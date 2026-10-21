import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRunnerAlertTransition,
  isUsEquityRegularSessionAt,
  shouldTreatV52StopAsIntentional,
} from "../lib/server/runtime-alert-policy";
import {
  expectedRunnerServiceUnit,
  expectedShaOverrideEnv,
  normalizeCurrentReleaseSha,
  resolveRunnerServiceUnit,
} from "../lib/server/runner-service-resolution";

test("runner alert policy notifies when a live runner becomes unhealthy", () => {
  assert.equal(classifyRunnerAlertTransition("ACTIVE", "FAILED"), "UNHEALTHY");
  assert.equal(classifyRunnerAlertTransition("ACTIVE", "INACTIVE"), "UNHEALTHY");
  assert.equal(classifyRunnerAlertTransition("FAILED", "INACTIVE"), "NONE");
});

test("runner alert policy notifies on recovery without changing trading gates", () => {
  assert.equal(classifyRunnerAlertTransition("FAILED", "ACTIVE"), "RECOVERED");
  assert.equal(classifyRunnerAlertTransition("INACTIVE", "ACTIVE"), "RECOVERED");
  assert.equal(classifyRunnerAlertTransition("ACTIVE", "ACTIVE"), "NONE");
});

test("initial active observation is quiet", () => {
  assert.equal(classifyRunnerAlertTransition(undefined, "ACTIVE"), "NONE");
});

test("V52 stop is intentional only outside the US equity regular session", () => {
  assert.equal(isUsEquityRegularSessionAt(new Date("2026-09-08T16:00:00.000Z")), true);
  assert.equal(isUsEquityRegularSessionAt(new Date("2026-09-08T21:00:00.000Z")), false);
  assert.equal(isUsEquityRegularSessionAt(new Date("2026-09-06T16:00:00.000Z")), false);
  assert.equal(shouldTreatV52StopAsIntentional(true, new Date("2026-09-08T16:00:00.000Z")), false);
  assert.equal(shouldTreatV52StopAsIntentional(true, new Date("2026-09-08T21:00:00.000Z")), true);
  assert.equal(shouldTreatV52StopAsIntentional(false, new Date("2026-09-08T21:00:00.000Z")), false);
});

