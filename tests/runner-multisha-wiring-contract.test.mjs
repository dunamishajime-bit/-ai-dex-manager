import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WIRING = new URL("../scripts/ops/root/disdex-current-runtime-wiring", import.meta.url);
const HEALTH = new URL("../scripts/ops/root/disdex-runner-health-snapshot-current.mjs", import.meta.url);
const WATCHDOG = new URL("../scripts/ops/root/disdex-runner-watchdog-current.mjs", import.meta.url);
const OPERATOR_GATE = new URL("../scripts/ops/root/disdex-live-operator-activation-gate.mjs", import.meta.url);

test("root wiring validates and consumes a runner-pin manifest instead of deriving peer SHAs from current", async () => {
  const source = await readFile(WIRING, "utf8");
  assert.match(source, /RUNNER_PINS_PATH=.*runner-pins\.json/);
  assert.match(source, /load_runner_pin_manifest\(\)/);
  assert.match(source, /disdex-runner-pin-manifest\.mjs/);
  assert.match(source, /--validate/);
  for (const variable of ["PENGU_SHA", "Q102_SHA", "V52_SHA", "FET_SHA", "HYPE_SHA", "IDLE_SHA", "SHARED_RISK_SHA", "MARGIN_SHA"]) {
    assert.match(source, new RegExp(`\\$\\{${variable}\\}`));
  }
  for (const sleeve of ["PENGU", "V52", "Q102", "FET", "HYPE", "IDLE"]) {
    assert.match(source, new RegExp(`DISDEX_HEALTH_SNAPSHOT_${sleeve}_EXPECTED_SHA=\\$\\{${sleeve}_SHA\\}`));
    assert.match(source, new RegExp(`DISDEX_WATCHDOG_${sleeve}_EXPECTED_SHA=\\$\\{${sleeve}_SHA\\}`));
    assert.doesNotMatch(source, new RegExp(`DISDEX_HEALTH_SNAPSHOT_${sleeve}_EXPECTED_SHA=\\$\\{DEPLOYED_SHA\\}`));
    assert.doesNotMatch(source, new RegExp(`DISDEX_WATCHDOG_${sleeve}_EXPECTED_SHA=\\$\\{DEPLOYED_SHA\\}`));
  }
  assert.match(source, /DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT=\$\{SHARED_RISK_RELEASE\}/);
  assert.match(source, /DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT=\$\{MARGIN_RELEASE\}/);
  assert.match(source, /DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA=\$\{SHARED_RISK_SHA\}/);
  assert.match(source, /DISDEX_WATCHDOG_MARGIN_GUARD_EXPECTED_SHA=\$\{MARGIN_SHA\}/);
});

test("health snapshot and watchdog expose evidence mode per runner", async () => {
  const health = await readFile(HEALTH, "utf8");
  const watchdog = await readFile(WATCHDOG, "utf8");
  assert.match(health, /evidenceMode/);
  assert.match(health, /heartbeatAt/);
  assert.match(health, /lastTickAt/);
  assert.match(health, /tick-v1/);
  assert.match(watchdog, /evidenceMode/);
  assert.match(watchdog, /lastTickAt/);
  assert.match(watchdog, /heartbeatAt/);
});

test("operator gate supports runner-specific SHA approvals and an explicit map-required mode", async () => {
  const source = await readFile(OPERATOR_GATE, "utf8");
  assert.match(source, /approvedShaByRunner/);
  assert.match(source, /requireRunnerShaMap/);
  assert.match(source, /--require-runner-sha-map/);
  assert.match(source, /RUNNER_SHA_MISMATCH/);
  assert.match(source, /DISDEX_OPERATOR_RUNNER_SHA_MAP_REQUIRED/);
});

test("root wiring sends map-required operator gates for every trading runner", async () => {
  const source = await readFile(WIRING, "utf8");
  assert.match(source, /--all --require-runner-sha-map/);
  assert.match(source, /--runner \"\$runner\" --require-runner-sha-map/);
  assert.match(source, /--runner V12_V4 --require-runner-sha-map/);
});
