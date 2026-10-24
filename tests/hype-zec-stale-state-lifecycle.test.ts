import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileAccountOrderLock, type AccountLockHandle } from "../lib/disdex-account-order-lock";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import { FileHypeZecLongRunnerStateStore, HYPE_ZEC_LONG_STATE_MAX_AGE_MS } from "../lib/hype-zec-long-runner-state";
import { evaluateHypeLongSignal } from "../lib/hype-zec-long-sleeves";
import { v4PeerOwners, type V4PeerKind, type V4PeerSource } from "../lib/v12-v4-peer-state-owners";

const SHA = "a".repeat(40);

function flatState(now: number, extra: Record<string, unknown> = {}) {
  return {
    schema: "disdex-hype-zec-long/v1" as const,
    runtimeCommitSha: SHA,
    mode: "SHADOW" as const,
    updatedAt: now - HYPE_ZEC_LONG_STATE_MAX_AGE_MS - 1,
    lastDecisionTs: now - HYPE_ZEC_LONG_STATE_MAX_AGE_MS - 1,
    lastDecision: { strategy: "HYPE_LONG" as const, signalTs: null, accepted: false, reason: "OLD_HEARTBEAT" },
    failures: [],
    ...extra,
  };
}

function signedFlatRead() {
  return {
    source: "ASTER_SIGNED_READ_ONLY" as const,
    positions: [],
    openOrders: [],
  };
}

function acceptedHypeMarket(now: number) {
  const step = 15 * 60_000;
  const candles = (lastClose: number) => Array.from({ length: 30 }, (_, index) => {
    const close = index < 29 ? 100 : lastClose;
    const previous = index === 0 ? 100 : index === 29 ? 100 : 100;
    return { ts: now - 30 * step + index * step, open: previous, high: Math.max(previous, close) * 1.001, low: Math.min(previous, close) * 0.999, close, volume: 100 + index };
  });
  return {
    btc15m: candles(100.1),
    btc1h: [],
    hype15m: candles(100.5),
    hype1h: [],
    hype1m: [{ ts: now, open: 100.5, high: 100.8, low: 100.4, close: 100.7, volume: 10_000 }],
    zec15m: [],
    zec1m: [],
  };
}

async function withAccountOrderLock<T>(root: string, callback: (lock: AccountLockHandle) => Promise<T>) {
  const lockStore = new FileAccountOrderLock(join(root, "account-order.lock"), 120_000, join(root, "pending.json"));
  const lock = await lockStore.acquire(`hype-zec-test:${process.pid}:${Date.now()}`);
  assert.ok(lock);
  try {
    return await callback(lock);
  } finally {
    await lock.release();
  }
}

function v4FlatSources(hypeRaw: Record<string, unknown>, sha: string, now: number): V4PeerSource[] {
  const oldSha = "b".repeat(40);
  const kinds: V4PeerKind[] = ["V12", "PENGU", "Q102", "V52", "FET", "HYPE_LONG", "IDLE", "RESIDUAL"];
  return kinds.map((kind) => {
    const runtime = kind === "V12" ? oldSha : sha;
    const raw: Record<string, any> = { updatedAt: now, runtimeCommitSha: runtime };
    if (kind === "V12") Object.assign(raw, { schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode: "LIVE" });
    if (kind === "PENGU") Object.assign(raw, { version: 2, strategyId: "PENGU_DUAL_LS_V2_FINAL", mode: "LIVE" });
    if (kind === "Q102") Object.assign(raw, { version: 1, strategyId: "QUALITY102_CAUSAL_V1" });
    if (kind === "V52") raw.positions = {};
    if (kind === "FET") Object.assign(raw, { schema: "fet-brk48-residual-state/v1", strategyId: "FET_BRK48_RESIDUAL" });
    if (kind === "HYPE_LONG") Object.assign(raw, hypeRaw);
    if (kind === "IDLE") Object.assign(raw, { schema: "disdex-idle-priority-state/v2", positions: [] });
    if (kind === "RESIDUAL") raw.schema = "disdex-idle-residual-long-state/v1";
    return {
      kind,
      programSha: runtime,
      raw,
      service: {
        unit: kind === "V12" ? `retired-v12@${oldSha}.service` : `disdex-${kind.toLowerCase()}@${sha}.service`,
        active: kind !== "V12",
        retiredV12: kind === "V12",
        observedAt: now,
        mainPid: kind === "V12" ? 0 : 1,
      },
    };
  });
}

