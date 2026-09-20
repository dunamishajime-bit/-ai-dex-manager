import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyOperatorActivationGateToRestart,
  validateImplementationReadiness,
  validateOperatorActivationArtifact,
  validateOperatorActivationFileMetadata,
} from "../scripts/ops/root/disdex-live-operator-activation-gate.mjs";
import { assertLiveStateMetadata } from "../lib/disdex-live-state-ownership";

const SHA = "a".repeat(40);
const TARGET = "V12 Top3 + FET + Q102 Governor";

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    schema: "disdex-live-operator-activation/v1",
    target: TARGET,
    approvedSha: SHA,
    approvedRunners: ["V12_X1_ALL", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52", "FET_BRK48_RESIDUAL"],
    ordersEnabled: true,
    operatorAcknowledgement: "I_ACK_REAL_MONEY_LIVE_ACTIVATION",
    approvedAt: new Date().toISOString(),
    ...overrides,
  };
}

function stats(overrides: Record<string, unknown> = {}) {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    gid: 0,
    mode: 0o100600,
    ...overrides,
  };
}

test("implementation readiness permits deployment while operator activation remains blocked", () => {
  const result = validateImplementationReadiness({
    schema: "disdex-current-implementation-readiness/v1",
    target: TARGET,
    implementationStatus: "READY",
    status: "BLOCKED",
    ordersEnabled: false,
    blockers: ["OPERATOR_LIVE_ACTIVATION_REQUIRED"],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.target, TARGET);
});

test("operator activation artifact is exact-SHA and runner scoped", () => {
  assert.equal(validateOperatorActivationArtifact(artifact(), {
    sha: SHA,
    target: TARGET,
    runner: "V12_X1_ALL",
  }).allowed, true);

  assert.equal(validateOperatorActivationArtifact(artifact({ approvedSha: "b".repeat(40) }), {
    sha: SHA,
    target: TARGET,
    runner: "V12_X1_ALL",
  }).allowed, false);

  assert.equal(validateOperatorActivationArtifact(artifact({ approvedRunners: ["V12_X1_ALL"] }), {
    sha: SHA,
    target: TARGET,
    runner: "PENGU_V8",
  }).allowed, false);

  assert.equal(validateOperatorActivationArtifact(artifact({ ordersEnabled: false }), {
    sha: SHA,
    target: TARGET,
    runner: "V12_X1_ALL",
  }).allowed, false);
});

test("operator activation file must be root-owned non-writable regular file", () => {
  assert.equal(validateOperatorActivationFileMetadata(stats()).allowed, true);
  assert.equal(validateOperatorActivationFileMetadata(stats({ uid: 1000 })).allowed, false);
  assert.equal(validateOperatorActivationFileMetadata(stats({ gid: 1000 })).allowed, false);
  assert.equal(validateOperatorActivationFileMetadata(stats({ mode: 0o100620 })).allowed, false);
  assert.equal(validateOperatorActivationFileMetadata(stats({ mode: 0o100602 })).allowed, false);
  assert.equal(validateOperatorActivationFileMetadata(stats({ isSymbolicLink: () => true })).allowed, false);
  assert.equal(validateOperatorActivationFileMetadata(stats({ isFile: () => false })).allowed, false);
});

test("watchdog restart is held fail-closed until operator activation", () => {
  const runner = { key: "V12_X1_ALL", unit: "disdex-v12-x1-all@test.service" };
  const restart = { action: "RESTART", reason: "service inactive" };

  const blocked = applyOperatorActivationGateToRestart(
    restart,
    { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_ABSENT" },
    runner,
  );
  assert.equal(blocked.action, "HOLD_FAIL_CLOSED");
  assert.equal(blocked.operatorActivationBlocked, true);
  assert.match(blocked.reason, /OPERATOR_LIVE_ACTIVATION_REQUIRED/);

  const allowed = applyOperatorActivationGateToRestart(
    restart,
    { allowed: true, reason: "OPERATOR_LIVE_ACTIVATION_CONFIRMED" },
    runner,
  );
  assert.equal(allowed.action, "RESTART");
});

test("runtime wiring places activation gate in every trading runner prestart", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  for (const runner of ["V12_X1_ALL", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52", "FET_BRK48_RESIDUAL"]) {
    assert.match(source, new RegExp(`--runner ${runner} --activation-path`));
  }
  assert.match(source, /--require-implementation-ready/);
  assert.match(source, /DISDEX_WATCHDOG_OPERATOR_ACTIVATION_PATH=/);
});

test("runtime wiring leaves watchdog and auto-repair disabled until all trading runners are operator-approved", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  const gate = source.indexOf("if operator_activation_all_trading_ready; then");
  const enableAutoRepair = source.indexOf("systemctl restart disdex-v12-kill-switch-auto-repair.path", gate);
  const enableWatchdog = source.indexOf('ensure_monitor_timer_active "disdex-runner-watchdog.timer"', gate);
  const blocked = source.indexOf("DISDEX_CURRENT_RUNTIME_OPERATOR_AUTOMATION_BLOCKED", gate);
  const stopAutoRepair = source.indexOf("systemctl stop disdex-v12-kill-switch-auto-repair.path", gate);
  const stopWatchdog = source.indexOf("systemctl stop disdex-runner-watchdog.timer", gate);
  assert.ok(gate >= 0 && enableAutoRepair > gate && enableWatchdog > gate);
  assert.ok(blocked > gate && stopAutoRepair > gate && stopWatchdog > gate);
  assert.match(source, /for runner in V12_X1_ALL PENGU_V8 QUALITY102_CAUSAL_V1 V52 FET_BRK48_RESIDUAL/);
});

test("auto-repair checks operator activation before quiescing or resuming trading runners", async () => {
  const source = await readFile("scripts/ops/root/disdex-v12-kill-switch-auto-repair", "utf8");
  const gateIndex = source.indexOf("if ! operator_activation_ready; then");
  const quiesceIndex = source.indexOf("quiesce_composition ||");
  assert.ok(gateIndex >= 0);
  assert.ok(quiesceIndex >= 0);
  assert.ok(gateIndex < quiesceIndex);
  assert.match(source, /V12_AUTO_REPAIR_OPERATOR_ACTIVATION_REQUIRED/);
});

test("recovery state metadata requires deploy ownership contract and mode 0600", () => {
  const ok = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 1001,
    gid: 1001,
    mode: 0o100600,
  };
  assert.doesNotThrow(() => assertLiveStateMetadata(ok, 1001, 1001, "TEST_STATE"));
  assert.throws(() => assertLiveStateMetadata({ ...ok, uid: 0 }, 1001, 1001, "TEST_STATE"), /OWNER_MISMATCH/);
  assert.throws(() => assertLiveStateMetadata({ ...ok, mode: 0o100640 }, 1001, 1001, "TEST_STATE"), /MODE_MISMATCH/);
  assert.throws(() => assertLiveStateMetadata({ ...ok, isSymbolicLink: () => true }, 1001, 1001, "TEST_STATE"), /NOT_REGULAR_FILE/);
});

test("both V12 recovery helpers enforce ownership normalization", async () => {
  const benign = await readFile("scripts/disdex-v12-benign-entry-gate-recovery.ts", "utf8");
  const presubmit = await readFile("scripts/disdex-v12-presubmit-snapshot-recovery.ts", "utf8");
  assert.match(benign, /normalizeLiveStateOwnership\(statePath/);
  assert.match(presubmit, /normalizeLiveStateOwnership\(v12StatePath/);
});
