import assert from "node:assert/strict";
import { test } from "node:test";

import type { DirectOpenOrder, DirectPosition, DirectTradeExecutor, DirectTradeResult } from "../lib/direct-trade-executor";
import type { HypeZecPreemptionPlan } from "../lib/hype-zec-preemption";
import { executeHypeZecPreemption, type HypeZecPreemptionStateStore } from "../lib/hype-zec-preemption-executor";

const NOW = 1_760_000_000_000;

function position(strategy: "HYPE_LONG" | "ZEC_LONG" = "HYPE_LONG"): DirectPosition {
  return {
    symbol: strategy === "HYPE_LONG" ? "HYPEUSDT" : "ZECUSDT",
    quantity: 10,
    entryPrice: strategy === "HYPE_LONG" ? 20 : 100,
    markPrice: strategy === "HYPE_LONG" ? 22 : 110,
    unrealizedPnl: 0,
    pnlPct: 0,
    notionalUsd: strategy === "HYPE_LONG" ? 220 : 1_100,
    positionSide: "BOTH",
    leverage: 5,
    updatedAt: NOW,
  };
}

function plan(overrides: Partial<HypeZecPreemptionPlan> = {}): HypeZecPreemptionPlan {
  return {
    status: "planned",
    reason: "PRIORITY_ENTRY_REQUIRES_SIDECAR_PREEMPTION",
    requiredGross: 0.25,
    releasedGross: 0.25,
    reductions: [{
      strategy: "HYPE_LONG",
      symbol: "HYPEUSDT",
      positionId: "aster:HYPEUSDT:BOTH",
      reducedQuantity: 5,
      reducedFraction: 0.5,
      releasedGross: 0.25,
      reason: "PRIORITY_ENTRY_CAPACITY_PREEMPTION",
    }],
    ...overrides,
  };
}

function protectionOrders(quantity = 10): DirectOpenOrder[] {
  return [
    { symbol: "HYPEUSDT", clientOrderId: "hz-stop-old", side: "SELL", status: "NEW", type: "STOP_MARKET", stopPrice: 19, reduceOnly: true, quantity, executedQuantity: 0 },
    { symbol: "HYPEUSDT", clientOrderId: "hz-tp-old", side: "SELL", status: "NEW", type: "TAKE_PROFIT_MARKET", stopPrice: 24, reduceOnly: true, quantity, executedQuantity: 0 },
  ];
}

function executorFixture() {
  let current = position();
  let orders = protectionOrders();
  const mutations: string[] = [];
  const direct: DirectTradeExecutor = {
    async getAccountSnapshot() { return { availableBalance: 1_000, walletBalance: 1_000, asset: "USDT", updatedAt: NOW }; },
    async getPositions() { return current.quantity > 0 ? [current] : []; },
    async getOpenOrders() { return orders; },
    async getMarketQuote(symbol) { return { symbol, bidPrice: 21.9, askPrice: 22.1, bidQuantity: 100, askQuantity: 100, midPrice: 22, spreadBps: 90, updatedAt: NOW }; },
    async normalizeMarketQuantity(symbol, requestedQuantity, referencePrice) { return { symbol, quantity: requestedQuantity, quantityText: String(requestedQuantity), minQuantity: 0.001, maxQuantity: 10_000, stepSize: 1, minNotional: 5, notional: requestedQuantity * referencePrice }; },
    async executeMarket(command) {
      mutations.push(`market:${command.symbol}:${command.side}:${command.quantity}:${command.reduceOnly}`);
      current = { ...current, quantity: current.quantity - command.quantity, notionalUsd: (current.quantity - command.quantity) * current.markPrice };
      return {
        requestId: command.requestId,
        clientOrderId: command.clientOrderId,
        symbol: command.symbol,
        side: command.side,
        status: "FILLED",
        requestedQuantity: command.quantity,
        submittedQuantity: command.quantity,
        executedQuantity: command.quantity,
        averagePrice: 21.9,
        quoteQuantity: command.quantity * 21.9,
        reduceOnly: true,
        executionUnknown: false,
        reconciled: false,
      } satisfies DirectTradeResult;
    },
    async reconcileOrder() { throw new Error("not expected"); },
  };
  const adapter = {
    async getOpenOrders() { return orders; },
    async cancel(clientOrderId: string) {
      mutations.push(`cancel:${clientOrderId}`);
      orders = orders.filter((order) => order.clientOrderId !== clientOrderId);
    },
    async placeStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) {
      mutations.push(`stop:${input.clientOrderId}:${input.quantity}`);
      orders = [...orders, { symbol: input.symbol, clientOrderId: input.clientOrderId, side: input.side, status: "NEW", type: "STOP_MARKET", stopPrice: input.stopPrice, reduceOnly: true, quantity: input.quantity, executedQuantity: 0 }];
      return { acknowledged: true };
    },
    async placeTakeProfit(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) {
      mutations.push(`tp:${input.clientOrderId}:${input.quantity}`);
      orders = [...orders, { symbol: input.symbol, clientOrderId: input.clientOrderId, side: input.side, status: "NEW", type: "TAKE_PROFIT_MARKET", stopPrice: input.stopPrice, reduceOnly: true, quantity: input.quantity, executedQuantity: 0 }];
      return { acknowledged: true };
    },
  };
  return { direct, adapter, mutations, get position() { return current; }, get orders() { return orders; } };
}

