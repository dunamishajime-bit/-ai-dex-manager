import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRunnerAlertTransition,
  isUsEquityRegularSessionAt,
  shouldTreatV52StopAsIntentional,
} from "../lib/server/runtime-alert-policy";
import {
  expectedRunnerServiceUnit,
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
  assert.equal(resolveRunnerServiceUnit("V12", currentSha).detail, `current release ${currentSha} のunitを使用`);
  assert.equal(normalizeCurrentReleaseSha(` ${currentSha.toUpperCase()} `), currentSha);
});

test("missing or invalid current release SHA fails closed without choosing a historical unit", () => {
  const resolved = resolveRunnerServiceUnit("QUALITY102_CAUSAL_V1", "8a2d73f7ad46d234dda161d1471191b2b09fa2bd\nnot-a-sha");
  assert.equal(resolved.unit, "");
  assert.equal(resolved.failClosed, true);
  assert.match(resolved.detail, /Fail Closed/);
});
