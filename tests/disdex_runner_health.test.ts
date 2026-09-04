import assert from "node:assert/strict";
import test from "node:test";
import {
    decideRecovery,
    type RecoveryObservation,
    type RunnerHeartbeat,
} from "../lib/disdex-runner-health";

const NOW = 1_757_000_000_000;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "/home/deploy/disdex-trading/releases/" + SHA;

function makeHeartbeat(overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    return {
        schema: "disdex-runner-heartbeat/v1",
        runnerId: "QUALITY102_CAUSAL_V1",
        serviceUnit: "disdex-quality102-causal-v1",
        runtimeSha: SHA,
        expectedSha: SHA,
        workingDirectory: RELEASE,
        mode: "LIVE",
        liveEnabled: true,
        safetyState: "LIVE",
        heartbeatAt: NOW,
        lastTickAt: NOW,
        lastReconciliationAt: NOW,
        lastDecision: "NOOP",
        reason: "healthy",
        symbols: [],
        caps: { strategy: 0.5, crypto: 2, total: 2.5 },
        restartAttempts: 0,
        updatedAt: NOW,
        ...overrides,
    };
}

function assertDecisionContract(decision: ReturnType<typeof decideRecovery>): void {
    assert.equal(decision.restartAuthorized, decision.action === "RESTART");
    assert.deepEqual(decision.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
}

function observe(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
    return {
        now: NOW,
        heartbeat: makeHeartbeat(),
        serviceActive: true,
        mainPid: 123,
        processCwd: RELEASE,
        expectedCwd: RELEASE,
        restartAttempts: 0,
        ...overrides,
    };
}

test("fresh matching service/PID/cwd/SHA returns NOOP", () => {
    const decision = decideRecovery(observe());
    assert.equal(decision.action, "NOOP");
    assertDecisionContract(decision);
});

test("inactive service with no PID and no heartbeat returns RESTART", () => {
    const decision = decideRecovery(observe({ heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined }));
    assert.equal(decision.action, "RESTART");
    assertDecisionContract(decision);
});

test("stale heartbeat returns RESTART", () => {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ heartbeatAt: NOW - 10 * 60_000 }) }));
    assert.equal(decision.action, "RESTART");
    assertDecisionContract(decision);
});

test("safety latches remain HOLD_FAIL_CLOSED and never restart", () => {
    for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
        const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState }) }));
        assert.equal(decision.action, "HOLD_FAIL_CLOSED");
        assertDecisionContract(decision);
        assert.equal(decision.restartAuthorized, false);
    }
});

test("Q102 fail-closed decision is runner-local", () => {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState: "KILL_SWITCH" }) }));
    assert.equal(decision.affectsOtherRunners, false);
    assertDecisionContract(decision);
});

test("shared reconciliation uncertainty affects every runner", () => {
    const decision = decideRecovery(observe({ sharedUncertainty: true }));
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assert.equal(decision.affectsOtherRunners, true);
    assertDecisionContract(decision);
});

test("exhausted retry budget never authorizes a fourth restart", () => {
    const decision = decideRecovery(observe({ restartAttempts: 3 }));
    assert.equal(decision.action, "RECOVERY_EXHAUSTED");
    assert.notEqual(decision.action, "RESTART");
    assertDecisionContract(decision);
    assert.equal(decision.restartAuthorized, false);
});
