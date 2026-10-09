import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry} from "../lib/v12-v4-production-lifecycle";
import {appendV4ClosedExitBars} from "../lib/v12-v4-live-exit-feed";
import {evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";

test("native H2 trailing boundary consumes its own observed next open before the holding deadline",async()=>{
 const H=3600000,ts=200*H;
 const base=evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:ts,age:2,volRatio:.5,er24:.5})[0];
 const candidate={...base,route:"REC_G3_LATE_BTC_REL",family:"RECOVERY_G",effectiveSide:"LONG" as const,requestedGross:.1};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const e=await planProductionEntry(state,{candidate,ts,eventId:"native-reserve",referencePrice:100,
  entryAtr:10,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",minimumOrderNotionalUsd:5,
  quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
 state=applyProductionEvent(state,e);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:e.leg.id,eventId:"native-fill",ts:ts+1,qty:1,price:100,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:e.leg.id,eventId:"native-terminal",ts:ts+2});
 const closed=[{openTs:ts,open:100,high:110,low:99,close:105},
  {openTs:ts+H,open:105,high:111,low:104,close:110}];
 const next=appendV4ClosedExitBars(state,e.leg.id,{closed,nextOpens:[{ts:ts+2*H,price:108}]},ts+2*H+5000);
 assert.equal(next.legs[e.leg.id].plannedExit?.reason,"TRAILING_CROSSED_BEFORE_REPLACEMENT");
 assert.equal(next.legs[e.leg.id].plannedExit?.price,108);
 assert.equal(next.legs[e.leg.id].nativeStop,109);
 assert.throws(()=>appendV4ClosedExitBars(state,e.leg.id,{closed,nextOpens:[]},ts+2*H+5000),/NATIVE_NEXT_OPEN_REQUIRED/);
 assert.throws(()=>appendV4ClosedExitBars(state,e.leg.id,{closed,nextOpens:[{ts:ts+3*H,price:108}]},ts+2*H+5000),/NATIVE_NEXT_OPEN_REQUIRED/);
});
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