test("HYPE LONG stale recovery requires an account-lock capability at the mutating boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-stale-lock-required-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  await writeFile(statePath, `${JSON.stringify(flatState(now), null, 2)}\n`, { mode: 0o600 });
  const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");

  await assert.rejects(
    () => store.recoverFlatStaleState({ reason: "ASTER_SIGNED_FLAT_READBACK", now, venue: signedFlatRead() } as any),
    /HYPE_ZEC_LONG_STALE_RECOVERY_LOCK_REQUIRED/,
  );
});

test("HYPE LONG stale flat recovery requires a signed flat read, exact non-overwriting backup, and atomic audited heartbeat", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-stale-recovery-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  const before = flatState(now, { futureField: { preserve: true } });
  const beforeBytes = `${JSON.stringify(before, null, 2)}\n`;
  await writeFile(statePath, beforeBytes, { mode: 0o600 });

  const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");
  const result = await withAccountOrderLock(root, (lock) => store.recoverFlatStaleState({
    reason: "ASTER_SIGNED_FLAT_READBACK",
    now,
    venue: signedFlatRead(),
    lock,
  }));

  assert.equal(result.status, "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS");
  assert.equal(result.ordersSent, 0);
  assert.equal(result.cancelsSent, 0);
  assert.equal(result.positionChangesSent, 0);
  assert.ok(result.backupPath);
  assert.equal(await readFile(result.backupPath!, "utf8"), beforeBytes);
  assert.equal((await stat(result.backupPath!)).isFile(), true);

  const after = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(after.runtimeCommitSha, SHA);
  assert.equal(after.mode, "SHADOW");
  assert.deepEqual(after.futureField, { preserve: true });
  assert.equal(after.lastDecision.reason, "HYPE_ZEC_STALE_FLAT_RECONCILED:ASTER_SIGNED_FLAT_READBACK");
  assert.equal(after.failures.at(-1).message, "HYPE_ZEC_STALE_FLAT_RECONCILED:ASTER_SIGNED_FLAT_READBACK");
  assert.equal(after.updatedAt, now);
});

test("HYPE LONG stale recovery emits a V4-CERTIFIED canonical flat state without positions:null", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-stale-v4-canonical-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  const before = flatState(now, { mode: "LIVE", positions: null });
  await writeFile(statePath, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });
  const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "LIVE");

  const result = await withAccountOrderLock(root, (lock) => store.recoverFlatStaleState({
    reason: "ASTER_SIGNED_FLAT_READBACK",
    now,
    venue: signedFlatRead(),
    lock,
  }));
  assert.equal(result.status, "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS");

  const recoveredRaw = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(Object.hasOwn(recoveredRaw, "positions"), false);
  assert.deepEqual(v4PeerOwners(v4FlatSources(recoveredRaw, SHA, now), SHA, now, "ATTEST_EACH_PEER"), []);
});

test("HYPE LONG stale recovery refuses unsafe local state and defensive venue evidence without writing a heartbeat", async () => {
  const cases = [
    { name: "position", extra: { positions: [{ symbol: "HYPEUSDT", quantity: 1 }] }, venue: signedFlatRead(), error: /STALE_FLAT_RECOVERY_NOT_FLAT/ },
    { name: "pending", extra: { pending: { phase: "planned" } }, venue: signedFlatRead(), error: /STALE_FLAT_RECOVERY_NOT_FLAT/ },
    { name: "manual-review", extra: { manualReview: "operator review" }, venue: signedFlatRead(), error: /STALE_FLAT_RECOVERY_NOT_FLAT/ },
    { name: "venue-position", extra: {}, venue: { ...signedFlatRead(), positions: [{ symbol: "ZECUSDT", quantity: 1 }] }, error: /STALE_RECOVERY_VENUE_NOT_FLAT/ },
    { name: "foreign-venue-position", extra: {}, venue: { ...signedFlatRead(), positions: [{ symbol: "AAVEUSDT", quantity: 1 }] }, error: /STALE_RECOVERY_VENUE_FOREIGN_NONZERO_POSITION/ },
    { name: "venue-order", extra: {}, venue: { ...signedFlatRead(), openOrders: [{ symbol: "HYPEUSDT", quantity: 1, status: "NEW" }] }, error: /STALE_RECOVERY_VENUE_NOT_FLAT/ },
    { name: "unsigned", extra: {}, venue: { source: "ASTER_PUBLIC_READ" as const, positions: [], openOrders: [] }, error: /STALE_RECOVERY_SIGNED_READ_REQUIRED/ },
  ];

  for (const entry of cases) {
    const root = await mkdtemp(join(tmpdir(), `hype-zec-stale-refuse-${entry.name}-`));
    const statePath = join(root, "runner.json");
    const now = Date.now();
    const before = flatState(now, entry.extra);
    const beforeBytes = `${JSON.stringify(before, null, 2)}\n`;
    await writeFile(statePath, beforeBytes, { mode: 0o600 });
    const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");

    await withAccountOrderLock(root, (lock) => assert.rejects(
      () => store.recoverFlatStaleState({ reason: "ASTER_SIGNED_FLAT_READBACK", now, venue: entry.venue as any, lock }),
      entry.error,
    ));
    assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  }
});

