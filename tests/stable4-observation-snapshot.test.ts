import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {captureObservation,readObservation,readR21Observation,readP91Observation,writeObservation,validateObservation} from "../lib/stable4-observation-snapshot";
import {observeR21,observeP91,type Candidate} from "../lib/stable4-research-decision-observation";
const H=3600000,t=200*H,at=t+300000,sha="a".repeat(40);
const c:Candidate={id:"R21_OLD24|ETH|"+t,symbol:"ETHUSDT",route:"R21_OLD24",ts:t,gross:.3,side:"SHORT"};
const p={signalTs:t,asof:at,macroBull:false,asterPoints:0,binancePoints:0,priorH1Close:100,bar:[t,100,101,98,99,10]};
test("capture, atomic snapshot, both actual runner inputs, no assumed slot state",async()=>{
 const d=await mkdtemp(join(tmpdir(),"stable4-observer-"));try{
 const path=join(d,"obs.json");const s=await captureObservation({sourceSha:sha,now:()=>at,loadR21:async()=>[c],loadP91:async()=>p});
 await writeObservation(path,s);
 const r=observeR21(await readR21Observation(path,sha,at+100),at+100);
 assert.equal(r.decisions[0].reason,"SLOT_STATE_UNVERIFIED");assert.equal(r.orderEnabled,false);
 const q=observeP91(await readP91Observation(path,sha,at+100),at+100);assert.equal(q.pass,true);assert.equal(q.orderEnabled,false);
 assert.equal(await readObservation(path,"b".repeat(40),at),undefined);
 assert.equal(await readObservation(path,sha,t+H),undefined);
 assert.equal(await readObservation(path,sha,at-1),undefined);
 assert.throws(()=>validateObservation({...s,orderEnabled:true} as any,sha,at),/INVALID/);
 }finally{await rm(d,{recursive:true,force:true});}
});
test("independent feed failure, stale/duplicate/clock rejection",async()=>{
 const s=await captureObservation({sourceSha:sha,now:()=>at,loadR21:async()=>{throw Error("gap");},loadP91:async()=>p});
 assert.equal(s.r21.status,"UNAVAILABLE");assert.equal(s.p91.status,"AVAILABLE");
 assert.throws(()=>validateObservation({...s,r21:{status:"AVAILABLE",candidates:[c,c]}},sha,at),/INVALID/);
 await assert.rejects(captureObservation({sourceSha:sha,now:()=>t,loadR21:async()=>[],loadP91:async()=>p}),/WINDOW/);
});
