import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { buildSharedCryptoDailyRiskState, writeSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FetBrk48LiveRunner } from "../lib/fet-brk48-live-runner";
import { readFetBrk48State } from "../lib/fet-brk48-state";

const HOUR = 3_600_000;
const RUNTIME_SHA = "a".repeat(40);

function makeKlines(entryTs: number, signalEnabled = true) {
  const rows: any[] = [];
  const start = entryTs - 80 * HOUR;
  for (let i = 0; i < 80; i += 1) {
    const openTs = start + i * HOUR;
    const closeTs = openTs + HOUR - 1;
    const isSignal = signalEnabled && openTs === entryTs - HOUR;
    rows.push([
      openTs,
      "100",
      isSignal ? "111" : "105",
      "95",
      isSignal ? "110" : "100",
      isSignal ? "130" : "100",
      closeTs,
    ]);
  }
  return rows;
}

test("FET live runner enters once, protects, survives restart, and exits after 24h", async () => {
  const root = await mkdtemp(join(tmpdir(), "fet-live-runner-"));
  const statePath = join(root, "state.json");
  const riskPath = join(root, "risk.json");
  const lockPath = join(root, "account.lock");
  const killPath = join(root, "kill-switch-missing.json");

  const entryTs = Date.UTC(2026, 8, 20, 5, 0, 0, 0);
  let now = entryTs + 30_000;
  const positions: any[] = [];
  const openOrders: any[] = [];
  const tradeCalls: any[] = [];
  const orderResults = new Map<string, any>();
  let liveMarkPrice = 110;

  const oldKill = process.env.DISDEX_SHARED_KILL_SWITCH_FILE;
  const oldLegacy = process.env.DISDEX_V96_KILL_SWITCH_FILE;
  process.env.DISDEX_SHARED_KILL_SWITCH_FILE = killPath;
  delete process.env.DISDEX_V96_KILL_SWITCH_FILE;

  try {
    await writeSharedCryptoDailyRisk(riskPath, buildSharedCryptoDailyRiskState({
      accountScope: "ASTER_FUTURES",
      utcDay: new Date(now).toISOString().slice(0, 10),
      strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL"],
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
      getAccountSnapshot: async () => ({
        walletBalance: 100,
        availableBalance: 100,
        asset: "USDT",
        updatedAt: now,
      }),
      getPositions: async () => positions.map((row) => ({ ...row, updatedAt: now, markPrice: liveMarkPrice })),
      getOpenOrders: async () => openOrders.map((row) => ({ ...row })),
      getMarketQuote: async () => ({
        symbol: "FETUSDT",
        bidPrice: 110,
        askPrice: 111,
        midPrice: 110.5,
        spreadBps: 9,
        bidQuantity: 1000,
        askQuantity: 1000,
        updatedAt: now,
      }),
      normalizeMarketQuantity: async (_symbol: string, quantity: number, price: number) => ({
        quantity,
        quantityText: quantity.toFixed(6),
        notional: quantity * price,
      }),
      executeMarket: async (input: any) => {
        tradeCalls.push({ ...input });
        const result = {
          requestId: input.requestId,
          clientOrderId: input.clientOrderId,
          symbol: input.symbol,
          side: input.side,
          status: "FILLED",
          executedQuantity: input.quantity,
          averagePrice: input.expectedPrice,
          quoteQuantity: input.quantity * input.expectedPrice,
          reduceOnly: Boolean(input.reduceOnly),
          executionUnknown: false,
          updatedAt: now,
        };
        orderResults.set(input.clientOrderId, result);
        if (!input.reduceOnly && input.side === "BUY") {
          positions.splice(0, positions.length, {
            symbol: "FETUSDT",
            quantity: input.quantity,
            entryPrice: input.expectedPrice,
            markPrice: input.expectedPrice,
            notionalUsd: input.quantity * input.expectedPrice,
            unrealizedPnl: 0,
            positionSide: "LONG",
            updatedAt: now,
          });
        } else if (input.reduceOnly && input.side === "SELL") {
          positions.splice(0, positions.length);
        }
        return result;
      },
      reconcileOrder: async (_symbol: string, clientOrderId: string) => orderResults.get(clientOrderId) || {
        symbol: "FETUSDT",
        clientOrderId,
        status: "NEW",
        executedQuantity: 0,
        averagePrice: 0,
        quoteQuantity: 0,
        side: "BUY",
        reduceOnly: false,
        executionUnknown: false,
      },
    };

    const adapter: any = {
      executor,
      normalizeStopPrice: async (_symbol: string, requested: number) => ({ price: requested, text: requested.toFixed(6) }),
      placeStopMarket: async (input: any) => {
        openOrders.push({
          symbol: input.symbol,
          clientOrderId: input.clientOrderId,
          status: "NEW",
          side: input.side,
          type: "STOP_MARKET",
          reduceOnly: true,
          quantity: input.quantity,
          executedQuantity: 0,
          stopPrice: input.stopPrice,
        });
        return { acknowledged: true, orderId: "1" };
      },
      openOrders: async () => openOrders.map((row) => ({ ...row })),
      getOpenOrders: async () => openOrders.map((row) => ({ ...row })),
      queryOrderSameId: async (_symbol: string, clientOrderId: string) => {
        const open = openOrders.find((row) => row.clientOrderId === clientOrderId);
        return open ? { ...open } : orderResults.get(clientOrderId) || null;
      },
      cancel: async (clientOrderId: string) => {
        const index = openOrders.findIndex((row) => row.clientOrderId === clientOrderId);
        if (index >= 0) openOrders.splice(index, 1);
      },
      flattenReduceOnly: async (input: any) => {
        tradeCalls.push({ ...input, reduceOnly: true, failsafe: true });
        positions.splice(0, positions.length);
      },
    };

    let signalEnabled = false;
    const client: any = {
      getKlines: async () => makeKlines(entryTs, signalEnabled),
    };

    const deps: any = {
      client,
      executor,
      adapter,
      statePath,
      runtimeSha: RUNTIME_SHA,
      accountLock: new FileAccountOrderLock(lockPath, 120_000),
      sharedRiskPath: riskPath,
      maxSlippageBps: 20,
      minimumOrderNotionalUsd: 5,
      now: () => now,
    };

    const idle = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(idle.status, "no-signal");
    assert.equal(idle.ordersSent, 0);
    assert.equal(tradeCalls.length, 0);
    const idleState = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.equal(idleState.runtimeCommitSha, RUNTIME_SHA);
    assert.ok(idleState.updatedAt > 0);

    signalEnabled = true;
    now += 1_000;
    const first = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(first.status, "entered");
    assert.equal(first.ordersSent, 1);
    assert.equal(tradeCalls.length, 1);
    assert.equal(tradeCalls[0].side, "BUY");
    assert.equal(tradeCalls[0].requireVenueMargin5xCross, true);
    assert.equal(openOrders.length, 1);
    assert.equal(openOrders[0].type, "STOP_MARKET");
    assert.equal(openOrders[0].reduceOnly, true);
    assert.ok(openOrders[0].quantity > 0);

    const afterEntry = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.ok(afterEntry.position);
    assert.equal(afterEntry.position?.quantity, openOrders[0].quantity);
    assert.equal(afterEntry.position?.protectionMode, "INITIAL_HARD_STOP");
    assert.equal(afterEntry.position?.hardStop, 111 * 0.95);
    assert.equal(afterEntry.pending, undefined);

    // A fresh runner instance must reconcile the same state and must not enter twice.
    now += 60_000;
    const restarted = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(restarted.status, "held");
    assert.equal(restarted.message, "FET_POSITION_HELD_PROTECTED");
    assert.equal(tradeCalls.length, 1);
    assert.equal(openOrders.length, 1);

    // Crossing +5% arms the +0.5% profit floor exactly once. The old -5% STOP
    // is canceled, the replacement is read back, and the upgraded protection
    // persists in state for restart recovery.
    liveMarkPrice = 111 * 1.051;
    now += 30_000;
    const armed = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(armed.status, "held");
    assert.equal(armed.message, "FET_PROFIT_FLOOR_ARMED_0P5_AFTER_5P0");
    assert.equal(armed.ordersSent, 1);
    assert.equal(tradeCalls.length, 1);
    assert.equal(openOrders.length, 1);
    assert.equal(openOrders[0].stopPrice, 111 * 1.005);
    const upgradedStopClientOrderId = openOrders[0].clientOrderId;

    const armedState = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.equal(armedState.position?.protectionMode, "PROFIT_FLOOR_0P5");
    assert.equal(armedState.position?.hardStop, 111 * 1.005);
    assert.equal(armedState.position?.stopClientOrderId, upgradedStopClientOrderId);
    assert.ok((armedState.position?.profitFloorArmedAt || 0) > 0);
    assert.equal(armedState.position?.profitFloorTriggerPrice, 111 * 1.05);

    now += 30_000;
    const armedRestart = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(armedRestart.status, "held");
    assert.equal(armedRestart.message, "FET_POSITION_HELD_PROTECTED");
    assert.equal(armedRestart.ordersSent, 0);
    assert.equal(openOrders.length, 1);
    assert.equal(openOrders[0].clientOrderId, upgradedStopClientOrderId);
    assert.equal(openOrders[0].stopPrice, 111 * 1.005);

    now = entryTs + 24 * HOUR + 1_000;
    await writeSharedCryptoDailyRisk(riskPath, buildSharedCryptoDailyRiskState({
      accountScope: "ASTER_FUTURES",
      utcDay: new Date(now).toISOString().slice(0, 10),
      strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL"],
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
    const exited = await new FetBrk48LiveRunner(deps).tick();
    assert.equal(exited.status, "exited");
    assert.equal(tradeCalls.length, 2);
    assert.equal(tradeCalls[1].side, "SELL");
    assert.equal(tradeCalls[1].reduceOnly, true);
    assert.equal(positions.length, 0);
    assert.equal(openOrders.length, 0);

    const finalState = await readFetBrk48State(statePath, RUNTIME_SHA);
    assert.equal(finalState.position, undefined);
    assert.equal(finalState.pending, undefined);
  } finally {
    if (oldKill === undefined) delete process.env.DISDEX_SHARED_KILL_SWITCH_FILE;
    else process.env.DISDEX_SHARED_KILL_SWITCH_FILE = oldKill;
    if (oldLegacy === undefined) delete process.env.DISDEX_V96_KILL_SWITCH_FILE;
    else process.env.DISDEX_V96_KILL_SWITCH_FILE = oldLegacy;
    await rm(root, { recursive: true, force: true });
  }
});
