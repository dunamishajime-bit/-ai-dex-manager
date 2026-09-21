import assert from "node:assert/strict";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
    DISDEX_V50_CONFIG,
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
const v11 = decideStockRoute(
    { eligible: false, completedMakerFill: false, completedHedge: false, reason: "V13D_DISABLED" },
    passingV11Snapshot,
);
assert.equal(v11.action, "OPEN");
assert.equal(v11.strategy, "V11_EQ");
const expensive = evaluateV11EqGate({
    ...passingV11Snapshot,
    absoluteBasisBps: 60,
    estimatedRoundTripCostBps: 50,
    estimatedNetEdgeBps: -5,
});
assert.equal(expensive.accepted, false);
assert.equal(expensive.reasons.includes("COST_TO_BASIS_RATIO_TOO_HIGH"), true);
assert.equal(expensive.reasons.includes("NET_EDGE_TOO_LOW"), true);

assert.doesNotThrow(() => assertPortfolioGross(3.0, 0));
assert.doesNotThrow(() => assertPortfolioGross(3.0, 1.25));
assert.doesNotThrow(() => assertPortfolioGross(0.25, 4.0));
assert.throws(() => assertPortfolioGross(3.0000000001, 0), /Crypto Gross cap exceeded/);
assert.throws(() => assertPortfolioGross(0, 4.0000000001), /Stock Gross cap exceeded/);
assert.throws(() => assertPortfolioGross(3.0, 1.2500000001), /Portfolio Gross cap exceeded/);

assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap, 1.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.sharedCryptoGrossCap, 3.0);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap, 4.0);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap, 4.25);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.sharedPortfolioGrossCap, 4.25);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.reservedFirstStockGross, 1.0);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumFirstStockGross, 0.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumSecondStockGross, 0.25);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoMayUsePortfolioResidual, false);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumConcurrentStockPositions, 2);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoInitialLeverage, 5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockInitialLeverage, 5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.requiredMarginType, "cross");
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumInitialMarginFraction, 0.70);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumAvailableBalanceFractionAfterOrder, 0.20);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.sameSymbolConcurrentStockPositionAllowed, false);
assert.equal(DISDEX_V50_CONFIG.strategyId, "POST_EARLY3__B60__C20__STOP1.75__EDGE7.5__BOTH");
assert.deepEqual(DISDEX_V50_CONFIG.entryTimesNy, ["11:30:00", "12:30:00", "13:30:00"]);
assert.equal(DISDEX_V13D_V11EQ_V96_RUNTIME.stateSchemaVersion, 3);
assert.equal(DISDEX_V13D_V11EQ_V96_RUNTIME.liveTradingEnabled, true);
assert.equal(DISDEX_V13D_V11EQ_V96_RUNTIME.pythonStockEngine, "scripts/disdex_v52_aster_only_live_engine.py");
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
    acknowledgement: "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY",
    credentialsReady: true,
    preflightPassed: true,
    killSwitchActive: false,
}));
console.log("V96 + V52 margin-aware LIVE contract self-test: PASS");
