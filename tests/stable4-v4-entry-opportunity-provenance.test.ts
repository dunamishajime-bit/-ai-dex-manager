import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createProductionState,planProductionEntry,applyProductionEvent,replayProductionJournal,HOUR} from "../lib/v12-v4-production-lifecycle";
import {evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {V4RunnerEngine,v4OpportunityEntrySnapshot} from "../lib/v12-v4-runner-engine";
const T=1800000000000,SHA="a".repeat(40),initial={equityUsd:1000,foreign:[],holdProtected:false};
const candidate=()=>({...evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:T,age:2,volRatio:.5,er24:.5})[0],route:"REC_X01_TIME_24H",family:"RECOVERY_X",symbol:"ETHUSDT",requestedGross:.1,effectiveSide:"LONG" as const,eligibleEntryTs:T});
const normalizer:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,stepSize:.01})};
async function reserve(){return planProductionEntry(createProductionState(initial),{candidate:candidate(),ts:T,observedAtMs:T+100,eventId:"reserve",referencePrice:100,minimumOrderNotionalUsd:5,quantityNormalizer:normalizer});}
const record=(leg:any,changes:any={})=>({strategy:"V4",positionId:leg.id,sourceSha:SHA,symbol:leg.candidate.symbol,side:leg.candidate.effectiveSide,entryTs:leg.entryTs,modelVersion:"ENTRY_V1",score:.03,capturedAt:T+50,...changes});
test("RESERVE validates provenance identity and causal capture rather than accepting arbitrary nested data",async()=>{
 const r=await reserve();
 for(const change of [{strategy:"Q102"},{positionId:"foreign"},{symbol:"BNBUSDT"},{side:"SHORT"},{entryTs:T-1},{capturedAt:T+101},{score:Infinity},{extra:true}]){
  const e:any=structuredClone(r);e.leg.entryOpportunity=record(r.leg,change);assert.throws(()=>applyProductionEvent(createProductionState(initial),e),/OPPORTUNITY/);
 }
});
test("journaled provenance survives partial fills, reduction, closure and restart without changing entry identity",async()=>{
 const r:any=await reserve();r.leg.entryOpportunity=record(r.leg);let s=applyProductionEvent(createProductionState(initial),r);
 const event=(x:any)=>{s=applyProductionEvent(s,x);assert.deepEqual(replayProductionJournal(initial,s.journal),s);assert.deepEqual((s.legs[r.leg.id] as any).entryOpportunity,r.leg.entryOpportunity);};
 event({type:"ENTRY_FILL",eventId:"fill",ts:T+200,id:r.leg.id,qty:1,price:100,feeUsd:0});
 event({type:"ENTRY_TERMINAL",eventId:"terminal",ts:T+201,id:r.leg.id});
 event({type:"EXIT_REQUEST",eventId:"partialrequest",ts:T+300,id:r.leg.id,qty:.5});
 event({type:"EXIT_FILL",eventId:"partialfill",ts:T+301,id:r.leg.id,qty:.5,price:101,feeUsd:0,cooldownUntil:T+302});
 event({type:"EXIT_REQUEST",eventId:"closerequest",ts:T+400,id:r.leg.id,qty:.5});
 event({type:"EXIT_FILL",eventId:"closefill",ts:T+401,id:r.leg.id,qty:.5,price:101,feeUsd:0,cooldownUntil:T+402});assert.equal(s.legs[r.leg.id].status,"CLOSED");
});
function harness(builder?:any){
 const dir=mkdtempSync(join(tmpdir(),"v4-entry-provenance-")),store=new V4ExecutionStore(join(dir,"state.json"),SHA);let doc=store.initialize(initial);
 doc=store.commit(doc.revision,{...doc,state:applyProductionEvent(doc.state,{type:"ACCOUNT_MARK",eventId:"account",ts:T+100,equityUsd:1000,prices:{}})});
 const warnings:string[]=[],events:string[]=[],lock={document:async()=>({ownerId:"V4"})},c=candidate();let now=T+100;
 const engine:any=new V4RunnerEngine({store,now:()=>now,assertEntrySafety:async()=>{},assertSourceParity:async()=>{},referencePrice:async()=>100,minimumVenueOrderNotional:async()=>5,requiredResidentStop:async()=>95,quantityNormalizer:normalizer,assertAuthority:async()=>{},...(builder?{entryOpportunityBuilder:async(x:any)=>{events.push("capture");return builder(x,store);}}:{}),entryOpportunityDiagnostic:(message:string)=>warnings.push(message)} as any);
 const decision:any={candidateCount:1,candidates:[c],entryAtrByCandidate:{[[c.symbol,c.route,c.effectiveSide,c.eligibleEntryTs].join("|")]:1},nativeCoreEvents:[]};
 const dispatcher:any={prepare:()=>{events.push("prepare");return"cid";},submit:async()=>{events.push("HTTP");throw Error("TEST_TRANSPORT_BOUNDARY");}};
 const run=()=>engine.tryCandidate(decision,dispatcher,{},lock);
 return{dir,store,engine,events,warnings,lock,c,run,setTime:(ts:number)=>{now=ts;}};
}
test("builder captures under the actual lease before journal commit and entry transport",async()=>{
 let input:any;const f=harness(async(x:any,s:V4ExecutionStore)=>{input=x;assert.equal(Object.keys(s.read().state.legs).length,0);return record(x.reservation.leg);});
 try{await assert.rejects(f.run(),/TEST_TRANSPORT_BOUNDARY/);assert.equal(input.lock,f.lock);assert.equal(input.decisionTs,T+100);assert.equal(Object.isFrozen(input.reservation),true);assert.equal(Object.isFrozen(input.reservation.leg),true);assert.deepEqual(input.entrySnapshot,{rank:f.c.rank});assert.deepEqual(f.events,["capture","prepare","HTTP"]);
  const doc=new V4ExecutionStore(f.store.path,SHA).read(),leg:any=Object.values(doc.state.legs)[0];assert.deepEqual(leg.entryOpportunity,(doc.state.journal.find(e=>e.type==="RESERVE") as any).leg.entryOpportunity);assert.equal(leg.entryOpportunity.positionId,leg.id);
  const edited=structuredClone(doc);(Object.values(edited.state.legs)[0] as any).entryOpportunity.score=999;assert.throws(()=>f.store.commit(doc.revision,edited),/SNAPSHOT_JOURNAL_MISMATCH/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("absent, failed or mismatched baseline capture logs missing provenance without inventing a score or blocking native entry",async()=>{
 for(const builder of [undefined,async()=>{throw Error("BOOK_UNAVAILABLE");},async()=>undefined,async(x:any)=>record(x.reservation.leg,{positionId:"wrong"})]){
  const f=harness(builder);try{await assert.rejects(f.run(),/TEST_TRANSPORT_BOUNDARY/);assert.equal((Object.values(f.store.read().state.legs)[0] as any).entryOpportunity,undefined);assert.ok(f.warnings.some(m=>m.includes("OPPORTUNITY")));assert.equal(f.events.at(-1),"HTTP");}finally{rmSync(f.dir,{recursive:true,force:true});}
 }
});
test("Core entry features come only from its exact native event and never current candidate diagnostics",()=>{
 const c:any={...candidate(),route:"FAILED_BREAK_REV_SHORT_6H",effectiveSide:"SHORT",rank:1};
 const native:any={symbol:"ETH",route:c.route,side:"SHORT",entry_ts_ms:T,decision_ts_ms:T,sg:-1,state_age_h:2,onset_momentum90:.04,atr:2,score:1.2};
 assert.deepEqual(v4OpportunityEntrySnapshot({nativeCoreEvents:[native]},c),{rank:1,sg:-1,state_age_h:2,onset_momentum90:.04,atr:2,score:1.2});
 for(const e of [{...native,symbol:"BNB"},{...native,entry_ts_ms:T-HOUR},{...native,decision_ts_ms:T+1}])assert.throws(()=>v4OpportunityEntrySnapshot({nativeCoreEvents:[e]},c),/CORE_EVIDENCE_MISSING/);
 assert.throws(()=>v4OpportunityEntrySnapshot({nativeCoreEvents:[native,native]},c),/CORE_EVIDENCE_MISSING/);
});
test("slow score publication cannot spend an expired signed account snapshot",async()=>{
 const f=harness(async(x:any)=>{f.setTime(T+121000);return record(x.reservation.leg);});
 try{const out=await f.run();assert.equal(out.status,"blocked");assert.equal(out.reason,"V4_ENTRY_ACCOUNT_LEDGER_REFRESH_REQUIRED");assert.equal(Object.keys(f.store.read().state.legs).length,0);assert.deepEqual(f.events,["capture"]);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
