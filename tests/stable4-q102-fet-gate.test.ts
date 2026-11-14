import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
const H=3600000,T=1800000000000,limit=.048722800378429465;
function evaluate(mode:"OFF"|"SHADOW"|"LIVE",ret?:number){
 const root=mkdtempSync(join(tmpdir(),"stable4-fet-"));
 const seed=join(root,"seed.json");writeFileSync(seed,JSON.stringify({schemaVersion:1,rows:[]}));
 try{
  const engine=new Stable4Q102OnlineEngine({mode,recoverySeedPath:seed,avaxSeedPath:seed,statePath:join(root,"state.json")});
  const rows=ret===undefined?[]:Array.from({length:336},(_,i)=>({timestampMs:T-(336-i)*H,open:100/(1+ret),high:110,low:90,close:100,quoteVolume:100}));
  const signal:any={strategyId:"QUALITY102_CAUSAL_V1",symbol:"FETUSDT",side:-1,family:"REV",variant:"REV24_T0.05_H8",referenceTs:T,requestedGross:1.25,reason:"NATIVE_FET",dataCutoffTs:T-H,brkEnabled:true};
  return engine.select(signal,{candlesBySymbol:{FETUSDT:rows},entryOpenBySymbol:{FETUSDT:{timestampMs:T,open:100}}},T).signal;
 }finally{rmSync(root,{recursive:true,force:true});}
}
test("FET uses exact causal ret14 ceiling in LIVE without backfilling another native route",()=>{
 assert.equal(evaluate("LIVE",limit-1e-10).side,-1);
 const rejected=evaluate("LIVE",limit+1e-10);assert.equal(rejected.side,0);assert.match(rejected.reason,/FET_RET14/);
 assert.equal(evaluate("LIVE").side,0);
 for(const mode of ["OFF","SHADOW"] as const)assert.equal(evaluate(mode,.5).side,-1);
});