function memoryState(): HypeZecPreemptionStateStore {
  let state: any = { schema: "disdex-hype-zec-preemption/v1", runtimeCommitSha: "test", updatedAt: NOW };
  return {
    async load() { return structuredClone(state); },
    async save(next) { state = structuredClone(next); },
  };
}

test("requires a verified shared account lock before any sidecar reduction", async () => {
  const fixture = executorFixture();
  const result = await executeHypeZecPreemption({
    plan: plan(), executor: fixture.direct, adapter: fixture.adapter, stateStore: memoryState(),
    now: () => NOW, expectedRuntimeSha: "test", protection: { HYPE_LONG: { stopPrice: 19, takeProfitPrice: 24, tickSize: 0.01, stepSize: 1 } },
  });
  assert.equal(result.status, "blocked");
  assert.match(result.message, /ACCOUNT_LOCK_REQUIRED/);
  assert.deepEqual(fixture.mutations, []);
});
test("reduces only the planned half, then re-installs and reads back both protections", async () => {
  const fixture = executorFixture();
  const result = await executeHypeZecPreemption({
    plan: plan(), executor: fixture.direct, adapter: fixture.adapter, stateStore: memoryState(),
    lock: { async document() { return { ownerId: "test", leaseId: "lease", expiresAt: NOW + 60_000 }; } },
    now: () => NOW, expectedRuntimeSha: "test", causeIdempotencyKey: "V12|signal-1",
    readVenueRisk: async () => ({ leverage: 5, marginType: "cross" }),
    protection: { HYPE_LONG: { stopPrice: 19, takeProfitPrice: 24, tickSize: 0.01, stepSize: 1 } },
  });
  assert.equal(result.status, "reduced");
  assert.equal(fixture.position.quantity, 5);
  assert.equal(fixture.mutations.filter((value) => value.startsWith("market:")).length, 1);
  assert.ok(fixture.mutations.some((value) => value.includes(":true")));
  assert.equal(fixture.orders.filter((order) => order.type === "STOP_MARKET" && order.quantity === 5).length, 1);
  assert.equal(fixture.orders.filter((order) => order.type === "TAKE_PROFIT_MARKET" && order.quantity === 5).length, 1);
});

test("blocks without mutation when venue risk is not exactly 5x Cross", async () => {
  const fixture = executorFixture();
  const result = await executeHypeZecPreemption({
    plan: plan(), executor: fixture.direct, adapter: fixture.adapter, stateStore: memoryState(),
    lock: { async document() { return { ownerId: "test", leaseId: "lease", expiresAt: NOW + 60_000 }; } },
    now: () => NOW, expectedRuntimeSha: "test", causeIdempotencyKey: "V12|signal-2",
    readVenueRisk: async () => ({ leverage: 3, marginType: "isolated" }),
    protection: { HYPE_LONG: { stopPrice: 19, takeProfitPrice: 24, tickSize: 0.01, stepSize: 1 } },
  });
  assert.equal(result.status, "blocked");
  assert.match(result.message, /VENUE_MARGIN_UNCONFIRMED/);
  assert.deepEqual(fixture.mutations, []);
});

test("blocks on partial/unknown reduction and never opens the priority order", async () => {
  const fixture = executorFixture();
  fixture.direct.executeMarket = async (command) => ({
    requestId: command.requestId, clientOrderId: command.clientOrderId, symbol: command.symbol, side: command.side,
    status: "PARTIALLY_FILLED", requestedQuantity: command.quantity, submittedQuantity: command.quantity,
    executedQuantity: command.quantity / 2, averagePrice: 21.9, quoteQuantity: command.quantity * 21.9 / 2,
    reduceOnly: true, executionUnknown: false, reconciled: false,
  });
  const result = await executeHypeZecPreemption({
    plan: plan(), executor: fixture.direct, adapter: fixture.adapter, stateStore: memoryState(),
    lock: { async document() { return { ownerId: "test", leaseId: "lease", expiresAt: NOW + 60_000 }; } },
    now: () => NOW, expectedRuntimeSha: "test", causeIdempotencyKey: "V12|signal-3",
    readVenueRisk: async () => ({ leverage: 5, marginType: "cross" }),
    protection: { HYPE_LONG: { stopPrice: 19, takeProfitPrice: 24, tickSize: 0.01, stepSize: 1 } },
  });
  assert.equal(result.status, "blocked");
  assert.match(result.message, /PARTIAL|EXECUTION/);
  assert.equal(fixture.mutations.filter((value) => value.startsWith("cancel:")).length, 0);
  assert.equal(fixture.mutations.filter((value) => value.startsWith("stop:")).length, 0);
  assert.equal(fixture.mutations.filter((value) => value.startsWith("tp:")).length, 0);
});
