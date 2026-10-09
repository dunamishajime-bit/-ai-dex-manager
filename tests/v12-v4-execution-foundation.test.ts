import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry,productionGross,replayProductionJournal,HOUR} from "../lib/v12-v4-production-lifecycle";
const c=()=>({...adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5});
const T=fixture.source.eligibleSourceEntryTs;
const executor:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,quantityText:String(q)})};
const plan=(state:any,candidate=c())=>planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"r-"+candidate.eligibleEntryTs,referencePrice:100,minimumOrderNotionalUsd:5,quantityNormalizer:executor});
test("fresh account inventory replaces prior foreign gross before reservation",async()=>{
 const initial={equityUsd:1000,foreign:[],holdProtected:false};
 let state=createProductionState(initial);
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"mark",ts:T,equityUsd:1000,prices:{TSLAUSDT:4500},
  foreign:[{owner:"V52",symbol:"TSLAUSDT",side:"LONG",qty:1,gross:4.5,crypto:false,pendingGross:0}]} as any);
 assert.equal(productionGross(state).total,4.5);
 await assert.rejects(()=>plan(state),/TOTAL_GROSS_CAP/);
 assert.deepEqual(replayProductionJournal(initial,state.journal),state);
});
test("foreign reservation without a filled position occupies shared crypto gross",async()=>{
 const state=createProductionState({equityUsd:1000,holdProtected:false,
  foreign:[{owner:"PENGU",symbol:"PENGUUSDT",side:"SHORT",qty:0,gross:0,crypto:true,pendingGross:3.25}]});
 await assert.rejects(()=>plan(state),/CRYPTO_GROSS_CAP/);
});
test("a confirmed adverse-price fill is recorded before overrun blocks subsequent entries",async()=>{
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const reserve=await plan(state);state=applyProductionEvent(state,reserve);
 const id=reserve.leg.id;
 state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"confirmed-fill",ts:T,id,qty:5,price:102,feeUsd:.51});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"terminal",ts:T,id});
 assert.equal(state.legs[id].qty,5);assert.equal(state.legs[id].entryNotional,510);
 assert.equal(state.legs[id].reservationUsd,0);
 assert.match((state as any).executionReview,/ENTRY_FILL_OVER_RESERVED_NOTIONAL/);
 await assert.rejects(()=>plan(state,{...c(),eligibleEntryTs:T+HOUR}),/UNRESOLVED_EXECUTION_REVIEW/);
});

test("fresh pending gross uses refreshed equity rather than startup equity",async()=>{
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"new-equity",ts:T,equityUsd:2000,prices:{PENGUUSDT:1},foreign:[{owner:"PENGU",symbol:"PENGUUSDT",side:"SHORT",qty:0,gross:0,crypto:true,pendingGross:3.25}]});
 assert.equal(productionGross(state).crypto,3.25);
 await assert.rejects(()=>plan(state),/CRYPTO_GROSS_CAP/);
});
