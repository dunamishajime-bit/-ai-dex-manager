import assert from "node:assert/strict";
import {auditQ102NativeS34} from "../lib/bt-verification/q102-s34-synthetic-audit";

const a=auditQ102NativeS34(20261115,"volatile","v2");
assert.equal(a.schema,"disdex-bt-q102-native-s34-audit-v1");
assert.equal(a.sourceRevision,"9118eeaa6c209dc6e37887cf5be139b3baaa005d");
assert.equal(a.sourceSha256,"1a75ba55bd58ddd93f26b3b1d9c58f0a42d7dcfb8f3dbbc57f2f4d555aef8466");
assert.equal(a.requiredWarmupHours,336);
assert.equal(a.totalFiveMinuteTicks,22*24*12);
assert.equal(a.nativeDecisionHours,132);
assert.equal(a.warmupDecisionHours,84);
assert.equal(a.evaluatedDecisionHours,48);
assert.equal(a.rawNativeCandidates,222);
assert.equal(a.gatedNativeCandidates,40);
assert.ok(a.missingModelSymbols.includes("APTUSDT"));
assert.ok(a.missingModelSymbols.includes("LDOUSDT"));
assert.ok(a.processedModelSymbols.includes("AVAXUSDT"));
assert.ok(a.processedModelSymbols.includes("UNIUSDT"));
assert.ok(a.processedModelSymbols.includes("FETUSDT"));
assert.equal(a.outcome,"PARTIAL_NATIVE_S34_SHADOW_NO_FILLS");
assert.equal(a.fills,0);
assert.equal(a.fullQ102,false);
assert.equal(a.onlineLayer23,false);
assert.ok(a.examples.length>0&&a.examples.length<=30);
assert.equal(a.perSymbol.reduce((x,y)=>x+y.raw,0),a.rawNativeCandidates);
assert.equal(a.perSymbol.reduce((x,y)=>x+y.gated,0),a.gatedNativeCandidates);
for(const row of a.examples){
 assert.ok(row.entryTs>row.dataCutoffTs&&row.entryTs===Date.parse(row.at));
 assert.ok(row.side==="LONG"||row.side==="SHORT");
 assert.ok(row.ret14>-1&&Number.isFinite(row.ret14));
}
assert.deepEqual(a,auditQ102NativeS34(20261115,"volatile","v2"),
 "Native S34 results must be reproducible for same artificial market version");
const v1=auditQ102NativeS34(20261115,"volatile","v1");
assert.equal(v1.nativeDecisionHours,a.nativeDecisionHours);
assert.equal(v1.missingModelSymbols.includes("APTUSDT"),true);
assert.equal(v1.missingModelSymbols.includes("LDOUSDT"),true);
assert.equal(v1.fills,0);
assert.notDeepEqual(v1,a,"Feed version alters artificial paths and must not inherit research equity");
assert.throws(()=>auditQ102NativeS34(-1,"range","v2"),/SEED_INVALID/);
console.log("PASS 22-day source-pinned Q102 S34 candidates native audit, 336H warmup, 222 raw, 40 gated, missing APT/LDO and zero orders");
