import assert from "node:assert/strict";
import { PENGU_DUAL_LS_V1, resolvePenguDualLsV1Runtime } from "../config/penguDualLsV1Runtime";
import { evaluatePenguDualLsV1Decision } from "../lib/pengu-dual-ls-v1";
import { MemoryLiveRunnerLock } from "../lib/live-runner-state";
import { MemoryPenguDualLsV1RunnerStateStore, createPenguDualLsV1RunnerState } from "../lib/pengu-dual-ls-v1-runner-state";
import { PenguDualLsV1PortfolioRunner } from "../lib/pengu-dual-ls-v1-portfolio-runner";

const baseFeatures = {
    referenceTs: 1,
    close: 1.1,
    high: 1.11,
    low: 1.09,
    atr14: 0.01,
    atr24Pct: 0.5,
    atr24MedianPct120: 0.6,
    compressionRatio: 0.83,
    range24Pct: 4,
    priorHigh24h: 1,
    priorLow24h: 0.97,
    volumeRatio: 1.1,
    penguMomentum24hPct: 5,
    btcMomentum24hPct: 1,
    btcMomentum72hPct: 2,
    btcCloseAboveSma168: true,
    rsi14: 60,
    fundingRate: 0.00005,
    shortDropPct: 0,
    shortRetracePct: 0,
    shortBreakdownConfirmed: false,
    shortRecentlyActive: false,
} as const;

const longDecision = evaluatePenguDualLsV1Decision(baseFeatures);
assert.equal(longDecision.side, 1);
assert.equal(longDecision.longEligible, true);
assert.equal(longDecision.shortEligible, false);

assert.equal(evaluatePenguDualLsV1Decision({ ...baseFeatures, fundingRate: null }).side, 0);
assert.equal(evaluatePenguDualLsV1Decision({ ...baseFeatures, shortRecentlyActive: true }).side, 0);

const shortFeatures = {
    ...baseFeatures,
    fundingRate: null,
    volumeRatio: 0.9,
    shortDropPct: 6,
    shortRetracePct: 35,
    shortBreakdownConfirmed: true,
    btcCloseAboveSma168: false,
    btcMomentum72hPct: -1,
};
const shortDecision = evaluatePenguDualLsV1Decision(shortFeatures, 0.9);
assert.equal(shortDecision.side, -1);
assert.equal(shortDecision.shortEligible, true);
assert.equal(shortDecision.longEligible, false);

const conflictingDecision = evaluatePenguDualLsV1Decision({
    ...baseFeatures,
    shortDropPct: 6,
    shortRetracePct: 35,
    shortBreakdownConfirmed: true,
}, 1.1);
assert.equal(conflictingDecision.side, -1);

const defaultRuntime = resolvePenguDualLsV1Runtime({});
assert.equal(defaultRuntime.enabled, false);
assert.equal(defaultRuntime.mode, "SHADOW");
assert.equal(defaultRuntime.maximumGross, 0.75);
assert.equal(defaultRuntime.longGross, 0.75);
assert.equal(defaultRuntime.shortGross, 0.75);
assert.equal(defaultRuntime.closeUnmanagedPositions, false);

const cappedRuntime = resolvePenguDualLsV1Runtime({
    PENGU_DUAL_LS_V1_ENABLED: "true",
    PENGU_DUAL_LS_V1_MODE: "LIVE",
    PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED: "true",
    PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED: "true",
    PENGU_DUAL_LS_V1_MAX_GROSS: "2.5",
});
assert.equal(cappedRuntime.maximumGross, 0.75);
assert.equal(cappedRuntime.longGross, 0.75);
assert.equal(cappedRuntime.shortGross, 0.75);

let executorCalls = 0;
const executor = {
    getAccountSnapshot: async () => { executorCalls += 1; throw new Error("SHADOW must not read account state in this test."); },
    getPositions: async () => { executorCalls += 1; throw new Error("SHADOW must not read positions in this test."); },
    getOpenOrders: async () => { executorCalls += 1; throw new Error("SHADOW must not read open orders in this test."); },
    getMarketQuote: async () => { executorCalls += 1; throw new Error("SHADOW must not read quotes in this test."); },
    normalizeMarketQuantity: async () => { executorCalls += 1; throw new Error("SHADOW must not normalize orders in this test."); },
    executeMarket: async () => { executorCalls += 1; throw new Error("SHADOW must never submit orders."); },
    reconcileOrder: async () => { executorCalls += 1; throw new Error("SHADOW must never reconcile orders."); },
};
const runner = new PenguDualLsV1PortfolioRunner({
    marketData: { load: async () => ({ btc1h: [], pengu1h: [], penguFunding: [] }) },
    executor,
    stateStore: new MemoryPenguDualLsV1RunnerStateStore(createPenguDualLsV1RunnerState("SHADOW")),
    lock: new MemoryLiveRunnerLock(),
    config: {
        mode: "SHADOW",
        enabled: true,
        liveExecutionEnabled: false,
        productionConfigLiveEnabled: false,
        maximumGross: PENGU_DUAL_LS_V1.maximumGross,
        longGross: PENGU_DUAL_LS_V1.longGross,
        shortGross: PENGU_DUAL_LS_V1.shortGross,
        cashReservePct: PENGU_DUAL_LS_V1.safety.cashReservePct,
        maxSlippageBps: PENGU_DUAL_LS_V1.safety.maxSlippageBps,
        minimumOrderNotionalUsd: PENGU_DUAL_LS_V1.safety.minimumOrderNotionalUsd,
        maxTransactionRetries: PENGU_DUAL_LS_V1.safety.maxTransactionRetries,
        portfolioGrossCap: 2.5,
        maximumDailyLossPct: 5,
    },
});
async function main() {
    const shadowResult = await runner.tick();
    assert.equal(shadowResult.status, "shadow");
    assert.equal(executorCalls, 0);
    console.log("PENGU_DUAL_LS_V1_SELFTEST_OK");
}

voi