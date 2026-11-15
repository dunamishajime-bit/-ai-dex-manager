import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {captureStable4NativeShadowObservation,captureStable4FetNativeCandidates,captureStable4IdleNativeCandidates,dispatchStable4NativeShadowObservation,Stable4NativeShadowObserver} from "../lib/stable4-native-shadow-observer";
import {createStable4NativeShadowLedger,Stable4NativeShadowStore} from "../lib/stable4-native-shadow-ledger";
import {FetBrk48LiveRunner} from "../lib/fet-brk48-live-runner";
import {IdlePriorityAsterMarketDataProvider} from "../lib/idle-priority-short-market-data";

const H=3600000,T=Date.UTC(2026,8,20,5),SHA="a".repeat(40),HASH="b".repeat(64);
const context={sourceSha:SHA,capturedAt:T+30000,policyVersion:"NATIVE_V1",policySourceDigestSha256:HASH,sourceRef:"native:h1"};
function fetRows(){return Array.from({length:80},(_,i)=>{const t=T-(80-i)*H,signal=i===79;return{openTs:t,closeTs:t+H-1,open:100,high:signal?111:105,low:95,close:signal?110:100,volume:signal?130:100};});}
function generic(strategy:"V4"|"PENGU"|"Q102"|"FET"|"IDLE"|"V52"|"HYPE"){return{...context,strategy,nativeKey:strategy+":native-one",symbol:"BTCUSDT",side:"LONG" as const,route:"NATIVE_ROUTE",logicalEntryTs:T,gross:.75,modelExpectedHoldHours:24,entrySnapshot:{},coverageFrom:T-1000,policyId:"NATIVE_EXIT",shortReturnConvention:"linear" as const};}

