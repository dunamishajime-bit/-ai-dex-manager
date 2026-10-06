import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = await readFile(new URL('../scripts/ops/root/disdex-idle-production-redeploy-20261001', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('require_flat_account() {'), source.indexOf('\nCUTOVER_ACCOUNT_MODE='));
const flat = {status:'ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS',positions:[],openOrders:[],ordersSent:0,cancelsSent:0,positionChangesSent:0};

for (const [name, row, code, accepted] of [
  ['flat account',flat,0,true],
  ['position present',{...flat,positions:[{symbol:'FETUSDT',positionAmt:1}]},0,false],
  ['open order present',{...flat,openOrders:[{symbol:'FETUSDT'}]},0,false],
  ['failed diagnostic',{...flat,status:'ASTER_READONLY_ACCOUNT_DIAGNOSTIC_FAIL_CLOSED'},0,false],
  ['diagnostic process failure',flat,9,false],
  ['malformed diagnostic','not-json',0,false],
]) {
  test(`rollback flat check in conditional context: ${name}`, async () => {
    const dir = await mkdtemp(join(tmpdir(),'disdex-rollback-test-'));
    try {
      await mkdir(join(dir,'node_modules','.bin'),{recursive:true});
      await writeFile(join(dir,'diagnostic.json'),typeof row==='string'?row:JSON.stringify(row)+'\n');
      await writeFile(join(dir,'node_modules','.bin','tsx'),'#!/bin/bash\ncat "$DIAG_FILE"\nexit "$DIAG_EXIT"\n',{mode:0o755});
      const result=spawnSync('bash',['-c',`set -Eeuo pipefail\n${helper}\nif require_flat_account "$RUNNER_ROOT"; then echo FLAT_ACCEPTED; else echo FLAT_REJECTED; fi`],{encoding:'utf8',env:{...process.env,DIAG_FILE:join(dir,'diagnostic.json'),DIAG_EXIT:String(code),RUNNER_ROOT:dir}});
      assert.equal(result.error,undefined);
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.includes('FLAT_ACCEPTED'),accepted,result.stdout+result.stderr);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
}

test('rollback stops writers before reconciliation and preserves current financial state', () => {
  const rollback=source.slice(source.indexOf('rollback() {'),source.indexOf("trap 'rc=$?;",source.indexOf('rollback() {')));
  assert.ok(rollback.indexOf('quiesce_rollback_writers')>=0);
  assert.ok(rollback.indexOf('quiesce_rollback_writers')<rollback.indexOf('require_flat_account'));
  assert.doesNotMatch(rollback,/for p in "\$\{STATE_PATHS\[@\]\}"/);
  assert.match(rollback,/migrate_rollback_state_lineage/);
  assert.match(source,/ROLLBACK_CURRENT_FINANCIAL_STATE_PRESERVED/);
  assert.match(rollback,/verify_rollback_runtime/);
  assert.match(source,/ROLLBACK_RESTORED_RUNTIME_VERIFIED/);
  assert.match(rollback,/bash "\$BACKUP\/runtime-wiring\.sh" --apply/);
  assert.match(rollback,/rollback_hold ROLLBACK_TRADER_START_FAILED/);
  assert.match(source,/rollback_hold\(\) \{[\s\S]*?quiesce_rollback_writers/);
  assert.doesNotMatch(rollback,/bash scripts\/ops\/root\/disdex-current-runtime-wiring --apply\) \|\| true/);
});

for (const blocked of [false,true]) {
  test(`rollback migration preserves latest accounting and rejects unknown exposure: blocked=${blocked}`,async () => {
    const dir=await mkdtemp(join(tmpdir(),'disdex-rollback-state-'));
    try {
      const suffixes=['v12-x1-all/runner.json','pengu-dual-ls-v2/runner-live.json','quality102-causal-v1/state.json','v52-aster-only/runner-live.json','fet-brk48-residual/state.json','hype-zec-long/runner.json','idle-priority/state.json','idle-priority/residual-long-state.json'];
      const old='a'.repeat(40),target='b'.repeat(40);
      const expected=[];
      for (const [i,suffix] of suffixes.entries()) {
        const p=join(dir,suffix);
        await mkdir(join(p,'..'),{recursive:true});
        const row={runtimeSha:target,lastCompletedIdempotencyKey:'latest-fill',history:[{realizedPnl:5,sourceSha:target}],positions:i===3&&blocked?{FETUSDT:{quantity:1}}:[]};
        expected.push(row);
        await writeFile(p,JSON.stringify(row));
      }
      await mkdir(join(dir,'shared'),{recursive:true});
      await mkdir(join(dir,'backup'),{recursive:true});
      await writeFile(join(dir,'shared/pending-exposure.json'),JSON.stringify({schema:'disdex-pending-exposure/v1',entries:[]}));
      const block=source.match(/migrate_rollback_state_lineage\(\) \{[\s\S]*?<<'PY'\n([\s\S]*?)\nPY/)[1].replaceAll('/var/lib/disdex',dir);
      const result=spawnSync('python3',['-c',block,old,target,'FLAT',join(dir,'backup')],{encoding:'utf8'});
      assert.equal(result.status===0,!blocked,result.stdout+result.stderr);
      for(const [i,suffix] of suffixes.entries()){
        const actual=JSON.parse(await readFile(join(dir,suffix),'utf8'));
        assert.deepEqual(actual,blocked?expected[i]:{...expected[i],runtimeSha:old});
      }
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
}

test('workflow retains failure rollback through all mandatory postdeploy checks', async () => {
  const workflow=await readFile(new URL('../.github/workflows/full-order-path-production-deploy-20261006.yml',import.meta.url),'utf8');
  assert.match(workflow,/DISDEX_ROLLBACK_ONLY=true/);
  assert.match(workflow,/if:.*failure\(\)/);
  assert.match(workflow,/production-rollback-behavior\.test\.mjs/);
  assert.match(source,/if \[\[ "\$ROLLBACK_ONLY" == true \]\]; then/);
});
