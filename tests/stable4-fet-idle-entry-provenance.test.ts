import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {emptyFetBrk48State,readFetBrk48State,validateFetEntryOpportunity} from "../lib/fet-brk48-state";
import {emptyIdleState,normalizeIdleState,validateIdleEntryOpportunity} from "../lib/idle-priority-short-state";
import {FetBrk48LiveRunner} from "../lib/fet-brk48-live-runner";
import {IdlePriorityShortRunner} from "../lib/idle-priority-short-runner";

const T=1800000000000,SHA="a".repeat(40);
const record=(strategy="FET",extra:any={})=>({strategy,positionId:"entry-id",sourceSha:SHA,symbol:strategy==="FET"?"FETUSDT":"TAOUSDT",side:strategy==="FET"?"LONG":"SHORT",entryTs:T,modelVersion:"entry-v1",score:null,capturedAt:T+1,...extra});
const fetPending=()=>({action:"ENTRY",idempotencyKey:"entry-id",clientOrderId:"fet-entry-id",symbol:"FETUSDT",side:"BUY",quantity:1,referenceTs:T-1,createdAt:T+2,updatedAt:T+2,expectedPrice:100,reason:"ENTRY",targetGross:1,entryTs:T,exitTs:T+86400000,hardStopPct:.05});
const idlePending=()=>({action:"ENTRY",phase:"planned",symbol:"TAOUSDT",route:"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",clientOrderId:"entry-id",idempotencyKey:"entry-id",quantity:1,expectedPrice:100,signalTs:T-3600000,decisionTs:T,holdHours:12,createdAt:T+2,updatedAt:T+2,reason:"ENTRY"});
const idlePosition=()=>({symbol:"TAOUSDT",route:"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",side:"SHORT",signalTs:T-3600000,entryTs:T+10,exitTs:T+10+12*3600000,entryPrice:100,quantity:.5,holdHours:12,gross:1,stopPrice:110,takeProfitPrice:75,stopClientOrderId:"stop",takeProfitClientOrderId:"tp",protectionVerified:true});

