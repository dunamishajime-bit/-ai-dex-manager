import assert from "node:assert/strict";
import test from "node:test";
import {
    evaluateIdleLiveAdmission,
    buildIdleProtectionPlan,
    deterministicIdleClientOrderId,
    normalizeIdleBaselineAdmission,
    IDLE_BASELINE_ADMISSION_SCHEMA,
    type IdleLiveAdmissionInput,
} from "../lib/idle-priority-short-live";

const base: IdleLiveAdmissionInput = {
    runtimeMode: "LIVE",
    operatorArmed: true,
    candidateAccepted: true,
    candidateSide: "SHORT",
    decisionTs: 1_700_000_000_000,
    baselineDecisionTs: 1_700_000_000_000,
    baselineFresh: true,
    baselineSourceComplete: true,
    baselineOpenPositions: 0,
    baselinePendingExposure: 0,
    baselineAcceptedThisTimestamp: 0,
    nonBaselineCryptoExposure: 0,
    nonBaselinePendingExposure: 0,
    sharedRiskHealthy: true,
    marginGuardHealthy: true,
    killSwitchActive: false,
    venueFiveXCrossConfirmed: true,
    fullCryptoGrossAvailable: 1,
    fullTotalGrossAvailable: 1,
    sameSymbolIdleActive: false,
};

test("missing or stale baseline admission fails closed", () => {
    assert.equal(evaluateIdleLiveAdmission({ ...base, baselineFresh: false }).accepted, false);
    assert.equal(evaluateIdleLiveAdmission({ ...base, baselineDecisionTs: base.decisionTs - 3_600_000 }).reason, "BASELINE_ADMISSION_UNAVAILABLE");
});

test("baseline wins at the same timestamp", () => {
    const result = evaluateIdleLiveAdmission({ ...base, baselineAcceptedThisTimestamp: 1 });
    assert.deepEqual(result, { accepted: false, reason: "BASELINE_ACCEPTED_SAME_TIMESTAMP", gross: 0 });
});

test("risk, margin, kill switch, cross, and side gates all fail closed", () => {
    for (const input of [
        { sharedRiskHealthy: false },
        { marginGuardHealthy: false },
        { killSwitchActive: true },
        { venueFiveXCrossConfirmed: false },
        { candidateSide: "LONG" as const },
        { candidateAccepted: false },
    ]) {
        assert.equal(evaluateIdleLiveAdmission({ ...base, ...input }).accepted, false);
    }
});

test("partial capacity never becomes a partial Idle order", () => {
    const result = evaluateIdleLiveAdmission({ ...base, fullCryptoGrossAvailable: 0.99 });
    assert.deepEqual(result, { accepted: false, reason: "FULL_1X_CAPACITY_UNAVAILABLE", gross: 0 });
});

test("same-symbol Idle occupancy and sidecar exposure block new entry", () => {
    assert.equal(evaluateIdleLiveAdmission({ ...base, sameSymbolIdleActive: true }).reason, "IDLE_SAME_SYMBOL_ACTIVE");
    assert.equal(evaluateIdleLiveAdmission({ ...base, nonBaselineCryptoExposure: 0.01 }).reason, "NON_BASELINE_SIDECAR_EXPOSURE");
});

test("accepted admission is exactly one gross", () => {
    assert.deepEqual(evaluateIdleLiveAdmission(base), { accepted: true, reason: "IDLE_LIVE_ADMISSION_ACCEPTED", gross: 1 });
});

test("protection plan is deterministic SHORT-only and uses stop/TP contract", () => {
    const plan = buildIdleProtectionPlan({ symbol: "DOTUSDT", signalTs: 1_700_000_000_000, entryPrice: 100, quantity: 2 });
    assert.equal(plan.side, "SHORT");
    assert.equal(plan.stopPrice, 110);
    assert.equal(plan.takeProfitPrice, 75);
    assert.equal(plan.stopClientOrderId, deterministicIdleClientOrderId({ action: "STOP", symbol: "DOTUSDT", signalTs: 1_700_000_000_000 }));
    assert.equal(plan.takeProfitClientOrderId, deterministicIdleClientOrderId({ action: "TP", symbol: "DOTUSDT", signalTs: 1_700_000_000_000 }));
});

test("baseline admission evidence is SHA-bound and fresh", () => {
    const sha = "a".repeat(40);
    const now = 1_700_000_000_000;
    const valid = normalizeIdleBaselineAdmission({
        schema: IDLE_BASELINE_ADMISSION_SCHEMA,
        runtimeSha: sha,
        decisionTs: now,
        updatedAt: now,
        sourceComplete: true,
        baselineOpenPositions: 0,
        baselinePendingExposure: 0,
        baselineAcceptedThisTimestamp: 0,
    }, sha, now, now, 90_000);
    assert.equal(valid.runtimeSha, sha);
    assert.throws(() => normalizeIdleBaselineAdmission({ ...valid, runtimeSha: "b".repeat(40) }, sha, now, now, 90_000), /RUNTIME_SHA/);
    assert.throws(() => normalizeIdleBaselineAdmission({ ...valid, updatedAt: now - 90_001 }, sha, now, now, 90_000), /STALE/);
});
