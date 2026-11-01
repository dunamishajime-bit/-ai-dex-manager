import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const handoff=fs.readFileSync('.github/workflows/disdex-v4-doge-missed-time-exit-operator-handoff.yml','utf8');
const staging=fs.readFileSync('.github/workflows/disdex-v4-doge-operator-request-stage.yml','utf8');
const route=fs.readFileSync('docs/ops/V4_DOGE_DIRECT_NEAR_STYLE_ROUTE_20261101.md','utf8');

test('DOGE handoff uses quiesced preflight and requires dedicated direct executor',()=>{
  assert.match(handoff,/--allow-quiesced/);
  assert.match(handoff,/v12-v4-doge-only-operator-exit\.ts/);
  assert.match(handoff,/DOGE_DIRECT_EXECUTOR_MISSING=TRUE/);
  assert.match(handoff,/installDogeOnlyGuards/);
  assert.match(handoff,/DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000/);
  assert.match(handoff,/v12-v4-98ded39746ed3502a4d7b0e26ef9/);
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
