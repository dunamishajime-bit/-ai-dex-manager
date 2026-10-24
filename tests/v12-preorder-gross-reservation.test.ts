import assert from "node:assert/strict";
import test from "node:test";

import { bindV12ResidualDecision, decideV12ResidualEntry, validateV12EntryGrossReservation, requireBoundV12ResidualApproval } from "@/lib/v12-top2-residual";

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

test("V12 residual approval is bound to the earlier decision timestamp and candidate snapshot identity", () => {
    const decision = decideV12ResidualEntry(0.5, {
        v12Gross: 0,
        v12BaseGross: 0,
        v12DynamicGross: 0,
        cryptoGross: 0,
        stockGross: 0,
        totalGross: 0,
    });
    const bound = bindV12ResidualDecision(decision, {
        idempotencyKey: "v12-entry-key",
        symbol: "BTCUSDT",
        side: "LONG",
        signalTs: 1_699_999_900_000,
        approvedAt: 1_700_000_000_000,
        snapshotAt: 1_700_000_000_000,
        equityUsd: 1_000,
    });
    assert.equal(bound.approval?.approvedAt, 1_700_000_000_000);
    assert.equal(Object.isFrozen(bound.approval), true);
    assert.equal(requireBoundV12ResidualApproval({
        decision: bound,
        idempotencyKey: "v12-entry-key",
        symbol: "BTCUSDT",
        side: "LONG",
        signalTs: 1_699_999_900_000,
        currentSnapshotAt: 1_700_000_000_000,
        equityUsd: 1_000,
        now: 1_700_000_001_000,
        maxAgeMs: 5_000,
    }).approvedAt, 1_700_000_000_000);
    assert.throws(() => requireBoundV12ResidualApproval({
        decision: bound,
        idempotencyKey: "different-key",
        symbol: "BTCUSDT",
        side: "LONG",
        signalTs: 1_699_999_900_000,
        currentSnapshotAt: 1_700_000_000_000,
        equityUsd: 1_000,
        now: 1_700_000_001_000,
        maxAgeMs: 5_000,
    }), /V12_APPROVAL_CANDIDATE_MISMATCH/);
    assert.throws(() => requireBoundV12ResidualApproval({
        decision,
        idempotencyKey: "v12-entry-key",
        symbol: "BTCUSDT",
        side: "LONG",
        signalTs: 1_699_999_900_000,
        currentSnapshotAt: 1_700_000_000_000,
        equityUsd: 1_000,
        now: 1_700_000_001_000,
        maxAgeMs: 5_000,
    }), /V12_APPROVAL_METADATA_MISSING/);
});
