import test from "node:test";
import assert from "node:assert/strict";
import {loadR21PublicObservation} from "../lib/stable4-r21-public-observation-feed";
import {initial} from "../lib/stable4-research-decision-observation";
import type {GetBars} from "../lib/stable4-p91-public-observation-feed";
const H=3600000,M=300000,t=Date.parse("2026-10-01T00:00:00Z"),asof=t+60000;
function fake(){let calls=0;const get:GetBars=async(_v,_s,i,a,b)=>{
 calls++;const w=i==="1h"?H:M;return Array.from({length:(b-a)/w},(_,j)=>[a+j*w,100,101,99,100,12,a+(j+1)*w-1,1200,12,6]);};
 return {get,calls:()=>calls};}
test("all 14 symbols with exact same UTC closed windows; no signal on flat price",async()=>{
 const f=fake(),x=await loadR21PublicObservation(asof,initial(),f.get,()=>asof);
 assert.equal(f.calls(),42);assert.deepEqual(x?.candidates,[]);
});
test("missing bar and duplicate fail closed",async()=>{
 const f=fake();await assert.rejects(loadR21PublicObservation(asof,initial(),async(...a)=>(await f.get(...a)).slice(1),()=>asof),/R21_RAW_GAP/);
 const g=fake();await assert.rejects(loadR21PublicObservation(asof,initial(),async(...a)=>{const x=await g.get(...a);return [...x,x[0]];},()=>asof),/DUPLICATE/);
});
test("deadline and early call do not generate candidates",async()=>{
 const f=fake();assert.equal(await loadR21PublicObservation(t,initial(),f.get,()=>t),undefined);
 await assert.rejects(loadR21PublicObservation(asof,initial(),f.get,()=>t+16*60000),/DEADLINE/);
 assert.equal(f.calls(),0);
});