test("runner unit resolution is pinned to the current release SHA", () => {
  const currentSha = "ba32a19ec67a70185ce14cd281a01631c4ee07cf";
  assert.equal(expectedRunnerServiceUnit("QUALITY102_CAUSAL_V1", currentSha), "disdex-quality102-causal-v1@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(expectedRunnerServiceUnit("SHARED_CRYPTO_RISK", currentSha), "disdex-shared-crypto-risk@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(expectedRunnerServiceUnit("MARGIN_GUARD", currentSha), "disdex-v12-v52-margin-guard@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(expectedRunnerServiceUnit("FET_BRK48_RESIDUAL", currentSha), "disdex-fet-brk48@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(expectedRunnerServiceUnit("HYPE_TREND_LONG", currentSha), "disdex-hype-long@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(expectedRunnerServiceUnit("IDLE_PRIORITY_SHORT", currentSha), "disdex-idle-priority-short@ba32a19ec67a70185ce14cd281a01631c4ee07cf.service");
  assert.equal(resolveRunnerServiceUnit("V12", currentSha).detail, `current release ${currentSha} のunitを使用`);
  assert.equal(normalizeCurrentReleaseSha(` ${currentSha.toUpperCase()} `), currentSha);
});

test("missing or invalid current release SHA fails closed without choosing a historical unit", () => {
  const resolved = resolveRunnerServiceUnit("QUALITY102_CAUSAL_V1", "8a2d73f7ad46d234dda161d1471191b2b09fa2bd\nnot-a-sha");
  assert.equal(resolved.unit, "");
  assert.equal(resolved.failClosed, true);
  assert.match(resolved.detail, /Fail Closed/);
});

test("V12 health alert can pin a V4 unit independently from peer current SHA", () => {
  const peerSha = "ce1edeead8d0f9e5d88e829d415057117502a335";
  const v4Sha = "80b3a6211f168691a85da511bedaa0c7df664f64";
  const resolved = resolveRunnerServiceUnit("V12", peerSha, `disdex-v12-v4@${v4Sha}.service`, v4Sha);
  assert.equal(resolved.failClosed, false);
  assert.equal(resolved.unit, `disdex-v12-v4@${v4Sha}.service`);
  assert.equal(resolved.releaseSha, v4Sha);
});

test("V12 independent SHA pin fails closed when its unit or SHA is malformed", () => {
  const peerSha = "ce1edeead8d0f9e5d88e829d415057117502a335";
  const v4Sha = "80b3a6211f168691a85da511bedaa0c7df664f64";
  const mismatch = resolveRunnerServiceUnit("V12", peerSha, `disdex-v12-v4@${"b".repeat(40)}.service`, v4Sha);
  const invalid = resolveRunnerServiceUnit("V12", peerSha, `disdex-v12-v4@${v4Sha}.service`, "not-a-sha");
  assert.equal(mismatch.failClosed, true);
  assert.equal(invalid.failClosed, true);
});

test("per-runner SHA override requires an explicit exact runner unit", () => {
  const currentSha = "ce1edeead8d0f9e5d88e829d415057117502a335";
  const v4Sha = "80b3a6211f168691a85da511bedaa0c7df664f64";
  const missingUnit = resolveRunnerServiceUnit("V12", currentSha, undefined, v4Sha);
  const peerOverride = resolveRunnerServiceUnit("PENGU_V8", currentSha, `disdex-pengu-dual-ls-v2@${v4Sha}.service`, v4Sha);
  assert.equal(missingUnit.failClosed, true);
  assert.equal(peerOverride.failClosed, false);
  assert.equal(peerOverride.unit, `disdex-pengu-dual-ls-v2@${v4Sha}.service`);
});

test("pinned HYPE and Idle units use explicit SHA overrides instead of false UNKNOWN", () => {
  const peerSha = "ce1edeead8d0f9e5d88e829d415057117502a335";
  const pinnedSha = "1f9a514159b34d719832b70d788cf529d2b55112";
  assert.equal(expectedShaOverrideEnv("HYPE_TREND_LONG"), "DISDEX_ALERT_HYPE_EXPECTED_SHA");
  assert.equal(expectedShaOverrideEnv("IDLE_PRIORITY_SHORT"), "DISDEX_ALERT_IDLE_EXPECTED_SHA");
  const hype = resolveRunnerServiceUnit("HYPE_TREND_LONG", peerSha, `disdex-hype-long@${pinnedSha}.service`, pinnedSha);
  const idle = resolveRunnerServiceUnit("IDLE_PRIORITY_SHORT", peerSha, `disdex-idle-priority-short@${pinnedSha}.service`, pinnedSha);
  assert.equal(hype.failClosed, false);
  assert.equal(idle.failClosed, false);
  assert.equal(hype.releaseSha, pinnedSha);
  assert.equal(idle.releaseSha, pinnedSha);
});


test("health alert source covers every current crypto runner including HYPE and Idle", async () => {
  const { readFile } = await import("node:fs/promises");
  const alert = await readFile("scripts/ops/root/disdex-runner-health-alert.ts", "utf8");
  const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(alert, /id: "HYPE_TREND_LONG"/);
  assert.match(alert, /id: "IDLE_PRIORITY_SHORT"/);
  assert.match(wiring, /DISDEX_ALERT_HYPE_SERVICE_UNIT=\$\{HYPE_UNIT\}/);
  assert.match(wiring, /DISDEX_ALERT_IDLE_SERVICE_UNIT=\$\{IDLE_UNIT\}/);
  assert.match(wiring, /disdex-runner-health-alert\.ts/);
});
