import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
 SyntheticMarket5m,SYNTHETIC_FEED_SYMBOLS,SYNTHETIC_FEED_SYMBOLS_V2,
 SYNTHETIC_FEED_SYMBOLS_V3,SYNTHETIC_FEED_SYMBOLS_V4
} from "../lib/bt-verification/synthetic-market";
import {
 V4NativeFailedBreakShadow,V4_NATIVE_CORE_PIN,V4_NATIVE_CORE_TARGETS
} from "../lib/bt-verification/pinned-native-v4/native-core-probe";
import {createMultiassetH48Replay}
 from "../lib/bt-verification/multiasset-h48-replay";
import {auditV4NativeFailedBreak22D}
 from "../lib/bt-verification/v4-native-core-synthetic-audit";
import {validateReplay} from "../lib/bt-verification/replay";

const sourcePath=join(process.cwd(),"lib","bt-verification","pinned-native-v4","v12-v4-native-core.ts");
let source=readFileSync(sourcePath,"utf8");
assert.equal(source.split('from "./native-v12-bar-type"').length,2);
source=source.replace('from "./native-v12-bar-type"','from "./v12-x1-all"')
 .split(String.fromCharCode(13,10)).join(String.fromCharCode(10))
 .split(String.fromCharCode(10)).join(String.fromCharCode(13,10));
assert.equal(createHash("sha256").update(source).digest("hex"),V4_NATIVE_CORE_PIN.originalSha256);

assert.equal(SYNTHETIC_FEED_SYMBOLS.length,23);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V2.length,24);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V3.length,26);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V4.length,33);
assert.deepEqual([...SYNTHETIC_FEED_SYMBOLS_V4.slice(0,26)],[...SYNTHETIC_FEED_SYMBOLS_V3]);
assert.equal(V4_NATIVE_CORE_TARGETS.length,14);
assert.ok(V4_NATIVE_CORE_TARGETS.every(x=>SYNTHETIC_FEED_SYMBOLS_V4.includes(x)));
for(const version of ["v1","v2","v3","v4"] as const){
 const options={start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-03T00:00:00Z",version};
 const f=new SyntheticMarket5m(20261115,"volatile",options);
 const copy=new SyntheticMarket5m(20261115,"volatile",options);
 for(let i=0;i<48*12;i++){
  assert.deepEqual(f.step(),copy.step(),"Each historical feed version must remain reproducible");
 }
 assert.equal(f.tick,48*12);
}
const window={start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-23T00:00:00Z"};
const feed=new SyntheticMarket5m(20261115,"rotation",{...window,version:"v4"});
const probe=new V4NativeFailedBreakShadow();
let scheduled=0,warmup=0,evaluated=0,missing=0,invalid=0,nativeEvents=0;
while(true){
 const step=feed.step();
 if(!step)break;
 const result=probe.inspect(feed,step);
 assert.equal(result.fills,0);
 assert.equal(result.fullV4Parity,false);
 if(result.status==="NOT_H2")continue;
 scheduled++;
 if(result.status==="MISSING_SYMBOLS")missing++;
 if(result.status==="WARMUP_61_H2")warmup++;
 if(result.status==="SOURCE_EVALUATED"){
  evaluated++;
  assert.equal(result.evaluatedSymbols.length,13);
  assert.deepEqual(result.missingSymbols,[]);
  nativeEvents+=result.nativeEvents.length;
  for(const event of result.nativeEvents){
   assert.equal(event.orderEnabled,false);
   assert.equal(event.route,"FAILED_BREAK_REV_SHORT_6H");
   assert.equal(event.side,"SHORT");
   assert.ok(event.decision_ts_ms<=Date.parse(step.observedAt));
  }
 }
 if(result.status==="SOURCE_INVALID")invalid++;
}
assert.equal(scheduled,22*12);
assert.equal(warmup,60);
assert.equal(evaluated,scheduled-warmup);
assert.equal(missing,0);
assert.equal(invalid,0);
const missingFeed=new SyntheticMarket5m(20261115,"rotation",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-02T00:00:00Z",version:"v3"
});
const missingProbe=new V4NativeFailedBreakShadow();
let missingResult;
for(let i=0;i<24*12;i++){
 const step=missingFeed.step()!;
 missingResult=missingProbe.inspect(missingFeed,step);
}
assert.equal(missingResult!.status,"MISSING_SYMBOLS");
assert.equal(missingResult!.missingSymbols.length,7);
assert.equal(missingResult!.nativeEvents.length,0);
const h48=createMultiassetH48Replay(123,"trend",10,"v4");
assert.equal(validateReplay(h48),true);
assert.ok(h48.engineSha.includes("33SYM_V4"));
assert.ok(h48.source?.note?.includes("all pinned V4 X1 symbols"));
assert.ok(h48.frames.every(f=>f.positions.every(p=>p.symbol==="HYPEUSDT")));
const uiAudit=auditV4NativeFailedBreak22D(20261115,"rotation");
assert.equal(uiAudit.completedH2Times,264);
assert.equal(uiAudit.warmupH2Times,60);
assert.equal(uiAudit.evaluatedH2Times,204);
assert.equal(uiAudit.nativeSourceEvents,nativeEvents);
assert.equal(uiAudit.badInputs,0);
assert.equal(uiAudit.actualOrders,0);
assert.equal(uiAudit.fullV4,false);
assert.equal(uiAudit.eventSample.length,nativeEvents);
console.log("PASS V4 original FAILED_BREAK core source 14-asset v4 feed, 61 H2 causal warmup, no trade authority",JSON.stringify({
 fullV4:false,sourceTargets:14,unmodeledTargets:0,scheduledH2:scheduled,
 warmupH2:warmup,evaluatedH2:evaluated,nativeCoreEvents:nativeEvents,
 missingInOldV3:7,invalid,orders:0
}));
