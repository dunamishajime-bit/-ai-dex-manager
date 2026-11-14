import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
const T=1800000000000,H=3600000;
const flat=(t:number):any=>({strategyId:"QUALITY102_CAUSAL_V1",side:0,referenceTs:t,requestedGross:0,dataCutoffTs:t-H,reason:"NONE",brkEnabled:true});
test("LIVE model cannot skip unobserved hours or select before causal catch-up",async()=>{
 const root=mkdtempSync(join(tmpdir(),"stable4-hourly-")),seed=join(root,"seed.json"),avax=join(root,"avax.json");
 writeFileSync(seed,JSON.stringify({schemaVersion:1,kind:"STABLE4_Q102_RECOVERY_SEED",candidateCoverageThrough:T,rows:[]}));
 writeFileSync(avax,JSON.stringify({schemaVersion:1,rows:[]}));
 const options:any={mode:"LIVE",requireHourlyCoverage:true,now:()=>T+3*H,recoverySeedPath:seed,avaxSeedPath:avax,statePath:join(root,"state.json"),nativeSignalBuilder:(_:unknown,t:number)=>flat(t)};
 try{
  const engine=new Stable4Q102OnlineEngine(options),history={candlesBySymbol:{}};
  assert.throws(()=>engine.observe(history,T+H),/OBSERVATION_GAP/);
  engine.observe(history,T);assert.throws(()=>engine.observe(history,T+2*H),/OBSERVATION_GAP/);
  engine.observe(history,T+H);engine.observe(history,T+2*H);
  await (engine as any).refreshOutcomes(history,T+2*H,{load:async()=>{throw Error("no observations need data");}});
  assert.equal(engine.select(flat(T+2*H),history,T+2*H).signal.side,0);
  assert.throws(()=>engine.select(flat(T+3*H),history,T+3*H),/OBSERVATION_NOT_CURRENT/);
  const restarted=new Stable4Q102OnlineEngine(options);assert.equal((restarted as any).state.observedThrough,T+2*H);
 }finally{rmSync(root,{recursive:true,force:true});}
});
