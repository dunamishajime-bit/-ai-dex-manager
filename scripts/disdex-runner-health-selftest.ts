import assert from "node:assert/strict";
import { decideRecovery, type RecoveryObservation, type RunnerHeartbeat } from "../lib/disdex-runner-health";
import { buildV12RunnerHeartbeat } from "./disdex-v12-x1-all-live-runner";
import { buildPenguRunnerHeartbeat } from "./disdex-pengu-dual-ls-v2-live-runner";
import { buildQuality102RunnerHeartbeat } from "./disdex-quality102-causal-v1-live-runner";

const NOW = 1_757_000_000_000;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "/home/deploy/disdex-trading/releases/" + SHA;
const Q102_CONFIG: Parameters<typeof buildQuality102RunnerHeartbeat>[1] = {
    mode: "LIVE",
    enabled: true,
    liveTradingEnabled: true,
    liveExecutionEnabled: true,
    runtimeCommitSha: SHA,
    expectedRuntimeCommitSha: SHA,
    symbols: ["SUIUSDT"],
};
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
const previousRuntimeSha = process.env.DISDEX_RUNTIME_COMMIT_SHA;
const previousReleaseSha = process.env.DISDEX_RELEASE_SHA;
const previousV12Sha = process.env.V12_LIVE_COMMIT_SHA;
const previousExpectedRuntimeSha = process.env.DISDEX_EXPECTED_RUNTIME_SHA;
const previousExpectedSha = process.env.DISDEX_EXPECTED_SHA;
const restoreIdentityEnvironment = () => {
    if (previousRuntimeSha === undefined) delete process.env.DISDEX_RUNTIME_COMMIT_SHA; else process.env.DISDEX_RUNTIME_COMMIT_SHA = previousRuntimeSha;
    if (previousReleaseSha === undefined) delete process.env.DISDEX_RELEASE_SHA; else process.env.DISDEX_RELEASE_SHA = previousReleaseSha;
    if (previousV12Sha === undefined) delete process.env.V12_LIVE_COMMIT_SHA; else process.env.V12_LIVE_COMMIT_SHA = previousV12Sha;
    if (previousExpectedRuntimeSha === undefined) delete process.env.DISDEX_EXPECTED_RUNTIME_SHA; else process.env.DISDEX_EXPECTED_RUNTIME_SHA = previousExpectedRuntimeSha;
    if (previousExpectedSha === undefined) delete process.env.DISDEX_EXPECTED_SHA; else process.env.DISDEX_EXPECTED_SHA = previousExpectedSha;
};
process.env.DISDEX_RUNTIME_COMMIT_SHA = SHA;
process.env.DISDEX_EXPECTED_RUNTIME_SHA = SHA;
assert.equal(buildV12RunnerHeartbeat({ status: "fatal", reason: "startup failed" }, NOW, { mode: "LIVE", liveTradingEnabled: true, liveExecutionEnabled: true }).safetyState, "UNKNOWN");
assert.equal(buildPenguRunnerHeartbeat({ status: "fatal", message: "startup failed" }, NOW, { mode: "PENGU_DUAL_LS_V2_FINAL", liveEnabled: true }).safetyState, "UNKNOWN");
assert.equal(buildQuality102RunnerHeartbeat({ status: "fatal", message: "startup failed" }, Q102_CONFIG, NOW).safetyState, "UNKNOWN");
for (const builder of [
    () => buildV12RunnerHeartbeat({ status: "failed", reason: "generic failure" }, NOW, { mode: "LIVE", liveTradingEnabled: true, liveExecutionEnabled: true }),
    () => buildPenguRunnerHeartbeat({ status: "failed", message: "generic failure" }, NOW, { mode: "PENGU_DUAL_LS_V2_FINAL", liveEnabled: true }),
    () => buildQuality102RunnerHeartbeat({ status: "failed", message: "generic failure" }, Q102_CONFIG, NOW),
]) {
    assert.equal(builder().safetyState, "FAIL_CLOSED");
}
for (const [status, expected] of [
    ["SHARED_KILL_SWITCH", "KILL_SWITCH"],
    ["DAILY_LOSS_TRIPPED", "DAILY_LOSS_LATCH"],
    ["SHARED_CRYPTO_DAILY_RISK", "FAIL_CLOSED"],
    ["RECONCILIATION_FAILED", "RECONCILIATION_FAILED"],
] as const) {
    assert.equal(buildV12RunnerHeartbeat({ status, reason: "hold" }, NOW, { mode: "LIVE", liveTradingEnabled: true, liveExecutionEnabled: true }).safetyState, expected);
    assert.equal(buildPenguRunnerHeartbeat({ status, message: "hold" }, NOW, { mode: "PENGU_DUAL_LS_V2_FINAL", liveEnabled: true }).safetyState, expected);
    assert.equal(buildQuality102RunnerHeartbeat({ status, message: "hold" }, Q102_CONFIG, NOW).safetyState, expected);
}
delete process.env.DISDEX_EXPECTED_RUNTIME_SHA;
delete process.env.DISDEX_EXPECTED_SHA;
const runtimeOnlyV12 = buildV12RunnerHeartbeat({ status: "held", reason: "fixture" }, NOW, { mode: "LIVE", liveTradingEnabled: true, liveExecutionEnabled: true });
const runtimeOnlyPengu = buildPenguRunnerHeartbeat({ status: "held", message: "fixture" }, NOW, { mode: "PENGU_DUAL_LS_V2_FINAL", liveEnabled: true });
assert.equal(runtimeOnlyV12.runtimeSha, SHA);
assert.equal(runtimeOnlyV12.expectedSha, "0".repeat(40));
assert.equal(runtimeOnlyV12.safetyState, "UNKNOWN");
assert.equal(runtimeOnlyPengu.runtimeSha, SHA);
assert.equal(runtimeOnlyPengu.expectedSha, "0".repeat(40));
assert.equal(runtimeOnlyPengu.safetyState, "UNKNOWN");
delete process.env.DISDEX_RUNTIME_COMMIT_SHA;
delete process.env.DISDEX_RELEASE_SHA;
delete process.env.V12_LIVE_COMMIT_SHA;
assert.equal(buildV12RunnerHeartbeat({ status: "held", reason: "fixture" }, NOW, { mode: "LIVE", liveTradingEnabled: true, liveExecutionEnabled: true }).safetyState, "UNKNOWN");
assert.equal(buildPenguRunnerHeartbeat({ status: "held", message: "fixture" }, NOW, { mode: "LIVE", liveEnabled: true }).safetyState, "UNKNOWN");
restoreIdentityEnvironment();
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
