import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,lstat,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectV4DynamicEvidence,stageV4EvidenceJson,validateDynamicRefreshTarget} from '../scripts/ops/root/disdex-v4-dynamic-evidence-refresh';

const now=Date.parse('2026-11-03T01:00:00Z'),sha='a'.repeat(40);
const runtime={sharedRisk:{sourceComplete:true,tripped:false,utcDay:'2026-11-03',updatedAt:now-1000,maximumLossPct:7.5},
 marginGuard:{stage:'HEALTHY',ordersAllowed:true,checkedAt:now-1000},killSwitch:{active:false},
 pendingExposure:{schema:'disdex-pending-exposure/v1',accountScope:'ASTER_FUTURES',updatedAt:now-1000,entries:[]}};
test('refresh-only authority cannot reattribute another release evidence target',()=>{
 assert.doesNotThrow(()=>validateDynamicRefreshTarget({status:'PASS',candidateSha:sha,readOnly:true,mutationCalls:0},sha));
 assert.throws(()=>validateDynamicRefreshTarget({status:'PASS',candidateSha:'b'.repeat(40),readOnly:true,mutationCalls:0},sha),/TARGET_SHA_INVALID/);
});
test('refresh samples shared risk after the signed reads, with the completion clock',async()=>{
 const events:string[]=[];
 const client={hasTradingCredentials:()=>true,getServerTime:async()=>{events.push('time');return {serverTime:now};},
  getBalances:async()=>{events.push('balances');return [];},getPositions:async()=>{events.push('positions');return [];},
  getOpenOrders:async()=>{events.push('orders');return [];}};
 await collectV4DynamicEvidence({sha,client,runtime,now,readRuntime:async()=>{events.push('runtime');return runtime;},clock:()=>now});
 assert.deepEqual(events,['time','balances','positions','orders','runtime']);
 await assert.rejects(()=>collectV4DynamicEvidence({sha,client,runtime,now,
  readRuntime:async()=>runtime,clock:()=>now+900001}),/STALE|WRONG_UTC_DAY/);
});
test('published evidence retains reader group and 0640 while private output stays 0600',{skip:process.platform==='win32'},async()=>{
 const p=await mkdtemp(join(tmpdir(),'v4-refresh-publication-'));
 try{
  const staged=await stageV4EvidenceJson(join(p,'evidence.json'),{value:1},process.getgid!());
  const s=await lstat(staged);assert.equal(s.mode&0o777,0o640);assert.equal(s.gid,process.getgid!());
  assert.deepEqual(JSON.parse(await readFile(staged,'utf8')),{value:1});
  const privateFile=await stageV4EvidenceJson(join(p,'private.json'),{});
  assert.equal((await lstat(privateFile)).mode&0o777,0o600);
 }finally{await rm(p,{recursive:true,force:true});}
});
