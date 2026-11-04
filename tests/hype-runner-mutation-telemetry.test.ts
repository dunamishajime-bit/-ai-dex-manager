import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function actualLog(event:string,result:Record<string,unknown>={}) {
  const source=await readFile('scripts/disdex-hype-zec-long-live-runner.ts','utf8');
  const line=source.split('\n').find(line=>line.includes(`event: "${event}"`)&&line.includes('console.'));
  assert.ok(line,'test must execute the actual production log expression');
  const rows:Record<string,unknown>[]=[];
  const context:Record<string,unknown>={result,runtime:{mode:'LIVE'},error:new Error('fixture unknown outcome'),
    console:{log:(s:string)=>rows.push(JSON.parse(s)),error:(s:string)=>rows.push(JSON.parse(s))}};
  if(source.includes('runnerMutationTelemetry(')) {
    const modulePath='../lib/disdex-runner-mutation-telemetry.ts';
    context.runnerMutationTelemetry=(await import(modulePath)).runnerMutationTelemetry;
  }
  runInNewContext(line.trim(),context);
  assert.equal(rows.length,1);
  return rows[0];
}

test('a completed HYPE cycle without counters cannot certify zero venue mutations',async()=>{
  const row=await actualLog('hype-zec-runner-tick',{status:'completed',message:'HYPE_ZEC_ENTRY_COMPLETED:HYPEUSDT'});
  for(const key of ['ordersSent','cancelsSent','positionChangesSent'])assert.equal(row[key],null);
  assert.equal(row.mutationCountersKnown,false);
});
test('actual HYPE log preserves explicit observed counters',async()=>{
  const row=await actualLog('hype-zec-runner-tick',{status:'completed',ordersSent:2,cancelsSent:1,positionChangesSent:1});
  assert.equal(row.ordersSent,2);assert.equal(row.cancelsSent,1);assert.equal(row.positionChangesSent,1);
  assert.equal(row.mutationCountersKnown,true);
});
test('malformed or partial counters never become certified zeros',async()=>{
  const row=await actualLog('hype-zec-runner-tick',{status:'held',ordersSent:-1,cancelsSent:'0',positionChangesSent:0});
  assert.equal(row.ordersSent,null);assert.equal(row.cancelsSent,null);assert.equal(row.positionChangesSent,0);
  assert.equal(row.mutationCountersKnown,false);
});
test('fatal HYPE outcome does not assert that a request never reached the venue',async()=>{
  const row=await actualLog('hype-zec-runner');
  assert.equal(row.ordersSent,null);assert.equal(row.cancelsSent,null);assert.equal(row.positionChangesSent,null);
  assert.equal(row.mutationCountersKnown,false);
});

test('actual manual-review method preserves unknown post-request outcome in its own audit log',async()=>{
  const source=await readFile('lib/hype-zec-long-runner.ts','utf8');
  const start=source.indexOf('  private async manualReview(');
  const end=source.indexOf('\n  private async ',start+1);
  assert.ok(start>=0&&end>start);
  const method=source.slice(start,end),body=method.slice(method.indexOf('{'));
  const modulePath='../lib/disdex-runner-mutation-telemetry.ts';
  const helper=(await import(modulePath)).runnerMutationTelemetry;
  const fn=runInNewContext('(async function(state,reason)'+body+')',{runnerMutationTelemetry:helper});
  let logged:Record<string,unknown>|undefined,saves=0;
  const state={failures:[]};
  await fn.call({now:()=>1800000000000,dependencies:{stateStore:{save:async()=>{saves++;}}},
    log:{error:(_event:string,row:Record<string,unknown>)=>{logged=row;}}},state,'request outcome unknown');
  assert.equal(saves,1);assert.ok(logged);assert.equal(logged.ordersSent,null);
  assert.equal(logged.mutationCountersKnown,false);
});