test("FET and IDLE nested records are strict immutable bindings rather than rescored positions",()=>{
 for(const strategy of ["FET","IDLE"]){
  const validate=strategy==="FET"?validateFetEntryOpportunity:validateIdleEntryOpportunity;
  const binding={symbol:strategy==="FET"?"FETUSDT":"TAOUSDT",positionId:"entry-id",logicalEntryTs:T};
  const original=record(strategy),valid=validate(original,binding);original.score=999;
  assert.equal(valid.score,null);assert.ok(Object.isFrozen(valid));
  for(const change of [{strategy:"V4"},{symbol:"BTCUSDT"},{side:strategy==="FET"?"SHORT":"LONG"},{positionId:"other"},{entryTs:T-1},{score:NaN},{extra:true}])assert.throws(()=>validate(record(strategy,change),binding));
 }
});
test("FET parser rejects mutated provenance, accepts legacy and retains original score after quantity reduction",async()=>{
 const root=await mkdtemp(join(tmpdir(),"fet-entry-provenance-")),path=join(root,"state.json");
 const state:any=emptyFetBrk48State(SHA,T+100);
 state.position={symbol:"FETUSDT",side:1,quantity:.5,entryPrice:100,entryTs:T,exitTs:T+86400000,gross:1,hardStop:95,stopClientOrderId:"stop"};
 try{
  await writeFile(path,JSON.stringify(state));assert.equal((await readFetBrk48State(path,SHA)).position?.entryOpportunity,undefined);
  state.position.entryOpportunity=record();await writeFile(path,JSON.stringify(state));assert.deepEqual((await readFetBrk48State(path,SHA)).position?.entryOpportunity,record());
  state.pending={...fetPending(),entryOpportunity:record("FET")};
  await writeFile(path,JSON.stringify(state));assert.deepEqual((await readFetBrk48State(path,SHA)).pending?.entryOpportunity,record());
  state.pending.entryOpportunity.positionId="wrong";await writeFile(path,JSON.stringify(state));await assert.rejects(readFetBrk48State(path,SHA));
 }finally{await rm(root,{recursive:true,force:true});}
});
test("IDLE parser preserves pending-to-position provenance and rejects exit provenance or time drift",()=>{
 const state:any={...emptyIdleState(SHA,T+100),positions:[{...idlePosition(),entryOpportunity:record("IDLE")}],pending:{...idlePending(),entryOpportunity:record("IDLE")}};
 const loaded=normalizeIdleState(state,SHA);assert.deepEqual(loaded.positions[0].entryOpportunity,record("IDLE"));
 assert.deepEqual(loaded.pending?.entryOpportunity,record("IDLE"));
 for(const change of [{action:"EXIT"},{decisionTs:T+1},{idempotencyKey:"wrong"}])assert.throws(()=>normalizeIdleState({...state,pending:{...state.pending,...change}},SHA));
 assert.throws(()=>normalizeIdleState({...state,positions:[{...state.positions[0],entryOpportunity:record("IDLE",{entryTs:T+100,capturedAt:T+100})}]},SHA));
});
test("builders receive the actual lease and detached frozen pending before the pending write",async()=>{
 const lease={document:async()=>({ownerId:"owner"})},calls:any[]=[],warnings:any[]=[];
 const fet:any=new FetBrk48LiveRunner({runtimeSha:SHA,now:()=>T+10,entryOpportunityBuilder:async(x:any)=>{calls.push(x);assert.ok(Object.isFrozen(x.pending));return record("FET");}} as any);
 const pending:any=fetPending();const prepared=await fet.prepareEntryOpportunity({entryTs:T},pending,lease);
 assert.deepEqual(prepared,record());assert.equal(calls[0].lock,lease);assert.equal(pending.entryOpportunity,undefined);
 const idle:any=new IdlePriorityShortRunner({runtime:{runtimeSha:SHA},now:()=>T+10,logger:{info:()=>{},warn:(...x:any[])=>warnings.push(x),error:()=>{}},entryOpportunityBuilder:async(x:any)=>{calls.push(x);assert.ok(Object.isFrozen(x.pending));return record("IDLE");}} as any);
 assert.deepEqual(await idle.prepareEntryOpportunity({features:{}},idlePending(),lease),record("IDLE"));
 assert.equal(calls[1].lock,lease);
});
test("missing builders and rejected score evidence never fabricate a baseline score",async()=>{
 for(const builder of [undefined,async()=>undefined,async()=>{throw Error("missing");},async()=>record("FET",{positionId:"other"})]){
  const fet:any=new FetBrk48LiveRunner({runtimeSha:SHA,now:()=>T+10,...(builder?{entryOpportunityBuilder:builder}:{})} as any);
  assert.equal(await fet.prepareEntryOpportunity({entryTs:T},fetPending(),{document:async()=>({})}),undefined);
 }
});
test("IDLE final fill and partial remaining quantity carry the original frozen entry record",async()=>{
 const saved:any[]=[],state:any={...emptyIdleState(SHA,T+100)},orders:any[]=[];
 const runner:any=new IdlePriorityShortRunner({runtime:{runtimeSha:SHA},now:()=>T+10,stateStore:{save:async(x:any)=>saved.push(structuredClone(x))},executor:{getPositions:async()=>[{symbol:"TAOUSDT",quantity:-.5,entryPrice:100,positionSide:"BOTH"}]},adapter:{normalizeStopPrice:async(_s:string,p:number)=>({price:p}),placeStopMarket:async(x:any)=>orders.push(x),placeTakeProfit:async(x:any)=>orders.push(x)},logger:{info:()=>{},warn:()=>{},error:()=>{}}} as any);
 runner.protectionReadBack=async()=>{};runner.markCandidateLifecycle=()=>{};
 const pending:any={...idlePending(),entryOpportunity:validateIdleEntryOpportunity(record("IDLE"),{symbol:"TAOUSDT",positionId:"entry-id",logicalEntryTs:T})};state.pending=pending;
 const lease={document:async()=>({}),releaseReservation:async()=>{}};
 await runner.finalizeEntry(state,pending,{status:"PARTIALLY_FILLED",executedQuantity:.5},lease);
 assert.equal(state.positions[0].quantity,.5);assert.deepEqual(state.positions[0].entryOpportunity,record("IDLE"));assert.equal(state.manualReview,"IDLE_PARTIAL_FILL_REQUIRES_OPERATOR_REVIEW");
 assert.deepEqual(normalizeIdleState(saved.at(-1),SHA).positions[0].entryOpportunity,record("IDLE"));
});

