import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = yaml.load(readFileSync(resolve(root, '.github/workflows/hp-data-fetch-reliability-20261012.yml'), 'utf8'));
const steps = workflow.jobs.ui.steps;

test('root SSH credentials are scoped only to the post-build SSH initialization step', () => {
  const jobEnv = workflow.jobs.ui.env || {};
  assert.equal(Object.keys(jobEnv).some((key) => /SSH_HOST|ROOT_KEY|SSH_KNOWN_HOSTS|SSH_PORT/.test(key)), false);

  const buildIndex = steps.findIndex((step) => step.name === 'Clean production build');
  const uploadIndex = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
  const initIndex = steps.findIndex((step) => step.name === 'Initialize restricted root SSH for HP-only deployment');
  const init = steps[initIndex];
  assert.ok(buildIndex >= 0 && uploadIndex > buildIndex && initIndex > uploadIndex);
  assert.deepEqual(Object.keys(init.env || {}).sort(), ['ROOT_KEY', 'SSH_HOST', 'SSH_KNOWN_HOSTS'].sort());
  assert.match(init.env.ROOT_KEY, /^\$\{\{ secrets\.DISDEX_VPS_ROOT_PRIVATE_KEY \}\}$/);
  assert.match(init.run, /RUNNER_TEMP\/disdex-vps-ssh-/);
  assert.doesNotMatch(init.run, /HOME\/\.ssh/);
  assert.ok(steps.some((step) => step.name === 'Read-only VPS preflight for exact current Trading and UI lineage' && step.env?.SSH_HOST));
  assert.ok(steps.some((step) => step.name === 'Transfer exact-SHA standalone UI artifact' && step.env?.SSH_HOST));
  assert.ok(steps.some((step) => step.name === 'Install immutable UI release, switch only HP, and verify ranking data' && step.env?.SSH_HOST));
});

test('SSH private key cleanup runs even when deployment or public smoke fails', () => {
  const cleanup = steps.find((step) => step.name === 'Remove temporary root SSH credentials');
  assert.ok(cleanup);
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /rm -f -- "\$expected\/id_root" "\$expected\/known_hosts"/);
  assert.match(cleanup.run, /rmdir -- "\$expected"/);
});

test('trading service snapshots fail closed and in-deploy rollback verifies the restored HP', () => {
  const deploy = steps.find((step) => step.name === 'Install immutable UI release, switch only HP, and verify ranking data').run;
  assert.doesNotMatch(deploy, /systemctl show[^\n]*NRestarts[^\n]*\|\| true/);
  assert.match(deploy, /TRADING_OR_SUPPORT_UNIT_CHANGED/);
  assert.match(deploy, /RESTORED_UI_HEALTH=PASS/);
  assert.match(deploy, /'\/realtime'/);
  assert.ok(deploy.lastIndexOf('HP_UI_DEPLOYED=true') > deploy.lastIndexOf('\nREMOTE\n'));
});

test('public smoke failure triggers a guarded HP-only rollback before SSH cleanup', () => {
  const publicIndex = steps.findIndex((step) => step.name === 'Verify public XServer HP reachability');
  const rollbackIndex = steps.findIndex((step) => step.name === 'Rollback HP release if public smoke fails');
  const rollback = steps[rollbackIndex];
  const cleanupIndex = steps.findIndex((step) => step.name === 'Remove temporary root SSH credentials');
  assert.ok(rollbackIndex > publicIndex && cleanupIndex > rollbackIndex);
  assert.match(rollback.if, /failure\(\)/);
  assert.match(rollback.if, /env\.HP_UI_DEPLOYED/);
  assert.match(rollback.run, /EXPECTED_OLD_UI_SHA/);
  assert.match(rollback.run, /TRADING_MUTATION=0/);
  assert.match(rollback.run, /RESTORED_UI_HEALTH=PASS/);
});
