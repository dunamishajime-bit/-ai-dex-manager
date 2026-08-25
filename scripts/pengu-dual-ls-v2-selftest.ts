import assert from "node:assert/strict";

import { PENGU_DUAL_LS_V2, resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import {
    buildPenguDualLsV2Signal,
    evaluatePenguDualLsV2Decision,
    evaluatePenguDualLsV2Exit,
    evaluatePenguDualLsV2ShortSignals,
    targetGrossForAtr,
    type PenguDualLsV2Features,
    type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import { MemoryLiveRunnerLock } from "../lib/live-runner-state";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { classifiedPortfolioGross, PenguDualLsV2PortfolioRunner, normalizedPositionGross } from "../lib/pengu-dual-ls-v2-portfolio-runner";
import { MemoryPenguDualLsV2RunnerStateStore, createPenguDualLsV2RunnerState } from "../lib/pengu-dual-ls-v2-runner-state";

const HOUR = 3_600_000;

function features(overrides: Partial<PenguDualLsV2Features> = {}): PenguDualLsV2Features {
    return {
        referenceTs: 200 * HOUR,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        previousLow: 99,
        priorHigh18h: 101,
        penguReturn24h: 0,
        penguReturn72h: 0,
        btcReturn24h: 0,
        relativeReturn24h: 0,
        ema72: 100,
        ema168: 100,
        btcEma168Distance: 0,
        volumeRatio6OverPrior36: 1,
        atr24Ratio: 0.02,
        rsi14: 50,
        ...overrides,
    };
}

assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
assert.equal(PENGU_DUAL_LS_V2.short.setupExpiryHours, 24);
assert.equal(PENGU_DUAL_LS_V2.short.maxHoldHours, 72);
assert.equal(PENGU_DUAL_LS_V2.long.maxHoldHours, 120);
assert.equal(PENGU_DUAL_LS_V2.cooldownHours, 6);
assert.equal(PENGU_DUAL_LS_V2.longGross, 0.9375);
assert.equal(PENGU_DUAL_LS_V2.shortGross, 0.75);
assert.equal(PENGU_DUAL_LS_V2.maximumGross, 0.9375);

const defaultRuntime = resolvePenguDualLsV2Runtime({});
assert.equal(defaultRuntime.mode, "SHADOW");
assert.equal(defaultRuntime.enabled, false);
assert.equal(defaultRuntime.liveTradingEnabled, false);
assert.equal(defaultRuntime.liveExecutionEnabled, false);
const liveRuntime = resolvePenguDualLsV2Runtime({
    PENGU_DUAL_LS_V2_MODE: "LIVE",
    PENGU_DUAL_LS_V2_ENABLED: "true",
    PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED: "true",
    PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED: "true",
    PENGU_DUAL_LS_V2_MAX_GROSS: "2.5",
    PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP: "2.5",
    PENGU_DUAL_LS_V2_COMBINED_PORTFOLIO_GROSS_CAP: "9.0",
});
assert.equal(liveRuntime.maximumGross, 0.9375);
assert.equal(liveRuntime.longGross, 0.9375);
assert.equal(liveRuntime.shortGross, 0.75);
assert.equal(liveRuntime.portfolioGrossCap, 1.5);
assert.equal(liveRuntime.combinedPortfolioGrossCap, 1.5);
assert.equal(liveRuntime.maximumEntryDelayMs, 5 * 60_000);
assert.equal(resolvePenguDualLsV2Runtime({ PENGU_DUAL_LS_V2_MAX_ENTRY_DELAY_MS: "9999999" }).maximumEntryDelayMs, 5 * 60_000);

const longBoundary = features({
    close: 120,
    priorHigh18h: 119,
    penguReturn72h: 0.15,
    penguReturn24h: 0.10,
    relativeReturn24h: 0.01,
    btcReturn24h: 0,
    rsi14: 48,
    volumeRatio6OverPrior36: 0.25,
    atr24Ratio: 0.05,
    ema168: 119,
});
assert.equal(evaluatePenguDualLsV2Decision(longBoundary, false, false).side, 1);
assert.equal(evaluatePenguDualLsV2Decision(longBoundary, false, true).side, 0, "Long is rising-edge only");
assert.equal(evaluatePenguDualLsV2Decision({ ...longBoundary, rsi14: 78.0001 }, false, false).side, 0);
assert.equal(evaluatePenguDualLsV2Decision(longBoundary, true, false).side, -1, "Short has same-bar priority");

const impulse = features({ penguReturn24h: -0.07, low: 100, close: 100 });
const armedRebreak = features({
    referenceTs: 201 * HOUR,
    low: 100,
    close: 101.25,
    previousLow: 102,
    penguReturn24h: -0.07,
    penguReturn72h: 0,
    relativeReturn24h: -0.02,
    ema72: 102,
    ema168: 103,
    volumeRatio6OverPrior36: 0.25,
    btcReturn24h: 0.04,
    btcEma168Distance: -0.04,
    rsi14: 30,
});
const shortSeries = evaluatePenguDualLsV2ShortSignals([impulse, armedRebreak]);
assert.equal(shortSeries.signals[0], false);
assert.equal(shortSeries.signals[1], true);
const invalidated = evaluatePenguDualLsV2ShortSignals([impulse, { ...armedRebreak, close: 106.01 }]);
assert.equal(invalidated.signals[1], false);
const expiredRows = [impulse, ...Array.from({ length: 25 }, (_, index) => features({ referenceTs: (201 + index) * HOUR, close: 100, low: 100, penguReturn24h: 0 }))];
assert.equal(evaluatePenguDualLsV2ShortSignals(expiredRows).setupActive.at(-1), false);

assert.equal(targetGrossForAtr(0.005), 0.75);
assert.equal(targetGrossForAtr(0.02), 0.75);
assert.equal(targetGrossForAtr(0.05), 0.60);
assert.equal(targetGrossForAtr(0.50), 0.60);
assert.equal(targetGrossForAtr(0), 0);
assert.equal(targetGrossForAtr(0.02, 1), 0.9375);
assert.equal(targetGrossForAtr(0.05, 1), 0.75);
assert.equal(targetGrossForAtr(0.02, -1), 0.75);

const longPosition: PenguDualLsV2Position = { side: 1, entryTs: 100 * HOUR, entryPrice: 100, quantity: 1, gross: 0.75, highWaterMark: 111 };
assert.equal(evaluatePenguDualLsV2Exit(longPosition, features({ low: 91.99 }))?.reason, "LONG_HARD_STOP");
assert.equal(evaluatePenguDualLsV2Exit(longPosition, features({ low: 107.66 }))?.reason, "LONG_TRAILING_STOP");
assert.equal(evaluatePenguDualLsV2Exit({ ...longPosition, highWaterMark: 100 }, features({ referenceTs: (100 + 119) * HOUR, low: 99 }))?.reason, "LONG_MAX_HOLD");

const shortPosition: PenguDualLsV2Position = { side: -1, entryTs: 100 * HOUR, entryPrice: 100, quantity: 1, gross: 0.75, highWaterMark: 100, lowWaterMark: 84 };
assert.equal(evaluatePenguDualLsV2Exit(shortPosition, features({ high: 108.01 }))?.reason, "SHORT_HARD_STOP");
assert.equal(evaluatePenguDualLsV2Exit(shortPosition, features({ high: 87.37 }))?.reason, "SHORT_TRAILING_STOP");
assert.equal(evaluatePenguDualLsV2Exit({ ...shortPosition, lowWaterMark: 100 }, features({ referenceTs: (100 + 71) * HOUR, high: 101 }))?.reason, "SHORT_MAX_HOLD");

const state = createPenguDualLsV2RunnerState("PAPER");
assert.equal(state.strategyId, "PENGU_DUAL_LS_V2_FINAL");
assert.equal(state.pending, undefined);
assert.equal(state.position, undefined);
const btcPosition = { symbol: "BTCUSDT", quantity: 1, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, positionSide: "LONG" as const, leverage: 5, notionalUsd: 100, updatedAt: 0 };
const stockPosition = { symbol: "NVDAUSDT", quantity: 2, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, positionSide: "LONG" as const, leverage: 5, notionalUsd: 200, updatedAt: 0 };
assert.equal(normalizedPositionGross([btcPosition], 1_000), 0.1);
assert.equal(normalizedPositionGross([], 0), Number.POSITIVE_INFINITY);
assert.deepEqual(classifiedPortfolioGross([btcPosition, stockPosition], 1_000), { cryptoGross: 0.1, stockGross: 0.2, combinedGross: 0.30000000000000004 });
assert.throws(
    () => classifiedPortfolioGross([{ ...btcPosition, symbol: "UNKNOWNUSDT", notionalUsd: 10 }], 1_000),
    /PENGU_UNKNOWN_NONZERO_ASTER_POSITION:UNKNOWNUSDT/,
);

const historyRows = Array.from({ length: 200 }, (_, index) => ({
    openTime: (index + 1) * HOUR,
    closeTime: (index + 2) * HOUR - 1,
    open: 100 + index / 100,
    high: 101 + index / 100,
    low: 99 + index / 100,
    close: 100.5 + index / 100,
    volume: 1_000,
}));
assert.throws(
    () => buildPenguDualLsV2Signal({ pengu1h: historyRows, btc1h: historyRows.filter((_, index) => index !== 100), penguFunding: [] }, undefined, 202 * HOUR),
    /missing|timestamps are not fully aligned/,
);

let executorCalls = 0;
const forbiddenExecutor = {
    getAccountSnapshot: async () => { executorCalls += 1; throw new Error("SHADOW account access is forbidden"); },
    getPositions: async () => { executorCalls += 1; throw new Error("SHADOW position access is forbidden"); },
    getOpenOrders: async () => { executorCalls += 1; throw new Error("SHADOW order access is forbidden"); },
    getMarketQuote: async () => { executorCalls += 1; throw new Error("SHADOW quote access is forbidden"); },
    normalizeMarketQuantity: async () => { executorCalls += 1; throw new Error("SHADOW normalization is forbidden"); },
    executeMarket: async () => { executorCalls += 1; throw new Error("SHADOW order send is forbidden"); },
    reconcileOrder: async () => { executorCalls += 1; throw new Error("SHADOW reconciliation is forbidden"); },
};
const shadowRunner = new PenguDualLsV2PortfolioRunner({
    marketData: { load: async () => ({ btc1h: [], pengu1h: [], penguFunding: [] }) },
    executor: forbiddenExecutor,
    stateStore: new MemoryPenguDualLsV2RunnerStateStore(createPenguDualLsV2RunnerState("SHADOW")),
    lock: new MemoryLiveRunnerLock(),
    config: {
        mode: "SHADOW",
        enabled: true,
        liveExecutionEnabled: false,
        productionConfigLiveEnabled: false,
        maximumGross: PENGU_DUAL_LS_V2.maximumGross,
        longGross: PENGU_DUAL_LS_V2.longGross,
        shortGross: PENGU_DUAL_LS_V2.shortGross,
        cashReservePct: PENGU_DUAL_LS_V2.safety.cashReservePct,
        maxSlippageBps: PENGU_DUAL_LS_V2.safety.maxSlippageBps,
        minimumOrderNotionalUsd: PENGU_DUAL_LS_V2.safety.minimumOrderNotionalUsd,
        maxTransactionRetries: PENGU_DUAL_LS_V2.safety.maxTransactionRetries,
        maximumEntryDelayMs: 5 * 60_000,
        portfolioGrossCap: PENGU_DUAL_LS_V2.portfolioGrossCap,
        combinedPortfolioGrossCap: PENGU_DUAL_LS_V2.combinedPortfolioGrossCap,
        maximumDailyLossPct: 5,
    },
});

async function main() {
    const shutdownDelay = createInterruptibleDelay();
    const shutdownStartedAt = Date.now();
    const longWait = shutdownDelay.wait(60_000);
    shutdownDelay.interrupt();
    await longWait;
    assert.equal(shutdownDelay.interrupted, true);
    assert.ok(Date.now() - shutdownStartedAt < 1_000, "SIGTERM-style interruption must not wait for the next hourly boundary");

    const shadowResult = await shadowRunner.tick();
    assert.equal(shadowResult.status, "shadow");
    assert.equal(executorCalls, 0);
    console.log("PENGU_DUAL_LS_V2_FINAL_SELFTEST_PASS");
    console.log("ordersSent=false");
    console.log("cancelSent=false");
    console.log("positionChangesSent=false");
}

void main();
