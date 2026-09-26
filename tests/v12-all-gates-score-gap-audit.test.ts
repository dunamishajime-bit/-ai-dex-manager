import assert from "node:assert/strict";
import test from "node:test";
import {inspectV12AllGateChecks} from "../lib/v12-all-gates-audit";
import {evaluateV12EntryQuality} from "../lib/v12-x1-all";
const candidate=(overrides:Record<string,any>={})=>({
  symbol:"LINK",side:"LONG" as const,score:0.90,momentum:0.08,volatility:0.02,
  atr:2,atrRatio:0.02,volumeRatio:1.20,regime:"LONG" as const,strongRegime:true,...overrides
});
test("strong-score-gap is observable and remains frozen blocked",()=>{
  const result=inspectV12AllGateChecks(candidate());
  assert.equal(result.strongScoreGap,true);
  assert.equal(result.strongScoreGapOnlyBaseFailure,true);
  assert.equal(result.checks.scoreStandard.status,"BLOCK");
  assert.equal(result.checks.scoreStrongAlternative.status,"BLOCK");
  assert.equal(result.checks.entryQuality.status,"BLOCK");
  assert.equal(result.checks.winRate.status,"NOT_EVALUATED");
  assert.equal(evaluateV12EntryQuality({regime:"LONG",strongRegime:true,side:"LONG",score:0.9,momentum:0.08,atrRatio:0.02}),false);
});
test("a first volume failure does not conceal additional score failure",()=>{
  const result=inspectV12AllGateChecks(candidate({volumeRatio:0.5}));
  assert.equal(result.checks.volume.status,"BLOCK");
  assert.equal(result.checks.entryQuality.status,"BLOCK");
  assert.equal(result.strongScoreGap,true);
  assert.equal(result.strongScoreGapOnlyBaseFailure,false);
});
test("strong bounded route, weak momentum route and neutral score have distinct checks",()=>{
  const strong=inspectV12AllGateChecks(candidate({score:0.5}));
  assert.equal(strong.checks.entryQuality.status,"PASS");
  const weak=inspectV12AllGateChecks(candidate({strongRegime:false}));
  assert.equal(weak.checks.momentumWeakAlternative.status,"PASS");
  assert.equal(weak.checks.entryQuality.status,"PASS");
  const neutral=inspectV12AllGateChecks(candidate({regime:"NEUTRAL",strongRegime:false}));
  assert.equal(neutral.checks.entryQuality.status,"BLOCK");
  assert.equal(neutral.checks.btcDirection.status,"PASS");
});
test("BTC misalignment and evaluated win-rate are independent",()=>{
  const result=inspectV12AllGateChecks(candidate({regime:"SHORT",portfolioRank:1,winRate:{allow:false,reason:"BLOCK_FALSE_BURST80"}}));
  assert.equal(result.checks.btcDirection.status,"BLOCK");
  assert.equal(result.checks.winRate.status,"BLOCK");
  assert.equal(result.checks.winRate.detail,"BLOCK_FALSE_BURST80");
});
test("score-gap diagnostics never approve real trading",()=>{
  const result=inspectV12AllGateChecks(candidate({portfolioRank:2,winRate:{allow:true,reason:"ALLOW_STANDARD"}}));
  assert.equal(result.checks.portfolioSelection.status,"NOT_EVALUATED");
  assert.equal(result.independentBasePass,false);
});
