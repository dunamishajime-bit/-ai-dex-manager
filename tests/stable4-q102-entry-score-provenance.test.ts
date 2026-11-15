import test from "node:test";
import assert from "node:assert/strict";
import {MemoryQuality102CausalV1StateStore,createQuality102CausalV1State} from "../lib/disdex-quality102-causal-v1-state";
import {Quality102CausalV1Runner} from "../lib/disdex-quality102-causal-v1-runner";
import {QUALITY102_CAUSAL_V1} from "../config/disdexQuality102CausalV1Runtime";
const T=1800000000000,SHA="a".repeat(40);
const record=(overrides:any={})=>({strategy:"Q102",positionId:"entry-id",sourceSha:SHA,symbol:"UNIUSDT",side:"SHORT",entryTs:T,modelVersion:"ENTRY_V1",score:.01,capturedAt:T+1,...overrides});
const pending=(overrides:any={})=>({idempotencyKey:"entry-id",clientOrderId:"q102-entry-id",phase:"planned",symbol:"UNIUSDT",side:"SELL",quantity:2,reduceOnly:false,referenceTs:T,createdAt:T+1,updatedAt:T+1,expectedPrice:100,targetGross:.75,hardStop:.07,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24,...overrides});
const position=(overrides:any={})=>({symbol:"UNIUSDT",side:-1,quantity:2,entryPrice:100,entryTs:T+1000,hardStop:.07,bestPrice:100,trailActive:false,acceptedEntryGross:.75,...overrides});
function store(extra:any={}){return new MemoryQuality102CausalV1StateStore({...createQuality102CausalV1State("LIVE",SHA),...extra},"LIVE",SHA);}
test("legacy state remains loadable and nested provenance roundtrips without rewriting position clocks",async()=>{
 assert.equal((await store({pending:pending()}).load()).pending?.entryOpportunity,undefined);
 const entryOpportunity=record();const state=await store({pending:pending({entryOpportunity}),position:position({entryOpportunity})}).load();
 assert.deepEqual(state.pending?.entryOpportunity,entryOpportunity);assert.deepEqual(state.position?.entryOpportunity,entryOpportunity);assert.equal(state.position?.entryTs,T+1000);assert.equal(state.position?.entryOpportunity?.entryTs,T);
});
test("strict nested provenance binds strategy symbol side pending identity and logical timestamp",async()=>{
 for(const change of [{strategy:"V4"},{symbol:"AVAXUSDT"},{side:"LONG"},{positionId:"other-entry"},{entryTs:T-1},{score:NaN},{extra:true}])await assert.rejects(store({pending:pending({entryOpportunity:record(change)})}).load());
 await assert.rejects(store({pending:pending({reduceOnly:true,entryOpportunity:record()})}).load());
 for(const change of [{symbol:"AVAXUSDT"},{side:"LONG"},{strategy:"V4"},{entryTs:T+2000,capturedAt:T+2001}])await assert.rejects(store({position:position({entryOpportunity:record(change)})}).load());
});
function runnerFixture(builder?:any){
 const saved:any[]=[],warnings:string[]=[],state:any={...createQuality102CausalV1State("LIVE",SHA)},history={candlesBySymbol:{}},lock={release:async()=>{}};
 const runner:any=new Quality102CausalV1Runner({config:{...QUALITY102_CAUSAL_V1,mode:"LIVE",runtimeCommitSha:SHA,symbols:["UNIUSDT"],minimumOrderNotionalUsd:5,maximumEntryDelayMs:3600000,maxSlippageBps:20},now:()=>T+1000,stateStore:{save:async(s:any)=>{saved.push(structuredClone(s));}},executor:{normalizeMarketQuantity:async()=>({quantity:2,notional:200}),getPositions:async()=>[{symbol:"UNIUSDT",quantity:-2,entryPrice:100,updatedAt:T+1000}]},logger:{info:()=>{},warn:(m:string)=>warnings.push(m),error:()=>{}},...(builder?{entryOpportunityBuilder:builder}:{})} as any);
 runner.integratedGrossContext=async()=>({});runner.protectPosition=async()=>undefined;
 const signal:any={strategyId:"QUALITY102_CAUSAL_V1",side:-1,symbol:"UNIUSDT",referenceTs:T,requestedGross:.75,reason:"NATIVE",dataCutoffTs:T-3600000,brkEnabled:false,hardStop:.07,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24};
 const quote={symbol:"UNIUSDT",midPrice:100,bidPrice:99.99,askPrice:100.01,bidQuantity:100,askQuantity:100,spreadBps:2,updatedAt:T+1000};
 const plan=()=>runner.planEntry(state,signal,{walletBalance:1000,availableBalance:1000,asset:"USDT",updatedAt:T+1000},[],quote,false,false,lock,history);
 return{runner,state,saved,warnings,history,lock,signal,plan};
}
test("capture precedes pending persistence and fill retains frozen provenance with venue observation clock",async()=>{
 let input:any,calls=0;const f=runnerFixture(async(x:any)=>{input=x;calls++;assert.equal(f.saved.length,0);return record({positionId:x.pending.idempotencyKey});});
 const result=await f.plan();assert.equal(result.status,"planned");assert.equal(calls,1);assert.equal(input.history,f.history);assert.equal(input.lock,f.lock);assert.equal(input.decisionTs,T+1000);
 const frozen=f.saved[0].pending.entryOpportunity;assert.ok(frozen);assert.equal(frozen.positionId,f.state.pending.idempotencyKey);
 await f.runner.applyFilledEntry(f.state,f.state.pending,{executedQuantity:2,averagePrice:100});
 const loaded=await store(f.saved.at(-1)).load();assert.deepEqual(loaded.position?.entryOpportunity,frozen);assert.equal(loaded.position?.entryTs,T+1000);assert.equal(loaded.pending,undefined);assert.equal(calls,1);
});
test("baseline builder failure leaves native eligibility intact with an explicit missing-score diagnostic",async()=>{
 for(const builder of [undefined,async()=>{throw Error("SCORE_MISSING");},async()=>record({positionId:"wrong"}),async()=>undefined]){
  const f=runnerFixture(builder);assert.equal((await f.plan()).status,"planned");assert.equal(f.state.pending.entryOpportunity,undefined);assert.ok(f.warnings.some(x=>x.includes("OPPORTUNITY")));
 }
});
test("recovered UNI requires a valid built record even when invoked directly at the planner boundary",async()=>{
 for(const builder of [undefined,async()=>undefined,async()=>{throw Error("SCORE_MISSING");},async()=>record({positionId:"wrong"})]){
  const f=runnerFixture(builder);f.signal.reason="STABLE4_Q102_UNI_ONLINE_RECOVERY:PORTFOLIO_DD_GOVERNOR:BASE";const result=await f.plan();assert.equal(result.status,"blocked-local");assert.equal(result.ordersSent,0);assert.equal(f.state.pending,undefined);assert.equal(f.saved.length,0);
 }
});
test("partial reduction and restart preserve the original entry identity and score",async()=>{
 const entryOpportunity=record(),f=runnerFixture();f.state.position=position({entryOpportunity});
 f.runner.dependencies.executor.getPositions=async()=>[{symbol:"UNIUSDT",quantity:-1,entryPrice:100,updatedAt:T+2000}];
 const reduce=pending({idempotencyKey:"reduction-id",reduceOnly:true,side:"BUY",quantity:1,referenceTs:T+1000,reason:"BASE_PRIORITY_MTM_REDUCTION:TEST"});f.state.pending=reduce;
 const out=await f.runner.applyFilledBaseReduction(f.state,reduce,{executedQuantity:1,averagePrice:100});assert.equal(out.status,"completed");
 const restarted=await store(f.saved.at(-1)).load();assert.equal(restarted.position?.quantity,1);assert.equal(restarted.position?.entryTs,T+1000);assert.deepEqual(restarted.position?.entryOpportunity,entryOpportunity);
});
test("an explicit unknown score is valid for baseline provenance but cannot bind a recovered UNI entry",async()=>{
 const builder=async(x:any)=>record({positionId:x.pending.idempotencyKey,score:null});
 const native=runnerFixture(builder);assert.equal((await native.plan()).status,"planned");assert.equal(native.state.pending.entryOpportunity.score,null);
 const recovered=runnerFixture(builder);recovered.signal.reason="STABLE4_Q102_UNI_ONLINE_RECOVERY";const out=await recovered.plan();assert.equal(out.status,"blocked-local");assert.equal(recovered.saved.length,0);assert.equal(recovered.state.pending,undefined);
});
test("the builder receives a frozen detached pending snapshot before its asynchronous work",async()=>{
 const f=runnerFixture(async(x:any)=>{
  assert.equal(Object.isFrozen(x.pending),true);const original=x.pending.quantity;assert.equal(Reflect.set(x.pending,"quantity",999),false);
  await Promise.resolve();assert.equal(x.pending.quantity,original);return record({positionId:x.pending.idempotencyKey});
 });
 assert.equal((await f.plan()).status,"planned");assert.equal(f.state.pending.quantity,2);assert.ok(f.state.pending.entryOpportunity);
});
