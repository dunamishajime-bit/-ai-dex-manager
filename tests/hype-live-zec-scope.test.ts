import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import { evaluateZecLongSignal, type HypeZecCandle } from "../lib/hype-zec-long-sleeves";

const SHA = "a".repeat(40);

test("LIVE HYPE runner fails closed on legacy ZEC residuals before any ZEC mutation", async () => {
  const now = Date.now();
  let saveCalls = 0;
  let marketLoads = 0;
  let zecQuoteCalls = 0;
  let executeCalls = 0;
  let cancelCalls = 0;
  let protectionCalls = 0;
  const state = {
    schema: "disdex-hype-zec-long/v1" as const,
    runtimeCommitSha: SHA,
    mode: "LIVE" as const,
    updatedAt: now,
    positions: [{
      strategy: "ZEC_LONG" as const,
      symbol: "ZECUSDT" as const,
      side: "LONG" as const,
      positionId: "legacy-zec",
      quantity: 1,
      entryPrice: 100,
      entryTs: now - 60_000,
      signalTs: now - 60_000,
      stopPrice: 100,
      takeProfitPrice: 200,
      stopClientOrderId: "hz-stop-zec",
      takeProfitClientOrderId: "hz-tp-zec",
      stopReadBackAt: now,
      peakPrice: 100,
      updatedAt: now,
    }],
    failures: [],
  };
  const stateStore = {
    async load() { return state; },
    async save() { saveCalls += 1; },
  };
  const executor = {
    async getAccountSnapshot() { return { availableBalance: 1_000, walletBalance: 1_000, asset: "USDT", updatedAt: now }; },
    async getPositions() {
      return [{ symbol: "ZECUSDT", quantity: 1, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 100, positionSide: "BOTH" as const, leverage: 5, updatedAt: now }];
    },
    async getOpenOrders() {
      return [
        { symbol: "ZECUSDT", clientOrderId: "hz-stop-zec", orderId: 1, status: "NEW", side: "SELL" as const, type: "STOP_MARKET", reduceOnly: true, quantity: 1, executedQuantity: 0 },
        { symbol: "ZECUSDT", clientOrderId: "hz-tp-zec", orderId: 2, status: "NEW", side: "SELL" as const, type: "TAKE_PROFIT_MARKET", reduceOnly: true, quantity: 1, executedQuantity: 0 },
      ];
    },
    async getMarketQuote(symbol: string) {
      if (symbol === "ZECUSDT") zecQuoteCalls += 1;
      return { symbol, bidPrice: 90, askPrice: 91, bidQuantity: 10, askQuantity: 10, midPrice: 90.5, spreadBps: 10, updatedAt: now };
    },
    async normalizeMarketQuantity() { throw new Error("must not normalize a ZEC order"); },
    async executeMarket() { executeCalls += 1; throw new Error("must not execute a ZEC order"); },
    async reconcileOrder() { throw new Error("must not reconcile a ZEC order"); },
  };
  const adapter = {
    async cancel() { cancelCalls += 1; throw new Error("must not cancel a ZEC order"); },
    async placeStopMarket() { protectionCalls += 1; throw new Error("must not place ZEC protection"); },
    async placeTakeProfit() { protectionCalls += 1; throw new Error("must not place ZEC protection"); },
  };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { marketLoads += 1; return { btc15m: [], btc1h: [], hype15m: [], hype1h: [], hype1m: [], zec15m: [], zec1m: [] }; } },
    executor,
    adapter,
    stateStore,
    lock: {
      async acquire() {
        return { async document() {}, async renew() {}, async reserve() {}, async releaseReservation() {}, async release() {} };
      },
    },
    runtime: {
      mode: "LIVE",
      enabled: true,
      liveExecutionEnabled: true,
      productionConfigLiveEnabled: true,
      operatorArmed: true,
      runtimeSha: SHA,
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      sharedRiskPath: "risk.json",
      maximumGross: 1.5,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 20 * 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 3,
      totalGrossCap: 4.25,
      signalMode: "TREND",
      symbols: ["HYPEUSDT"],
    },
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();

  assert.equal(result.status, "manual-review");
  assert.match(result.message, /HYPE_LIVE_SCOPE_ZEC_RESIDUAL/);
  assert.equal(marketLoads, 0);
  assert.equal(zecQuoteCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(protectionCalls, 0);
  assert.equal(saveCalls, 1);
});

