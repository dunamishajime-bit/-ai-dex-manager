import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {replayQ102HvNativeClosed180d} from "../lib/bt-verification/q102-highvol-180d-native-replay";
import {
  QUALITY102_DAY_MS,QUALITY102_HOUR_MS,
  QUALITY102_RESEARCH_COSTS,quality102NetFromGross,
  simulateQuality102HighVolExit,quality102HighVolRuleKey,
  type Quality102Candle
} from "../lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline";

const native=readFileSync(join(process.cwd(),"lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts"));
assert.equal(createHash("sha256").update(Buffer.from(native.toString("utf8")
  .replace(/\r?\n/g,"\r\n"))).digest("hex"),
  "7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f");

const monthStart=Date.parse("2026-03-01T00:00:00Z");
const start=monthStart-180*QUALITY102_DAY_MS;
const end=monthStart-QUALITY102_HOUR_MS;
const first=start-336*QUALITY102_HOUR_MS;
const count=(end-QUALITY102_HOUR_MS-first)/QUALITY102_HOUR_MS+1;
// Transparent algebraic H1 fictional market: every candle is fixed from
// deterministic price functions, not exchange data and not synthetic v3 5m.
const candles:Quality102Candle[]=[];
let previous=120;
for(let i=0;i<count;i++){
  // A rising long-run trend with independent 160-hour drawdown/rebound
  // episodes: 14-day trend can be positive while the last 24h fall.
  const phase=i%160;
  const dip=phase<35?phase/35:phase<65?1-(phase-35)/30:0;
  const close=120*Math.exp(.0007*i-.22*dip+.015*Math.sin(i*2*Math.PI/450));
  candles.push({timestampMs:first+i*QUALITY102_HOUR_MS,
    open:previous,high:Math.max(previous,close)*1.012,
    low:Math.min(previous,close)*.988,close,
    quoteVolume:1_000_000*(1+.22*Math.sin(i*2*Math.PI/13))});
  previous=close;
}
const rules=[
 {longDrop:.08,longRsi:40,shortRally:.05,shortRsi:55,hardStop:.10},
 {longDrop:.12,longRsi:30,shortRally:.10,shortRsi:65,hardStop:.15}
] as const;
const input={monthStartMs:monthStart,bars:candles,frozenRules:rules};
const result=replayQ102HvNativeClosed180d(input);
assert.equal(result.barCount,count);
assert.equal(result.trainingDays,180);
assert.equal(result.rulesTested,2);
assert.ok(result.gridMatches>0,"Native grid should detect price-path matches");
assert.ok(result.closedModelTrades>0,"Native exit simulation should close model positions");
assert.equal(result.closedModelTrades,result.ledger.rows.length);
assert.equal(new Set(result.closedTradeIds).size,result.closedModelTrades);
assert.equal(result.ledger.windowStartMs,start);
assert.equal(result.ledger.windowEndMs,end);
assert.equal(result.selection.closedTradesEvaluated,result.closedModelTrades);
assert.equal(result.selection.liveEntryEnabled,false);
assert.equal(result.selection.fills,0);
assert.equal(result.nativeS1S2Orders,0);
assert.equal(result.verifiedStageMembership,false);
for(const row of result.ledger.rows){
  assert.ok(row.openedAtMs>=start);
  assert.ok(row.closedAtMs!==null && row.closedAtMs<=end);
  assert.ok(rules.some(rule=>quality102HighVolRuleKey(rule)===
    quality102HighVolRuleKey(row.rule)));
  const model=result.modelEvents.find(x=>x.id===row.id);
  assert.ok(model,"Every ledger row must have a complete native model event");
  assert.equal(model.netReturn,row.netReturn);
  assert.equal(model.exitAvailableAtMs,row.closedAtMs);
  assert.equal(model.entryAtMs,row.openedAtMs);
  assert.equal(model.signalAvailableAtMs,model.entryAtMs);
  assert.ok(model.exitAvailableAtMs<=end);
  const index=(row.openedAtMs-first)/QUALITY102_HOUR_MS;
  const side= row.rule===rules[0]||row.rule===rules[1]
    ? (candles[index-1].close/candles[index-1-336].close-1>=0?1:-1)
    : null;
  assert.ok(side===1||side===-1);
  const ex=simulateQuality102HighVolExit({
    side,entryPrice:candles[index].open,hardStop:row.rule.hardStop,
    bars:candles.slice(index,index+72)
  });
  assert.equal(ex.exitTs+QUALITY102_HOUR_MS,row.closedAtMs);
  assert.ok(Math.abs(row.netReturn-quality102NetFromGross(
    ex.grossReturn,ex.holdHours,QUALITY102_RESEARCH_COSTS.normal.perSide,
    QUALITY102_RESEARCH_COSTS.normal.fundingPerDay))<1e-12);
}
assert.equal(result.modelEvents.length,result.closedModelTrades);
assert.deepEqual(result,replayQ102HvNativeClosed180d(input));
assert.throws(()=>replayQ102HvNativeClosed180d({...input,bars:candles.slice(1)}),
 /EXACT_COVERAGE/);
