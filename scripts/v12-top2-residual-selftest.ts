import assert from "node:assert/strict";

import { decideV12ResidualEntry, v12ResidualCapacity, V12_TOP2_RESIDUAL_POLICY, type V12GrossSnapshot } from "@/lib/v12-top2-residual";

const empty: V12GrossSnapshot = { v12Gross: 0, penguGross: 0, cryptoGross: 0, stockGross: 0, totalGross: 0 };

const v12Only = decideV12ResidualEntry(1, empty, 0);
assert.equal(v12Only.acceptedGross, 1);
const rank2 = decideV12ResidualEntry(1, { ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, 1);
assert.equal(rank2.acceptedGross, 0.5);
assert.equal(v12ResidualCapacity({ ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, 1).v12Residual, 0.5);

const pengu075 = decideV12ResidualEntry(1, { ...empty, penguGross: 0.75, cryptoGross: 0.75, totalGross: 0.75 }, 0);
assert.equal(pengu075.acceptedGross, 0.75);
const pengu060 = decideV12ResidualEntry(1, { ...empty, penguGross: 0.6, cryptoGross: 0.6, totalGross: 0.6 }, 0);
assert.equal(pengu060.acceptedGross, 0.9);
const stock150Pengu075 = decideV12ResidualEntry(1, { v12Gross: 0, penguGross: 0.75, cryptoGross: 0.75, stockGross: 1.5, totalGross: 2.25 }, 0);
assert.equal(stock150Pengu075.acceptedGross, 0.25);
const stock150Pengu000 = decideV12ResidualEntry(1, { v12Gross: 0, penguGross: 0, cryptoGross: 0, stockGross: 1.5, totalGross: 1.5 }, 0);
assert.equal(stock150Pengu000.acceptedGross, 1);
const noResidual = decideV12ResidualEntry(0.2, { ...empty, v12Gross: 1.5, cryptoGross: 1.5, totalGross: 1.5 }, 1);
assert.equal(noResidual.acceptedGross, 0);
assert.equal(noResidual.reason, "NO_RESIDUAL");
const maxPositions = decideV12ResidualEntry(0.2, { ...empty, v12Gross: 1, cryptoGross: 1, totalGross: 1 }, V12_TOP2_RESIDUAL_POLICY.maximumPositions);
assert.equal(maxPositions.acceptedGross, 0);
assert.equal(maxPositions.reason, "MAX_POSITIONS");

// MTM drift does not create an entry-cap breach.  The next entry is clipped by
// the fresh snapshot; the existing position is never force-closed here.
const mtmDrift = decideV12ResidualEntry(1, { ...empty, v12Gross: 1.56, cryptoGross: 1.56, totalGross: 1.56 }, 1);
assert.equal(mtmDrift.acceptedGross, 0);
assert.equal(mtmDrift.reason, "NO_RESIDUAL");

console.log("V12_TOP2_RESIDUAL_SELFTEST_PASS", JSON.stringify({
    aggregateEntryGrossCap: V12_TOP2_RESIDUAL_POLICY.aggregateEntryGrossCap,
    perPositionEntryGrossCap: V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap,
    maximumPositions: V12_TOP2_RESIDUAL_POLICY.maximumPositions,
}));
