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
    /for unit in "\$PENGU_UNIT" "\$Q102_UNIT" "\$FET_UNIT" "\$V52_UNIT" "\$HYPE_UNIT" "\$IDLE_UNIT"[\s\S]*?ensure_trading_unit_running "\$unit"[\s\S]*?ensure_trading_unit_running "\$V12_UNIT"/,
  );
  assert.match(wiring, /ensure_trading_unit_running\(\) \{/);
});

test("V4 primary unit is ordered after every attested peer", () => {
  assert.match(
    wiring,
    /After=\$\{PENGU_UNIT\} \$\{Q102_UNIT\} \$\{FET_UNIT\} \$\{V52_UNIT\} \$\{HYPE_UNIT\} \$\{IDLE_UNIT\}/,
  );
});

test("V4 primary contract preserves peer safety overrides after V4 env generation", () => {
  assert.match(wiring, /STRICT_PORTFOLIO_PLANNER_ACTIVE=true/);
  assert.match(wiring, /V12_BASE_GROSS_CAP=2\.0/);
  assert.match(wiring, /V12_DYNAMIC_GROSS_CAP=2\.0/);
  assert.match(wiring, /V12_GROSS_CAP=2\.0/);
  assert.match(wiring, /PENGU_GROSS_CAP=1\.0/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_MAX_GROSS=1\.0/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP=3\.0/);
  assert.match(wiring, /QUALITY102_CAUSAL_V1_MAX_GROSS=3\.0/);
  assert.match(wiring, /STOCK_GROSS_CAP=4\.0/);
  assert.match(wiring, /CRYPTO_GROSS_CAP=3\.0/);
  assert.match(wiring, /TOTAL_GROSS_CAP=4\.25/);
  assert.match(wiring, /DISDEX_V52_CRYPTO_GROSS_CAP=3\.0/);
  assert.match(wiring, /DISDEX_V52_STOCK_GROSS_CAP=4\.0/);
  assert.match(wiring, /DISDEX_V52_V11_GROSS_CAP=2\.0/);
  assert.match(wiring, /DISDEX_V52_V50_GROSS_CAP=2\.0/);
  assert.match(wiring, /DISDEX_V52_PORTFOLIO_GROSS_CAP=4\.25/);
  assert.match(wiring, /DISDEX_HYPE_ZEC_MAX_GROSS=1\.5/);
  assert.match(wiring, /DISDEX_IDLE_PRIORITY_RUNTIME_SHA=\$\{DEPLOYED_SHA\}/);
  assert.match(wiring, /DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7\.5/);
  assert.match(wiring, /QUALITY102_CAUSAL_V1_SYMBOLS=\$\{QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS\}/);
  assert.match(wiring, /FET_BRK48_CORE_PREEMPTION_READY=\$\{fet_core_preemption_ready\}/);
  assert.match(wiring, /DISDEX_IDLE_PRIORITY_OPERATOR_ARMED=true/);
});

test("V4 runtime EnvironmentFile pins peer writers to the monitored state roots", () => {
  // The legacy EnvironmentFiles are still loaded by the peer templates.  The
  // release-bound contract must therefore repeat these paths; otherwise a
  // process can write an old state tree while health/watchdog reads /var/lib.
  assert.match(wiring, /DISDEX_V13D_V11EQ_V96_STATE_DIR=\/var\/lib\/disdex\/v52-aster-only/);
  assert.match(wiring, /DISDEX_V52_ASTER_ONLY_STATE_DIR=\/var\/lib\/disdex\/v52-aster-only/);
  assert.match(wiring, /DISDEX_V11EQ_ASTER_ONLY_STATE_DIR=\/var\/lib\/disdex\/v52-aster-only/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_STATE_DIR=\$\{PENGU_STATE_ROOT\}/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_STATE_PATH=\$\{PENGU_STATE_ROOT\}\/runner-live\.json/);
  assert.match(wiring, /DISDEX_V52_ASTER_ONLY_STATE_PATH=\/var\/lib\/disdex\/v52-aster-only\/runner-live\.json/);
});

test("trading startup waits for shared Aster rate-budget quiet between peers", () => {
  assert.match(wiring, /wait_aster_rate_budget_quiet\(\) \{/);
  assert.match(wiring, /disdex-aster-rate-budget\/v1/);
  assert.match(wiring, /DISDEX_CURRENT_RUNTIME_RATE_BUDGET_QUIET_HORIZON_MS/);
  assert.match(wiring, /wait_aster_rate_budget_quiet "before-\$\{unit\}"/);
  assert.match(wiring, /wait_aster_rate_budget_quiet "before-\$\{V12_UNIT\}"/);
  assert.match(wiring, /wait_aster_rate_budget_quiet "after-\$\{unit\}"/);
});

test("V4 wiring performs official flat execution-ledger lineage migration before startup", () => {
  assert.match(wiring, /v12-v4-flat-lineage-migration\.ts/);
  assert.match(wiring, /V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION/);
  assert.match(wiring, /V12_V4_EXECUTION_STORE_PATH/);
});

test("V4 lineage migration loads the V4-primary contract environment", () => {
  assert.match(wiring, /contract_env_file="\$V4_CONTRACT_ENV_FILE"/);
  assert.match(wiring, /"\$contract_env_file"; do/);
});
