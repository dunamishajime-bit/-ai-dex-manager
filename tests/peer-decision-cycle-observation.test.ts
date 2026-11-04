import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sha='a'.repeat(40);
async function implementation(){const path='../lib/disdex-peer-decision-cycle.ts';return (await import(path)).observePeerDecisionCycle;}
async function fixture(run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'disdex-peer-tick-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test('only a completed awaited cycle records actual PID CWD and original result',async()=>fixture(async root=>{
 const observe=await implementation();let release!:()=>void;const pending=new Promise<void>(done=>release=done);
 const result={status:'no-change',message:'NO_SIGNAL'};
 const work=observe({root,runnerId:'PENGU_V8',runtimeSha:sha,mode:'LIVE',operation:async()=>{await pending;return result;}});
 await new Promise(done=>setTimeout(done,10));assert.deepEqual(await readdir(root),[]);
 release();assert.equal(await work,result);
 const marker=JSON.parse(await readFile(join(root,'ticks/pengu-v8.json'),'utf8'));
 assert.equal(marker.schema,'disdex-runner-tick/v1');assert.equal(marker.mainPid,process.pid);
 assert.equal(marker.workingDirectory,process.cwd());assert.equal(marker.runtimeSha,sha);
 assert.equal(marker.serviceUnit,`disdex-pengu-dual-ls-v2@${sha}.service`);
 assert.ok(marker.tickCompletedAt>=marker.tickStartedAt);assert.equal(marker.reason,'NO_SIGNAL');
 assert.equal(marker.ordersSent,undefined);assert.equal(marker.newOrdersAllowed,false);
}));
test('an incomplete or failed decision does not update lastTick',async()=>fixture(async root=>{
 const observe=await implementation();const args={root,runnerId:'PENGU_V8',runtimeSha:sha,mode:'LIVE'};
 await observe({...args,operation:async()=>({status:'held',message:'PROTECTED'})});
 const path=join(root,'ticks/pengu-v8.json'),before=await readFile(path,'utf8');
 await assert.rejects(()=>observe({...args,operation:async()=>{throw Error('API_UNAVAILABLE');}}),/API_UNAVAILABLE/);
 assert.equal(await readFile(path,'utf8'),before);
}));
test('invalid LIVE identity is rejected before the decision can invoke an adapter',async()=>fixture(async root=>{
 const observe=await implementation();let calls=0;
 for(const identity of [{runnerId:'V52',runtimeSha:sha},{runnerId:'PENGU_V8',runtimeSha:'unknown'}]){
  await assert.rejects(()=>observe({root,...identity,mode:'LIVE',operation:async()=>{calls++;return {status:'completed'};}}));
 }
 assert.equal(calls,0);assert.deepEqual(await readdir(root),[]);
}));
test('lock, held and no-signal are real completed outcomes without fabricated mutation counts',async()=>fixture(async root=>{
 const observe=await implementation();
 for(const status of ['locked','held','no-change']){
  await observe({root,runnerId:'HYPE_TREND_LONG',runtimeSha:sha,mode:'LIVE',operation:async()=>({status,message:status,ordersSent:NaN})});
  const row=JSON.parse(await readFile(join(root,'ticks/hype-trend-long.json'),'utf8'));
  assert.equal(row.status,status);assert.equal(row.newOrdersAllowed,false);assert.equal(row.ordersSent,undefined);
 }
}));
test('failed marker publication cannot be reported as a successful observed cycle',async()=>fixture(async root=>{
 const observe=await implementation();await writeFile(join(root,'ticks'),'not a directory');let calls=0;
 await assert.rejects(()=>observe({root,runnerId:'FET_BRK48_RESIDUAL',runtimeSha:sha,mode:'LIVE',operation:async()=>{calls++;return {status:'completed'};}}));
 assert.equal(calls,1);assert.equal(await readFile(join(root,'ticks'),'utf8'),'not a directory');
}));
test('non-LIVE execution preserves existing paper behavior and creates no Production evidence',async()=>fixture(async root=>{
 const observe=await implementation(),result={status:'shadow'};
 assert.equal(await observe({root,runnerId:'PENGU_V8',runtimeSha:'',mode:'SHADOW',operation:async()=>result}),result);
 assert.deepEqual(await readdir(root),[]);
}));
test('the four legacy Production entrypoints wrap their real decision operation',async()=>{
 for(const [file,id] of Object.entries({
  'disdex-pengu-dual-ls-v2-live-runner.ts':'PENGU_V8',
  'disdex-fet-brk48-live-runner.ts':'FET_BRK48_RESIDUAL',
  'disdex-hype-zec-long-live-runner.ts':'HYPE_TREND_LONG',
  'disdex-idle-priority-short-live-runner.ts':'IDLE_PRIORITY_SHORT',
 })){
  const source=await readFile('scripts/'+file,'utf8');
  assert.ok(/await observePeerDecisionCycle\(/.test(source),file);
  assert.ok(source.includes(`runnerId: "${id}"`),file);
 }
});
