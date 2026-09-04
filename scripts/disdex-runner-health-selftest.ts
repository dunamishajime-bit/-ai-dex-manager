import assert from "node:assert/strict";
import { decideRecovery, type RecoveryObservation, type RunnerHeartbeat } from "../lib/disdex-runner-health";

const NOW = 1_757_000_000_000;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "/home/deploy/disdex-trading/releases/" + SHA;
function makeHeartbeat(overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    return { schema: "disdex-runner-heartbeat/v1", runnerId: "QUALITY102_CAUSAL_V1", serviceUnit: "disdex-quality102-causal-v1", runtimeSha: SHA, expectedSha: SHA, workingDirectory: RELEASE, mode: "LIVE", liveEnabled: true, safetyState: "LIVE", heartbeatAt: NOW, lastTickAt: NOW, lastReconciliationAt: NOW, lastDecision: "NOOP", reason: "healthy", symbols: [], caps: { strategy: 0.5, crypto: 2, total: 2.5 }, restartAttempts: 0, updatedAt: NOW, ...overrides };
}

function observe(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
    return { now: NOW, heartbeat: makeHeartbeat(), serviceActive: true, mainPid: 123, processCwd: RELEASE, expectedCwd: RELEASE, restartAttempts: 0, ...overrides };
}

function assertDecisionContract(decision: ReturnType<typeof decideRecovery>): void {
    assert.equal(decision.restartAuthorized, decision.action === "RESTART");
    assert.deepEqual(decision.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
}

const fresh = decideRecovery(observe());
assert.equal(fresh.action, "NOOP");
assertDecisionContract(fresh);
const inactive = decideRecovery(observe({ heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined }));
assert.equal(inactive.action, "RESTART");
assertDecisionContract(inactive);
const stale = decideRecovery(observe({ heartbeat: makeHeartbeat({ heartbeatAt: NOW - 10 * 60_000 }) }));
assert.equal(stale.action, "RESTART");
assertDecisionContract(stale);
for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState }) }));
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assertDecisionContract(decision);
    assert.equal(decision.restartAuthorized, false);
}
const localHold = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState: "KILL_SWITCH" }) }));
assert.equal(localHold.affectsOtherRunners, false);
const shared = decideRecovery(observe({ sharedUncertainty: true }));
assert.equal(shared.action, "HOLD_FAIL_CLOSED");
assert.equal(shared.affectsOtherRunners, true);
assertDecisionContract(shared);
assert.equal(shared.restartAuthorized, false);
const exhausted = decideRecovery(observe({ restartAttempts: 3 }));
assert.equal(exhausted.action, "RECOVERY_EXHAUSTED");
assert.equal(exhausted.restartAuthorized, false);
assert.notEqual(exhausted.action, "RESTART");
assertDecisionContract(exhausted);
console.log("DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0");
