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
