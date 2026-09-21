import assert from "node:assert/strict";
import test from "node:test";

import { validateV12EntryGrossReservation } from "@/lib/v12-top2-residual";

const baseSnapshot = {
    v12Gross: 1.25,
    v12BaseGross: 1.25,
    v12DynamicGross: 0,
    cryptoGross: 1.25,
    stockGross: 0,
    totalGross: 1.25,
};

test("pre-order reservation blocks an entry that would breach the V12 2.0x base cap", () => {
    const result = validateV12EntryGrossReservation({
        snapshot: baseSnapshot,
        candidateBaseGross: 0.80,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.80,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "V12_BASE_AGGREGATE_GROSS_OVER_CAP");
    assert.ok(result.projectedBaseGross > 2.0);
    assert.equal(result.orderAllowed, false);
});

test("worst-case fill is checked before an exposure order", () => {
    const blocked = validateV12EntryGrossReservation({
        snapshot: baseSnapshot,
        candidateBaseGross: 0.70,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.81,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "V12_BASE_AGGREGATE_GROSS_OVER_CAP");

    const allowed = validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12Gross: 1.15, v12BaseGross: 1.15, cryptoGross: 1.15, totalGross: 1.15 },
        candidateBaseGross: 0.79,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.80,
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.orderAllowed, true);
});

test("pending and reserved gross are included on retry/restart", () => {
    const result = validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12Gross: 1.20, v12BaseGross: 1.20, cryptoGross: 1.20, totalGross: 1.20 },
        pendingBaseGross: 0.15,
        reservedGross: 0.15,
        candidateBaseGross: 0.55,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.55,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "V12_BASE_AGGREGATE_GROSS_OVER_CAP");
    assert.equal(result.orderAllowed, false);
});

test("invalid/stale gross snapshots fail closed", () => {
    assert.throws(() => validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12Gross: 2.1, v12BaseGross: 2.1, cryptoGross: 2.1, totalGross: 2.1 },
        candidateBaseGross: 0,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0,
    }), /V12_DYNAMIC_GROSS_SNAPSHOT_INVALID/);
});
