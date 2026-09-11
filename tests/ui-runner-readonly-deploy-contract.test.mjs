import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const control = readFileSync("scripts/ops/root/disdex-github-actions-control", "utf8");
const workflow = readFileSync(".github/workflows/disdex-vps-control.yml", "utf8");
const target = "1cd5cc050b80c9b2e536740efcf2640c86a1c19e";
const base = "7c2ed06ca7caee0105b55a8ef743be454b6f0fdf";

test("V2 deploy is pinned to the mobile UI branch and exact SHA pair", () => {
  for (const source of [control, workflow]) {
    assert.match(source, /UI_SYSTEMD_DEPLOY_V2/);
    assert.match(source, /codex\/mobile-runner-ui-fix-20260912/);
    assert.ok(source.includes(target));
    assert.ok(source.includes(base));
  }
});

test("V2 wiring exposes only canonical read-only runner state paths to the UI", () => {
  assert.match(control, /V12_X1_ALL_STATE_PATH=\/var\/lib\/disdex\/v12-x1-all\/runner\.json/);
  assert.match(control, /PENGU_DUAL_LS_V2_RUNNER_STATE_PATH=\/var\/lib\/disdex\/pengu-dual-ls-v2\/runner-live\.json/);
  assert.match(control, /QUALITY102_CAUSAL_V1_STATE_PATH=\/var\/lib\/disdex\/quality102-causal-v1\/state\.json/);
  assert.match(control, /V52_ASTER_ONLY_STATE_PATH=\/var\/lib\/disdex\/v52-aster-only\/runner-live\.json/);
});

test("V2 makes sanitized heartbeat snapshots readable by the deploy UI user", () => {
  assert.match(control, /Group=deploy/);
  assert.match(control, /UMask=0027/);
  assert.match(control, /systemctl start "?disdex-runner-health-snapshot\.service"?/);
  assert.match(control, /runuser -u deploy -- test -r/);
  assert.match(control, /HEARTBEATS_DEPLOY_READABLE=TRUE/);
});

test("V2 remains UI/read-only and never restarts trading runners", () => {
  assert.match(control, /TRADING_RESTART_ATTEMPTED=FALSE/);
  assert.match(control, /RUNNER_READONLY_WIRING=VERIFIED/);
  assert.doesNotMatch(control, /systemctl restart disdex-v12-x1-all/);
  assert.doesNotMatch(control, /systemctl restart disdex-pengu-dual-ls-v2/);
  assert.doesNotMatch(control, /systemctl restart disdex-quality102-causal-v1/);
  assert.doesNotMatch(control, /systemctl restart disdex-v52-aster-only/);
});
