import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const V12 = "deploy/systemd/disdex-v12-x1-all@.service";
const PENGU = "deploy/systemd/disdex-pengu-dual-ls-v2@.service";
const WIRING = "scripts/ops/root/disdex-current-runtime-wiring";
const CUTOVER = "scripts/ops/root/disdex-idle-production-redeploy-20261001";
const DIRECT_EXECUTOR = "lib/direct-trade-executor.ts";
const V12_ENGINE = "lib/v12-live-execution-engine.ts";
const PENGU_RUNNER = "lib/pengu-dual-ls-v2-portfolio-runner.ts";

async function read(path) {
  return readFile(path, "utf8");
}

function assertSoftSharedRiskHardMargin(source, label) {
  assert.match(
    source,
    /^Wants=.*\bdisdex-shared-crypto-risk@%i\.service\b/m,
    `${label} must pull Shared Risk in as a soft dependency`,
  );
  assert.match(
    source,
    /^After=.*\bdisdex-shared-crypto-risk@%i\.service\b.*\bdisdex-v12-v52-margin-guard@%i\.service\b/m,
    `${label} must preserve start ordering behind Shared Risk and Margin Guard`,
  );
  assert.match(
    source,
    /^Wants=.*\bdisdex-v12-v52-margin-guard@%i\.service\b/m,
    `${label} must pull Margin Guard in as a soft dependency`,
  );
  assert.doesNotMatch(
    source,
    /^Requires=.*\bdisdex-shared-crypto-risk@%i\.service\b/m,
    `${label} must not stop/restart when Shared Risk transiently restarts`,
  );
  assert.doesNotMatch(
    source,
    /^Requires=.*\bdisdex-v12-v52-margin-guard@%i\.service\b/m,
    `${label} must not hard-couple process lifecycle to Margin Guard`,
  );
}

test("V12 and PENGU do not hard-couple process lifecycle to Shared Risk", async () => {
  const [v12, pengu] = await Promise.all([read(V12), read(PENGU)]);
  assertSoftSharedRiskHardMargin(v12, "V12");
  assertSoftSharedRiskHardMargin(pengu, "PENGU");
});

test("runtime wiring installs the managed V12 and PENGU templates before daemon reload", async () => {
  const wiring = await read(WIRING);
  assert.match(wiring, /prepare_managed_unit_templates_for_apply\(\)/);
  assert.match(wiring, /deploy\/systemd\/disdex-v12-x1-all@\.service/);
  assert.match(wiring, /\/etc\/systemd\/system\/disdex-v12-x1-all@\.service/);
  assert.match(wiring, /deploy\/systemd\/disdex-pengu-dual-ls-v2@\.service/);
  assert.match(wiring, /DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED=true/);
  assert.match(wiring, /\/etc\/systemd\/system\/disdex-pengu-dual-ls-v2@\.service/);
  const prepareStart = wiring.indexOf("prepare_managed_unit_templates_for_apply()");
  const reload = wiring.indexOf("systemctl daemon-reload", prepareStart);
  assert.ok(prepareStart >= 0 && reload > prepareStart, "managed templates must be installed before daemon-reload");
});

test("Shared Risk transient handling and lifecycle decoupling are both release artifacts", async () => {
  const wiring = await read(WIRING);
  assert.match(wiring, /validate_release_artifacts/);
  assert.match(wiring, /deploy\/systemd\/disdex-v12-x1-all@\.service/);
  assert.match(wiring, /deploy\/systemd\/disdex-pengu-dual-ls-v2@\.service/);
});


