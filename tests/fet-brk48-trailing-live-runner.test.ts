import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { buildSharedCryptoDailyRiskState, SHARED_CRYPTO_STRATEGIES, writeSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FetBrk48LiveRunner } from "../lib/fet-brk48-live-runner";
import { readFetBrk48State } from "../lib/fet-brk48-state";

const HOUR = 3_600_000;
const FIVE_MINUTE = 300_000;
const RUNTIME_SHA = "b".repeat(40);

function makeH1(entryTs: number) {
  const rows: any[] = [];
  const start = entryTs - 80 * HOUR;
  for (let i = 0; i < 80; i += 1) {
    const openTs = start + i * HOUR;
    const closeTs = openTs + HOUR - 1;
    const signal = openTs === entryTs - HOUR;
    rows.push([openTs, "100", signal ? "111" : "105", "95", signal ? "110" : "100", signal ? "130" : "100", closeTs]);
  }
  return rows;
}

function makeM5(entryTs: number, closes: Array<{ close: number; low?: number }>) {
  return closes.map((item, index) => {
    const openTs = entryTs + index * FIVE_MINUTE;
    const close = item.close;
    const low = item.low ?? close;
    return [openTs, "112", String(Math.max(close, 112)), String(low), String(close), "100", openTs + FIVE_MINUTE - 1];
  });
}

