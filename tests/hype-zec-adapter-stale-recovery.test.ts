import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import { FileHypeZecLongRunnerStateStore, HYPE_ZEC_LONG_STATE_MAX_AGE_MS } from "../lib/hype-zec-long-runner-state";
import type { AsterV3Client } from "../lib/aster-v3-client";
import { resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";

test("malformed raw Aster position evidence refuses stale recovery without heartbeat or order mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-adapter-stale-recovery-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  const stale = {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: "a".repeat(40),
    mode: "SHADOW",
    updatedAt: now - HYPE_ZEC_LONG_STATE_MAX_AGE_MS - 1,
    failures: [],
  };
  const beforeBytes = `${JSON.stringify(stale, null, 2)}\n`;
  await writeFile(statePath, beforeBytes, { mode: 0o600 });

  let orderMutations = 0;
  const client = {
    async getBalances() { return [{ asset: "USDT", balance: "1000", availableBalance: "1000" }]; },
    async getServerTime() { return { serverTime: Date.now() }; },
    async getPositions() {
      return [{
        symbol: "HYPEUSDT",
        positionAmt: "not-a-number",
        entryPrice: "100",
        markPrice: "100",
        positionSide: "BOTH",
        leverage: "5",
      }];
    },
    async getOpenOrders() { return []; },
    async newOrder() { orderMutations += 1; throw new Error("unexpected order mutation"); },
    async cancelOrder() { orderMutations += 1; throw new Error("unexpected cancel mutation"); },
    async setMarginType() { orderMutations += 1; throw new Error("unexpected margin mutation"); },
    async setLeverage() { orderMutations += 1; throw new Error("unexpected leverage mutation"); },
  } as unknown as AsterV3Client;
  const executor = new AsterDirectTradeExecutor(client);
  const runtime = resolveHypeZecLongRuntime({
    NODE_ENV: "test",
    DISDEX_HYPE_ZEC_MODE: "SHADOW",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "a".repeat(40),
    DISDEX_HYPE_ZEC_SIGNAL_MODE: "TREND",
    DISDEX_HYPE_ZEC_SYMBOLS: "HYPEUSDT",
  });
  const store = new FileHypeZecLongRunnerStateStore(statePath, "a".repeat(40), "SHADOW");
  const lock = new FileAccountOrderLock(join(root, "account-order.lock"), 120_000, join(root, "pending.json"));
  const runner = new HypeZecLongRunner({
    runtime,
    stateStore: store,
    lock,
    executor,
    marketData: { async load() { throw new Error("market data must not be used after malformed recovery evidence"); } },
    adapter: {} as any,
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await runner.tick();

  assert.equal(result.status, "manual-review");
  assert.match(result.message, /HYPE_ZEC_STALE_STATE_RECOVERY_REFUSED/);
  assert.match(result.message, /ASTER_POSITION/);
  assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  assert.equal(orderMutations, 0);
  assert.equal((await readdir(root)).some((entry) => entry.includes("before-stale-flat-recovery")), false);
});

test("AsterDirectTradeExecutor rejects malformed open-order evidence instead of normalizing it away", async () => {
  for (const [label, row] of [
    ["missing symbol", { status: "NEW", origQty: "1", executedQty: "0" }],
    ["missing status", { symbol: "HYPEUSDT", origQty: "1", executedQty: "0" }],
    ["invalid quantity", { symbol: "HYPEUSDT", status: "NEW", origQty: "not-a-number", executedQty: "0" }],
    ["invalid stop", { symbol: "HYPEUSDT", status: "NEW", type: "STOP_MARKET", origQty: "1", executedQty: "0", stopPrice: "not-a-number" }],
  ] as const) {
    const client = { async getOpenOrders() { return [row]; } } as unknown as AsterV3Client;
    await assert.rejects(
      () => new AsterDirectTradeExecutor(client).getOpenOrders(),
      /ASTER_OPEN_ORDER|ASTER_VENUE_SYMBOL/,
      label,
    );
  }
});

test("HYPE stale recovery uses only HYPE/ZEC symbol-scoped reads when the account has unrelated rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-scoped-stale-recovery-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  await writeFile(statePath, JSON.stringify({
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: "a".repeat(40),
    mode: "SHADOW",
    updatedAt: now - HYPE_ZEC_LONG_STATE_MAX_AGE_MS - 1,
    failures: [],
  }), { mode: 0o600 });

  const positionSymbols: Array<string | undefined> = [];
  const orderSymbols: Array<string | undefined> = [];
  const client = {
    async getBalances() { return [{ asset: "USDT", balance: "1000", availableBalance: "1000" }]; },
    async getServerTime() { return { serverTime: Date.now() }; },
    async getPositions(symbol?: string) {
      positionSymbols.push(symbol);
      if (!symbol) return [{ symbol: "AAPLUSDC", positionAmt: "0", entryPrice: "0", markPrice: "100", positionSide: "BOTH", leverage: "5" }];
      return [{ symbol, positionAmt: "0", entryPrice: "0", markPrice: "100", positionSide: "BOTH", leverage: "5" }];
    },
    async getOpenOrders(symbol?: string) {
      orderSymbols.push(symbol);
      if (!symbol) return [{ symbol: "AAPLUSDC", status: "NEW", origQty: "1", executedQty: "0" }];
      return [];
    },
  } as unknown as AsterV3Client;
  const runtime = resolveHypeZecLongRuntime({
    NODE_ENV: "test",
    DISDEX_HYPE_ZEC_MODE: "SHADOW",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "a".repeat(40),
    DISDEX_HYPE_ZEC_SIGNAL_MODE: "TREND",
    DISDEX_HYPE_ZEC_SYMBOLS: "HYPEUSDT",
  });
  const runner = new HypeZecLongRunner({
    runtime,
    stateStore: new FileHypeZecLongRunnerStateStore(statePath, "a".repeat(40), "SHADOW"),
    lock: new FileAccountOrderLock(join(root, "account-order.lock"), 120_000, join(root, "pending.json")),
    executor: new AsterDirectTradeExecutor(client),
    marketData: { async load() { throw new Error("market data must not load during stale recovery"); } },
    adapter: {} as any,
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await runner.tick();

  assert.equal(result.status, "held");
  assert.equal(result.message, "HYPE_ZEC_STALE_FLAT_RECOVERY_READ_ONLY");
  assert.deepEqual(positionSymbols, ["HYPEUSDT", "ZECUSDT"]);
  assert.deepEqual(orderSymbols, ["HYPEUSDT", "ZECUSDT"]);
});

