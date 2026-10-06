import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadHypeRuntimeObservability} from '../lib/server/hype-runtime-observability';
test('HYPE75 uses current H1 decision and live heartbeat, preserving resolved history without false stop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hype75-hp-'));const sha='a'.repeat(40),now=100*3600000;
 const put=async(p:string,d:any)=>{await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),typeof d==='string'?d:JSON.stringify(d));};
 try{
 await put('.disdex-release-sha',sha);await put('config/hypeTrendLongPolicy.ts','maximumGross: 1.5, riskPct: 5, fastEmaPeriod: 12, slowEmaPeriod: 48, minimumRegimeSlopeBps: 75, breakoutLookbackHours: 24, minimumBreakoutBps: 30, maximumDistanceFromSlowEmaBps: 900, stopAtrMultiple: 2.5, trailingAtrMultiple: 3, maximumHoldHours: 168,');
 await put('hype-zec-long/runner.json',{runtimeCommitSha:sha,mode:'LIVE',updatedAt:now-600000,lastDecisionTs:now-600000,lastDecision:{strategy:'HYPE_LONG',reason:'REGIME_SLOPE_NOT_MET',accepted:false,signalTs:now-3600000},failures:[{occurredAt:now-86400000,message:'old resolved'}]});
 await put('runner-health/heartbeats/hype-trend-long.json',{runtimeSha:sha,expectedSha:sha,heartbeatAt:now,mainPid:42,mode:'LIVE',liveEnabled:true,safetyState:'HEALTHY'});await put('shared/kill-switch.json',{active:false});
 const d=await loadHypeRuntimeObservability(now,{releaseRoot:root,stateRoot:root});const h=d.sleeves.HYPE_LONG;
 assert.equal(h.status,'LIVE');assert.equal(h.maxGross,1.5);assert.equal(h.lastDecision?.reason,'REGIME_SLOPE_NOT_MET');assert.equal(h.publicSignalEligible,false);assert(h.gates.some(g=>g.key==='REGIME_SLOPE_NOT_MET'&&g.status==='BLOCKED'));assert(!h.gates.some(g=>g.key==='BTC_15M_MOVE'||g.key==='BREAKOUT_1M'));
 const stale=await loadHypeRuntimeObservability(now+120001,{releaseRoot:root,stateRoot:root});assert.equal(stale.sleeves.HYPE_LONG.status,'STALE');
 }finally{await rm(root,{recursive:true,force:true});}
});
