import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  parseV12AllGateChecks, parseV12GateDiagnostics, summarizeV12DecisionHistory
} from "../lib/v12-gate-visibility";

test("runner-authored independent gate checks retain overlapping failures",()=>{
  const v=parseV12AllGateChecks({schema:"v12-all-gates-audit/v1",
    strongScoreGap:true,strongScoreGapOnlyBaseFailure:false,independentBasePass:false,
    checks:{volume:{status:"BLOCK",observed:0.55,minimum:0.9845},
      entryQuality:{status:"BLOCK",observed:0.9,detail:"STRONG_REGIME_SCORE_GAP"},
      winRate:{status:"NOT_EVALUATED"},unknown:{status:"PASS"}}});
  assert.equal(v?.checks.volume.status,"BLOCK");
  assert.equal(v?.checks.entryQuality.status,"BLOCK");
  assert.equal(v?.checks.winRate.status,"NOT_EVALUATED");
  assert.equal(v?.strongScoreGap,true);
  assert.equal(v?.strongScoreGapOnlyBaseFailure,false);
  assert.equal(v?.checks.unknown,undefined);
});
test("unknown/incomplete gate rows never become PASS",()=>{
  assert.equal(parseV12AllGateChecks(null),undefined);
  assert.equal(parseV12AllGateChecks({schema:"v12-all-gates-audit/v1",checks:{volume:{status:"maybe"}}}),undefined);
  const v=parseV12AllGateChecks({schema:"v12-all-gates-audit/v1",
    checks:{volume:{status:"NOT_EVALUATED"},winRate:{status:"NOT_APPLICABLE"}}});
  assert.equal(v?.checks.volume.status,"NOT_EVALUATED");
  assert.equal(v?.checks.winRate.status,"NOT_APPLICABLE");
});
test("latest snapshot counts concurrent gate failures instead of first reason",()=>{
  const x=parseV12GateDiagnostics({schema:"v12-gate-diagnostics/v1",
    candidateCount:14,allCheckBlockCounts:{volume:14,entryQuality:12},strongScoreGapCandidates:3,
    rejectionReasons:{VOLUME_RATIO_BELOW_MINIMUM:14}});
  assert.equal(x?.allCheckBlockCounts.volume,14);
  assert.equal(x?.allCheckBlockCounts.entryQuality,12);
  assert.equal(x?.strongScoreGapCandidates,3);
});
test("history removes duplicate observations and excludes unranked base candidates",()=>{
  const now=Date.now(), ts=now-3*86_400_000;
  const selected=(symbol:string,side:string,rank:number)=>({
    symbol,side,portfolioRank:rank,signalEligible:true,entryGateReason:"ALLOW_STANDARD"
  });
  const rows=[
    {referenceTs:ts,candidates:[selected("LINK","LONG",1),{
      symbol:"SOL",side:"LONG",signalEligible:true,entryGateReason:"ALLOW_STANDARD"}]},
    {referenceTs:ts,candidates:[selected("LINK","LONG",1)]},
    {referenceTs:ts+2*3_600_000,candidates:[selected("LINK","LONG",1)]},
    {referenceTs:ts+25*3_600_000,candidates:[selected("LINK","SHORT",1)]},
    {referenceTs:ts+48*3_600_000,candidates:[selected("LINK","LONG",1),
      {symbol:"BTC",side:"LONG",portfolioRank:2,signalEligible:false,entryGateReason:"BLOCK_FALSE_BURST80"}]},
  ];
  const x=summarizeV12DecisionHistory(rows,ts-1000,3);
  assert.equal(x.available,true);
  assert.equal(x.observedH2Bars,4);
  assert.equal(x.repeatedSelectedSignals,4);
  assert.equal(x.independent24hPerSymbol,2);
  assert.equal(x.independent46hPerSymbol,2);
  assert.equal(x.realOrderableCount,null);
  assert.equal(x.actualEntryCount,null);
});
test("UI marks unknown orderability and correct momentum fraction units",async()=>{
  const ui=await readFile("components/features/DecisionStatusPanel.tsx","utf8");
  const server=await readFile("lib/server/v12-decision-observability.ts","utf8");
  assert.match(ui,/percentFromFraction\(candidate\.momentum/);
  assert.match(ui,/V12GateMatrix candidate=\{candidate\}/);
  assert.match(ui,/実注文可能/);
  assert.match(ui,/未検証/);
  assert.match(server,/allGateChecks: parseV12AllGateChecks/);
  assert.match(server,/historyStats/);
  assert.match(server,/BASE_ONLY_NOT_FINAL_SIGNAL/);
});
