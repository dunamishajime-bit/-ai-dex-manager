import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
import {resolveRunnerServiceUnit} from "../lib/server/runner-service-resolution";

const runner=readFileSync("scripts/v12-v4-production-runner.ts","utf8");
const snapshot=readFileSync("scripts/ops/root/disdex-runner-health-snapshot-current.mjs","utf8");
const watchdog=readFileSync("scripts/ops/root/disdex-runner-watchdog-current.mjs","utf8");
const wiring=readFileSync("scripts/ops/root/disdex-current-runtime-wiring","utf8");
const coherence=readFileSync("scripts/ops/root/disdex-current-runtime-coherence-guard","utf8");
const alert=readFileSync("scripts/ops/root/disdex-runner-health-alert.ts","utf8");

test("V4 daemon emits an exact-release heartbeat after each successful tick",()=>{
 assert.match(runner,/disdex-v12-v4-runner-heartbeat\/v1/);
 assert.match(runner,/V12_V4_HEALTH_STATE_PATH/);
 assert.match(runner,/\/var\/lib\/disdex\/v12-v4\/heartbeat\.json/);
 assert.match(runner,/await writeV4Health\(releaseSha,operationMode,result\)/);
});

test("health snapshot can replace legacy V12 with V4 only by explicit mode",()=>{
 assert.match(snapshot,/DISDEX_HEALTH_SNAPSHOT_V12_MODE/);
 assert.match(snapshot,/key: "V12_V4"/);
 assert.match(snapshot,/disdex-v12-v4@\$\{V12_PIN\.expectedSha\}\.service/);
 assert.match(snapshot,/\/var\/lib\/disdex\/v12-v4\/heartbeat\.json/);
 assert.match(snapshot,/operationMode \|\| ""\)\.toUpperCase\(\) === "CERTIFIED"/);
});

