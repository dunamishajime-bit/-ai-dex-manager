import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wiring = readFileSync("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
const v4Unit = readFileSync("deploy/systemd/disdex-v12-v4@.service", "utf8");

test("V4 SHA-bound env contract unifies every shared kill-switch alias", () => {
  for (const key of [
    "DISDEX_SHARED_KILL_SWITCH_FILE",
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
    "DISDEX_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
  ]) {
    assert.match(
      wiring,
      new RegExp(`^${key}=\\$\\{SHARED_ROOT\\}/kill-switch\\.json$`, "m"),
      `${key} must resolve to the canonical shared kill switch`,
    );
  }
});

test("V4 runtime contract supplies the shared Aster rate budget after legacy env files", () => {
  assert.match(wiring, /^DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=\$\{SHARED_ROOT\}\/aster-rate-budget\.json$/m);
  assert.match(wiring, /^DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS=50$/m);
  assert.match(wiring, /^DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS=5000$/m);
  const baseV96 = v4Unit.indexOf("EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env");
  const basePeers = v4Unit.indexOf("EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env");
  const v4Env = v4Unit.indexOf("EnvironmentFile=/etc/disdex/current-runtime/%i.env");
  assert.ok(baseV96 >= 0 && basePeers > baseV96 && v4Env > basePeers, "SHA-bound runtime contract must load last");
});

test("V4 full-LIVE wiring pins V4 independently while preserving current peer SHA", () => {
  assert.match(wiring, /DISDEX_V12_V4_PRIMARY_SHA/);
  assert.match(wiring, /V4_PRIMARY_RELEASE/);
  assert.match(wiring, /disdex-v12-v4@\$\{V4_PRIMARY_SHA\}\.service/);
  assert.match(wiring, /PENGU_UNIT="disdex-pengu-dual-ls-v2@\$\{DEPLOYED_SHA\}\.service"/);
  assert.match(wiring, /V4_OPERATOR_ACTIVATION_PATH=.*v12-v4-full\.json/);
  assert.match(wiring, /V4_CONTRACT_ENV_FILE=.*\$\{V4_PRIMARY_SHA\}\.env/);
  assert.match(wiring, /DISDEX_V4_MIXED_SHA_RUNTIME_METADATA_PRUNE_SKIPPED/);
  assert.match(wiring, /operator_activation_all_trading_ready/);
});

test("mixed-SHA wiring validates V4 runner artifacts from the pinned V4 release", () => {
  const validation = wiring.match(/validate_release_artifacts\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(validation, /local required_file v4_release="\$CURRENT_RELEASE"/);
  assert.match(validation, /if \[\[ "\$PRIMARY_V12_MODE" == "V4" \]\]; then\s+v4_release="\$V4_PRIMARY_RELEASE"/);
  assert.match(validation, /"\$v4_release\/scripts\/v12-v4-production-runner\.ts"/);
  assert.match(validation, /"\$v4_release\/deploy\/systemd\/disdex-v12-v4@\.service"/);
  assert.doesNotMatch(validation, /"\$CURRENT_RELEASE\/scripts\/v12-v4-production-runner\.ts"/);
  assert.doesNotMatch(validation, /"\$CURRENT_RELEASE\/deploy\/systemd\/disdex-v12-v4@\.service"/);
});
