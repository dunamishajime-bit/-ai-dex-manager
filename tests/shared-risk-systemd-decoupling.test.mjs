import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const V12 = "deploy/systemd/disdex-v12-x1-all@.service";
const PENGU = "deploy/systemd/disdex-pengu-dual-ls-v2@.service";
const WIRING = "scripts/ops/root/disdex-current-runtime-wiring";

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
    /^Requires=disdex-v12-v52-margin-guard@%i\.service$/m,
    `${label} must keep Margin Guard as a hard dependency`,
  );
  assert.doesNotMatch(
    source,
    /^Requires=.*\bdisdex-shared-crypto-risk@%i\.service\b/m,
    `${label} must not stop/restart when Shared Risk transiently restarts`,
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