test("FET pending restart reconciles partial fills without invoking or changing the original score",async()=>{
 const root=await mkdtemp(join(tmpdir(),"fet-entry-restart-")),path=join(root,"state.json"),orders:any[]=[];
 const state:any={...emptyFetBrk48State(SHA,T+10),pending:{...fetPending(),entryOpportunity:record("FET")}};
 let captures=0;
 const deps:any={runtimeSha:SHA,statePath:path,now:()=>T+10,accountLock:{acquire:async()=>({release:async()=>{}})},entryOpportunityBuilder:async()=>{captures++;throw Error("must not rescore");},executor:{reconcileOrder:async()=>({status:"PARTIALLY_FILLED"}),getPositions:async()=>[{symbol:"FETUSDT",quantity:.5,entryPrice:100}]},adapter:{normalizeStopPrice:async(_s:string,p:number)=>({price:p}),openOrders:async()=>orders,placeStopMarket:async(x:any)=>{orders.push({...x,type:"STOP_MARKET",status:"NEW",stopPrice:x.stopPrice});}}};
 try{
  await writeFile(path,JSON.stringify(state));
  const out=await new FetBrk48LiveRunner(deps).tick();assert.equal(out.status,"manual-review");
  const loaded=await readFetBrk48State(path,SHA);assert.equal(loaded.position?.quantity,.5);assert.deepEqual(loaded.position?.entryOpportunity,record("FET"));assert.equal(captures,0);assert.equal(loaded.pending,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("IDLE pending restart uses persisted provenance and never invokes the entry builder",async()=>{
 const state:any={...emptyIdleState(SHA,T+10),pending:{...idlePending(),entryOpportunity:record("IDLE")}},saved:any[]=[];
 let captures=0;
 const runner:any=new IdlePriorityShortRunner({runtime:{runtimeSha:SHA},now:()=>T+10,stateStore:{save:async(x:any)=>saved.push(structuredClone(x))},executor:{reconcileOrder:async()=>({status:"FILLED",executedQuantity:.5}),getPositions:async()=>[{symbol:"TAOUSDT",quantity:-.5,entryPrice:100,positionSide:"BOTH"}]},entryOpportunityBuilder:async()=>{captures++;throw Error("must not rescore");},logger:{info:()=>{},warn:()=>{},error:()=>{}}} as any);
 runner.installProtection=async(_s:any,p:any)=>({...idlePosition(),entryOpportunity:p.entryOpportunity});
 runner.markCandidateLifecycle=()=>{};
 state.pending.reservationId="reservation";
 const out=await runner.reconcilePending(state,{document:async()=>({}),releaseReservation:async()=>{}});
 assert.equal(out.status,"completed");assert.equal(captures,0);assert.equal(state.positions[0].quantity,.5);assert.deepEqual(state.positions[0].entryOpportunity,record("IDLE"));assert.equal(state.pending,null);
});

test("IDLE optional builder failure stays unbound, with a diagnostic and no invented zero",async()=>{
 for(const builder of [undefined,async()=>undefined,async()=>{throw Error("missing book");},async()=>record("IDLE",{sourceSha:"b".repeat(40)})]){
  const messages:string[]=[];
  const runner:any=new IdlePriorityShortRunner({runtime:{runtimeSha:SHA},now:()=>T+10,...(builder?{entryOpportunityBuilder:builder}:{}),logger:{info:()=>{},warn:(x:string)=>messages.push(x),error:()=>{}}} as any);
  assert.equal(await runner.prepareEntryOpportunity({features:{}},idlePending(),{document:async()=>({})}),undefined);
  if(builder)assert.ok(messages.some(x=>x==="STABLE4_IDLE_ENTRY_OPPORTUNITY_MISSING"));
 }
});
