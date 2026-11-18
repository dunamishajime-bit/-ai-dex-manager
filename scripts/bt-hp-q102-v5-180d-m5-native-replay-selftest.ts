/**
 * BT-481-M: 194-day opt-in synthetic v5 M5->closed H1->frozen Q102
 * high-vol native rule/exit monthly research replay (six legacy fixture
 * symbols; native stage ID producer is NOT proven; ZERO executable entries).
 *
 * All prices, volumes and modeled outcomes are fictional. Do not compare
 * these rows with authenticated fills or count overlapping rules as orders.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {
  SyntheticMarket5m,type SyntheticSymbol
} from "../lib/bt-verification/synthetic-market";
import {LEGACY_Q102_S12_FIXTURE_SYMBOLS}
 from "../lib/bt-verification/q102-legacy-s12-v5-synthetic-audit";
import {replayQ102HvNativeClosed180d}
 from "../lib/bt-verification/q102-highvol-180d-native-replay";
import {
  QUALITY102_DAY_MS,QUALITY102_HOUR_MS,
  type Quality102Candle,quality102HighVolRuleKey
} from "../lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline";

const H=QUALITY102_HOUR_MS;
const monthStart=Date.parse("2026-03-01T00:00:00Z");
const earliest=monthStart-180*QUALITY102_DAY_MS-336*H;
const endExclusive=monthStart-H;
const opts={
  start:new Date(earliest).toISOString(),
  endExclusive:new Date(endExclusive).toISOString(),
  version:"v5" as const
};
assert.throws(()=>new SyntheticMarket5m(20261116,"volatile",
  {...opts,version:"v4"}),/SYNTHETIC_WINDOW_INVALID/,
 "Original v4 must keep its 53,000 tick cap");
const feed=new SyntheticMarket5m(20261116,"volatile",opts);
assert.ok(feed.totalTicks>53_000&&feed.totalTicks<=60_000,
 "Only opt-in v5 may span 180d training plus 14d warmup");
let btcCompleted=0;
let lastObserved="";
let clockErrors=0;
const ticks=feed.runToEnd(step=>{
  lastObserved=step.observedAt;
  if(step.completedH1.some(x=>x.symbol==="BTCUSDT")){
    btcCompleted++;
    if(Date.parse(step.observedAt)%H!==0)clockErrors++;
  }
});
assert.equal(ticks,feed.totalTicks);
assert.equal(clockErrors,0);
assert.equal(btcCompleted,(endExclusive-earliest)/H);
assert.equal(Date.parse(lastObserved),endExclusive);
const frozenRules=[
 {longDrop:.08,longRsi:40,shortRally:.05,shortRsi:55,hardStop:.10},
 {longDrop:.12,longRsi:30,shortRally:.10,shortRsi:65,hardStop:.15}
] as const;
const ruleKeys=new Set(frozenRules.map(quality102HighVolRuleKey));
assert.equal(ruleKeys.size,2);
type SourceCase=ReturnType<typeof replayQ102HvNativeClosed180d>;
const cases:{symbol:string;result:SourceCase}[]=[];
const globallyNamedIds=new Set<string>();
for(const symbol of LEGACY_Q102_S12_FIXTURE_SYMBOLS){
  const source=feed.historyH1(symbol as SyntheticSymbol,6000);
  assert.equal(source.length,btcCompleted);
  assert.ok(source.every(x=>
    x.symbol===symbol&&x.category==="crypto"&&x.ticks===12&&
    x.partialSession===false&&Date.parse(x.closedAt)===Date.parse(x.openTime)+H));
  const bars:Quality102Candle[]=source.map(x=>({
    timestampMs:Date.parse(x.openTime),
    open:x.open,high:x.high,low:x.low,close:x.close,
    quoteVolume:x.volume,baseVolume:x.volume/x.close
  }));
  const result=replayQ102HvNativeClosed180d({
    monthStartMs:monthStart,bars,frozenRules
  });
  assert.equal(result.trainingDays,180);
  assert.equal(result.rulesTested,2);
  assert.equal(result.barCount,btcCompleted);
  assert.equal(result.modelEvents.length,result.closedModelTrades);
  assert.equal(result.nativeS1S2Orders,0);
  assert.equal(result.verifiedStageMembership,false);
  assert.equal(result.selection.fills,0);
  assert.equal(result.selection.liveEntryEnabled,false);
  for(const x of result.modelEvents){
    assert.ok(x.exitAvailableAtMs<=monthStart-H);
    assert.ok(x.signalAvailableAtMs<=x.entryAtMs);
    assert.ok(x.entryAtMs>=monthStart-180*QUALITY102_DAY_MS);
    assert.ok(ruleKeys.has(x.ruleKey));
    const globalId=symbol+":"+x.id;
    assert.ok(!globallyNamedIds.has(globalId));
    globallyNamedIds.add(globalId);
  }
  cases.push({symbol,result});
}
const summary={
 status:"PASS_M5_TO_H1_NATIVE_MODEL_ONLY",
 source:"SYNTHETIC_V5_NOT_ORIGINAL_Q102_S1_S2_UNIVERSE",
 seed:20261116,scenario:"volatile",version:"v5",
 monthStart:new Date(monthStart).toISOString(),
 feedStart:new Date(earliest).toISOString(),
 lastCompletedH1At:new Date(endExclusive).toISOString(),
 m5Ticks:ticks,h1ClosedEach:btcCompleted,
 includedLegacyFixtureSymbols:cases.map(x=>x.symbol),
 rulesPerSymbol:2,
 perSymbol:cases.map(({symbol,result})=>({
  symbol,rawGridMatches:result.gridMatches,
  overlapped:result.excludedOverlapping,
  rightCensored:result.rightCensored,
  closedModelTrades:result.closedModelTrades,
  nativeMonthlySelectorResult:result.selection.sourceOutcome,
  selectedResearchRule:result.selection.selectedRuleKey
 })),
 totalRawGridMatches:cases.reduce((n,x)=>n+x.result.gridMatches,0),
 totalClosedModelTrades:cases.reduce((n,x)=>n+x.result.closedModelTrades,0),
 nativeS1S2StageMembershipVerified:false,
 historicalVenueFills:0,nativeS1S2Orders:0,
 note:"Two predeclared alternative rules per artificial ticker, not an integrated portfolio. These independent scenarios can overlap and must NOT be summed as real executed trades."
};
console.log(JSON.stringify(summary));
const privateDir=process.env.DISDEX_BT_PRIVATE_EVIDENCE_DIR;
if(privateDir){
 mkdirSync(privateDir,{recursive:true});
 const manifest={
   summary,
   nativeSourceSha256:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
   testScriptSha256:createHash("sha256").update(readFileSync(
     "scripts/bt-hp-q102-v5-180d-m5-native-replay-selftest.ts")).digest("hex"),
   modelCases:cases.map(({symbol,result})=>({
    symbol,
    ledger:result.ledger,
    modelEvents:result.modelEvents
   }))
 };
 const raw=JSON.stringify(manifest,null,2)+"\n";
 const out=join(privateDir,"BT481_Q102_S12_V5_180D_M5_NATIVE_EXIT_MODELS_20261116.json");
 writeFileSync(out,raw);
 console.log("OWNER_PRIVATE_180D_M5_LEDGER_SHA256="+createHash("sha256").update(raw).digest("hex"));
}
