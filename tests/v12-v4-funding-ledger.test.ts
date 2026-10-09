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


test("real runner funding checkpoint survives process restart and never double-books",async()=>{
 const {V4ExecutionStore}=await import("../lib/v12-v4-execution-store");
 const {V4OrderCycle}=await import("../lib/v12-v4-order-cycle");
 const {mkdtempSync,rmSync}=await import("node:fs");
 const {tmpdir}=await import("node:os");
 const {join}=await import("node:path");
 const dir=mkdtempSync(join(tmpdir(),"v4-funding-cursor-"));
 try{
  const sha="a".repeat(40),store=new V4ExecutionStore(join(dir,"orders.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const candidate={...adaptProductionCandidates({...fixture,source:{...fixture.source,
    side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5};
  const ts=candidate.eligibleEntryTs;
  const e=await planProductionEntry(store.read().state,{candidate,ts,eventId:"reserve",referencePrice:100,
   minimumOrderNotionalUsd:5,quantityNormalizer:{
    normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
  let state=applyProductionEvent(store.read().state,e);
  state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"entry",ts:ts+1,id:e.leg.id,qty:5,price:100,feeUsd:0});
  state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"filled",ts:ts+2,id:e.leg.id});
  const old=store.read();store.commit(old.revision,{...old,state});
  let calls=0;
  const client:any={getIncomeHistory:async({startTime,endTime}:any)=>{
   calls++;
   return ts+10>=startTime&&ts+10<=endTime?[{symbol:candidate.symbol,
    incomeType:"FUNDING_FEE",income:"-0.25",asset:"USDT",tranId:3001,time:ts+10}]:[];
  }};
  const cycle=new V4OrderCycle(store,{} as any,{} as any,client);
  await cycle.reconcileFundingUpTo(ts+1000);
  assert.equal(store.read().state.legs[e.leg.id].fundingUsd,-.25);
  assert.equal(store.read().state.journal.filter(x=>x.type==="FUNDING").length,1);
  assert.equal(store.read().state.journal.filter(x=>x.type==="FUNDING_SCAN").length,1);
  const restarted=new V4OrderCycle(new V4ExecutionStore(join(dir,"orders.json"),sha),
   {} as any,{} as any,client);
  await restarted.reconcileFundingUpTo(ts+2000);
  const next=store.read().state;
  assert.equal(next.legs[e.leg.id].fundingUsd,-.25);
  assert.equal(next.journal.filter(x=>x.type==="FUNDING").length,1);
  assert.equal(next.journal.filter(x=>x.type==="FUNDING_SCAN").length,2);
  assert.equal(calls,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
