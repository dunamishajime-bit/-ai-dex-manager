import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {
  SyntheticMarket5m,SYNTHETIC_FEED_SYMBOLS_V4,
  SYNTHETIC_FEED_SYMBOLS_V5
} from "../lib/bt-verification/synthetic-market";
import {
  auditLegacyQ102S12SyntheticV5,
  LEGACY_Q102_S12_FIXTURE_SYMBOLS
} from "../lib/bt-verification/q102-legacy-s12-v5-synthetic-audit";
import {
  generateQuality102HighVolSignals,
} from "../lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline";
import {auditSyntheticFeed} from "../lib/bt-verification/synthetic-feed-audit";

const old=[...SYNTHETIC_FEED_SYMBOLS_V4];
const extra=["ONDOUSDT","SUIUSDT","OPUSDT","SEIUSDT","ARBUSDT"];
assert.deepEqual([...SYNTHETIC_FEED_SYMBOLS_V5.slice(0,old.length)],old);
assert.deepEqual([...SYNTHETIC_FEED_SYMBOLS_V5.slice(old.length)],extra);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V5.length,38);
assert.equal(new Set(SYNTHETIC_FEED_SYMBOLS_V5).size,38);
assert.ok(LEGACY_Q102_S12_FIXTURE_SYMBOLS.every(x=>
 SYNTHETIC_FEED_SYMBOLS_V5.includes(x)));
assert.equal(LEGACY_Q102_S12_FIXTURE_SYMBOLS.length,6);
const file=readFileSync("lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts");
assert.equal(createHash("sha256").update(Buffer.from(file.toString("utf8")
 .replace(/\r?\n/g,"\r\n"))).digest("hex"),
 "7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f");
const opt={start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-03T00:00:00Z"} as const;
for(const version of ["v1","v2","v3","v4","v5"] as const){
 const a=new SyntheticMarket5m(9,"rotation",{...opt,version});
 const b=new SyntheticMarket5m(9,"rotation",{...opt,version});
 for(let i=0;i<48*12;i++)assert.deepEqual(a.step(),b.step(),
    "Every source feed version retains deterministic generation");
 assert.equal(a.step(),null);
}
const legacyFeed=new SyntheticMarket5m(20261116,"volatile",{...opt,version:"v5"});
const legacyTick=legacyFeed.step()!;
assert.equal(legacyTick.quotes.length,38);
assert.ok(LEGACY_Q102_S12_FIXTURE_SYMBOLS.every(symbol=>
  legacyTick.quotes.some(q=>q.symbol===symbol&&q.category==="crypto"&&q.price>0)));
const v5Audit=auditSyntheticFeed(20261116,"volatile",24,"v5");
assert.equal(v5Audit.cryptoSymbols,30);
assert.equal(v5Audit.stockSymbols,8);
assert.equal(v5Audit.totalSymbols,38);
assert.equal(v5Audit.nativeRunnerDecisionReady,false);
const result=auditLegacyQ102S12SyntheticV5(20261116,"volatile");
assert.deepEqual(result,auditLegacyQ102S12SyntheticV5(20261116,"volatile"),
 "The same v5 fixed seed must reproduce the exact 22d results");
assert.equal(result.syntheticSymbols,38);
assert.equal(result.completedH1,528);
assert.equal(result.warmupH1,336);
assert.equal(result.evaluatedH1,192);
assert.deepEqual([...result.coveredLegacySymbols],[...LEGACY_Q102_S12_FIXTURE_SYMBOLS]);
assert.deepEqual([...result.missingLegacySymbols],[]);
assert.equal(result.perSymbol.length,6);
assert.ok(result.perSymbol.every(x=>x.evaluations===192));
assert.equal(result.rawGridThresholdMatches,
 result.perSymbol.reduce((acc,x)=>acc+x.gridMatches,0));
assert.equal(result.stage1Stage2MembershipVerified,false);
assert.equal(result.originalNativeS1S2Expanded30IdsAvailable,false);
assert.equal(result.historical180dClosedVenueTradesAvailable,false);
assert.equal(result.monthlyRulesVerified,false);
assert.equal(result.nativeS1S2EntrySignals,0);
assert.equal(result.ordersOrFills,0);
assert.equal(result.outcome,"LEGACY_SIX_SYNTHETIC_FEATURES_ONLY");
assert.deepEqual(generateQuality102HighVolSignals({
  symbol:"SUIUSDT",stage:"S1",bars:[],monthlyRules:new Map()
}),[],"Never synthesize official monthly rules");
console.log(JSON.stringify({
 status:"PASS_LEGACY_SIX_H1_SOURCE_ONLY",
 feedVersion:"v5",seed:result.seed,syntheticSymbols:38,
 nativeFixtureSymbols:result.coveredLegacySymbols,
 sourceEvaluatedH1:result.evaluatedH1,
 evaluatedSymbolHours:result.perSymbol.reduce((n,x)=>n+x.evaluations,0),
 rawGridThresholdMatches:result.rawGridThresholdMatches,
 sourceStageMembershipVerified:false,nativeOrders:0
}));

// Aggregate reproducibility manifest on the owner PC only. No price paths
// or candidate-level rows are committed to GitHub.
const privateDir=process.env.DISDEX_BT_PRIVATE_EVIDENCE_DIR;
if(privateDir){
 mkdirSync(privateDir,{recursive:true});
 const auditDocument={
  status:"Q102_LEGACY_SIX_ARTIFICIAL_SOURCE_COVERAGE_ONLY",
  originalNativeSourceSha256:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
  auditScriptSha256:createHash("sha256").update(readFileSync(
    "scripts/bt-hp-q102-legacy-s12-v5-synthetic-selftest.ts")).digest("hex"),
  result
 };
 const raw=JSON.stringify(auditDocument,null,2)+"\n";
 const output=join(privateDir,"BT481_Q102_LEGACY_S12_V5_FEATURE_COVERAGE_20261116.json");
 writeFileSync(output,raw);
 console.log("OWNER_PRIVATE_FEATURE_MANIFEST_SHA256="+createHash("sha256").update(raw).digest("hex"));
}
