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

test("runtime migration commands execute from the exact release root", () => {
  assert.match(
    wiring,
    /assert_current_live_target_ready\n\s+cd "\$CURRENT_RELEASE"\s+\|\| return 1/,
  );
});

test("V4 wiring does not authorize legacy V12 and V4 together", () => {
  assert.match(wiring, /DISDEX_V12_V4_LEGACY_PERSISTENT_MASK/);
  assert.match(wiring, /V12_OPERATOR_RUNNER="V12_V4"/);
  assert.match(wiring, /systemctl disable --now disdex-v12-three-hour-health-check\.timer/);
});

test("operator-enabled wiring starts every exact-SHA trading runner", () => {
  assert.match(
    wiring,
    /for unit in "\$V12_UNIT" "\$PENGU_UNIT" "\$Q102_UNIT" "\$FET_UNIT" "\$V52_UNIT"[\s\S]*?systemctl enable --now "\$unit"/,
  );
});

test("V4 primary contract preserves peer safety overrides after V4 env generation", () => {
  assert.match(wiring, /DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /QUALITY102_CAUSAL_V1_SYMBOLS=\$\{QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS\}/);
  assert.match(wiring, /FET_BRK48_CORE_PREEMPTION_READY=\$\{fet_core_preemption_ready\}/);
  assert.match(wiring, /DISDEX_IDLE_PRIORITY_OPERATOR_ARMED=true/);
});

test("V4 wiring performs official flat execution-ledger lineage migration before startup", () => {
  assert.match(wiring, /v12-v4-flat-lineage-migration\.ts/);
  assert.match(wiring, /V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION/);
  assert.match(wiring, /V12_V4_EXECUTION_STORE_PATH/);
});
