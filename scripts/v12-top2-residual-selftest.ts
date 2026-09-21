import assert from "node:assert/strict";

import { decideV12ResidualEntry, V12_TOP2_RESIDUAL_POLICY, type V12GrossSnapshot } from "@/lib/v12-top2-residual";

const empty: V12GrossSnapshot = { v12Gross: 0, cryptoGross: 0, stockGross: 0, totalGross: 0 };

{
    const decision = decideV12ResidualEntry(1.2, empty, 0);
    assert.equal(decision.acceptedGross, 1);
    assert.equal(decision.baseAcceptedGross, 1);
    assert.equal(decision.dynamicAcceptedGross, 0);
}
{
    const decision = decideV12ResidualEntry(1, {
        ...empty,
        v12Gross: 1,
        v12BaseGross: 1,
        v12DynamicGross: 0,
        cryptoGross: 1,
        totalGross: 1,
    }, 1);
    assert.equal(decision.acceptedGross, 1);
    assert.equal(decision.baseAcceptedGross, 1);
    assert.equal(decision.dynamicAcceptedGross, 0);
}
{
    const decision = decideV12ResidualEntry(1, {
        ...empty,
        v12Gross: 1.5,
        v12BaseGross: 1,
        v12DynamicGross: 0.5,
        cryptoGross: 1.5,
        totalGross: 1.5,
    }, 1);
    assert.equal(decision.acceptedGross, 0.5);
    assert.equal(decision.baseAcceptedGross, 0.5);
    assert.equal(decision.dynamicAcceptedGross, 0);
}
{
    const decision = decideV12ResidualEntry(1, {
        ...empty,
        v12Gross: 2,
        v12BaseGross: 1,
        v12DynamicGross: 1,
        cryptoGross: 2,
        totalGross: 2,
    }, 1);
    assert.equal(decision.acceptedGross, 0);
    assert.equal(decision.reason, "NO_RESIDUAL");
}
assert.ok(decideV12ResidualEntry(0.1, { ...empty, v12Gross: 1.5, v12BaseGross: 1.5, v12DynamicGross: 0, cryptoGross: 1.5, totalGross: 1.5 }, 2).acceptedGross > 0);
assert.equal(decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, 3).reason, "MAX_POSITIONS");
assert.equal(V12_TOP2_RESIDUAL_POLICY.baseAggregateGrossCap, 2);
assert.equal(V12_TOP2_RESIDUAL_POLICY.dynamicAggregateGrossCap, 2);
assert.equal(V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap, 1);
assert.equal(V12_TOP2_RESIDUAL_POLICY.maximumPositions, 3);
assert.equal(V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap, 3);
assert.equal(V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap, 4.25);
console.log("V12_TOP2_RESIDUAL_SELFTEST_PASS");
