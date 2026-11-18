import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
import {
 inspectQ102NativeS34SymbolAt,inspectQ102NativeS34Source,Q102_NATIVE_S34_SOURCE_PIN
} from "../lib/bt-verification/pinned-native-q102/probe";
import {QUALITY102_CAUSAL_V4_S34_MODEL}
 from "../lib/bt-verification/pinned-native-q102/disdexQuality102CausalV4Model";

const root=join(process.cwd(),"lib","bt-verification","pinned-native-q102");
const hash=(s:string|Uint8Array)=>createHash("sha256").update(s).digest("hex");
const files=[
 ["disdex-quality102-causal-v4-s34.ts","ec19c31ad93d9e69d2a3f4a2f8012fbe600997a53002bd77eed9dc6c0edaed29",
  [["./disdexQuality102CausalV4Model","../config/disdexQuality102CausalV4Model"],
   ["./quality102-pipeline-types","./disdex-quality102-causal-pipeline"]]],
 ["disdex-quality102-causal-selector.ts","6bdd82f6230d54a1c40f58d13b2719db60bda6369135da417c04563efc4fab24",
  [["./disdexStrictBt33404708902Runtime","../config/disdexStrictBt33404708902Runtime"]]],
 ["disdexQuality102CausalV4Model.ts","4f2b3d6ad2b7fc4a6f4278cfffdfc0007a85e65afe8a03a0978187593bc23c50",[]],
 ["disdexStrictBt33404708902Runtime.ts","d51a9cdfacbd3983ff4fb2d93df61a439b8126d63b7f708dea00e574484635cd",[]]
] as const;
for(const [name,sha,restores] of files){
 let s=readFileSync(join(root,name),"utf8");
 for(const [edited,upstream] of restores){
  assert.equal(s.split(edited).length,2,"Only one known config/type import may be changed");
  s=s.replace(edited,upstream);
 }
 // Compare the upstream source with CRLF normalized to LF: the same exact
 // original code bytes apart from the platform's text-file line endings.
 assert.equal(hash(s.split(String.fromCharCode(13,10)).join(String.fromCharCode(10))),sha,
   "Q102 original logic must exactly match upstream after import and EOL normalization");
}
assert.equal(Q102_NATIVE_S34_SOURCE_PIN.requiredHours,336);
assert.equal(Q102_NATIVE_S34_SOURCE_PIN.fullQ102Parity,false);
assert.equal(QUALITY102_CAUSAL_V4_S34_MODEL.some(x=>x.key==="UNI|MR72_Z1.5_H24"),true);
const H=3600000,asOf=Date.parse("2025-10-20T05:00:00Z"),at=new Date(asOf).toISOString();
const engineered:MarketCandle5m[]=Array.from({length:336},(_,i)=>{
 const opening=asOf-(336-i)*H,isLast=i===335;
 const close=isLast?115:100;
 return {symbol:"UNIUSDT",category:"crypto",openTime:new Date(opening).toISOString(),
   closedAt:new Date(opening+H).toISOString(),open:100,
   high:isLast?116:101,low:99,close,volume:isLast?160:100,
   ticks:12,partialSession:false};
});
const found=inspectQ102NativeS34SymbolAt("UNIUSDT",engineered,at,115);
const uni=found.raw.find(x=>x.key==="UNI|MR72_Z1.5_H24");
assert.ok(uni,"Real native S34 detector, not surrogate threshold, must produce UNI MR72");
assert.equal(uni.side,-1);
assert.equal(uni.family,"MR");
assert.equal(uni.entryTs,asOf);
assert.equal(uni.dataCutoffTs,asOf-H);
assert.equal(uni.maxHoldHours,24);
assert.ok(uni.ret14>.1);
assert.ok(found.gated.every(x=>found.raw.some(r=>r.key===x.key&&r.side===x.side)),
 "Native strict gate cannot invent a candidate absent from raw detection");
const badFuture=structuredClone(engineered);
badFuture[335].closedAt=new Date(asOf+H).toISOString();
assert.throws(()=>inspectQ102NativeS34SymbolAt("UNIUSDT",badFuture,at,115),/NONCAUSAL_OR_GAP/);
const gap=structuredClone(engineered);
gap[39].openTime=new Date(Date.parse(gap[39].openTime)+H).toISOString();
assert.throws(()=>inspectQ102NativeS34SymbolAt("UNIUSDT",gap,at,115),/NONCAUSAL_OR_GAP/);
assert.throws(()=>inspectQ102NativeS34SymbolAt("UNIUSDT",engineered.slice(1),at,115),/INSUFFICIENT_14D/);
assert.throws(()=>inspectQ102NativeS34SymbolAt("UNIUSDT",engineered,at,0),/ENTRY_OPEN_INVALID/);
assert.throws(()=>inspectQ102NativeS34SymbolAt("UNIUSDT",engineered,
 new Date(asOf+H).toISOString(),115),/DECISION_TIME_INVALID/);

const feed=new SyntheticMarket5m(20261115,"volatile",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-23T00:00:00Z",version:"v2"});
let checks=0,warmup=0,evaluated=0,rawCount=0,gatedCount=0,invalid=0;
let missingApt=0,missingLdo=0,processedUni=0;
for(;;){
 const s=feed.step();
 if(!s)break;
 if(!s.completedH1.some(x=>x.symbol==="BTCUSDT")||new Date(s.observedAt).getUTCHours()%4!==1)continue;
 const a=inspectQ102NativeS34Source(feed,s);
 checks++;
 assert.equal(a.fills,0,"Native raw candidates are not synthetic fills");
 assert.equal(a.nativeEntryOnly,true);
 for(const cand of [...a.rawCandidates,...a.gatedCandidates]){
   assert.ok(cand.dataCutoffTs<cand.entryTs);
   assert.equal(cand.entryTs,Date.parse(s.observedAt));
   assert.ok(cand.ret14>-1&&Number.isFinite(cand.ret14));
 }
 if(a.missingModelSymbols.includes("APTUSDT"))missingApt++;
 if(a.missingModelSymbols.includes("LDOUSDT"))missingLdo++;
 if(a.status==="INSUFFICIENT_14D")warmup++;
 if(a.status==="EVALUATED_SOURCE_PARTIAL"){
   evaluated++;
   assert.ok(a.evaluatedSymbols.includes("UNIUSDT"));
   assert.ok(a.evaluatedSymbols.includes("FETUSDT"));
   processedUni++;
   rawCount+=a.rawCandidates.length;
   gatedCount+=a.gatedCandidates.length;
 }
 if(a.status==="ASOF_GAP_OR_INVALID")invalid++;
}
assert.ok(checks>100&&warmup>60&&evaluated>35);
assert.equal(invalid,0);
assert.equal(missingApt,checks);
assert.equal(missingLdo,checks);
assert.equal(processedUni,evaluated);
console.log("PASS exact Q102 S3/S4 native candidate source, 336 H1, 22d synthetic as-of, independent source missing flags",JSON.stringify({
 checks,warmup,evaluated,rawCount,gatedCount,invalid,missingApt,missingLdo,
 fullQ102:false,online:false,trades:0
}));