test("HYPE runner never evaluates a ZEC entry signal even in non-LIVE compatibility mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-scope-shadow-"));
  const now = Date.now();
  const step = 15 * 60_000;
  const candles = (lastClose: number): HypeZecCandle[] => Array.from({ length: 30 }, (_, index) => {
    const close = index < 29 ? 100 : lastClose;
    const previous = index === 0 ? 100 : index === 29 ? 100 : 100;
    return { ts: now - 30 * step + index * step, open: previous, high: Math.max(previous, close) * 1.001, low: Math.min(previous, close) * 0.999, close, volume: 100 + index };
  });
  const market = {
    btc15m: candles(100.08),
    btc1h: [],
    hype15m: [],
    hype1h: [],
    hype1m: [],
    zec15m: candles(100.8),
    zec1m: [{ ts: now, open: 100.8, high: 101.2, low: 100.7, close: 101, volume: 10_000 }],
  };
  const zecSignal = evaluateZecLongSignal({ now, btc15m: market.btc15m, symbol15m: market.zec15m, symbol1m: market.zec1m });
  assert.equal(zecSignal.accepted, true);
  await writeFile(join(root, "risk.json"), JSON.stringify({
    schema: "disdex-shared-crypto-daily-risk/v1",
    accountScope: "ASTER_FUTURES",
    utcDay: new Date(now).toISOString().slice(0, 10),
    strategyIds: ["HYPE_LONG"],
    lossPct: 0,
    maximumLossPct: 5,
    tripped: false,
    updatedAt: now,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl: 0,
    referenceEquity: 1_000,
    sourceComplete: true,
  }), { mode: 0o600 });

  let quoteCalls = 0;
  let executeCalls = 0;
  let saved: any;
  const state = { schema: "disdex-hype-zec-long/v1" as const, runtimeCommitSha: SHA, mode: "SHADOW" as const, updatedAt: now, failures: [] };
  const runner = new HypeZecLongRunner({
    marketData: { async load() { return market; } },
    stateStore: { async load() { return state; }, async save(next: any) { saved = next; } },
    lock: { async acquire() { return { async document() {}, async renew() {}, async reserve() {}, async releaseReservation() {}, async release() {} }; } },
    executor: {
      async getAccountSnapshot() { return { availableBalance: 1_000, walletBalance: 1_000, asset: "USDT", updatedAt: now }; },
      async getPositions() { return []; },
      async getOpenOrders() { return []; },
      async getMarketQuote() { quoteCalls += 1; throw new Error("must not read a ZEC quote"); },
      async normalizeMarketQuantity() { throw new Error("must not normalize a ZEC order"); },
      async executeMarket() { executeCalls += 1; throw new Error("must not execute a ZEC order"); },
      async reconcileOrder() { throw new Error("must not reconcile a ZEC order"); },
    },
    adapter: { async cancel() {}, async placeStopMarket() {}, async placeTakeProfit() {} },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: SHA,
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      sharedRiskPath: join(root, "risk.json"),
      maximumGross: 1,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 20 * 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 3,
      totalGrossCap: 4.25,
      signalMode: "LEGACY",
      symbols: ["ZECUSDT"],
    },
    now: () => now,
    logger: { info() {}, warn() {}, error() {} },
  } as any);

  const result = await runner.tick();

  assert.equal(result.status, "no-change");
  assert.equal(result.message, "HYPE_ZEC_NO_ACCEPTED_ENTRY");
  assert.equal(quoteCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(saved.lastDecision.strategy, "HYPE_LONG");
});
