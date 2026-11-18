import assert from "node:assert/strict";
import {SyntheticMarket5m,SYNTHETIC_FEED_SYMBOLS,SYNTHETIC_FEED_SYMBOLS_V2,
 SYNTHETIC_FEED_SYMBOLS_V3} from "../lib/bt-verification/synthetic-market";
import {auditQ102NativeS34} from "../lib/bt-verification/q102-s34-synthetic-audit";
import {createMultiassetH48Replay} from "../lib/bt-verification/multiasset-h48-replay";
import {validateReplay} from "../lib/bt-verification/replay";
import {QUALITY102_CAUSAL_V4_S34_MODEL}
 from "../lib/bt-verification/pinned-native-q102/disdexQuality102CausalV4Model";

assert.equal(SYNTHETIC_FEED_SYMBOLS.length,23);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V2.length,24);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V3.length,26);
assert.deepEqual([...SYNTHETIC_FEED_SYMBOLS_V3.slice(0,24)], [...SYNTHETIC_FEED_SYMBOLS_V2]);
assert.deepEqual(SYNTHETIC_FEED_SYMBOLS_V3.slice(-2),["APTUSDT","LDOUSDT"]);
const window={start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-05T00:00:00Z"};
const v1=new SyntheticMarket5m(123,"volatile",window);
const v1Explicit=new SyntheticMarket5m(123,"volatile",{...window,version:"v1"});
const v2=new SyntheticMarket5m(123,"volatile",{...window,version:"v2"});
const v2Copy=new SyntheticMarket5m(123,"volatile",{...window,version:"v2"});
const v3=new SyntheticMarket5m(123,"volatile",{...window,version:"v3"});
const v3Copy=new SyntheticMarket5m(123,"volatile",{...window,version:"v3"});
assert.equal(v3.description.schema,"disdex-bt-synthetic-feed-v3");
for(let i=0;i<4*24*12;i++){
 const a=v1.step()!,b=v1Explicit.step()!,c=v2.step()!,d=v2Copy.step()!,
       e=v3.step()!,f=v3Copy.step()!;
 assert.deepEqual(a,b,"v1 untouched after adding v3");
 assert.deepEqual(c,d,"v2 untouched and deterministic after adding v3");
 assert.deepEqual(e,f,"v3 deterministic");
 assert.equal(a.quotes.length,23);assert.equal(c.quotes.length,24);assert.equal(e.quotes.length,26);
 assert.ok(e.quotes.some(x=>x.symbol==="APTUSDT"&&x.price>0));
 assert.ok(e.quotes.some(x=>x.symbol==="LDOUSDT"&&x.price>0));
 if(i>=335){
  assert.ok(v3.historyH1("APTUSDT",30).length>0);
  assert.ok(v3.historyH1("LDOUSDT",30).length>0);
 }
}
const q=auditQ102NativeS34(20261115,"volatile","v3");
assert.equal(q.feedVersion,"v3");
assert.equal(q.outcome,"PARTIAL_NATIVE_S34_SHADOW_NO_FILLS");
assert.equal(q.fills,0);
assert.equal(q.nativeDecisionHours,132);
assert.equal(q.warmupDecisionHours,84);
assert.equal(q.evaluatedDecisionHours,48);
assert.deepEqual(q.missingModelSymbols,[],"Every original S3/S4 model symbol must have source OHLCV in v3");
const modeled=[...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))].sort();
assert.deepEqual(q.processedModelSymbols,modeled,
 "All frozen native Q102 S3/S4 model symbols must be evaluated on artificial v3 data");
assert.ok(q.rawNativeCandidates>=q.gatedNativeCandidates);
assert.ok(q.rawNativeCandidates>0,"Original native signal must evaluate real invented market candidate paths");
assert.equal(q.perSymbol.length,modeled.length);
const h=createMultiassetH48Replay(1,"trend",10,"v3");
assert.equal(validateReplay(h),true);
assert.ok(h.engineSha.includes("26SYM_V3"));
assert.ok(h.source?.note?.includes("including TIA/APT/LDO (v3)"));
const tia=h.frames.flatMap(x=>x.events.filter(e=>e.includes("RISK IDLE_NATIVE_TIAUSDT")));
assert.equal(tia.length,240);
assert.ok(tia.every(x=>!x.includes("MISSING_SYMBOL")&&x.endsWith("NO_FILL")));
assert.ok(h.frames.every(x=>x.positions.every(p=>p.symbol==="HYPEUSDT")),
 "Neither Q102 APT/LDO nor IDLE TIA shadow sources are simulated as traded positions");
console.log("PASS v3 26 symbols supply every source-pinned Q102 S3/S4 model ticker",JSON.stringify({
 version:q.feedVersion,allModelSymbols:modeled.length,raw:q.rawNativeCandidates,
 nativeGated:q.gatedNativeCandidates,unresolved:q.missingModelSymbols.length,
 q102Trades:q.fills,h48Frames:h.frames.length
}));
