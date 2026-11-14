import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as online from "../lib/disdex-quality102-stable4-online";
const H=3600000,A=Math.ceil(1800000000000/(6*H))*6*H+H;
function history(t=A){
 const bars=Array.from({length:169},(_,i)=>({timestampMs:t-(169-i)*H,open:100,high:101,low:99,close:100,baseVolume:10,quoteVolume:i>162?100000:1000}));
 return{candlesBySymbol:{AVAXUSDT:bars,BTCUSDT:bars},entryOpenBySymbol:{AVAXUSDT:{timestampMs:t,open:100},BTCUSDT:{timestampMs:t,open:100}}};
}
test("QAON7 feature volume matches frozen base-volume training convention",()=>{
 const fn=(online as any).deriveStable4AvaxFeatures;assert.equal(typeof fn,"function");
 assert.equal(fn(history()).f[11],1,"quote turnover must not replace base-volume ratio");
});
test("qualified QAON7 shadow selection consumes its own durable 24h slot independently of account entry",()=>{
 const root=mkdtempSync(join(tmpdir(),"stable4-avax-")),seed=join(root,"seed.json"),empty=join(root,"empty.json"),statePath=join(root,"state.json");
 writeFileSync(empty,JSON.stringify({schemaVersion:1,rows:[]}));
 writeFileSync(seed,JSON.stringify({schemaVersion:1,rows:Array.from({length:40},(_,i)=>({entryTs:A-(50+i*30)*H,exitTs:A-(26+i*30)*H,raw:.02,f:[0,0,0,0,0,0,0,0,0,.5,.02,1]}))}));
 const options:any={mode:"LIVE",recoverySeedPath:empty,avaxSeedPath:seed,statePath,nativeSignalBuilder:(_:unknown,t:number)=>({strategyId:"QUALITY102_CAUSAL_V1",side:0,referenceTs:t,requestedGross:0,dataCutoffTs:t-H,reason:"NONE",brkEnabled:true})};
 try{
  const engine=new online.Stable4Q102OnlineEngine(options);engine.observe(history(),A);engine.observe(history(),A);
  const state=JSON.parse(readFileSync(statePath,"utf8"));assert.equal(state.avaxLastSelectedEntryTs,A);assert.equal(state.recoveryPending.length,1);assert.equal(state.recoveryPending[0].route,"Q102_AVAX_ONLINE_KNN_STOP5_TP3_Q01365");
  assert.equal(engine.propose(history())?.kind,"AVAX_KNN","same boundary remains available to account admission");
  const restarted=new online.Stable4Q102OnlineEngine(options);assert.equal(restarted.propose(history(A+6*H)),undefined);assert.equal(restarted.propose(history(A+24*H))?.kind,"AVAX_KNN");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("zero-return training neighbors never count as SHORT agreement",()=>{
 const root=mkdtempSync(join(tmpdir(),"stable4-avax-zero-")),seed=join(root,"seed.json"),empty=join(root,"empty.json");
 writeFileSync(empty,JSON.stringify({schemaVersion:1,rows:[]}));writeFileSync(seed,JSON.stringify({schemaVersion:1,rows:Array.from({length:40},(_,i)=>({entryTs:A-(50+i*30)*H,exitTs:A-(26+i*30)*H,raw:i<25?-.03:0,f:[0,0,0,0,0,0,0,0,0,.5,.02,1]}))}));
 try{const engine=new online.Stable4Q102OnlineEngine({mode:"LIVE",recoverySeedPath:empty,avaxSeedPath:seed,statePath:join(root,"state.json")});assert.equal(engine.propose(history()),undefined);}
 finally{rmSync(root,{recursive:true,force:true});}
});
