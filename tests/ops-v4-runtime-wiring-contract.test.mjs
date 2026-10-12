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
