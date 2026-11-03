import test from 'node:test';
import assert from 'node:assert/strict';
import { validateObservedTick, observedV4Phase, readObservedRunnerTick } from '../lib/disdex-observed-runner-phase.mjs';
import { mkdtemp,writeFile,chmod,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sha='a'.repeat(40), now=2000000;
const runner={key:'V12_V4',runnerId:'V12_V4',script:'scripts/v12-v4-production-runner.ts',expectedSha:sha,unit:`disdex-v12-v4@${sha}.service`,releaseRoot:`/home/deploy/disdex-trading/releases/${sha}`,maxStateAgeMs:300000};
const service={pid:123,cwd:runner.releaseRoot};
const marker={schema:'disdex-runner-tick/v1',runnerId:runner.runnerId,runtimeSha:sha,expectedSha:sha,serviceUnit:runner.unit,workingDirectory:runner.releaseRoot,mainPid:123,tickStartedAt:now-100,tickCompletedAt:now-1,ordersSent:0,cancelsSent:0,positionChangesSent:0,status:'held',reason:'KILL_SWITCH_HOLD_PROTECTED',newOrdersAllowed:false};
test('canonical tick requires exact live PID/CWD/SHA/service and never accepts legacy schema',()=>{
 assert.equal(validateObservedTick(runner,service,marker,now).lastTickAt,now-1);
 for(const delta of [{schema:'disdex-runner-tick-heartbeat/v1'},{mainPid:99},{workingDirectory:'/wrong'},{runtimeSha:'b'.repeat(40)},{tickCompletedAt:now+1},{tickCompletedAt:now-300001},{tickCompletedAt:false},{serviceUnit:'other'}]){
  const value=validateObservedTick(runner,service,{...marker,...delta},now);assert.equal(value.valid,false);assert.equal(value.lastTickAt,null);
 }
});
test('monitor phase proves no-order flags and a genuine matching decision tick without granting trading',()=>{
 const tick=validateObservedTick(runner,service,marker,now);
 const state={schema:'disdex-v12-v4-runner-heartbeat/v1',strategyId:'V12_V4',mode:'MONITOR_ONLY',operationMode:'MONITOR_ONLY',liveEnabled:false,newOrdersAllowed:false,runtimeSha:sha,mainPid:123,workingDirectory:runner.releaseRoot,lastTickAt:marker.tickCompletedAt};
 const phase=observedV4Phase(runner,service,state,tick);assert.equal(phase.mode,'MONITOR_ONLY');assert.equal(phase.valid,true);assert.equal(phase.newOrdersAllowed,false);
 for(const delta of [{liveEnabled:true},{newOrdersAllowed:true},{mainPid:99},{runtimeSha:'b'.repeat(40)},{lastTickAt:now+1}])assert.equal(observedV4Phase(runner,service,{...state,...delta},tick).valid,false);
 assert.equal(observedV4Phase(runner,service,state,{valid:false,lastTickAt:null}).valid,false);
});
test('actual snapshot reports a healthy monitor separately from order permission and preserves Q102 gate',async()=>{
 const {buildHeartbeat}=await import('../scripts/ops/root/disdex-runner-health-snapshot-current.mjs');
 const liveService={...service,active:true,command:'scripts/v12-v4-production-runner.ts --monitor-only --daemon',execStart:runner.releaseRoot+'/scripts/v12-v4-production-runner.ts',nRestarts:0};
 const state={schema:'disdex-v12-v4-runner-heartbeat/v1',strategyId:'V12_V4',mode:'MONITOR_ONLY',operationMode:'MONITOR_ONLY',liveEnabled:false,newOrdersAllowed:false,runtimeSha:sha,mainPid:123,workingDirectory:runner.releaseRoot,lastTickAt:marker.tickCompletedAt,heartbeatAt:now-1};
 const dependencies={clock:()=>now,readJson:async()=>state,snapshot:async()=>liveService,readTick:async()=>validateObservedTick(runner,liveService,marker,now)};
 const result=await buildHeartbeat(runner,now,'',dependencies);
 assert.equal(result.heartbeat.mode,'MONITOR_ONLY');assert.equal(result.heartbeat.liveEnabled,false);
 assert.equal(result.heartbeat.safetyState,'MONITOR_ONLY',JSON.stringify(result));assert.equal(result.heartbeat.orderPermission,'DENIED_MONITOR_ONLY');assert.equal(result.heartbeat.newOrdersAllowed,false);
 assert.equal(result.heartbeat.lastTickAt,now-1);assert.equal(result.heartbeat.heartbeatAt,now);
 const held=await buildHeartbeat(runner,now,'existing protected hold',dependencies);
 assert.equal(held.heartbeat.newOrdersAllowed,false);assert.equal(held.heartbeat.healthReason,'existing protected hold');
 const stale=await buildHeartbeat(runner,now,'',{...dependencies,readTick:async()=>({valid:false,lastTickAt:null,reason:'OBSERVED_TICK_TIME'})});
 assert.equal(stale.heartbeat.safetyState,'BLOCKED');assert.equal(stale.heartbeat.actualLastTickAt,null);
});
test('missing marker never borrows current time, legacy stays unverified, and SHA pins must match',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'disdex-observed-phase-'));
 const manifestPath=join(folder,'pins.json'),ticksRoot=folder;
 const r={...runner,heartbeatFile:'v4.json'};
 const pin={sha,serviceUnit:runner.unit,releaseRoot:runner.releaseRoot,evidenceMode:'tick-v1'};
 async function pins(delta={}) {await chmod(manifestPath,0o600).catch(()=>{});await writeFile(manifestPath,JSON.stringify({schema:'disdex-runner-pin-manifest/v1',runners:{V12_V4:{...pin,...delta}}}));await chmod(manifestPath,0o444);}
 try {
  await pins();const missing=await readObservedRunnerTick(r,service,now,{manifestPath,ticksRoot});assert.equal(missing.valid,false);assert.equal(missing.lastTickAt,null);
  await writeFile(join(folder,'v4.json'),JSON.stringify(marker));assert.equal((await readObservedRunnerTick(r,service,now,{manifestPath,ticksRoot})).valid,true);
  await pins({evidenceMode:'legacy'});const legacy=await readObservedRunnerTick(r,service,now,{manifestPath,ticksRoot});assert.equal(legacy.valid,false);assert.equal(legacy.legacy,true);assert.equal(legacy.lastTickAt,null);
  await pins({sha:'b'.repeat(40)});assert.equal((await readObservedRunnerTick(r,service,now,{manifestPath,ticksRoot})).reason,'OBSERVED_PIN_IDENTITY');
  await pins({evidenceMode:'unknown'});assert.equal((await readObservedRunnerTick(r,service,now,{manifestPath,ticksRoot})).reason,'OBSERVED_PIN_EVIDENCE_MODE_INVALID');
 }finally{await chmod(manifestPath,0o600).catch(()=>{});await rm(folder,{recursive:true,force:true});}
});
test('preserved Q102 gate cannot enable historical selector flags',async()=>{
 const {resolveQuality102OperatorGateReason:resolve}=await import('../lib/disdex-q102-health-gate.mjs');
 const env='QUALITY102_CAUSAL_V1_MODE=LIVE QUALITY102_LIVE_ENABLED=false QUALITY102_LIVE_SELECTOR_PARITY=false QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4 QUALITY102_CAUSAL_V1_ENABLED=true QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=true QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=true QUALITY102_CAUSAL_V1_OPERATOR_ARMED=true';
 assert.equal(resolve(env),'');assert.match(resolve(env.replace('QUALITY102_LIVE_ENABLED=false','QUALITY102_LIVE_ENABLED=true')),/HISTORICAL_SELECTOR/);
});
