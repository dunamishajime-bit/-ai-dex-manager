import assert from "node:assert/strict";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
} from "@/config/disdexStockRouterV13DV11EqRuntime";
import {
    assertLiveOrderSubmissionEnabled,
    assertPortfolioGross,
    decideStockRoute,
    evaluateV11EqGate,
    type V11ExecutionSnapshot,
} from "@/lib/disdex-v13d-v11eq-stock-router-contract";

const passingV11Snapshot: V11ExecutionSnapshot = {
    symbol: "META",
    absoluteBasisBps: 100,
    estimatedRoundTripCostBps: 40,
    estimatedNetEdgeBps: 45,
    dataAgeMs: 500,
    sourceClockDifferenceMs: 300,
    depthMultiple: 3,
    currentSpreadBps: 8,
    spreadToThirtySecondMedianMultiple: 1.2,
    adverseTwoSecondMoveBps: 1,
    adverseBasisMoveBps: 2,
    stillTop1: true,
    sourceFallbackUsed: false,
    stockSleeveOccupied: false,
    dailyLossLocked: false,
    killSwitchActive: false,
};

assert.equal(evaluateV11EqGate(passingV11Snapshot).accepted, true);
const v13dPriority = decideStockRoute(
    { eligible: true, completedMakerFill: true, completedHedge: true, symbol: "NVDA" },
    passingV11Snapshot,
);
assert.deepEqual(v13dPriority, {
    action: "OPEN", strategy: "V13D", symbol: "NVDA", reasons: ["V13D_FIRST_PRIORITY_COMPLETED"],
});
const v11Fallback = decideStockRoute(
    { eligible: false, completedMakerFill: false, completedHedge: false, reason: "NO_V13D_EDGE" },
    passingV11Snapshot,
);
assert.equal(v11Fallback.action, "OPEN");
assert.equal(v11Fallback.strategy, "V11_EQ");
const expensive = evaluateV11EqGate({
    ...passingV11Snapshot,
    absoluteBasisBps: 60,
    estimatedRoundTripCostBps: 50,
    estimatedNetEdgeBps: -5,
});
assert.equal(expensive.accepted, false);
assert.equal(expensive.reasons.includes("COST_TO_BASIS_RATIO_TOO_HIGH"), true);
assert.equal(expensive.reasons.includes("NET_EDGE_TOO_LOW"), true);
const stale = decideStockRoute(
    { eligible: false, completedMakerFill: false, completedHedge: false },
    { ...passingV11Snapshot, dataAgeMs: 2000 },
);
assert.equal(stale.action, "HOLD_CASH");
assert.equal(stale.reasons.includes("STALE_MARKET_DATA"), true);
assert.doesNotThrow(() => assertPortfolioGross(1, 1));
assert.throws(() => assertPortfolioGross(1.01, 0), /Crypto Gross cap exceeded/);
assert.throws(() => assertPortfolioGross(1, 1.01), /Stock Gross cap exceeded/);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.sleeveLendingEnabled, false);
assert.equal(DISDEX_V13D_V11EQ_V96_RUNTIME.liveTradingEnabled, true);
assert.equal(DISDEX_V13D_V11EQ_V96_RUNTIME.orderSubmissionAllowed, true);
assert.throws(() => assertLiveOrderSubmissionEnabled({
    runnerMode: "live",
    environmentLiveExecutionEnabled: false,
    credentialsReady: true,
    preflightPassed: true,
    killSwitchActive: false,
}), /environment switch/);
assert.doesNotThrow(() => assertLiveOrderSubmissionEnabled({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    acknowledgement: "I_ACCEPT_REAL_MONEY_V13D_V11EQ_V96",
    credentialsReady: true,
    preflightPassed: true,
    killSwitchActive: false,
}));
console.log("V13D + V11-EQ + Crypto V96 LIVE contract self-test: PASS");
