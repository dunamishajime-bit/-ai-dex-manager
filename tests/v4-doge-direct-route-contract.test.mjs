import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const handoff=fs.readFileSync('.github/workflows/disdex-v4-doge-missed-time-exit-operator-handoff.yml','utf8');
const staging=fs.readFileSync('.github/workflows/disdex-v4-doge-operator-request-stage.yml','utf8');
const route=fs.readFileSync('docs/ops/V4_DOGE_DIRECT_NEAR_STYLE_ROUTE_20261101.md','utf8');

test('historical DOGE protected-position handoff is retired after manual flat settlement',()=>{
  assert.match(handoff,/DOGE_PROTECTED_POSITION_PLAN_RETIRED_MANUAL_FLAT=TRUE/);
  assert.match(handoff,/REQUIRES_NEW_FLAT_STATE_PLAN_AND_SCOPE=TRUE/);
  assert.match(handoff,/TRADING_MUTATION=0/);
  assert.match(handoff,/exit 1/);
  assert.doesNotMatch(handoff,/--allow-quiesced/);
  assert.doesNotMatch(handoff,/v12-v4-doge-only-operator-exit\.ts/);
  assert.doesNotMatch(handoff,/deploy-approvals\.json/);
});

test('operator inbox workflow is explicitly legacy, not canonical',()=>{
  assert.match(staging,/Legacy Audit Only/);
  assert.match(staging,/retained for audit compatibility only/);
  assert.match(staging,/Canonical DOGE recovery uses the NEAR-style dedicated direct executor contract/);
});

test('route document defines historical NEAR-style direct pattern',()=>{
  assert.match(route,/owner approval -> exact preflight -> dedicated DOGE-only executor dry-run/);
  assert.match(route,/scripts\/v12-v4-doge-only-operator-exit\.ts/);
  assert.match(route,/root-owned operator inbox\/staging path introduced later is not the canonical/);
});