assert.throws(()=>replayQ102HvNativeClosed180d({...input,bars:[...candles,{...candles.at(-1)!,timestampMs:end}]}),
 /EXACT_COVERAGE/);
const hole=candles.slice();hole[700]={...hole[700],timestampMs:hole[700].timestampMs+QUALITY102_HOUR_MS};
assert.throws(()=>replayQ102HvNativeClosed180d({...input,bars:hole}),/NONCAUSAL_OR_INVALID_BAR/);
const corrupt=candles.slice();corrupt[770]={...corrupt[770],high:0};
assert.throws(()=>replayQ102HvNativeClosed180d({...input,bars:corrupt}),/NONCAUSAL_OR_INVALID_BAR/);
assert.throws(()=>replayQ102HvNativeClosed180d({...input,frozenRules:[rules[0],rules[0]]}),
 /DUPLICATE_FROZEN_RULE/);
assert.throws(()=>replayQ102HvNativeClosed180d({...input,frozenRules:[]}),
 /FROZEN_RULESET_REQUIRED/);
assert.throws(()=>replayQ102HvNativeClosed180d({...input,frozenRules:[{...rules[0],longDrop:.081}]}),
 /RULE_OUTSIDE_GRID/);
// A future outcome is excluded even when its price path could be
// simulated from a larger dataset, and no month-start entry is invented.
assert.ok(result.ledger.rows.every(row=>row.closedAtMs!<=end));
console.log(JSON.stringify({
 status:"PASS_CAUSAL_RESEARCH_ONLY",monthStart:new Date(monthStart).toISOString(),
 source:"DETERMINISTIC_ARTIFICIAL_H1_NOT_VENUE",
 trainingDays:180,warmupHours:336,closedModelTrades:result.closedModelTrades,
 rawGridMatches:result.gridMatches,overlapBlocks:result.excludedOverlapping,
 rightCensored:result.rightCensored,
 selection:result.selection.sourceOutcome,
 selectedRuleForResearch:result.selection.selectedRuleKey,
 nativeS1S2Orders:0,
 checks:["exact-180d","native-grid","native-72h-exit","native-cost","no-lookahead",
  "future-exclusion","gap-rejection","grid-rejection","determinism","no-live"]
}));

// Opt-in owner-PC evidence output only. Never send model events to GitHub
// or allow an unset path to write into the research repository.
const evidenceDir=process.env.DISDEX_BT_PRIVATE_EVIDENCE_DIR;
if(evidenceDir){
  mkdirSync(evidenceDir,{recursive:true});
  const document={
    status:"RESEARCH_MODEL_ONLY_NOT_S1_S2",
    source:"deterministic H1 equation in scripts/bt-hp-q102-180d-native-replay-selftest.ts",
    scriptSha256:createHash("sha256").update(readFileSync(join(process.cwd(),
      "scripts/bt-hp-q102-180d-native-replay-selftest.ts"))).digest("hex"),
    nativeSourceSha256:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
    monthStart:new Date(monthStart).toISOString(),
    trainingStart:new Date(start).toISOString(),
    trainingEnd:new Date(end).toISOString(),
    sourceCost:QUALITY102_RESEARCH_COSTS.normal,
    ...result
  };
  const payload=JSON.stringify(document,null,2)+"\n";
  writeFileSync(join(evidenceDir,"Q102_S1S2_180D_CLOSED_NATIVE_REPLAY_20261116.json"),payload);
  console.log("OWNER_PRIVATE_MODEL_EVIDENCE_SHA256="+createHash("sha256").update(payload).digest("hex"));
}