test("HYPE LONG stale recovery rejects incomplete signed rows and any defensive ZEC residual order", async () => {
  const cases = [
    { name: "position-missing-symbol", venue: { ...signedFlatRead(), positions: [{ quantity: 0 }] } },
    { name: "position-unknown-symbol", venue: { ...signedFlatRead(), positions: [{ symbol: "UNKNOWN", quantity: 0 }] } },
    { name: "position-non-finite", venue: { ...signedFlatRead(), positions: [{ symbol: "HYPEUSDT", quantity: Number.NaN }] } },
    { name: "order-missing-symbol", venue: { ...signedFlatRead(), openOrders: [{ quantity: 0, status: "CANCELED" }] } },
    { name: "order-unknown-symbol", venue: { ...signedFlatRead(), openOrders: [{ symbol: "UNKNOWN", quantity: 0, status: "CANCELED" }] } },
    { name: "order-missing-status", venue: { ...signedFlatRead(), openOrders: [{ symbol: "BTCUSDT", quantity: 0 }] } },
    { name: "order-unknown-status", venue: { ...signedFlatRead(), openOrders: [{ symbol: "BTCUSDT", quantity: 0, status: "MAYBE" }] } },
    { name: "order-non-finite-quantity", venue: { ...signedFlatRead(), openOrders: [{ symbol: "BTCUSDT", quantity: Number.POSITIVE_INFINITY, status: "CANCELED" }] } },
    { name: "terminal-zec-order", venue: { ...signedFlatRead(), openOrders: [{ symbol: "ZECUSDT", quantity: 0, status: "CANCELED" }] } },
  ];

  for (const entry of cases) {
    const root = await mkdtemp(join(tmpdir(), `hype-zec-stale-venue-invalid-${entry.name}-`));
    const statePath = join(root, "runner.json");
    const now = Date.now();
    const beforeBytes = `${JSON.stringify(flatState(now), null, 2)}\n`;
    await writeFile(statePath, beforeBytes, { mode: 0o600 });
    const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");

    await withAccountOrderLock(root, (lock) => assert.rejects(
      () => store.recoverFlatStaleState({ reason: "ASTER_SIGNED_FLAT_READBACK", now, venue: entry.venue as any, lock }),
      /HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_/,
    ));
    assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  }
});

test("HYPE LONG stale recovery keeps malformed, mismatched, and colliding state fail-closed", async () => {
  const cases = [
    { name: "malformed-json", bytes: "{not-json", error: /HYPE_ZEC_LONG_STATE_MALFORMED/ },
    { name: "schema-mismatch", raw: { ...flatState(Date.now()), schema: "other/v1" }, error: /HYPE_ZEC_LONG_STATE_MALFORMED/ },
    { name: "sha-mismatch", raw: { ...flatState(Date.now()), runtimeCommitSha: "b".repeat(40) }, error: /RUNTIME_SHA_MISMATCH/ },
    { name: "mode-mismatch", raw: { ...flatState(Date.now()), mode: "LIVE" }, error: /MODE_MISMATCH/ },
    { name: "positions-malformed", raw: { ...flatState(Date.now()), positions: { symbol: "HYPEUSDT" } }, error: /HYPE_ZEC_LONG_STATE_MALFORMED/ },
  ];

  for (const entry of cases) {
    const root = await mkdtemp(join(tmpdir(), `hype-zec-stale-invalid-${entry.name}-`));
    const statePath = join(root, "runner.json");
    const beforeBytes = entry.bytes || `${JSON.stringify(entry.raw, null, 2)}\n`;
    await writeFile(statePath, beforeBytes, { mode: 0o600 });
    const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");
    await withAccountOrderLock(root, (lock) => assert.rejects(
      () => store.recoverFlatStaleState({ reason: "ASTER_SIGNED_FLAT_READBACK", now: Date.now(), venue: signedFlatRead(), lock }),
      entry.error,
    ));
    assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  }

  const root = await mkdtemp(join(tmpdir(), "hype-zec-stale-backup-collision-"));
  const statePath = join(root, "runner.json");
  const now = Date.now();
  const before = flatState(now);
  const beforeBytes = `${JSON.stringify(before, null, 2)}\n`;
  await writeFile(statePath, beforeBytes, { mode: 0o600 });
  const backupPath = `${statePath}.before-stale-flat-recovery-${now}`;
  await writeFile(backupPath, "existing backup\n", { mode: 0o600 });
  const store = new FileHypeZecLongRunnerStateStore(statePath, SHA, "SHADOW");
  await withAccountOrderLock(root, (lock) => assert.rejects(
    () => store.recoverFlatStaleState({ reason: "ASTER_SIGNED_FLAT_READBACK", now, venue: signedFlatRead(), lock }),
    /BACKUP_EXISTS/,
  ));
  assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  assert.equal(await readFile(backupPath, "utf8"), "existing backup\n");
});