test("FET live trail uses confirmed M5 bars and replaces protection before retiring the old STOP", async () => {
  const root = await mkdtemp(join(tmpdir(), "fet-trailing-live-"));
  const statePath = join(root, "state.json");
  const riskPath = join(root, "risk.json");
  const lockPath = join(root, "account.lock");
  const killPath = join(root, "kill-switch-missing.json");
  const entryTs = Date.UTC(2026, 8, 20, 5, 0, 0, 0);
  let now = entryTs + 30_000;
  let m5 = makeM5(entryTs, []);
  const positions: any[] = [];
  const openOrders: any[] = [];
  const tradeCalls: any[] = [];
  const lifecycle: string[] = [];
  const orderResults = new Map<string, any>();
  let liveMarkPrice = 111;

  const oldTrailEnabled = process.env.FET_BRK48_TRAILING_STOP_ENABLED;
  const oldTrailPolicy = process.env.FET_BRK48_TRAILING_STOP_POLICY;
  const oldKill = process.env.DISDEX_SHARED_KILL_SWITCH_FILE;
  const oldLegacy = process.env.DISDEX_V96_KILL_SWITCH_FILE;
  process.env.FET_BRK48_TRAILING_STOP_ENABLED = "true";
  process.env.FET_BRK48_TRAILING_STOP_POLICY = "FET_TRAIL_8P_GIVEBACK_4P";
  process.env.DISDEX_SHARED_KILL_SWITCH_FILE = killPath;
  delete process.env.DISDEX_V96_KILL_SWITCH_FILE;

  try {
    await writeSharedCryptoDailyRisk(riskPath, buildSharedCryptoDailyRiskState({
      accountScope: "ASTER_FUTURES",
      utcDay: new Date(now).toISOString().slice(0, 10),
      strategyIds: [...SHARED_CRYPTO_STRATEGIES],
      lossPct: 0,
      maximumLossPct: 7.5,
      tripped: false,
      updatedAt: now,
      realizedPnl: 0,
      unrealizedPnl: 0,
      fees: 0,
      funding: 0,
      netDailyPnl: 0,
      referenceEquity: 100,
      sourceComplete: true,
    }));

    const executor: any = {
      getAccountSnapshot: async () => ({ walletBalance: 100, availableBalance: 100, asset: "USDT", updatedAt: now }),
      getPositions: async () => positions.map((row) => ({ ...row, updatedAt: now, markPrice: liveMarkPrice })),
      getOpenOrders: async () => openOrders.map((row) => ({ ...row })),
      getMarketQuote: async () => ({ symbol: "FETUSDT", bidPrice: liveMarkPrice, askPrice: liveMarkPrice + 1, midPrice: liveMarkPrice + 0.5, spreadBps: 9, bidQuantity: 1000, askQuantity: 1000, updatedAt: now }),
      normalizeMarketQuantity: async (_symbol: string, quantity: number, price: number) => ({ quantity, quantityText: quantity.toFixed(6), notional: quantity * price }),
      executeMarket: async (input: any) => {
        lifecycle.push(`market:${input.side}`);
        tradeCalls.push({ ...input });
        const result = { requestId: input.requestId, clientOrderId: input.clientOrderId, symbol: input.symbol, side: input.side, status: "FILLED", executedQuantity: input.quantity, averagePrice: input.expectedPrice, quoteQuantity: input.quantity * input.expectedPrice, reduceOnly: Boolean(input.reduceOnly), executionUnknown: false, updatedAt: now };
        orderResults.set(input.clientOrderId, result);
        if (!input.reduceOnly && input.side === "BUY") {
          positions.splice(0, positions.length, { symbol: "FETUSDT", quantity: input.quantity, entryPrice: input.expectedPrice, markPrice: input.expectedPrice, notionalUsd: input.quantity * input.expectedPrice, unrealizedPnl: 0, positionSide: "LONG", leverage: 5, updatedAt: now });
        }
        return result;
      },
      reconcileOrder: async (_symbol: string, clientOrderId: string) => orderResults.get(clientOrderId) || { symbol: "FETUSDT", clientOrderId, status: "NEW", executedQuantity: 0, averagePrice: 0, quoteQuantity: 0, side: "BUY", reduceOnly: false, executionUnknown: false },
    };

    const adapter: any = {
      executor,
      normalizeStopPrice: async (_symbol: string, requested: number) => ({ price: requested, text: requested.toFixed(6) }),
      placeStopMarket: async (input: any) => {
        lifecycle.push(`place:${input.clientOrderId}:${input.stopPrice}`);
        openOrders.push({ symbol: input.symbol, clientOrderId: input.clientOrderId, status: "NEW", side: input.side, type: "STOP_MARKET", reduceOnly: true, quantity: input.quantity, executedQuantity: 0, stopPrice: input.stopPrice });
        return { acknowledged: true, orderId: String(openOrders.length) };
      },
      openOrders: async () => openOrders.map((row) => ({ ...row })),
      getOpenOrders: async () => openOrders.map((row) => ({ ...row })),
      queryOrderSameId: async (_symbol: string, clientOrderId: string) => openOrders.find((row) => row.clientOrderId === clientOrderId) || orderResults.get(clientOrderId) || null,
      cancel: async (clientOrderId: string) => {
        lifecycle.push(`cancel:${clientOrderId}`);
        const index = openOrders.findIndex((row) => row.clientOrderId === clientOrderId);
        if (index >= 0) openOrders.splice(index, 1);
      },
      flattenReduceOnly: async () => { throw new Error("UNEXPECTED_FAILSAFE_FLATTEN"); },
    };

    const client: any = {
      getPositions: async (symbol?: string) => positions.filter((row) => !symbol || row.symbol === symbol).map((row) => ({ symbol: row.symbol, positionAmt: String(row.quantity) })),
      getOpenOrders: async (symbol?: string) => openOrders.filter((row) => !symbol || row.symbol === symbol).map((row) => ({ ...row })),
      getKlines: async (_symbol: string, interval: string) => interval === "5m" ? m5 : makeH1(entryTs),
    };
    const deps: any = { client, executor, adapter, statePath, runtimeSha: RUNTIME_SHA, accountLock: new FileAccountOrderLock(lockPath, 120_000), sharedRiskPath: riskPath, maxSlippageBps: 20, minimumOrderNotionalUsd: 5, now: () => now };

    const entered = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(entered.status, "entered");
    const initialStop = openOrders[0].clientOrderId;
    assert.equal(openOrders[0].stopPrice, 112 * 0.95);

    // No completed 5-minute bar is not permission to remove or synthesize a
    // new protection order. The original hard stop remains the authority.
    now += 60_000;
    const unavailable = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(unavailable.status, "held");
    assert.equal(unavailable.message, "FET_POSITION_HELD_PROTECTED");
    assert.equal(openOrders.length, 1);
    assert.equal(openOrders[0].clientOrderId, initialStop);
    assert.equal(lifecycle.some((event) => event === `cancel:${initialStop}`), false);

    m5 = makeM5(entryTs, [{ close: 122, low: 112 }]);
    now = entryTs + FIVE_MINUTE + 1_000;
    const armed = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(armed.status, "held");
    assert.equal(armed.message, "FET_TRAIL_8P_GIVEBACK_4P_STOP_UPDATED");
    assert.equal(openOrders.length, 1);
    assert.ok(openOrders[0].stopPrice > 112 * 0.95);
    assert.equal(lifecycle.findIndex((event) => event.startsWith("place:")) < lifecycle.findIndex((event) => event === `cancel:${initialStop}`), true);
    const armedState = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.equal(armedState.position?.protectionMode, "TRAIL_8P_GIVEBACK_4P");
    assert.equal(armedState.position?.trailingStop?.armed, true);
    assert.equal(armedState.position?.trailingStop?.bestGainPct, 122 / 112 - 1);

    const callsAfterArm = lifecycle.length;
    now += 30_000;
    const duplicate = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(duplicate.status, "held");
    assert.equal(lifecycle.length, callsAfterArm);

    // A venue-side partial reduction is reconciled by placing a new
    // quantity-matched STOP before retiring the old one, and survives a fresh
    // runner instance through the durable state file.
    positions[0].quantity /= 2;
    now += 30_000;
    const partial = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(partial.status, "held");
    assert.equal(openOrders.length, 1);
    assert.equal(openOrders[0].quantity, positions[0].quantity);
    const partialState = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.equal(partialState.position?.quantity, positions[0].quantity);
  } finally {
    if (oldTrailEnabled === undefined) delete process.env.FET_BRK48_TRAILING_STOP_ENABLED; else process.env.FET_BRK48_TRAILING_STOP_ENABLED = oldTrailEnabled;
    if (oldTrailPolicy === undefined) delete process.env.FET_BRK48_TRAILING_STOP_POLICY; else process.env.FET_BRK48_TRAILING_STOP_POLICY = oldTrailPolicy;
    if (oldKill === undefined) delete process.env.DISDEX_SHARED_KILL_SWITCH_FILE; else process.env.DISDEX_SHARED_KILL_SWITCH_FILE = oldKill;
    if (oldLegacy === undefined) delete process.env.DISDEX_V96_KILL_SWITCH_FILE; else process.env.DISDEX_V96_KILL_SWITCH_FILE = oldLegacy;
    await rm(root, { recursive: true, force: true });
  }
});
