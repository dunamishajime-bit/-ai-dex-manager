import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const v4Unit = readFileSync("deploy/systemd/disdex-v12-v4@.service", "utf8");
const wiring = readFileSync("scripts/ops/root/disdex-current-runtime-wiring", "utf8");

test("V4 prepares the deploy-owned FET peer state before it reads peers", () => {
  assert.match(
    v4Unit,
    /ExecStartPre=\+\/usr\/bin\/install -d -o deploy -g deploy -m 0700 \/var\/lib\/disdex\/fet-brk48-residual/,
  );
  assert.match(
    v4Unit,
    /ExecStartPre=\+\/bin\/sh -c .*chown deploy:deploy \/var\/lib\/disdex\/fet-brk48-residual\/state\.json.*chmod 600/,
  );
});

test("V4 runtime wiring keeps V4 primary and all peer pins explicit", () => {
  assert.match(wiring, /DISDEX_V12_V4_PRIMARY_SHA/);
  assert.match(wiring, /DISDEX_V12_V4_PEER_SHA/);
  assert.match(wiring, /DISDEX_HEALTH_SNAPSHOT_FET_EXPECTED_SHA=\$\{DEPLOYED_SHA\}/);
  assert.match(wiring, /DISDEX_WATCHDOG_FET_EXPECTED_SHA=\$\{DEPLOYED_SHA\}/);
});

test("V4 wiring does not authorize legacy V12 and V4 together", () => {
  assert.match(wiring, /DISDEX_V12_V4_LEGACY_PERSISTENT_MASK/);
  assert.match(wiring, /V12_OPERATOR_RUNNER="V12_V4"/);
  assert.match(wiring, /systemctl disable --now disdex-v12-three-hour-health-check\.timer/);
});
