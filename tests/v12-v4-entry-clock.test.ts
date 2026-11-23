import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry} from "../lib/v12-v4-production-lifecycle";
test("real account mark precedes later durable reservation without backdating it",async()=>{
 const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 const signal=candidate.eligibleEntryTs,observed=signal+9000;
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"signed-mark",ts:observed-100,
  equityUsd:1000,foreign:[],prices:{}});
 const normalize:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})};
 const entry=await planProductionEntry(state,{candidate,ts:signal,observedAtMs:observed,eventId:"reserve-live",
  referencePrice:100,minimumOrderNotionalUsd:5,quantityNormalizer:normalize});
 assert.equal(entry.ts,observed);
 assert.equal(entry.leg.entryTs,signal);
 const next=applyProductionEvent(state,entry);
 assert.equal(next.journal.length,2);
 await assert.rejects(()=>planProductionEntry(state,{candidate,ts:signal,observedAtMs:signal+900001,
  eventId:"stale",referencePrice:100,minimumOrderNotionalUsd:5,quantityNormalizer:normalize}),/OBSERVATION_STALE_OR_REVERSED/);
});
