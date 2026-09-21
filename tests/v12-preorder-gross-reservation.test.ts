import assert from "node:assert/strict";
import test from "node:test";

import { validateV12EntryGrossReservation } from "@/lib/v12-top2-residual";

const baseSnapshot = {
    v12Gross: 0.8038357574226936,
    v12BaseGross: 0.7870945617580162,
    v12DynamicGross: 0.016741195664677522,
    cryptoGross: 0.8038357574226936,
    stockGross: 0,
    totalGross: 0.8038357574226936,
};

test("pre-order reservation blocks the DOGE fill that would breach the V12 base cap", () => {
    const result = validateV12EntryGrossReservation({
        snapshot: baseSnapshot,
        candidateBaseGross: 0.7387290838844657,
        candidateDynamicGross: 0.051566373661449116,
        candidateWorstCaseGross: 0.798588559336,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "V12_BASE_AGGREGATE_GROSS_OVER_CAP");
    assert.ok(result.projectedBaseGross > 1.5);
    assert.equal(result.orderAllowed, false);
});

test("partial or full-fill worst case is checked before an exposure order", () => {
    const partial = validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12BaseGross: 0.70 },
        candidateBaseGross: 0.70,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.81,
    });
    assert.equal(partial.ok, false);

    const full = validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12BaseGross: 0.70 },
        candidateBaseGross: 0.79,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.80,
    });
    assert.equal(full.ok, true);
    assert.equal(full.orderAllowed, true);
});

test("pending and reserved gross are included on retry/restart", () => {
    const result = validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12BaseGross: 0.70 },
        pendingBaseGross: 0.10,
        reservedGross: 0.10,
        candidateBaseGross: 0.61,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0.61,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "V12_BASE_AGGREGATE_GROSS_OVER_CAP");
    assert.equal(result.orderAllowed, false);
});

test("invalid/stale gross snapshots fail closed", () => {
    assert.throws(() => validateV12EntryGrossReservation({
        snapshot: { ...baseSnapshot, v12Gross: 2.1 },
        candidateBaseGross: 0,
        candidateDynamicGross: 0,
        candidateWorstCaseGross: 0,
    }), /V12_DYNAMIC_GROSS_SNAPSHOT_INVALID/);
});
