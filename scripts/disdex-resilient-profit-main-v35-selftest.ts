import assert from "node:assert/strict";
import {
    DISDEX_RESILIENT_PROFIT_MAIN_V35,
    evaluateDisDexV35LiveGate,
    resolveDisDexV35Allocation,
} from "../lib/disdex-resilient-profit-main-v35";

const strong = resolveDisDexV35Allocation({
    regime: "BULL",
    coreGross: 0.9,
    penguSignalActive: true,
    features: {
        btcCloseAboveSma20d: true,
        btcMomentum20dPct: 12,
        btcMomentum3dPct: 2,
        btcShock1dPct: 1,
        coreDownsideVolatilitySkew: 1.1,
    },
});
assert.equal(strong.state, "STRONG_BULL");
assert.equal(strong.coreMultiplier, 1.4);
assert.equal(strong.penguGross, 0);
assert.ok(Math.abs(strong.finalGross - 1.26) < 1e-12);
assert.ok(strong.reasons.some((reason) => reason.includes("PENGU signal ignored")));

const normal = resolveDisDexV35Allocation({
    regime: "BULL",
    coreGross: 0.9,
    penguSignalActive: false,
    features: {
        btcCloseAboveSma20d: true,
        btcMomentum20dPct: 6,
        btcMomentum3dPct: 1,
        btcShock1dPct: 0,
        coreDownsideVolatilitySkew: 1.2,
    },
});
assert.equal(normal.state, "NORMAL_BULL");
assert.equal(normal.coreMultiplier, 1.2);
assert.ok(Math.abs(normal.finalGross - 1.08) < 1e-12);

const brake = resolveDisDexV35Allocation({
    regime: "BULL",
    coreGross: 0.9,
    penguSignalActive: true,
    features: {
        btcCloseAboveSma20d: true,
        btcMomentum20dPct: 15,
        btcMomentum3dPct: 3,
        btcShock1dPct: -4.5,
        coreDownsideVolatilitySkew: 1.1,
    },
});
assert.equal(brake.state, "BRAKE");
assert.equal(brake.coreMultiplier, 0.35);
assert.equal(brake.penguGross, 0);
assert.ok(Math.abs(brake.finalGross - 0.315) < 1e-12);

const capped = resolveDisDexV35Allocation({
    regime: "BULL",
    coreGross: 2,
    penguSignalActive: true,
    features: {
        btcCloseAboveSma20d: true,
        btcMomentum20dPct: 20,
        btcMomentum3dPct: 5,
        btcShock1dPct: 0,
        coreDownsideVolatilitySkew: 1,
    },
});
assert.equal(capped.finalGross, 2);
assert.ok(capped.capScale < 1);

const bear = resolveDisDexV35Allocation({
    regime: "BEAR",
    coreGross: 0.4,
    penguSignalActive: false,
    features: {
        btcCloseAboveSma20d: false,
        btcMomentum20dPct: -10,
        btcMomentum3dPct: -2,
        btcShock1dPct: -1,
        coreDownsideVolatilitySkew: 1.5,
    },
});
assert.equal(bear.state, "BEAR");
assert.equal(bear.coreMultiplier, 1);
assert.ok(Math.abs(bear.finalGross - 0.4) < 1e-12);

const gate = evaluateDisDexV35LiveGate({
    pristineForwardDays: 60,
    completedPenguTrades: 20,
    severeReturnPct: 4,
    severeMaxDrawdownPct: -12,
    dataCoveragePct: 99,
});
assert.equal(gate.checks.robustAsterBacktest, false);
assert.equal(gate.passed, false);
assert.equal(gate.liveEligible, false);
assert.equal(DISDEX_RESILIENT_PROFIT_MAIN_V35.realTradingDefaultEnabled, false);
assert.equal(DISDEX_RESILIENT_PROFIT_MAIN_V35.paperOnly, true);

console.log("DISDEX_RESILIENT_PROFIT_MAIN_V35_SELFTEST_OK");