test("watchdog V4 mode targets only the V4 service and V12_V4 operator scope",()=>{
 assert.match(watchdog,/const V4_V12_RUNNER/);
 assert.match(watchdog,/key: "V12_V4"/);
 assert.match(watchdog,/disdex-v12-v4@\$\{sha\}\.service/);
 assert.match(watchdog,/DISDEX_WATCHDOG_V12_MODE/);
 assert.match(watchdog,/operatorActivationPathEnv: "DISDEX_WATCHDOG_V12_OPERATOR_ACTIVATION_PATH"/);
 assert.match(watchdog,/activationPath: runner\.operatorActivationPath/);
 assert.match(watchdog,/DISDEX_WATCHDOG_MARGIN_GUARD_EXPECTED_SHA/);
 assert.match(watchdog,/assertReleasePinnedRunnerSingleton\(nonInactiveMarginUnits, config\.marginGuardUnit/);
 assert.match(watchdog,/runnersForEnv\(env\)/);
 assert.match(watchdog,/evaluateOperatorActivationGate/);
});

test("runtime wiring persists V4 primary and permanently retires legacy recovery paths",()=>{
 assert.match(wiring,/DISDEX_PRIMARY_V12_RUNNER/);
 assert.match(wiring,/\.v12-primary\.env/);
 assert.match(wiring,/V12_OPERATOR_RUNNER="V12_V4"/);
 assert.match(wiring,/V12_STATE_PATH="\/var\/lib\/disdex\/v12-v4\/heartbeat\.json"/);
 assert.match(wiring,/systemctl mask "\$unit"/);
 assert.match(wiring,/DISDEX_V12_V4_LEGACY_PERSISTENT_MASK/);
 assert.match(wiring,/disdex-v12-kill-switch-auto-repair\.path/);
 assert.match(wiring,/disdex-runner-position-recovery\.timer/);
 assert.match(wiring,/disdex-v12-three-hour-health-check\.timer/);
 assert.match(wiring,/DISDEX_V12_V4_LEGACY_RECOVERY_AUTOMATION_DISABLED/);
});

test("coherence guard follows the persistent V4 primary marker",()=>{
 assert.match(coherence,/PRIMARY_V12_MODE_FILE/);
 assert.match(coherence,/FAMILIES\[0\]="disdex-v12-v4"/);
 assert.match(coherence,/HEARTBEATS\[0\]="v12-v4\.json"/);
	assert.match(coherence,/V12_EXPECTED_UNIT="disdex-v12-v4@\$V4_PRIMARY_SHA\.service"/);
 assert.match(coherence,/legacy_v12_persistently_retired/);
 assert.match(coherence,/DISDEX_PRIMARY_V12_RUNNER="\$PRIMARY_V12_MODE"/);
});

test("safety daemons are enabled as well as started so coherence does not defer forever",()=>{
 assert.match(wiring,/systemctl enable "\$unit"/);
 assert.match(wiring,/required safety daemon is not enabled/);
});

test("coherence guard accepts only the exact V4-primary/current-peer mixed-SHA set",()=>{
  const bash=process.platform==="win32"?"C:/Program Files/Git/bin/bash.exe":"/usr/bin/bash";
  const guard=resolve("scripts/ops/root/disdex-current-runtime-coherence-guard");
  const output=execFileSync(bash,[guard,"--self-test-v4-mixed-sha"],{encoding:"utf8"});
  assert.match(output,/V4_MIXED_SHA_COHERENCE_SELFTEST_PASS/);
});

test("coherence guard accepts only the release-bound Python Margin Guard form",()=>{
 const bash=process.platform==="win32"?"C:/Program Files/Git/bin/bash.exe":"/usr/bin/bash";
 const guard=resolve("scripts/ops/root/disdex-current-runtime-coherence-guard");
 const output=execFileSync(bash,[guard,"--self-test-margin-guard-exec"],{encoding:"utf8"});
 assert.match(output,/MARGIN_GUARD_EXECSTART_COHERENCE_SELFTEST_PASS/);
});

test("health alert accepts only exact-SHA V4 override for V12",()=>{
 const sha="a".repeat(40);
 const ok=resolveRunnerServiceUnit("V12",sha,`disdex-v12-v4@${sha}.service`);
 assert.equal(ok.failClosed,false);
 assert.equal(ok.unit,`disdex-v12-v4@${sha}.service`);
 const bad=resolveRunnerServiceUnit("V12",sha,`disdex-v12-v4@${"b".repeat(40)}.service`);
 assert.equal(bad.failClosed,true);
 assert.match(alert,/process\.env\[runner\.unitEnv\]/);
});

test("V12 health alert independently pins full-live SHA while peers remain on current SHA",()=>{
 const current="ce1edeead8d0f9e5d88e829d415057117502a335";
 const v4="80b3a6211f168691a85da511bedaa0c7df664f64";
 const ok=resolveRunnerServiceUnit("V12",current,`disdex-v12-v4@${v4}.service`,v4);
 const peer=resolveRunnerServiceUnit("PENGU_V8",current,`disdex-pengu-dual-ls-v2@${current}.service`);
 const bad=resolveRunnerServiceUnit("V12",current,`disdex-v12-v4@${"b".repeat(40)}.service`,v4);
 assert.equal(ok.failClosed,false);
 assert.equal(ok.unit,`disdex-v12-v4@${v4}.service`);
 assert.equal(ok.releaseSha,v4);
 assert.equal(peer.failClosed,false);
 assert.equal(peer.releaseSha,current);
 assert.equal(bad.failClosed,true);
 assert.match(alert,/DISDEX_ALERT_V12_EXPECTED_SHA/);
 assert.match(alert,/function runnerLabel/);
 assert.match(wiring,/DISDEX_ALERT_V12_EXPECTED_SHA=\$\{V4_PRIMARY_SHA:-\$\{DEPLOYED_SHA\}\}/);
 assert.match(wiring,/DISDEX_WATCHDOG_EXPECTED_SHA=\$\{MONITOR_RUNTIME_SHA\}/);
 assert.match(wiring,/DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA=\$\{MONITOR_RUNTIME_SHA\}/);
 assert.match(wiring,/ExecStart=\/usr\/bin\/node \$\{MONITOR_RUNTIME_ROOT\}\/scripts\/ops\/root\/disdex-runner-watchdog-current\.mjs/);
 assert.match(wiring,/ExecStartPre=\/usr\/bin\/grep -Fxq \$\{V4_PRIMARY_SHA:-\$\{DEPLOYED_SHA\}\}/);
});
