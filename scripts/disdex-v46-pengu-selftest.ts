import assert from "node:assert/strict";
import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "../config/disdexV46Runtime";
import { evaluateDisDexPenguV46Decision, type DisDexPenguV46DecisionFeatures } from "../lib/pengu-dual-engine-v46";
import { buildDisDexV35RebalanceActions } from "../lib/disdex-v35-portfolio-runner";

const longFeatures: DisDexPenguV46DecisionFeatures = {
    volumeRatio: 1.1,
    fundingRate: 0.0002,
    btcCloseAboveSma168: true,
    btcMomentum72hPct: 2,
    penguCloseAboveSma72: true,
    penguCloseAboveSma168: true,
    penguSma168Rising48h: true,
    penguMomentum6hPct: 2,
    penguMomentum6hLag12Pct: -0.5,
    penguMomentum24hPct: 3,
    penguMomentum120hPct: 8,
    relativeMomentum48hPct: 2,
    relativeMomentum120hPct: 1,
    rsi14: 60,
    priorLow24h: 0.009,
    close: 0.011,
};

const longDecision = evaluateDisDexPenguV46Decision(longFeatures);
assert.equal(longDecision.side, 1);
assert.equal(longDecision.longEligible, true);
assert.equal(longDecision.shortEligible, false);

const fundingBlocked = evaluateDisDexPenguV46Decision({ ...longFeatures, fundingRate: null });
assert.equal(fundingBlocked.side, 0);
assert.equal(fundingBlocked.longEligible, false);

const fundingOverheated = evaluateDisDexPenguV46Decision({
    ...longFeatures,
    fundingRate: DISDEX_PENGU_DUAL_ENGINE_V46.fundingCap + 0.00001,
});
assert.equal(fundingOverheated.side, 0);

const shortDecision = evaluateDisDexPenguV46Decision({
    ...longFeatures,
    fundingRate: null,
    penguCloseAboveSma72: false,
    penguCloseAboveSma168: false,
    penguSma168Rising48h: false,
    penguMomentum6hPct: -2,
    penguMomentum24hPct: -5,
    penguMomentum120hPct: -10,
    relativeMomentum48hPct: -4,
    relativeMomentum120hPct: -6,
    rsi14: 35,
    priorLow24h: 0.010,
    close: 0.0095,
    btcCloseAboveSma168: false,
    btcMomentum72hPct: -2,
});
assert.equal(shortDecision.side, -1);
assert.equal(shortDecision.shortEligible, true);

const shortBlockedByStrongBtc = evaluateDisDexPenguV46Decision({
    ...longFeatures,
    fundingRate: null,
    penguCloseAboveSma72: false,
    penguCloseAboveSma168: false,
    penguSma168Rising48h: false,
    penguMomentum6hPct: -2,
    priorLow24h: 0.010,
    close: 0.0095,
    btcCloseAboveSma168: true,
    btcMomentum72hPct: 5,
});
assert.equal(shortBlockedByStrongBtc.side, 0);

const now = Date.now();
const reversal = buildDisDexV35RebalanceActions({
    account: {
        walletBalance: 1000,
        availableBalance: 1000,
        asset: "USDT",
        updatedAt: now,
    },
    positions: [{
        symbol: "PENGUUSDT",
        quantity: 1000,
        entryPrice: 0.01,
        markPrice: 0.01,
        unrealizedPnl: 0,
        pnlPct: 0,
        notionalUsd: 10,
        positionSide: "BOTH",
        leverage: 1,
        updatedAt: now,
    }],
    quotes: {
        PENGUUSDT: {
            symbol: "PENGUUSDT",
            bidPrice: 0.0099,
            askPrice: 0.0101,
            bidQuantity: 1_000_000,
            askQuantity: 1_000_000,
            midPrice: 0.01,
            spreadBps: 200,
            updatedAt: now,
        },
    },
    targetWeights: { PENGUUSDT: -0.15 },
    config: {
        cashReservePct: 0,
        maxGross: 2,
        minOrderNotionalUsd: 5,
        rebalanceTolerancePct: 0.1,
        closeUnmanagedPositions: true,
    },
});
assert.equal(reversal.actions.length, 1);
assert.equal(reversal.actions[0].side, "SELL");
assert.equal(reversal.actions[0].reduceOnly, true);
assert.equal(reversal.actions[0].targetWeight, -0.15);
assert.equal(DISDEX_V46_RUNTIME.liveTradingEnabled, false);
assert.equal(DISDEX_V46_RUNTIME.mode, "PAPER");

console.log("DISDEX_PENGU_DUAL_ENGINE_V46_SELFTEST_OK");
