import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry} from "../lib/v12-v4-production-lifecycle";
import {reconcileV4Funding} from "../lib/v12-v4-funding-ledger";
test("signed funding applies once only to a uniquely owned open leg",async()=>{
 const candidate={...adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const e=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"reserve",referencePrice:100,
 minimumOrderNotionalUsd:5,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
 state=applyProductionEvent(state,e);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"entry",ts:e.ts+1,id:e.leg.id,qty:5,price:100,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"filled",ts:e.ts+2,id:e.leg.id});
 const signed=[{symbol:candidate.symbol,incomeType:"FUNDING_FEE",income:"-0.25",asset:"USDT",tranId:91,time:e.ts+4}];
 const once=reconcileV4Funding(state,signed,e.ts+5);
 assert.equal(once.legs[e.leg.id].fundingUsd,-.25);
 assert.deepEqual(reconcileV4Funding(once,signed,e.ts+6),once);
 assert.throws(()=>reconcileV4Funding(state,[{...signed[0],income:"0.5",asset:"BTC"}],e.ts+5),/PROOF_INVALID/);
});
test("funding for a symbol without independent V4 ownership is rejected",()=>{
 const s=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 assert.throws(()=>reconcileV4Funding(s,[{symbol:"ETHUSDT",incomeType:"FUNDING_FEE",income:"1",asset:"USDT",tranId:9,time:100}],200),/OWNER_AMBIGUOUS/);
});
