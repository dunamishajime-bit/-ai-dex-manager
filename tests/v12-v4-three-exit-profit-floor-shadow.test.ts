import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileThreeExitFloorShadowStore} from "../lib/exit-profit-floor-three-shadow-store";
import {observeThreeFloorH1History} from "../lib/exit-profit-floor-three-observers";

import assert from "node:assert/strict";
import {
 EXIT_FLOOR_HOUR_MS as H,
} from "../lib/exit-profit-floor-three";
import {
 createProductionState,applyProductionEvent,planProductionEntry,
 replayProductionJournal,type State,type InitialState,
} from "../lib/v12-v4-production-lifecycle";
import {appendV4ClosedExitBars} from "../lib/v12-v4-live-exit-feed";
import {V12_V4_ROUTE_CATALOG,evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";
const ts=200*H;
const initial:InitialState={equityUsd:1000,foreign:[],holdProtected:false};
const normalizer:any={normalizeMarketQuantity:async(_symbol:string,qty:number,price:number)=>{
 const quantity=Math.floor(qty*100)/100;
 return {quantity,notional:quantity*price,stepSize:.01};
}};
function candidate(route:string,side:"LONG"|"SHORT"){
 const raw=evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:ts,
  age:2,volRatio:.5,er24:.5})[0];
 const c=V12_V4_ROUTE_CATALOG.find(r=>r.route===route);
 assert.ok(c,"V12 V4 route must belong to frozen 41-route catalog");
 return {...raw,route,family:c.family,requestedGross:.1,effectiveSide:side,
  symbol:"ETHUSDT"};
}
async function openLeg(route="REC_G5_SLOW_TREND",side:"LONG"|"SHORT"="LONG"){
 let state=createProductionState(initial);
 const c=candidate(route,side);
 const reserv=await planProductionEntry(state,{candidate:c,ts,eventId:"reserve:"+route,
  referencePrice:100,quantityNormalizer:normalizer,minimumOrderNotionalUsd:5});
 state=applyProductionEvent(state,reserv);
 const legId=reserv.leg.id;
 const quantity=reserv.leg.requestedQty;
 state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"entry-fill",ts:ts+100,
  id:legId,qty:quantity,price:100,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"terminal",ts:ts+200,id:legId});
 return {state,legId};
}
function bar(i:number,close:number){
 return {openTs:ts+i*H,open:close,high:close+1,low:close-1,close};
}
test("original 6f97 H1 V4 exit ledger keeps byte-exact old journal schema",async()=>{
 for(const route of ["REC_G5_SLOW_TREND","REC_X05_TIME_36H"]){
  const {state,legId}=await openLeg(route);
  const next=appendV4ClosedExitBars(state,legId,{closed:[bar(0,104)]},ts+H);
  assert.equal(next.legs[legId].plannedExit,undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(next.legs[legId],"threeExitFloorShadow"),false);
  assert.equal(next.journal.some(e=>(e as {type:string}).type==="EXIT_FLOOR_SHADOW_H1"),false);
  assert.deepEqual(replayProductionJournal(initial,next.journal),next);
 }
});
test("G5 and X05 shadow computations are separate from original V4 journal",async()=>{
 for(const route of ["REC_G5_SLOW_TREND","REC_X05_TIME_36H"]){
  const {state,legId}=await openLeg(route);
  const next=appendV4ClosedExitBars(state,legId,{closed:[bar(0,102.9)]},ts+H);
  const leg=next.legs[legId];
  const dir=mkdtempSync(join(tmpdir(),"v4-threefloor-"));
  try{
   const store=new FileThreeExitFloorShadowStore(join(dir,"profit-floor.json"),"V12_V4");
   const id={owner:"V12_V4" as const,route:leg.candidate.route,symbol:leg.candidate.symbol,
    legId:leg.id,side:leg.candidate.effectiveSide,entryTs:leg.entryTs,
    entryPrice:leg.entryNotional/leg.qty,entryQuantity:leg.qty};
   const sample=observeThreeFloorH1History({identity:id,
    closedCandles:[{timestampMs:ts,open:102.9,high:103.9,low:101.9,close:102.9}],
    observedAt:ts+H});
   assert.equal(sample.state?.armed,true);
   assert.equal(sample.state?.floorStopPrice,route==="REC_G5_SLOW_TREND"?100.5:101);
   await store.save(sample.state!);
   const recovered=new FileThreeExitFloorShadowStore(join(dir,"profit-floor.json"),"V12_V4");
   assert.deepEqual(await recovered.load(leg.id),sample.state);
   assert.deepEqual(replayProductionJournal(initial,next.journal),next);
   assert.equal(Object.prototype.hasOwnProperty.call(next.legs[legId],"threeExitFloorShadow"),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
test("untargeted V4 routes keep normal exit evaluation and no H1 profit floor",async()=>{
 const {state,legId}=await openLeg("REC_X01_TIME_24H");
 const next=appendV4ClosedExitBars(state,legId,{closed:[bar(0,109)]},ts+H);
 const leg=next.legs[legId];
 const sample=observeThreeFloorH1History({
  identity:{owner:"V12_V4",route:leg.candidate.route,symbol:leg.candidate.symbol,
   legId:leg.id,side:leg.candidate.effectiveSide,entryTs:leg.entryTs,
   entryPrice:leg.entryNotional/leg.qty,entryQuantity:leg.qty},
  closedCandles:[{timestampMs:ts,open:109,high:110,low:108,close:109}],
  observedAt:ts+H,
 });
 assert.equal(sample.newBars,0);
 assert.equal(sample.state,undefined);
 assert.deepEqual(replayProductionJournal(initial,next.journal),next);
});
test("X05 activation follows completed H1 and never consumes incomplete bar",async()=>{
 const {state,legId}=await openLeg("REC_X05_TIME_36H");
 const leg=state.legs[legId];
 const identity={owner:"V12_V4" as const,route:leg.candidate.route,symbol:leg.candidate.symbol,
  legId:leg.id,side:leg.candidate.effectiveSide,entryTs:leg.entryTs,
  entryPrice:leg.entryNotional/leg.qty,entryQuantity:leg.qty};
 const b=(t:number,v:number)=>({timestampMs:t,open:v,high:v+1,low:v-1,close:v});
 assert.throws(()=>observeThreeFloorH1History({identity,
  closedCandles:[b(ts,102.6)],observedAt:ts+H-1}),/FUTURE_H1/);
 const first=observeThreeFloorH1History({identity,
  closedCandles:[b(ts,102.4)],observedAt:ts+H});
 assert.equal(first.state?.armed,false);
 const next=observeThreeFloorH1History({identity,
  closedCandles:[b(ts,102.4),b(ts+H,102.6)],
  observedAt:ts+2*H,previous:first.state});
 assert.equal(next.state?.armed,true);
 assert.equal(next.state?.effectiveFromTs,ts+2*H);
});