test("all seven common strategies capture causal native evidence without owner/portfolio inputs",()=>{
 for(const strategy of ["V4","PENGU","Q102","FET","IDLE","V52","HYPE"] as const){const c=captureStable4NativeShadowObservation(generic(strategy));assert.equal(c.strategy,strategy);assert.equal(c.logicalEntryTs,T);assert.equal(c.nativePolicy.roundTripCost,.003);assert.ok(Object.isFrozen(c));assert.equal(c.evidenceCoverage.refs.find((r:any)=>r.kind==="POLICY").sha256,HASH);}
});
test("FET source discovery captures the native candidate independently of actual holding or capacity",()=>{
 const candidates=captureStable4FetNativeCandidates({rows:fetRows(),decisionTs:T+30000},context);assert.equal(candidates.length,1);
 const c=candidates[0];assert.equal(c.nativeKey,"FET:FETUSDT:LONG:"+T);assert.equal(c.entryFeatures.volumeRatio,1.3);assert.ok(Math.abs(c.entryFeatures.return72h-.1)<1e-12);assert.equal(c.modelExpectedHoldHours,24);
 assert.deepEqual(captureStable4FetNativeCandidates({rows:fetRows(),decisionTs:T+6*60_000},context),[]);
});
test("IDLE retains every native accepted route before lifecycle, slot, cooldown and portfolio suppression",()=>{
 const features={decisionTs:T,signalTs:T-H,ret12:-.2,ret24:-.2,btc24:.02,rel24:-.22,atrRatio:.05,volumeRatio:2,breakoutLong24:false,breakoutShort24:true,breakdown24:true};
 // The factory accepts native pre-portfolio route decisions, not generic LONG
 // signals or state-dependent entry results. It never installs a new gate.
 const signals:any[]=[{accepted:true,symbol:"TAOUSDT",route:"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",side:"SHORT",holdHours:12,features,reason:"NATIVE"},{accepted:true,symbol:"TIAUSDT",route:"IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100",side:"SHORT",holdHours:12,features,reason:"NATIVE"}];
 const rows=captureStable4IdleNativeCandidates({signals,sourceSnapshot:{features}},context);assert.equal(rows.length,2);assert.ok(rows.every((r:any)=>r.logicalEntryTs===T&&r.side==="SHORT"));
 assert.equal(captureStable4IdleNativeCandidates({signals:[{...signals[0],accepted:false}],sourceSnapshot:{}},context).length,0);
});
test("detached observer failures and unresolved work never block or mutate the native caller",async()=>{
 const source={quantity:1},messages:string[]=[];let resolve:()=>void=()=>{};
 dispatchStable4NativeShadowObservation(async(snapshot)=>{assert.equal(snapshot.quantity,1);await new Promise<void>(r=>resolve=r);throw Error("learning unavailable");},source,message=>messages.push(message));
 source.quantity=2;await Promise.resolve();assert.deepEqual(messages,[]);resolve();await new Promise(r=>setImmediate(r));assert.match(messages[0],/learning unavailable/);
});
test("observer requires initialized partition and exact native identity retry cannot rescore",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"native-shadow-observer-"));try{
  const store=new Stable4NativeShadowStore(join(dir,"ledger.json")),observer=new Stable4NativeShadowObserver(store,"FET");
  const c=captureStable4FetNativeCandidates({rows:fetRows(),decisionTs:T+30000},context)[0];await assert.rejects(observer.capture([c]),/MISSING/);
  await store.initialize(createStable4NativeShadowLedger("FET"));await observer.capture([c]);
  const retry=captureStable4FetNativeCandidates({rows:fetRows(),decisionTs:T+30000},{...context,capturedAt:T+31000})[0];
  await observer.capture([retry]);assert.equal((await store.read()).entries.length,1);assert.equal((await store.read()).entries[0].candidate.capturedAt,T+30000);
  const mutated=structuredClone(retry);mutated.entryFeatures.volumeRatio=3;await assert.rejects(observer.capture([mutated]),/CONFLICT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("FET detached held-position discovery reuses native H1 read and captures once per boundary",async()=>{
 let reads=0;const frames:any[]=[];
 const raw=fetRows().map(r=>[r.openTs,String(r.open),String(r.high),String(r.low),String(r.close),String(r.volume),r.closeTs]);
 const runner:any=new FetBrk48LiveRunner({now:()=>T+30000,client:{getKlines:async()=>{reads++;return raw;}},nativeShadowObserver:async(frame:any)=>{frames.push(frame);}} as any);
 assert.equal(runner.dispatchNativeShadow(T+30000),undefined);
 await runner.loadNativeH1(T+30000);await new Promise(r=>setImmediate(r));
 assert.equal(reads,1);assert.equal(frames.length,1);assert.equal(captureStable4FetNativeCandidates(frames[0],context).length,1);
 // Discovery may share an in-flight read, but must not freeze ordinary live
 // reads for an entire hour if venue publication later completes a candle.
 await runner.loadNativeH1(T+40000);assert.equal(reads,2);
 runner.dispatchNativeShadow(T+40000);await new Promise(r=>setImmediate(r));assert.equal(reads,2);assert.equal(frames.length,1);
});
test("IDLE provider observes all raw native routes with detached snapshot and ignores learning failure",async()=>{
 const raw=Array.from({length:160},(_,i)=>[T-(160-i)*H,"100","105","95","100","100",T-(159-i)*H-1,"1000"]);
 const frames:any[]=[],health:any[]=[];
 const provider=new IdlePriorityAsterMarketDataProvider({getKlines:async()=>raw} as any,{now:()=>T+30000,nativeShadowObserver:async(frame:any)=>{frames.push(frame);frame.market.btc[0].close=999;throw Error("learning partition unavailable");},nativeShadowDiagnostic:frame=>health.push(frame)});
 const market=await provider.load();await new Promise(r=>setImmediate(r));
 assert.equal(market.btc[0].close,100);assert.equal(frames.length,1);assert.equal(frames[0].signals.length,Object.keys(market.symbols).length);assert.equal(health[0].complete,false);assert.match(health[0].reason,/partition unavailable/);
});
