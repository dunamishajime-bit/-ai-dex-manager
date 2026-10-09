import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry} from "../lib/v12-v4-production-lifecycle";
import {appendV4ClosedExitBars} from "../lib/v12-v4-live-exit-feed";
test("recording closed H1 later than its close time preserves journal ordering",async()=>{
 const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const e=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"r",referencePrice:100,
  entryAtr:1,minimumOrderNotionalUsd:5,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
 state=applyProductionEvent(state,e);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:e.leg.id,eventId:"f",ts:e.ts+1,qty:e.leg.requestedQty,price:100,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:e.leg.id,eventId:"t",ts:e.ts+2});
 const bar={openTs:e.ts,open:100,high:100.1,low:99.9,close:100};
 const at=e.ts+3600000+5000;
 const next=appendV4ClosedExitBars(state,e.leg.id,{closed:[bar]},at);
 assert.equal(next.journal.at(-1)?.type,"EXIT_BAR");
 assert.equal(next.journal.at(-1)?.ts,at);
 assert.equal(next.legs[e.leg.id].lastExitBarTs,e.ts);
 assert.throws(()=>appendV4ClosedExitBars(state,e.leg.id,{closed:[]},at),/EXIT_FEED_GAP/);
});
