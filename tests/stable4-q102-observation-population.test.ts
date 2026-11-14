import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
const H=3600000,M=300000,T=1800000000000;
function fixture(state?:unknown){
 const root=mkdtempSync(join(tmpdir(),"stable4-population-")),seed=join(root,"seed.json"),statePath=join(root,"state.json");
 writeFileSync(seed,JSON.stringify({schemaVersion:1,rows:[]}));if(state)writeFileSync(statePath,JSON.stringify(state));
 const options:any={mode:"LIVE",recoverySeedPath:seed,avaxSeedPath:seed,statePath,nativeSignalBuilder:()=>({strategyId:"QUALITY102_CAUSAL_V1",side:-1,symbol:"ONDOUSDT",family:"HIGH_VOL",referenceTs:T,requestedGross:.6,hardStop:.1,maxHoldHours:72,exitPolicy:"HIGH_VOL_TRAIL72",dataCutoffTs:T-H,reason:"NATIVE",brkEnabled:true})};
 return{root,options,statePath};
}
test("observation records the selected native HIGH_VOL opportunity even when it is not UNI",()=>{
 const f=fixture();
 try{
  const e=new Stable4Q102OnlineEngine(f.options),history={candlesBySymbol:{ONDOUSDT:[]},entryOpenBySymbol:{ONDOUSDT:{timestampMs:T,open:100}}};
  e.observe(history,T);e.observe(history,T);
  const state=JSON.parse(readFileSync(f.statePath,"utf8"));
  assert.equal(state.recoveryPending.length,1);assert.equal(state.recoveryPending[0].route,"HIGH_VOL|ONDOUSDT");assert.deepEqual(state.recoveryPending[0].features,{});
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("completed shadow outcomes use actual early exit, persist, and do not relabel after restart",async()=>{
 const f=fixture({schemaVersion:1,updatedAt:T,recoveryRows:[],avaxRows:[],avaxPending:[],recoveryPending:[{entryTs:T,exitTs:T+24*H,symbol:"UNIUSDT",side:"LONG",route:"UNI|MR72_Z1.5_H24",entryPrice:100,hardStop:.05,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24,features:{ret14:0,strength:2,margin:1}}]});
 try{
  const engine=new Stable4Q102OnlineEngine(f.options);let calls=0;
  const provider={load:async()=>{calls++;return{fiveMinute:[{timestampMs:T,open:100,high:100,low:94,close:94,quoteVolume:1}],hourly:[],funding:{from:T,through:T+2*M,capturedAt:T+2*M,rows:[]}};}};
  await (engine as any).refreshOutcomes({candlesBySymbol:{}},T+2*M,provider);
  const state=JSON.parse(readFileSync(f.statePath,"utf8"));assert.equal(state.recoveryPending.length,0);assert.equal(state.recoveryRows.length,1);
  assert.equal(state.recoveryRows[0].exitTs,T+M);assert.ok(Math.abs(state.recoveryRows[0].net30-(-.05-.003))<1e-12);
  const restarted=new Stable4Q102OnlineEngine(f.options);await (restarted as any).refreshOutcomes({candlesBySymbol:{}},T+3*M,provider);assert.equal(calls,1);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("partial evidence failure cannot leak uncommitted model rows into the next retry",async()=>{
 const q=(symbol:string)=>({entryTs:T,exitTs:T+24*H,symbol,side:"LONG",route:symbol+"|MR",entryPrice:100,hardStop:.05,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24,features:{}});
 const f=fixture({schemaVersion:1,updatedAt:T,recoveryRows:[],avaxRows:[],avaxPending:[],recoveryPending:[q("UNIUSDT"),q("FETUSDT")]});
 try{
  const engine=new Stable4Q102OnlineEngine(f.options);let calls=0;
  const provider={load:async()=>{if(++calls===2)throw Error("SECOND_SYMBOL_DATA_GAP");return{fiveMinute:[{timestampMs:T,open:100,high:100,low:94,close:94,quoteVolume:1}],hourly:[],funding:{from:T,through:T+2*M,capturedAt:T+2*M,rows:[]}};}};
  await assert.rejects((engine as any).refreshOutcomes({candlesBySymbol:{}},T+2*M,provider),/DATA_GAP/);
  assert.equal((engine as any).state.recoveryRows.length,0);assert.equal(engine.isHealthy(),false);
  await (engine as any).refreshOutcomes({candlesBySymbol:{}},T+2*M,provider);
  const state=JSON.parse(readFileSync(f.statePath,"utf8"));assert.equal(state.recoveryRows.length,2);assert.equal(engine.isHealthy(),true);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("SHADOW observation degradation preserves native trading while LIVE fails closed",async()=>{
 const f=fixture();
 try{
  const provider={load:async()=>{throw Error("UNEXPECTED_DATA_CALL");}},history={candlesBySymbol:{}};
  const broken=()=>{throw Error("HISTORY_GAP");};
  const shadow=new Stable4Q102OnlineEngine({...f.options,mode:"SHADOW",nativeSignalBuilder:broken});
  await assert.doesNotReject((shadow as any).observeAndRefresh(history,T,provider));assert.equal(shadow.isHealthy(),false);
  const live=new Stable4Q102OnlineEngine({...f.options,mode:"LIVE",nativeSignalBuilder:broken});
  await assert.rejects((live as any).observeAndRefresh(history,T,provider),/HISTORY_GAP/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
