import test from "node:test";
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
test("V4 G5 shadow event is in the durable journal and replays byte-exact",async()=>{
 let {state,legId}=await openLeg();
 state=appendV4ClosedExitBars(state,legId,{closed:[bar(0,102.1)]},ts+H,
  {threeExitFloorShadowEnabled:true});
 const floor=state.legs[legId].threeExitFloorShadow;
 assert.ok(floor?.armed);
 assert.ok(Math.abs(floor!.floorStopPrice!-100.5)<1e-10);
 assert.equal(floor?.effectiveFromTs,ts+H);
 assert.equal(state.legs[legId].plannedExit,undefined);
 assert.equal(state.journal.filter(e=>e.type==="EXIT_FLOOR_SHADOW_H1").length,1);
 assert.deepEqual(replayProductionJournal(initial,state.journal),state);
});
test("default OFF remains journal-identical with no shadow event",async()=>{
 const {state,legId}=await openLeg();
 const next=appendV4ClosedExitBars(state,legId,{closed:[bar(0,104)]},ts+H);
 assert.equal(next.legs[legId].threeExitFloorShadow,undefined);
 assert.equal(next.journal.filter(e=>e.type==="EXIT_FLOOR_SHADOW_H1").length,0);
 assert.deepEqual(replayProductionJournal(initial,next.journal),next);
});
test("G5 shadow cannot skip H1 or read the future",async()=>{
 const {state,legId}=await openLeg();
 assert.throws(()=>appendV4ClosedExitBars(state,legId,{closed:[bar(1,103)]},ts+2*H,
 {threeExitFloorShadowEnabled:true}),/EXIT_FEED_GAP/);
 assert.throws(()=>appendV4ClosedExitBars(state,legId,{closed:[bar(0,103)]},ts+H-1,
 {threeExitFloorShadowEnabled:true}),/UNCLOSED_H1/);
});
test("V4 X05 only arms after +2.5 percent close, then persists",async()=>{
 let {state,legId}=await openLeg("REC_X05_TIME_36H");
 state=appendV4ClosedExitBars(state,legId,{closed:[bar(0,102.4)]},ts+H,
  {threeExitFloorShadowEnabled:true});
 assert.equal(state.legs[legId].threeExitFloorShadow?.armed,false);
 state=appendV4ClosedExitBars(state,legId,{closed:[bar(1,102.6)]},ts+2*H,
  {threeExitFloorShadowEnabled:true});
 assert.equal(state.legs[legId].threeExitFloorShadow?.armed,true);
 assert.equal(state.legs[legId].threeExitFloorShadow?.floorStopPrice,101);
 assert.deepEqual(replayProductionJournal(initial,state.journal),state);
});
test("G5 SHORT profit floor is below entry and cannot send orders",async()=>{
 let {state,legId}=await openLeg("REC_G5_SLOW_TREND","SHORT");
 state=appendV4ClosedExitBars(state,legId,{closed:[bar(0,97.8)]},ts+H,
  {threeExitFloorShadowEnabled:true});
 assert.equal(state.legs[legId].threeExitFloorShadow?.floorStopPrice,99.5);
 assert.equal(state.journal.filter(e=>e.type==="EXIT_FLOOR_SHADOW_H1").length,1);
});
test("non-G5/X05 frozen route never creates floor journals",async()=>{
 let {state,legId}=await openLeg("REC_X01_TIME_24H");
 state=appendV4ClosedExitBars(state,legId,{closed:[bar(0,109)]},ts+H,
  {threeExitFloorShadowEnabled:true});
 assert.equal(state.legs[legId].threeExitFloorShadow,undefined);
 assert.equal(state.journal.filter(e=>e.type==="EXIT_FLOOR_SHADOW_H1").length,0);
});