test("authoritative HYPE stale recovery stays under the account lock and stops the recovery tick before any normal path", async () => {
  const now = Date.now();
  const state = flatState(now, { updatedAt: now });
  let loadCalls = 0;
  let saveCalls = 0;
  let recoveryCalls = 0;
  let orderCalls = 0;
  let cancelCalls = 0;
  let positionMutationCalls = 0;
  let positionReads = 0;
  let orderReads = 0;

  const stateStore = {
    async load() {
      loadCalls += 1;
      if (loadCalls <= 2) throw new Error("HYPE_ZEC_LONG_STATE_STALE");
      throw new Error("UNEXPECTED_SECOND_STATE_LOAD");
    },
    async recoverFlatStaleState(input: unknown) {
      recoveryCalls += 1;
      assert.equal(typeof (input as { lock?: { document?: unknown } }).lock?.document, "function");
      assert.deepEqual({ ...(input as Record<string, unknown>), lock: undefined }, {
        reason: "ASTER_SIGNED_FLAT_READBACK",
        venue: { source: "ASTER_SIGNED_READ_ONLY", positions: [], openOrders: [] },
        lock: undefined,
      });
      return { status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS", state, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0, backupPath: "backup" };
    },
    async save() { saveCalls += 1; },
  };
  const runtime = {
    mode: "SHADOW" as const,
    enabled: true,
    liveExecutionEnabled: false,
    productionConfigLiveEnabled: false,
    operatorArmed: false,
    runtimeSha: SHA,
    statePath: "runner.json",
    pendingExposurePath: "pending.json",
    sharedRiskPath: "risk.json",
    maximumGross: 0.1,
    maximumReductionFraction: 0.5,
    hypeRiskPct: 5,
    zecRiskPct: 4.5,
    maximumEntryDelayMs: 20 * 60_000,
    maximumSlippageBps: 20,
    feeBpsPerSide: 4,
    fundingBps: 2,
    cryptoGrossCap: 1,
    totalGrossCap: 1,
    signalMode: "LEGACY" as const,
    symbols: ["HYPEUSDT"] as const,
  };
  const flatExecutor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getPositions() { positionReads += 1; return []; },
    async getOpenOrders() { orderReads += 1; return []; },
    async getHypeZecPositions() { positionReads += 1; return []; },
    async getHypeZecOpenOrders() { orderReads += 1; return []; },
    async getMarketQuote() { throw new Error("quote must not be read for flat stale recovery"); },
    async normalizeMarketQuantity() { positionMutationCalls += 1; throw new Error("must not normalize in recovery"); },
    async executeMarket() { orderCalls += 1; throw new Error("must not place an order in recovery"); },
    async reconcileOrder() { positionMutationCalls += 1; throw new Error("must not reconcile an order in recovery"); },
  };
  const adapter = {
    async cancel() { cancelCalls += 1; throw new Error("must not cancel in recovery"); },
    async placeStopMarket() { orderCalls += 1; throw new Error("must not place protection in recovery"); },
    async placeTakeProfit() { orderCalls += 1; throw new Error("must not place protection in recovery"); },
  };
  const lock = {
    async acquire() {
      return {
        async document() { return {}; },
        async renew() { return {}; },
        async reserve() { throw new Error("must not reserve in recovery"); },
        async releaseReservation() {},
        async release() {},
      };
    },
  };

  const runner = new HypeZecLongRunner({
    marketData: { async load() { return { btc15m: [], btc1h: [], hype15m: [], hype1h: [], hype1m: [], zec15m: [], zec1m: [] }; } },
    executor: flatExecutor,
    adapter,
    stateStore,
    lock,
    runtime,
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();
  assert.equal(result.status, "held");
  assert.equal(result.message, "HYPE_ZEC_STALE_FLAT_RECOVERY_READ_ONLY");
  assert.equal(recoveryCalls, 1);
  assert.equal(loadCalls, 2);
  assert.equal(positionReads, 1);
  assert.equal(orderReads, 1);
  assert.equal(saveCalls, 0);
  assert.equal(orderCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(positionMutationCalls, 0);
});

test("successful HYPE stale recovery is read-only for its tick even when HYPEUSDT data is accepted", async () => {
  const now = Date.now();
  const root = await mkdtemp(join(tmpdir(), "hype-zec-recovery-read-only-tick-"));
  const sharedRiskPath = join(root, "shared-risk.json");
  await writeFile(sharedRiskPath, JSON.stringify({
    schema: "disdex-shared-crypto-daily-risk/v1",
    accountScope: "ASTER_FUTURES",
    utcDay: new Date(now).toISOString().slice(0, 10),
    strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL", "HYPE_LONG", "IDLE_PRIORITY_SHORT"],
    lossPct: 0,
    maximumLossPct: 5,
    tripped: false,
    updatedAt: now,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl: 0,
    referenceEquity: 1000,
    sourceComplete: true,
  }), { mode: 0o600 });
  const state = flatState(now, { updatedAt: now });
  const market = acceptedHypeMarket(now);
  const signal = evaluateHypeLongSignal({ now, btc15m: market.btc15m, symbol15m: market.hype15m, symbol1m: market.hype1m });
  assert.equal(signal.accepted, true);

  let loadCalls = 0;
  let marketLoads = 0;
  let saveCalls = 0;
  let quoteCalls = 0;
  let reserveCalls = 0;
  let normalizeCalls = 0;
  let executeCalls = 0;
  let cancelCalls = 0;
  let protectionCalls = 0;
  let positionMutationCalls = 0;
  const stateStore = {
    async load() {
      loadCalls += 1;
      if (loadCalls <= 2) throw new Error("HYPE_ZEC_LONG_STATE_STALE");
      return state;
    },
    async recoverFlatStaleState(input: any) {
      assert.equal(typeof input.lock?.document, "function");
      return { status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS", state, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0, backupPath: "backup" };
    },
    async save() { saveCalls += 1; },
  };
  const runtime = {
    mode: "SHADOW" as const,
    enabled: true,
    liveExecutionEnabled: false,
    productionConfigLiveEnabled: false,
    operatorArmed: false,
    runtimeSha: SHA,
    statePath: "runner.json",
    pendingExposurePath: "pending.json",
    sharedRiskPath,
    maximumGross: 0.1,
    maximumReductionFraction: 0.5,
    hypeRiskPct: 5,
    zecRiskPct: 4.5,
    maximumEntryDelayMs: 20 * 60_000,
    maximumSlippageBps: 20,
    feeBpsPerSide: 4,
    fundingBps: 2,
    cryptoGrossCap: 1,
    totalGrossCap: 1,
    signalMode: "LEGACY" as const,
    symbols: ["HYPEUSDT"] as const,
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getPositions() { return []; },
    async getOpenOrders() { return []; },
    async getHypeZecPositions() { return []; },
    async getHypeZecOpenOrders() { return []; },
    async getMarketQuote() {
      quoteCalls += 1;
      return { symbol: "HYPEUSDT", bidPrice: 100.6, askPrice: 100.7, bidQuantity: 100, askQuantity: 100, midPrice: 100.65, updatedAt: now };
    },
    async normalizeMarketQuantity() { normalizeCalls += 1; throw new Error("must not normalize during recovery tick"); },
    async executeMarket() { executeCalls += 1; throw new Error("must not execute during recovery tick"); },
    async reconcileOrder() { positionMutationCalls += 1; throw new Error("must not reconcile during recovery tick"); },
  };
  const lock = {
    async acquire() {
      return {
        async document() { return {}; },
        async renew() { return {}; },
        async reserve() { reserveCalls += 1; throw new Error("must not reserve during recovery tick"); },
        async releaseReservation() {},
        async release() {},
      };
    },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { marketLoads += 1; return market; } },
    executor,
    adapter: {
      client: {
        async getExchangeInfo() {
          return { symbols: [{ symbol: "HYPEUSDT", status: "TRADING", filters: [{ filterType: "PRICE_FILTER", tickSize: "0.1" }, { filterType: "LOT_SIZE", stepSize: "0.001" }] }] };
        },
      },
      async cancel() { cancelCalls += 1; },
      async placeStopMarket() { protectionCalls += 1; },
      async placeTakeProfit() { protectionCalls += 1; },
    },
    stateStore,
    lock,
    runtime,
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const recoveredTick = await runner.tick();
  assert.equal(recoveredTick.status, "held");
  assert.equal(recoveredTick.message, "HYPE_ZEC_STALE_FLAT_RECOVERY_READ_ONLY");
  assert.equal(loadCalls, 2);
  assert.equal(marketLoads, 0);
  assert.equal(saveCalls, 0);
  assert.equal(quoteCalls, 0);
  assert.equal(reserveCalls, 0);
  assert.equal(normalizeCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(protectionCalls, 0);
  assert.equal(positionMutationCalls, 0);

  const freshTick = await runner.tick();
  assert.equal(freshTick.status, "no-change");
  assert.equal(freshTick.message, "HYPE_ZEC_NO_ACCEPTED_ENTRY");
  assert.equal(loadCalls, 4);
  assert.equal(marketLoads, 1);
  assert.equal(saveCalls, 2);
  assert.ok(quoteCalls > 0);
  assert.equal(reserveCalls, 0);
  assert.equal(normalizeCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(protectionCalls, 0);
  assert.equal(positionMutationCalls, 0);
});

test("authoritative HYPE runner failure preserves the original error without a second unverified state load", async () => {
  const now = Date.now();
  const state = flatState(now, { updatedAt: now });
  let loadCalls = 0;
  let saveCalls = 0;
  let orderCalls = 0;
  let cancelCalls = 0;
  let positionMutationCalls = 0;
  const stateStore = {
    async load() {
      loadCalls += 1;
      return state;
    },
    async recoverFlatStaleState(input: any) {
      assert.equal(typeof input.lock?.document, "function");
      return { status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS", state, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0, backupPath: "backup" };
    },
    async save() { saveCalls += 1; },
  };
  const runtime = {
    mode: "SHADOW" as const,
    enabled: true,
    liveExecutionEnabled: false,
    productionConfigLiveEnabled: false,
    operatorArmed: false,
    runtimeSha: SHA,
    statePath: "runner.json",
    pendingExposurePath: "pending.json",
    sharedRiskPath: "risk.json",
    maximumGross: 0.1,
    maximumReductionFraction: 0.5,
    hypeRiskPct: 5,
    zecRiskPct: 4.5,
    maximumEntryDelayMs: 20 * 60_000,
    maximumSlippageBps: 20,
    feeBpsPerSide: 4,
    fundingBps: 2,
    cryptoGrossCap: 1,
    totalGrossCap: 1,
    signalMode: "LEGACY" as const,
    symbols: ["HYPEUSDT"] as const,
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getPositions() { return []; },
    async getOpenOrders() { return []; },
    async getMarketQuote() { throw new Error("must not quote"); },
    async normalizeMarketQuantity() { positionMutationCalls += 1; throw new Error("must not normalize"); },
    async executeMarket() { orderCalls += 1; throw new Error("must not order"); },
    async reconcileOrder() { positionMutationCalls += 1; throw new Error("must not reconcile"); },
  };
  const lock = {
    async acquire() {
      return {
        async document() { return {}; },
        async renew() { return {}; },
        async reserve() { throw new Error("must not reserve"); },
        async releaseReservation() {},
        async release() {},
      };
    },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { throw new Error("POST_RECOVERY_MARKET_DATA_FAILURE"); } },
    executor,
    adapter: {
      async cancel() { cancelCalls += 1; },
      async placeStopMarket() { orderCalls += 1; },
      async placeTakeProfit() { orderCalls += 1; },
    },
    stateStore,
    lock,
    runtime,
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();
  assert.equal(result.status, "manual-review");
  assert.match(result.message, /POST_RECOVERY_MARKET_DATA_FAILURE/);
  assert.equal(loadCalls, 2);
  assert.equal(saveCalls, 1);
  assert.equal(orderCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(positionMutationCalls, 0);
});

test("authoritative HYPE stale recovery refuses active residual exposure or a signed-read failure without state mutation", async () => {
  const now = Date.now();
  const runtime = {
    mode: "SHADOW" as const,
    enabled: true,
    liveExecutionEnabled: false,
    productionConfigLiveEnabled: false,
    operatorArmed: false,
    runtimeSha: SHA,
    statePath: "runner.json",
    pendingExposurePath: "pending.json",
    sharedRiskPath: "risk.json",
    maximumGross: 0.1,
    maximumReductionFraction: 0.5,
    hypeRiskPct: 5,
    zecRiskPct: 4.5,
    maximumEntryDelayMs: 20 * 60_000,
    maximumSlippageBps: 20,
    feeBpsPerSide: 4,
    fundingBps: 2,
    cryptoGrossCap: 1,
    totalGrossCap: 1,
    signalMode: "LEGACY" as const,
    symbols: ["HYPEUSDT"] as const,
  };
  for (const failure of ["HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_NOT_FLAT", "ASTER_READ_FAILED"]) {
    let loadCalls = 0;
    let saveCalls = 0;
    let orderCalls = 0;
    let cancelCalls = 0;
    const stateStore = {
      async load() {
        loadCalls += 1;
        throw new Error("HYPE_ZEC_LONG_STATE_STALE");
      },
      async recoverFlatStaleState() { throw new Error(failure); },
      async save() { saveCalls += 1; },
    };
    const executor = {
      async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
      async getPositions() {
        if (failure === "ASTER_READ_FAILED") throw new Error(failure);
        return [{ symbol: "HYPEUSDT", quantity: 1, entryPrice: 10, markPrice: 10, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 10, positionSide: "BOTH", leverage: 5, updatedAt: now }];
      },
      async getOpenOrders() { return []; },
      async getHypeZecPositions() {
        if (failure === "ASTER_READ_FAILED") throw new Error(failure);
        return [{ symbol: "HYPEUSDT", quantity: 1, entryPrice: 10, markPrice: 10, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 10, positionSide: "BOTH" as const, leverage: 5, updatedAt: now }];
      },
      async getHypeZecOpenOrders() { return []; },
      async getMarketQuote() { throw new Error("must not quote"); },
      async normalizeMarketQuantity() { throw new Error("must not normalize"); },
      async executeMarket() { orderCalls += 1; throw new Error("must not order"); },
      async reconcileOrder() { throw new Error("must not reconcile"); },
    };
    const lock = {
      async acquire() {
        return {
          async document() { return {}; },
          async renew() { return {}; },
          async reserve() { throw new Error("must not reserve"); },
          async releaseReservation() {},
          async release() {},
        };
      },
    };
    const runner = new HypeZecLongRunner({
      marketData: { async load() { throw new Error("must not load market data"); } },
      executor,
      adapter: {
        async cancel() { cancelCalls += 1; },
        async placeStopMarket() { orderCalls += 1; },
        async placeTakeProfit() { orderCalls += 1; },
      },
      stateStore,
      lock,
      runtime,
      now: () => now,
      logger: { info() {}, warn() {}, error() {} },
    } as any);

    const result = await runner.tick();
    assert.equal(result.status, "manual-review");
    assert.match(result.message, /HYPE_ZEC_STALE_STATE_RECOVERY_REFUSED/);
    assert.equal(loadCalls, 2);
    assert.equal(saveCalls, 0);
    assert.equal(orderCalls, 0);
    assert.equal(cancelCalls, 0);
  }
});

test("ordinary HYPE ticks do not treat a flat ZEC venue row as residual exposure", async () => {
  const now = Date.now();
  const state = flatState(now, { updatedAt: now, lastDecisionTs: now });
  let reconcileCalls = 0;
  let cancelCalls = 0;
  const stateStore = {
    async load() { return structuredClone(state); },
    async save() {},
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getPositions() { throw new Error("ordinary HYPE path must use the portfolio capability"); },
    async getOpenOrders() { throw new Error("ordinary HYPE path must use the portfolio capability"); },
    async getHypePortfolioPositions() {
      return [{ symbol: "ZECUSDT", quantity: 0, entryPrice: 0, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 0, positionSide: "BOTH" as const, leverage: 5, updatedAt: now }];
    },
    async getHypePortfolioOpenOrders() { return []; },
    async getMarketQuote() { throw new Error("flat HYPE tick must not require a quote"); },
    async normalizeMarketQuantity() { throw new Error("must not normalize a flat HYPE tick"); },
    async executeMarket() { throw new Error("must not execute a flat HYPE tick"); },
    async reconcileOrder() { reconcileCalls += 1; throw new Error("must not reconcile a flat ZEC row"); },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { return { btc15m: [], btc1h: [], hype15m: [], hype1h: [], hype1m: [], zec15m: [], zec1m: [] }; } },
    executor,
    adapter: { async cancel() { cancelCalls += 1; } },
    stateStore,
    lock: { async acquire() { return { async document() {}, async renew() {}, async reserve() {}, async releaseReservation() {}, async release() {} }; } },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: SHA,
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      sharedRiskPath: "risk.json",
      maximumGross: 0.1,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 20 * 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 1,
      totalGrossCap: 1,
      signalMode: "LEGACY",
      symbols: ["HYPEUSDT"],
    },
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();

  assert.equal(result.status, "no-change");
  assert.equal(result.message, "HYPE_ZEC_NO_ACCEPTED_ENTRY");
  assert.equal(reconcileCalls, 0);
  assert.equal(cancelCalls, 0);
});

test("any lowercase persisted ZEC state, even flat, is stopped before protection reconciliation", async () => {
  const now = Date.now();
  const state = flatState(now, {
    updatedAt: now,
    lastDecisionTs: now,
    positions: [{
      strategy: "ZEC_LONG",
      symbol: "zecusdt",
      side: "LONG",
      positionId: "legacy-zec-lowercase",
      quantity: 0,
      entryPrice: 100,
      entryTs: now - 60_000,
      signalTs: now - 60_000,
      stopPrice: 90,
      takeProfitPrice: 120,
      stopClientOrderId: "legacy-zec-stop",
      takeProfitClientOrderId: "legacy-zec-tp",
      stopReadBackAt: now,
      peakPrice: 100,
      updatedAt: now,
    }],
  });
  let reconcileCalls = 0;
  let cancelCalls = 0;
  const stateStore = {
    async load() { return structuredClone(state); },
    async save() {},
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getHypePortfolioPositions() { return []; },
    async getHypePortfolioOpenOrders() { return []; },
    async getPositions() { throw new Error("must not use a broad position read"); },
    async getOpenOrders() { throw new Error("must not use a broad order read"); },
    async reconcileOrder() { reconcileCalls += 1; throw new Error("must not reconcile legacy ZEC protection"); },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { throw new Error("must not load market data after ZEC review"); } },
    executor,
    adapter: { async cancel() { cancelCalls += 1; } },
    stateStore,
    lock: { async acquire() { return { async document() {}, async renew() {}, async reserve() {}, async releaseReservation() {}, async release() {} }; } },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: SHA,
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      sharedRiskPath: "risk.json",
      maximumGross: 0.1,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 20 * 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 1,
      totalGrossCap: 1,
      signalMode: "LEGACY",
      symbols: ["HYPEUSDT"],
    },
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();

  assert.equal(result.status, "manual-review");
  assert.match(result.message, /HYPE_LIVE_SCOPE_ZEC_RESIDUAL|HYPE_ZEC_PERSISTED_SYMBOL_INVALID/);
  assert.equal(reconcileCalls, 0);
  assert.equal(cancelCalls, 0);
});

test("stale recovery refuses to use a broad executor fallback when scoped capability is absent", async () => {
  const now = Date.now();
  let recoveryCalls = 0;
  let broadPositionReads = 0;
  const stateStore = {
    async load() { throw new Error("HYPE_ZEC_LONG_STATE_STALE"); },
    async recoverFlatStaleState() { recoveryCalls += 1; throw new Error("recovery must not receive a broad read"); },
    async save() {},
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: now }; },
    async getPositions() {
      broadPositionReads += 1;
      return [{ symbol: "AAVEUSDT", quantity: 1, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 100, positionSide: "BOTH" as const, leverage: 5, updatedAt: now }];
    },
    async getOpenOrders() { return []; },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { throw new Error("must not load market data after scoped capability refusal"); } },
    executor,
    adapter: {},
    stateStore,
    lock: { async acquire() { return { async document() {}, async renew() {}, async reserve() {}, async releaseReservation() {}, async release() {} }; } },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: SHA,
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      sharedRiskPath: "risk.json",
      maximumGross: 0.1,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 20 * 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 1,
      totalGrossCap: 1,
      signalMode: "LEGACY",
      symbols: ["HYPEUSDT"],
    },
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();

  assert.equal(result.status, "manual-review");
  assert.match(result.message, /HYPE_ZEC_STALE_RECOVERY_SCOPED_POSITION_CAPABILITY_REQUIRED/);
  assert.equal(recoveryCalls, 0);
  assert.equal(broadPositionReads, 0);
});