test("cutover verifies the effective dependency graph and can restore prior templates", async () => {
  const cutover = await read(CUTOVER);
  assert.match(cutover, /SYSTEMD_TEMPLATE_PATHS=/);
  assert.match(cutover, /CUTOVER_SYSTEMD_TEMPLATE_BACKED_UP/);
  assert.match(cutover, /ROLLBACK_SYSTEMD_TEMPLATE_RESTORED/);
  assert.match(cutover, /POSTDEPLOY_SHARED_RISK_HARD_DEPENDENCY_PRESENT/);
  assert.match(cutover, /POSTDEPLOY_SHARED_RISK_SOFT_DEPENDENCY_MISSING/);
  assert.match(cutover, /POSTDEPLOY_MARGIN_GUARD_HARD_DEPENDENCY_PRESENT/);
  assert.match(cutover, /POSTDEPLOY_MARGIN_GUARD_SOFT_DEPENDENCY_MISSING/);
  assert.match(cutover, /CUTOVER_SHARED_RISK_SOURCE_INCOMPLETE/);
  assert.match(cutover, /CUTOVER_SHARED_RISK_STALE/);
  assert.match(cutover, /CUTOVER_KNOWN_SHARED_RISK_TRANSIENT_RESTART_ACCEPTED/);
  assert.match(cutover, /name" == disdex-shared-crypto-risk && "\$restart_count" == 1/);
});


test("soft lifecycle dependencies preserve independent fail-closed order gates", async () => {
  const [executor, v12, pengu, wiring] = await Promise.all([
    read(DIRECT_EXECUTOR),
    read(V12_ENGINE),
    read(PENGU_RUNNER),
    read(WIRING),
  ]);
  assert.match(wiring, /DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED=true/);
  assert.match(executor, /runFreshMarginGuardBeforeExposureOrder\(symbol\)/);
  assert.match(executor, /Margin Guard did not return a HEALTHY order-time result/);
  assert.match(v12, /readSharedCryptoDailyRisk\(/);
  assert.match(v12, /SHARED_CRYPTO_RISK:/);
  assert.match(pengu, /readSharedCryptoDailyRisk\(/);
  assert.match(pengu, /Shared crypto daily-risk state blocked PENGU entry/);
});


test("managed Production templates preserve the existing sandbox and launch contract", async () => {
  const [v12, pengu] = await Promise.all([read(V12), read(PENGU)]);
  for (const [label, source] of [["V12", v12], ["PENGU", pengu]]) {
    assert.match(source, /^User=deploy$/m, `${label} user`);
    assert.match(source, /^Group=deploy$/m, `${label} group`);
    assert.match(source, /^NoNewPrivileges=true$/m, `${label} no-new-privileges`);
    assert.match(source, /^PrivateTmp=true$/m, `${label} private tmp`);
    assert.match(source, /^ProtectSystem=strict$/m, `${label} protect system`);
    assert.match(source, /^ProtectHome=read-only$/m, `${label} protect home`);
    assert.match(source, /^UMask=0077$/m, `${label} umask`);
    assert.match(source, /^Restart=on-failure$/m, `${label} restart policy`);
  }
  assert.match(v12, /disdex-v12-mutual-exclusion-preflight\.sh %i runtime/);
  assert.match(v12, /tsx scripts\/disdex-v12-x1-all-live-runner\.ts --daemon/);
  assert.match(v12, /^RestartPreventExitStatus=2$/m);
  assert.match(pengu, /tsx scripts\/disdex-pengu-dual-ls-v2-live-runner\.ts --daemon/);
});


test("cutover waits for fresh safety daemons before starting trading runners", async () => {
  const cutover = await read(CUTOVER);
  assert.match(cutover, /wait_safety_daemons_ready\(\)/);
  assert.match(cutover, /risk\.get\("sourceComplete"\) is not True/);
  assert.match(cutover, /now-risk_at>120000/);
  assert.match(cutover, /guard\.get\("stage"\)!="HEALTHY"/);
  assert.match(cutover, /guard\.get\("ordersAllowed"\) is not True/);
  assert.match(cutover, /now-guard_at>120000/);
  assert.match(cutover, /required_consecutive=2/);

  const sharedStart = cutover.indexOf('systemctl enable --now "disdex-shared-crypto-risk@$TARGET_SHA.service"');
  const marginStart = cutover.indexOf('systemctl enable --now "disdex-v12-v52-margin-guard@$TARGET_SHA.service"');
  const safetyWait = cutover.indexOf("wait_safety_daemons_ready", Math.max(sharedStart, marginStart));
  const coreStart = cutover.indexOf('for name in "${CORE[@]}"', safetyWait);
  assert.ok(sharedStart >= 0 && marginStart >= 0, "safety daemons must be explicitly started");
  assert.ok(safetyWait > sharedStart && safetyWait > marginStart, "freshness gate must run after both safety daemons start");
  assert.ok(coreStart > safetyWait, "core trading runners must start only after safety snapshots are fresh and HEALTHY");
});


test("cutover permits only one diagnosed healthy historical V12 restart", async () => {
  const cutover = await read(CUTOVER);
  assert.match(cutover, /name" == disdex-v12-x1-all && "\$restart_count" == 1/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_RESTART_NOT_CURRENTLY_HEALTHY/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_RESTART_STATE_SHA_MISMATCH/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_RESTART_STATE_STALE/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_RESTART_MANUAL_REVIEW_ACTIVE/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_RESTART_PENDING_ACTIVE/);
  assert.match(cutover, /CUTOVER_KNOWN_V12_SINGLE_RESTART_ACCEPTED/);
  assert.doesNotMatch(cutover, /restart_count" -le [2-9]/);
});


test("cutover permits only one diagnosed healthy historical Q102 restart", async () => {
  const cutover = await read(CUTOVER);
  assert.match(cutover, /name" == disdex-quality102-causal-v1 && "\$restart_count" == 1/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_RESTART_NOT_CURRENTLY_HEALTHY/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_RESTART_STATE_SHA_MISMATCH/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_RESTART_STATE_STALE/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_RESTART_MANUAL_REVIEW_ACTIVE/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_RESTART_PENDING_ACTIVE/);
  assert.match(cutover, /CUTOVER_KNOWN_Q102_SINGLE_RESTART_ACCEPTED/);
});
