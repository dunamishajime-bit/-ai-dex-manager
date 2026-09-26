import assert from "node:assert/strict";
import test from "node:test";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { auditV12CandidateGates, evaluateV12EntryQuality, type V12Candidate } from "../lib/v12-x1-all";

const candidate=(score:number,volumeRatio:number):V12Candidate=>({
  symbol:"LINK",side:"LONG",score,volumeRatio,momentum:0.08,volatility:0.02,atr:2,
});
test("strong score gap is independently visible when volume also fails",()=>{
  const result=auditV12CandidateGates(candidate(0.85,0.4),0.02,{regime:"LONG",strongRegime:true});
  assert.equal(result.scoreQuality.strongScoreGap,true);
  assert.equal(result.scoreQuality.pass,false);
  assert.equal(result.volume.pass,false);
  assert.deepEqual(result.failedGates,["VOLUME_RATIO","SCORE_OR_QUALITY"]);
  assert.equal(evaluateV12EntryQuality({regime:"LONG",strongRegime:true,side:"LONG",score:0.85,momentum:0.08,atrRatio:0.02}),false);
});
test("strong 0.15-0.70 band and ordinary 1.4649+ remain valid without changes",()=>{
  const state={regime:"LONG" as const,strongRegime:true};
  for(const score of [0.15,0.50,0.70,1.4649,2]){
    const result=auditV12CandidateGates(candidate(score,1.2),0.02,state);
    assert.equal(result.scoreQuality.pass,true,"score "+score);
    assert.equal(result.scoreQuality.strongScoreGap,false);
  }
  assert.equal(auditV12CandidateGates(candidate(0.85,1.2),0.02,state).scoreQuality.pass,false);
});
test("normal neutral score gate is not mistaken for strong band",()=>{
  const result=auditV12CandidateGates(candidate(0.85,1.2),0.02,{regime:"NEUTRAL",strongRegime:false});
  assert.equal(result.scoreQuality.strongScoreGap,false);
  assert.equal(result.scoreQuality.pass,false);
  assert.equal(result.btcDirection.pass,V12_X1_ALL.allowNeutralRegime);
});
test("regime direction fails independently of score",()=>{
  const result=auditV12CandidateGates(candidate(1.5,1.2),0.02,{regime:"SHORT",strongRegime:true});
  assert.equal(result.scoreQuality.pass,true);
  assert.equal(result.btcDirection.pass,false);
  assert.deepEqual(result.failedGates,["BTC_REGIME_DIRECTION"]);
});
test("bounded quality ATR and nonstrong momentum routes match production contract",()=>{
  const strong=auditV12CandidateGates(candidate(0.5,1.2),0.0139,{regime:"LONG",strongRegime:true});
  assert.equal(strong.scoreQuality.pass,false);
  const relaxed=auditV12CandidateGates(candidate(0.85,1.2),0.02,{regime:"LONG",strongRegime:false});
  assert.equal(relaxed.scoreQuality.pass,true);
  assert.equal(relaxed.qualityRoute,"RELAXED_MOMENTUM");
});
