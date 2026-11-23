import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {IdleResidualLongRunner} from "../lib/idle-residual-long-runner";
import {emptyIdleResidualLongState} from "../lib/idle-residual-long-state";
import {emptyIdleState} from "../lib/idle-priority-short-state";
const SHA="a".repeat(40), H=3600000, NOW=1800000000000;
// These admission tests require the production root-owned, mode-0600 POSIX
// certificate contract. Windows cannot create that ownership/mode fixture.
const requiresRootPosix = process.platform === "win32" || typeof process.getuid !== "function" || process.getuid() !== 0;
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"idle-residual-stale-"));
 const cert={schema:"disdex-idle-residual-long-parity-cert/v1",runtimeSha:SHA,generatedAt:new Date(NOW).toISOString(),priority:["FORMAL_EXISTING","IDLE_PRIORITY_SHORT","DOGE_REL_VOL","AVAX_REL_LONG"],trailAtr:0.20,stopAtr:2.477,takeProfitAtr:3.1995,roundtripBps:10,finalJpy:1319918378.8124561,integratedTradeCount:1390,idleTrades:61,dogeTrades:11,avaxTrades:16,profitFactor:2.332297694545306,maxMtmDrawdown:-0.21359613575534397,contractSha256:"b".repeat(64)};
 const certPath=join(root,"cert.json"),corePath=join(root,"core.json");
 await writeFile(certPath,JSON.stringify(cert),{mode:0o600});
 await writeFile(corePath,JSON.stringify(emptyIdleState(SHA,NOW)));
 let state=emptyIdleResidualLongState(SHA,NOW),released=false,orders=0;
 const rows=(signal:boolean)=>Array.from({length:80},(_,i)=>({ts:NOW-(80-i)*H,open:100,high:112,low:98,close:signal&&i===79?110:100,quoteVolume:signal&&i===79?200:100}));
 const d:any={now:()=>NOW,runtime:{enabled:true,operatorArmed:true,runtimeSha:SHA,parityCertificatePath:certPath},coreRuntime:{mode:"LIVE",runtimeSha:SHA,statePath:corePath,pendingExposurePath:join(root,"pending.json")},
 stateStore:{load:async()=>structuredClone(state),save:async(s:any)=>{state=structuredClone(s);}},
 lock:{acquire:async()=>({release:async()=>{released=true;},reserve:async()=>{throw Error("must not reserve");}})},
 marketData:{load:async()=>({decisionTs:NOW,symbols:{},residualSymbols:{DOGEUSDT:rows(true)},btc:rows(false)})},
 executor:{getAccountSnapshot:async()=>({walletBalance:100}),getPositions:async()=>[],getOpenOrders:async()=>[],executeMarket:async()=>{orders++;throw Error("must not order");}},
 adapter:{},client:{}};
 const runner=new IdleResidualLongRunner(d);
 return {runner,state:()=>state,released:()=>released,orders:()=>orders,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test("stale residual baseline defers without orders, manual review or daemon rejection; next tick retries",{skip:requiresRootPosix,timeout:5000},async()=>{
 const f=await fixture();
 try{
  (f.runner as any).baselineContext=async()=>{throw Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");};
  const r=await f.runner.tick();
  assert.equal(r.status,"held");assert.match(r.message,/BASELINE_ADMISSION_BLOCKED:BASELINE_ADMISSION_SOURCE_STALE/);
  assert.equal(f.state().manualReview,null);assert.equal(f.state().lastDecision?.accepted,false);
  assert.equal(f.orders(),0);assert.equal(f.released(),true);
  (f.runner as any).baselineContext=async()=>({baseline:{baselineAcceptedThisTimestamp:1,baselineOpenPositions:0,baselinePendingExposure:0}});
  assert.equal((await f.runner.tick()).message,"IDLE_RESIDUAL_BLOCKED_BY_FORMAL_BASELINE");
  assert.equal(f.orders(),0);
 }finally{await f.cleanup();}
});
test("account lock remains held while async residual entry admission settles",{skip:requiresRootPosix,timeout:5000},async()=>{
 const f=await fixture();
 try{
  let reached!:()=>void,finish!:()=>void;
  const started=new Promise<void>(r=>{reached=r;});
  const pending=new Promise<void>(r=>{finish=r;});
  (f.runner as any).baselineContext=async()=>{reached();await pending;throw Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");};
  const tick=f.runner.tick();
  await Promise.race([started,tick.then((result)=>{throw new Error(`entry admission was not reached: ${result.message}`);})]);
  assert.equal(f.released(),false);
  finish();assert.equal((await tick).status,"held");
  assert.equal(f.released(),true);assert.equal(f.orders(),0);
 }finally{await f.cleanup();}
});
test("async entry exceptions are caught and persisted before lock release",async()=>{
 const f=await fixture();
 try{
  (f.runner as any).enter=async()=>{throw Error("UNEXPECTED_ENTRY_FAULT");};
  const r=await f.runner.tick();
  assert.equal(r.status,"manual-review");assert.match(f.state().manualReview||"",/UNEXPECTED_ENTRY_FAULT/);
  assert.equal(f.released(),true);assert.equal(f.orders(),0);
 }finally{await f.cleanup();}
});
