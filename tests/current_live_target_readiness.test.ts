import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import test from "node:test";

const exec = promisify(execFile);

test("implementation is ready while real-money activation remains operator-blocked", async () => {
  const readiness = JSON.parse(await readFile("docs/production/current-implementation-readiness.json", "utf8"));
  assert.equal(readiness.implementationStatus, "READY");
  assert.equal(readiness.status, "BLOCKED");
  assert.equal(readiness.ordersEnabled, false);
  assert.deepEqual(readiness.blockers, ["OPERATOR_LIVE_ACTIVATION_REQUIRED"]);
  for (const completed of [
    "FET_CORE_PREEMPTION_V12_WIRED",
    "FET_CORE_PREEMPTION_PENGU_WIRED",
    "FET_CORE_PREEMPTION_Q102_WIRED",
    "FET_CORE_PREEMPTION_V52_WIRED",
    "FET_PROTECTIVE_ORDER_V12_RECOGNITION_WIRED",
    "FET_PROTECTIVE_ORDER_PENGU_RECOGNITION_WIRED",
    "FET_CORE_PREEMPTION_REDUCE_ONLY_IDEMPOTENCY_TESTED",
  ]) assert.ok(readiness.completed.includes(completed), completed);

  const { stdout } = await exec(process.execPath, [
    "--import", "tsx",
    "scripts/disdex-current-live-target-readiness.ts",
  ]);
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!);
  assert.equal(result.status, "PRODUCTION_ACTIVATION_BLOCKED");
  assert.equal(result.implementationReady, true);
  assert.deepEqual(result.blockers, ["OPERATOR_LIVE_ACTIVATION_REQUIRED"]);
  assert.equal(result.ordersSent, 0);
  assert.equal(result.cancelSent, 0);
  assert.equal(result.positionChangesSent, 0);
});

test("readiness checker is read-only by construction", async () => {
  const source = await readFile("scripts/disdex-current-live-target-readiness.ts", "utf8");
  for (const forbidden of ["AsterV3Client", "executeMarket", "placeOrder", "cancelOrder", "setLeverage", "setMarginType", "fetch("]) {
    assert.equal(source.includes(forbidden), false, `forbidden mutation/network token: ${forbidden}`);
  }
});


test("activation entry points require the read-only readiness gate", async () => {
  const [wiring, fetUnit, q102Unit] = await Promise.all([
    readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8"),
    readFile("ops/systemd/disdex-fet-brk48@.service", "utf8"),
    readFile("ops/systemd/disdex-quality102-causal-v1@.service", "utf8"),
  ]);
  assert.match(wiring, /assert_current_live_target_ready\(\)/);
  assert.match(wiring, /scripts\/disdex-current-live-target-readiness\.ts\" --require-implementation-ready/);
  const applyStart = wiring.indexOf("apply_wiring() {");
  const gate = wiring.indexOf("  assert_current_live_target_ready", applyStart);
  const firstMutation = wiring.indexOf("  install -d", applyStart);
  assert.ok(applyStart >= 0 && gate > applyStart && firstMutation > gate, "implementation readiness must run before apply mutations");
  for (const [unit, runner] of [[fetUnit, "FET_BRK48_RESIDUAL"], [q102Unit, "QUALITY102_CAUSAL_V1"]] as const) {
    assert.match(unit, /ExecStartPre=.*disdex-current-live-target-readiness\.ts --require-implementation-ready/);
    assert.match(unit, new RegExp(`ExecStartPre=.*disdex-live-operator-activation-gate\\.mjs.*--runner ${runner}`));
  }
});

test("standalone FET Core preemption helper is independently fail-closed", async () => {
  const [helper, wiring] = await Promise.all([
    readFile("scripts/disdex-fet-brk48-core-preempt.ts", "utf8"),
    readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8"),
  ]);
  const gate = helper.indexOf("FET_BRK48_CORE_PREEMPTION_READY");
  const client = helper.indexOf("new AsterV3Client");
  assert.ok(gate >= 0 && client > gate, "preemption readiness must be checked before venue client construction");
  assert.match(wiring, /FET_BRK48_CORE_PREEMPTION_READY=false/);
});
