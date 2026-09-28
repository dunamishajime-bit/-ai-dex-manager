import test from "node:test";
import assert from "node:assert/strict";

import { createPenguRiskOverlayState } from "@/lib/pengu-route-quarantine-dd-governor";
import { reconcileExternallyClosedRecoveryV8Position } from "@/lib/pengu-external-exit-reconciliation";
import type { PenguDualLsV2RunnerState } from "@/lib/pengu-dual-ls-v2-runner-state";
import { PenguDualLsV2PortfolioRunner } from "@/lib/pengu-dual-ls-v2-portfolio-runner";
import { MemoryLiveRunnerLock } from "@/lib/live-runner-state";
import { MemoryPenguDualLsV2RunnerStateStore } from "@/lib/pengu-dual-ls-v2-runner-state";
import type { DirectReadonlyOrder, DirectReadonlyTrade } from "@/lib/direct-trade-executor";

const ENTRY_TS = 1_790_600_400_000;
const EXIT_TS = 1_790_608_522_200;
const CLIENT_ORDER_ID = "recv8-934303940d325cee8b8ed5ba3b1c66";

function state(): PenguDualLsV2RunnerState {
    return {
        version: 2,
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        mode: "LIVE",
        updatedAt: EXIT_TS,
        riskOverlay: createPenguRiskOverlayState(),
        failures: [],
        position: {
            side: 1,
            entryTs: ENTRY_TS,
            entryPrice: 0.009959,
            quantity: 3408,
            gross: 0.5,
            highWaterMark: 0.009959,
            lowWaterMark: 0.009959,
            entryVersion: "RECOVERY_V8",
            recoveryV8: {
                version: "RECOVERY_V8",
                side: 1,
                entryTs: ENTRY_TS,
                entryPrice: 0.009959,
                logicalEntryPrice: 0.009959,
                recoveryExecutionPrice: 0.009959,
                quantity: 3408,
                originalQuantity: 3408,
                originalGross: 0.5,
                remainingGross: 0.5,
                partialDefenseTriggered: false,
                highWaterMark: 0.009959,
                protectionLifecycle: "FULL_HARD_STOP",
                fullHardStopClientOrderId: CLIENT_ORDER_ID,
            },
        },
    };
}

function evidence(overrides: Record<string, unknown> = {}) {
    return {
        currentPosition: undefined,
        symbolOpenOrders: [],
        order: {
            symbol: "PENGUUSDT",
            orderId: 1145411366,
            clientOrderId: CLIENT_ORDER_ID,
            status: "FILLED",
            type: "MARKET",
            side: "SELL",
            origQty: 3408,
            executedQty: 3408,
            avgPrice: 0.0093434,
            reduceOnly: true,
            stopPrice: 0.009361,
            updateTime: EXIT_TS,
        },
        trades: [
            { orderId: "1145411366", symbol: "PENGUUSDT", side: "SELL", quantity: 589, price: 0.009348, time: EXIT_TS, realizedPnl: -0.359879 },
            { orderId: "1145411366", symbol: "PENGUUSDT", side: "SELL", quantity: 589, price: 0.009344, time: EXIT_TS, realizedPnl: -0.362235 },
            { orderId: "1145411366", symbol: "PENGUUSDT", side: "SELL", quantity: 2230, price: 0.009342, time: EXIT_TS, realizedPnl: -1.37591 },
        ],
        ...overrides,
    };
}

test("PENGU external Recovery V8 hard-stop fill reconciles a flat venue without mutation", () => {
    const result = reconcileExternallyClosedRecoveryV8Position({ state: state(), ...evidence(), now: EXIT_TS + 60_000 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.position, undefined);
    assert.equal(result.exit.orderId, 1145411366);
    assert.equal(result.exit.executedQuantity, 3408);
    assert.equal(result.state.riskOverlay.routeQuarantineUntilTs.RECOVERY_V8, EXIT_TS + 60 * 3_600_000);
    assert.equal(result.ordersSent, 0);
    assert.equal(result.cancelsSent, 0);
    assert.equal(result.positionChangesSent, 0);
});

test("PENGU external reconciliation remains fail closed without exact reduce-only evidence", () => {
    const result = reconcileExternallyClosedRecoveryV8Position({
        state: state(),
        ...evidence({ order: { ...evidence().order, reduceOnly: false } }),
        now: EXIT_TS + 60_000,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /REDUCE_ONLY|PROOF/);
});

test("PENGU external reconciliation does not clear a live position or an open PENGU order", () => {
    const result = reconcileExternallyClosedRecoveryV8Position({
        state: state(),
        ...evidence({ currentPosition: { symbol: "PENGUUSDT", quantity: 3408 }, symbolOpenOrders: [{ clientOrderId: "other" }] }),
        now: EXIT_TS + 60_000,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /POSITION|OPEN_ORDER/);
});

test("PENGU LIVE runner clears a proven external Recovery V8 exit instead of repeating manual review", async () => {
    const current = state();
    const saved = new MemoryPenguDualLsV2RunnerStateStore(current);
    const order = evidence().order;
    const trades = evidence().trades;
    const executor = {
        getAccountSnapshot: async () => ({ availableBalance: 65, walletBalance: 65, asset: "USDT", updatedAt: EXIT_TS }),
        getPositions: async () => [],
        getOpenOrders: async () => [],
        getMarketQuote: async () => ({ symbol: "PENGUUSDT", bidPrice: 0.009, askPrice: 0.0091, bidQuantity: 1000, askQuantity: 1000, midPrice: 0.00905, spreadBps: 1, updatedAt: EXIT_TS }),
        normalizeMarketQuantity: async () => { throw new Error("not expected"); },
        executeMarket: async () => { throw new Error("no mutation is allowed in this reconciliation"); },
        reconcileOrder: async () => { throw new Error("not expected"); },
        getReadonlyOrder: async () => order as DirectReadonlyOrder,
        getUserTrades: async () => trades as DirectReadonlyTrade[],
    };
    const runner = new PenguDualLsV2PortfolioRunner({
        marketData: { load: async () => ({ pengu1h: [], btc1h: [], penguFunding: [] }) },
        executor,
        stateStore: saved,
        lock: new MemoryLiveRunnerLock(),
        now: () => EXIT_TS + 60_000,
        config: {
            mode: "LIVE",
            enabled: true,
            liveExecutionEnabled: true,
            productionConfigLiveEnabled: true,
            maximumGross: 1,
            longGross: 1,
            shortGross: 1,
            cashReservePct: 0,
            maxSlippageBps: 20,
            minimumOrderNotionalUsd: 5,
            maxTransactionRetries: 1,
            maximumEntryDelayMs: 300_000,
            portfolioGrossCap: 3,
            maximumDailyLossPct: 7.5,
            recoveryV8Enabled: true,
            v64DynamicLongEnabled: true,
        },
    });
    const result = await runner.tick();
    assert.equal(result.status, "no-change");
    assert.equal((await saved.load()).position, undefined);
});
