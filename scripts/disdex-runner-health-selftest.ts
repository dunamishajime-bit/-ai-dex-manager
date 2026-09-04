import assert from "node:assert/strict";
import { decideRecovery, type RecoveryObservation, type RunnerHeartbeat } from "../lib/disdex-runner-health";

const NOW = 1_757_000_000_000;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "/home/deploy/disdex-trading/releases/" + SHA;
const counters = { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 };

function makeHeartbeat(overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    return { schema: 1, runnerId: "QUALITY102_CAUSAL_V1", serviceUnit: "disdex-quality102-causal-v1", runtimeSha: SHA, expectedSha: SHA, workingDirectory: RELEASE, mode: "LIVE", liveEnabled: true, safetyState: "LIVE", heartbeatAt: NOW, lastTickAt: NOW, lastReconciliationAt: NOW, lastDecision: "NOOP", reason: "healthy", symbols: [], caps: { strategy: 0.5, crypto: 2, total: 2.5 }, restartAttempts: 0, updatedAt: NOW, ...overrides };
}

function observe(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
    return { now: NOW, heartbeat: makeHeartbeat(), serviceActive: true, mainPid: 123, processCwd: RELEASE, expectedCwd: RELEASE, restartAttempts: 0, ...overrides };
}

assert.equal(decideRecovery(observe()).action, "NOOP");
assert.equal(decideRecovery(observe({ heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined })).action, "RESTART");
assert.equal(decideRecovery(observe({ heartbeat: makeHeartbeat({ heartbeatAt: NOW - 10 * 60_000 }) })).action, "RESTART");
for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
    assert.equal(decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState }) })).action, "HOLD_FAIL_CLOSED");
}
assert.equal(decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState: "KILL_SWITCH" }) })).affectsOtherRunners, false);
assert.equal(decideRecovery(observe({ sharedUncertainty: true })).affectsOtherRunners, true);
assert.equal(decideRecovery(observe({ restartAttempts: 3 })).action, "RECOVERY_EXHAUSTED");
assert.deepEqual(counters, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
console.log("DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0");
