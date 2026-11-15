import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
 QUALITY102_HIGH_VOL_GRID,
 computeQuality102HighVolFeatures,
 matchQuality102HighVolGrid,generateQuality102HighVolSignals,
 quality102HighVolMarketValid
} from "../lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline";
import {
 inspectQ102NativeHighVolFeaturesAt,inspectQ102NativeHighVolSyntheticAt,Q102_HV_SOURCE_PIN
} from "../lib/bt-verification/pinned-native-q102/highvol-probe";
import {auditQ102NativeHighVol22D}
 from "../lib/bt-verification/q102-highvol-synthetic-audit";
import type {MarketCandle5m} from "../lib/bt-verification/synthetic-market";

const raw=readFileSync(join(process.cwd(),
 "lib","bt-verification","pinned-native-q102","disdex-quality102-causal-pipeline.ts"),"utf8");
const normalized=raw.split(String.fromCharCode(13,10)).join(String.fromCharCode(10));
const sourceSha=createHash("sha256").update(
 normalized.split(String.fromCharCode(10)).join(String.fromCharCode(13,10))
).digest("hex");
assert.equal(sourceSha,Q102_HV_SOURCE_PIN.originalSha256,
 "Original engine code is byte-equal after platform EOL only; no threshold changes");
assert.deepEqual(QUALITY102_HIGH_VOL_GRID.longDrops,[.08,.1,.12,.15]);
assert.deepEqual(QUALITY102_HIGH_VOL_GRID.shortRallies,[.05,.08,.1,.12]);
const engineered={
 signalTs:Date.parse("2025-10-21T00:00:00Z"),ret24:-.14,ret14d:.05,
 rsi14:23,atr14:1.8,atrPct:.02,volumeRatio:1.2,barUp:true,barDown:false
};
assert.equal(quality102HighVolMarketValid(engineered),true);
const grid=matchQuality102HighVolGrid(engineered);
assert.ok(grid.length>=12);
assert.ok(grid.every(x=>x.side===1));
assert.deepEqual(matchQuality102HighVolGrid({...engineered,volumeRatio:.4}),[]);
assert.deepEqual(matchQuality102HighVolGrid({...engineered,ret14d:-.01}),[]);
const H=3600000, now=Date.parse("2025-10-21T01:00:00Z");
const native:MarketCandle5m[]=Array.from({length:337},(_,i)=>{
 const start=now-(337-i)*H;
 const isLast=i===336;
 const price=i===0?85:isLast?91:100;
 return {symbol:"AVAXUSDT",category:"crypto",openTime:new Date(start).toISOString(),
 closedAt:new Date(start+H).toISOString(),open:price,high:price*1.03,
 low:price*.97,close:price,volume:100,ticks:12,partialSession:false};
});
const features=inspectQ102NativeHighVolFeaturesAt("AVAXUSDT",native,new Date(now).toISOString());
assert.equal(features.nativeEntries,0);
assert.ok(Number.isFinite(features.features.ret14d));
assert.equal(features.features.signalTs,now-H);
assert.throws(()=>inspectQ102NativeHighVolFeaturesAt("AVAXUSDT",native.slice(1),
  new Date(now).toISOString()),/NEEDS_337_H1/);
const gap=structuredClone(native);
gap[92].openTime=new Date(Date.parse(gap[92].openTime)+H).toISOString();
assert.throws(()=>inspectQ102NativeHighVolFeaturesAt("AVAXUSDT",gap,
  new Date(now).toISOString()),/NONCAUSAL_SOURCE_REJECTED/);
const future=structuredClone(native);
future[336].closedAt=new Date(now+H).toISOString();
assert.throws(()=>inspectQ102NativeHighVolFeaturesAt("AVAXUSDT",future,
  new Date(now).toISOString()),/NONCAUSAL_SOURCE_REJECTED/);
// The actual source-selected generator requires (a) 337 causal signal
// candles, (b) a known next-hour OPEN, and (c) an externally trained
// selected monthly rule. None is silently synthesized in the BT UI.
const noMonthly=generateQuality102HighVolSignals({
 symbol:"AVAXUSDT",stage:"S1",
 bars:[...native.map(x=>({
  timestampMs:Date.parse(x.openTime),open:x.open,high:x.high,
  low:x.low,close:x.close,quoteVolume:x.volume
 })),{timestampMs:now,open:90,high:90,low:90,close:90,quoteVolume:0}],
 monthlyRules:new Map()
});
assert.equal(noMonthly.length,0,"No 180-day monthly winner => fail closed");
const audit=auditQ102NativeHighVol22D(20261115,"volatile","v3");
assert.equal(audit.scheduledH1,528);
assert.equal(audit.warmupH1,336);
assert.equal(audit.sourceEvaluatedH1,192);
assert.equal(audit.evaluatedModelSymbols.length,11);
assert.deepEqual(audit.missingModelSymbols,[]);
assert.equal(audit.nativeSelectedEntryCandidates,0);
assert.equal(audit.simulationFills,0);
assert.equal(audit.hasVerifiedMonthlyRules,false);
assert.equal(audit.stageMembershipKnown,false);
assert.ok(audit.perSymbol.every(x=>x.frames===192));
assert.equal(audit.perSymbol.reduce((n,x)=>n+x.rawGrid,0),audit.rawThresholdGridMatches);
console.log("PASS Q102 native S1/S2 source features, native grid threshold and 180-day monthly fail-closed",JSON.stringify({
  scheduled:audit.scheduledH1,warmup:audit.warmupH1,
  sourceEvaluated:audit.sourceEvaluatedH1,
  modeledSymbols:audit.evaluatedModelSymbols.length,
  rawThresholdGridMatches:audit.rawThresholdGridMatches,
  verifiedMonthlyRules:false,actualEntries:0,orders:0
}));
