import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,planProductionEntry,applyProductionEvent} from "../lib/v12-v4-production-lifecycle";
import {buildV4AccountMark} from "../lib/v12-v4-peer-account-mark";
import {emptyPendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
test("signed account marks reconcile an existing V4 leg without folding it into peer ownership",async()=>{
 const now=Date.now(),sha="a".repeat(40);
 const kinds=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"] as const;
 const sources=kinds.map(kind=>({kind,programSha:sha,raw:{
   updatedAt:now,...(kind==="V12"?{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]}:
   kind==="V52"?{positions:{}}:kind==="HYPE_LONG"||kind==="IDLE"?{positions:[]}:kind==="PENGU"?{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE",position:null}:{position:null})}}));
 const candidate={...adaptProductionCandidates({...fixture,source:{...fixture.source,side:fixture.source.side as "LONG"|"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const entry=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"reserve",referencePrice:100,minimumOrderNotionalUsd:5,
  quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
 state=applyProductionEvent(state,entry);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"fill",ts:entry.ts+1,id:entry.leg.id,qty:5,price:100,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"terminal",ts:entry.ts+2,id:entry.leg.id});
 const qty=candidate.effectiveSide==="LONG"?5:-5;
 const args={sources,venue:{capturedAt:now,equityUsd:1000,positions:[{symbol:candidate.symbol,quantity:qty,markPrice:100}]},
  registry:emptyPendingExposureRegistry(now),state,expectedPeerSha:sha,now,eventId:"mark"};
 const result=buildV4AccountMark(args);
 const updated=applyProductionEvent(state,result.event);
 assert.equal(updated.foreign.length,0);
 assert.ok(Math.abs(updated.prices[candidate.symbol]-100)<1e-12);
 assert.throws(()=>buildV4AccountMark({...args,venue:{...args.venue,positions:[{...args.venue.positions[0],quantity:qty+1}]}}),/VENUE_OWNED_QUANTITY_MISMATCH/);
});

test("canonical Q102 and FET flat snapshots may omit optional position but pending cannot masquerade as flat",async()=>{
 const {v4PeerOwners}=await import("../lib/v12-v4-peer-state-owners");
 const now=Date.now(),sha="a".repeat(40);
 const kinds=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"] as const;
 const sources=kinds.map(kind=>({kind,programSha:sha,raw:{updatedAt:now,
  ...(kind==="V12"?{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]}:kind==="V52"?{positions:{}}:
  kind==="HYPE_LONG"||kind==="IDLE"?{positions:[]}:
  kind==="Q102"?{version:1,strategyId:"QUALITY102_CAUSAL_V1"}:
  kind==="FET"?{schema:"fet-brk48-residual-state/v1",strategyId:"FET_BRK48_RESIDUAL"}:
  kind==="RESIDUAL"?{schema:"disdex-idle-residual-long-state/v1"}:
  {version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE"})}}));
 assert.deepEqual(v4PeerOwners(sources,sha,now),[]);
 const q=sources.find(s=>s.kind==="Q102")!;
 (q.raw as any).pending={symbol:"BTCUSDT"};
 assert.throws(()=>v4PeerOwners(sources,sha,now),/PEER_PENDING_OR_MANUAL_REVIEW/);
});
