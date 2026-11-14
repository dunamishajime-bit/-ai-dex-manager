import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
const H=3_600_000;
function fixture(rows:unknown[],state?:unknown){
 const root=mkdtempSync(join(tmpdir(),"stable4-continuation-"));
 const recoverySeedPath=join(root,"recovery.json"),avaxSeedPath=join(root,"avax.json"),statePath=join(root,"state.json");
 writeFileSync(recoverySeedPath,JSON.stringify({schemaVersion:1,rows}));
 writeFileSync(avaxSeedPath,JSON.stringify({schemaVersion:1,rows:[]}));
 if(state)writeFileSync(statePath,JSON.stringify(state));
 return {root,options:{mode:"LIVE" as const,recoverySeedPath,avaxSeedPath,statePath}};
}
const row=(symbol:string,route:string)=>({id:symbol+route,entryTs:10*H,exitTs:20*H,symbol,route,side:"SHORT",net30:.02,features:{ret14:.01,strength:2,margin:.1}});
test("distinct same-time completed opportunities both contribute to the causal model",()=>{
 const f=fixture([row("AVAXUSDT","AVAX|REV12_T0.03_H12"),row("FETUSDT","FET|REV24_T0.05_H8")]);
 try{
  const engine=new Stable4Q102OnlineEngine(f.options);
  const pool=(engine as any).allRecoveryRows(30*H);
  assert.equal(pool.length,2);
  assert.deepEqual(new Set(pool.map((x:any)=>x.symbol)),new Set(["AVAXUSDT","FETUSDT"]));
  assert.equal((engine as any).allRecoveryRows(20*H).length,0,"an outcome ending at the decision is not a completed prior label");
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("invalid seed chronology cannot supply a future entry as a completed label",()=>{
 const f=fixture([{...row("UNIUSDT","UNI|MR72_Z1.5_H24"),entryTs:30*H,exitTs:20*H}]);
 try{assert.throws(()=>new Stable4Q102OnlineEngine(f.options),/CHRONOLOGY/);}
 finally{rmSync(f.root,{recursive:true,force:true});}
});
test("restart validates persisted model samples rather than trusting array-shaped state",()=>{
 const f=fixture([],{schemaVersion:1,updatedAt:30*H,recoveryRows:[{...row("UNIUSDT","UNI|MR72_Z1.5_H24"),net30:null}],recoveryPending:[],avaxRows:[],avaxPending:[]});
 try{assert.throws(()=>new Stable4Q102OnlineEngine(f.options),/RECOVERY.*INVALID/);}
 finally{rmSync(f.root,{recursive:true,force:true});}
});

const candidate:any={id:"UNI",key:"UNI|MR72_Z1.5_H24",symbol:"UNIUSDT",side:-1,family:"MR",variant:"MR72_Z1.5_H24",layer:"S3",entryTs:200*24*H,dataCutoffTs:200*24*H-H,ret14:.01,strength:2,margin:.1,hardStop:.07,maxHoldHours:24,exitPolicy:"FIXED_HOLD_STOP"};
function positiveRows(){return Array.from({length:12},(_,i)=>({...row("UNIUSDT",candidate.key),id:String(i),entryTs:(180+i)*24*H,exitTs:(181+i)*24*H,net30:.03}));}
test("recovered opportunity preserves native MR gross and compares its score with active entry scores",()=>{
 const f=fixture(positiveRows());
 try{
  const e=new Stable4Q102OnlineEngine(f.options);
  const p=e.propose({candlesBySymbol:{}},candidate)!;
  assert.ok(p);assert.equal(p.signal.requestedGross,.75,"native MR gross remains .75");
  assert.ok(Math.abs(Number(p.diagnostics.opportunityScore)-Number(p.diagnostics.ev)*Number(p.diagnostics.confidence)/.75)<1e-12);
  assert.equal(e.propose({candlesBySymbol:{}},candidate,Number(p.diagnostics.opportunityScore)),undefined,"strictly higher than existing entry scores is required");
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("route health uses shrunk time-weighted component instead of lifetime unweighted wins",()=>{
 const good=positiveRows();
 // Ancient losses overwhelm raw route win rate, but no longer dominate a 90-day half life.
 const ancient=Array.from({length:30},(_,i)=>({...good[0],id:"old"+i,entryTs:(i+1)*H,exitTs:(i+2)*H,net30:-.001,features:{ret14:100,strength:100,margin:100}}));
 const f=fixture([...ancient,...good]);
 try{assert.ok(new Stable4Q102OnlineEngine(f.options).propose({candlesBySymbol:{}},{...candidate,entryTs:1000*24*H}));}
 finally{rmSync(f.root,{recursive:true,force:true});}
});
