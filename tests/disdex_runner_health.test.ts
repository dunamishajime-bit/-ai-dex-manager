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
        schema: 1,
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
    assert.equal(decideRecovery(observe()).action, "NOOP");
});

test("inactive service with no PID and no heartbeat returns RESTART", () => {
    assert.equal(decideRecovery(observe({ heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined })).action, "RESTART");
});

test("stale heartbeat returns RESTART", () => {
    assert.equal(decideRecovery(observe({ heartbeat: makeHeartbeat({ heartbeatAt: NOW - 10 * 60_000 }) })).action, "RESTART");
});

test("safety latches remain HOLD_FAIL_CLOSED and never restart", () => {
    for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
        const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState }) }));
        assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    }
});

test("Q102 fail-closed decision is runner-local", () => {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState: "KILL_SWITCH" }) }));
    assert.equal(decision.affectsOtherRunners, false);
});

test("shared reconciliation uncertainty affects every runner", () => {
    const decision = decideRecovery(observe({ sharedUncertainty: true }));
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assert.equal(decision.affectsOtherRunners, true);
});

test("exhausted retry budget never authorizes a fourth restart", () => {
    const decision = decideRecovery(observe({ restartAttempts: 3 }));
    assert.equal(decision.action, "RECOVERY_EXHAUSTED");
    assert.notEqual(decision.action, "RESTART");
});