test("HYPE portfolio reads preserve managed USDT crypto while ignoring only verified-flat foreign rows", async () => {
  const client = {
    async getPositions() {
      return [
        { symbol: "HYPEUSDT", positionAmt: "0", entryPrice: "0", markPrice: "100", positionSide: "BOTH", leverage: "5" },
        { symbol: "AAVEUSDT", positionAmt: "2", entryPrice: "100", markPrice: "101", positionSide: "BOTH", leverage: "5" },
        { symbol: "NEARUSDT", positionAmt: "3", entryPrice: "4", markPrice: "4.1", positionSide: "BOTH", leverage: "5" },
        { symbol: "AAPLUSDC", positionAmt: "0", entryPrice: "0", markPrice: "0", positionSide: "BOTH", leverage: "5" },
      ];
    },
  } as unknown as AsterV3Client;

  const positions = await new AsterDirectTradeExecutor(client).getHypePortfolioPositions();

  assert.deepEqual(positions.map((position) => position.symbol), ["HYPEUSDT", "AAVEUSDT", "NEARUSDT"]);
});

test("HYPE portfolio reads reject nonzero foreign position rows instead of treating the account as flat", async () => {
  const client = {
    async getPositions() {
      return [{
        symbol: "AAPLUSDC",
        positionAmt: "1",
        entryPrice: "100",
        markPrice: "100",
        positionSide: "BOTH",
        leverage: "5",
      }];
    },
  } as unknown as AsterV3Client;

  await assert.rejects(
    () => new AsterDirectTradeExecutor(client).getHypePortfolioPositions(),
    /ASTER_HYPE_PORTFOLIO_UNKNOWN_NONZERO_POSITION/,
  );
});

test("HYPE portfolio reads ignore a Unicode foreign row only after proving its quantity is flat", async () => {
  const client = {
    async getPositions() {
      return [{
        symbol: "MÜNCHENUSDT",
        positionAmt: "0",
        entryPrice: "not-used-for-flat-row",
        markPrice: "not-used-for-flat-row",
        positionSide: "BOTH",
        leverage: "not-used-for-flat-row",
      }];
    },
  } as unknown as AsterV3Client;

  const positions = await new AsterDirectTradeExecutor(client).getHypePortfolioPositions();

  assert.deepEqual(positions, []);
});
