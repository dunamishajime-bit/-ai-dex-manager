import assert from "node:assert/strict";
import test from "node:test";
import {
  createV4FourRuleState,
  observeV4FourRuleM5,
  observeV4FourRuleH1,
  desiredV4FourRuleStop,
  cooldownAfterV4ShortInitialFill,
  type V4FourRuleM5Bar,
  type V4FourRuleH1Bar,
} from "../lib/v12-v4-four-rule-policy";

const m5=(openTs:number,open:number,high:number,low:number,close:number):V4FourRuleM5Bar=>
  ({openTs,open,high,low,close,observedAt:openTs+300_000});
const h1=(openTs:number,open:number,high:number,low:number,close:number):V4FourRuleH1Bar=>
  ({openTs,open,high,low,close,observedAt:openTs+3_600_000});

test("TIME37 LONG arms -5% only after a completed M5 high reaches +2%",()=>{
  let state=createV4FourRuleState();
  state=observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"LONG",entryTs:0,fill:100,state,bar:m5(0,100,101.9,99.8,101)}).state;
  assert.equal(state.longTimeStopStage,"INITIAL");
  assert.equal(desiredV4FourRuleStop({route:"REC_X09_TIME_48H",side:"LONG",fill:100,state}),92);
  state=observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"LONG",entryTs:0,fill:100,state,bar:m5(300_000,101,102.1,100.5,101.8)}).state;
  assert.equal(state.longTimeStopStage,"ARMED");
  assert.equal(desiredV4FourRuleStop({route:"REC_X09_TIME_48H",side:"LONG",fill:100,state}),95);
});

test("armed TIME37 LONG state never falls back after restart-style rehydration",()=>{
  const state=createV4FourRuleState({longTimeStopStage:"ARMED",longTimePeakHigh:102.2,longTimeArmedAt:600_000,lastM5OpenTs:300_000});
  assert.equal(desiredV4FourRuleStop({route:"REC_X10_TIME_48H",side:"LONG",fill:100,state}),95);
  assert.throws(()=>observeV4FourRuleM5({route:"REC_X10_TIME_48H",side:"LONG",entryTs:0,fill:100,state,bar:m5(900_000,100,100.5,99,100)}),/V4_FOUR_RULE_M5_GAP/);
});

test("X09/X10/X14 LONG profit guard needs +3%, +1% floor and two bearish closed H1 bars",()=>{
  const twoBars=createV4FourRuleState({longProfitPeakHigh:103});
  const first=observeV4FourRuleH1({route:"REC_X14_TIME_48H",side:"LONG",entryTs:0,fill:100,state:twoBars,bar:h1(0,102,102.5,100.8,101)}).state;
  const confirmed=observeV4FourRuleH1({route:"REC_X14_TIME_48H",side:"LONG",entryTs:0,fill:100,state:first,bar:h1(3_600_000,101,101.2,99.8,100.8)});
  assert.equal(confirmed.exitCandidate?.reason,"V4_LONG_PROFIT_GUARD_FILLED");
});

test("SHORT initial adverse exit uses prior MFE, starts only after 12h, and never creates cooldown before fill",()=>{
  let state=createV4FourRuleState();
  for(let i=0;i<144;i++){
    state=observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state,bar:m5(i*300_000,100,100.1,99.6,99.9)}).state;
  }
  const candidate=observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state,bar:m5(144*300_000,99.9,102.5,99.8,102)});
  assert.equal(candidate.exitCandidate?.reason,"V4_SHORT_INITIAL_ADVERSE_CANDIDATE");
  assert.equal(cooldownAfterV4ShortInitialFill({side:"SHORT",reason:"V4_SHORT_INITIAL_ADVERSE_FILLED",actualFillTs:undefined}),undefined);
});

test("SHORT initial adverse exit does not fire when prior MFE reached +1%",()=>{
  const state=createV4FourRuleState({shortPeakFavorablePct:0.011,lastM5OpenTs:12*3_600_000-300_000});
  const result=observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state,bar:m5(12*3_600_000,100,102.5,98.5,102)});
  assert.equal(result.exitCandidate,undefined);
});

test("TIME37 SHORT profit guard needs +5%, +2% remaining gain and two bullish H1 bars",()=>{
  let state=createV4FourRuleState({shortPeakFavorablePct:0.051});
  state=observeV4FourRuleH1({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state,bar:h1(0,95,98,94.5,97)}).state;
  const result=observeV4FourRuleH1({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state,bar:h1(3_600_000,97,99,96.5,98.2)});
  assert.equal(result.exitCandidate?.reason,"V4_SHORT_PROFIT_GUARD_FILLED");
});

test("short cooldown is derived from confirmed actual fill only and is direction-scoped",()=>{
  assert.equal(cooldownAfterV4ShortInitialFill({side:"SHORT",reason:"V4_SHORT_INITIAL_ADVERSE_FILLED",actualFillTs:1_000}),43_201_000);
  assert.equal(cooldownAfterV4ShortInitialFill({side:"LONG",reason:"V4_SHORT_INITIAL_ADVERSE_FILLED",actualFillTs:1_000}),undefined);
  assert.throws(()=>cooldownAfterV4ShortInitialFill({side:"SHORT",reason:"V4_SHORT_INITIAL_ADVERSE_FILLED",actualFillTs:-1}),/V4_FOUR_RULE_ACTUAL_FILL_INVALID/);
});

test("uncertain or gapped bars fail closed instead of synthesizing a trigger",()=>{
  assert.throws(()=>observeV4FourRuleM5({route:"REC_X09_TIME_48H",side:"LONG",entryTs:0,fill:100,state:createV4FourRuleState(),bar:m5(600_000,100,103,99,100)}),/V4_FOUR_RULE_M5_GAP/);
  assert.throws(()=>observeV4FourRuleH1({route:"REC_X09_TIME_48H",side:"SHORT",entryTs:0,fill:100,state:createV4FourRuleState(),bar:{...h1(0,100,101,99,100),observedAt:3_599_999}}),/V4_FOUR_RULE_H1_UNCLOSED/);
});
