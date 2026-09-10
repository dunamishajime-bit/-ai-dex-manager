import assert from "node:assert/strict";

import { decideV12ResidualEntry, V12_TOP2_RESIDUAL_POLICY, type V12GrossSnapshot } from "@/lib/v12-top2-residual";

const empty: V12GrossSnapshot = { v12Gross: 0, cryptoGross: 0, stockGross: 0, totalGross: 0 };
assert.equal(decideV12ResidualEntry(1.2, empty, 0).acceptedGross, 1);
assert.equal(decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, 1).acceptedGross, 0.5);
assert.equal(decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1.75, totalGross: 1.75 }, 1).acceptedGross, 0.25);
assert.ok(Math.abs(decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1, stockGross: 1.4, totalGross: 2.4 }, 1).acceptedGross - 0.1) < 1e-12);
assert.equal(decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, 2).reason, "MAX_POSITIONS");
assert.equal(V12_TOP2_RESIDUAL_POLICY.aggregateEntryGrossCap, 1.5);
assert.equal(V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap, 1);
assert.equal(V12_TOP2_RESIDUAL_POLICY.maximumPositions, 2);
assert.equal(V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap, 2);
assert.equal(V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap, 2.5);
console.log("V12_TOP2_RESIDUAL_SELFTEST_PASS");
