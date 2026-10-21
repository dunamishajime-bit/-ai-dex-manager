import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
import {v4ShortEligible,v4ShortProfitEligible,v4ShortInitialState,
 v4ObserveClosedShortM5,v4ShortProfitGivebackCandidate,
 v4ShortInitialStopCooldownUntil} from "../lib/v12-v4-short-two-axis-research-policy";
const H=3600000,M5=300000, entryTs=H*200;
const m5={openTs:entryTs,open:100,high:100.3,low:100,close:100.1,observedAt:entryTs+M5};
test("only SHORT; initial covered all 41, profit only TIME37",()=>{
 assert.equal(PRODUCTION_EXIT_CATALOG.length,41);
 for(const c of PRODUCTION_EXIT_CATALOG){
  assert.equal(v4ShortEligible(c.route,"SHORT"),true);
  assert.equal(v4ShortEligible(c.route,"LONG"),false);
  assert.equal(v4ShortProfitEligible(c.route,"SHORT"),c.spec.kind==="TIME");
  assert.equal(v4ShortProfitEligible(c.route,"LONG"),false);
 }
});
test("after 12h and no +1% MFE, initial adverse threshold +2.5%; no same-bar peek",()=>{
 const route="REC_X09_TIME_48H";
 let stage=v4ShortInitialState();
 for(let i=0;i<144;i++){
  const bar={...m5,openTs:entryTs+i*M5,observedAt:entryTs+(i+1)*M5};
  const x=v4ObserveClosedShortM5({route,side:"SHORT",entryTs,signedAverageEntryFill:100,stage,bar});
  assert.equal(x.initialAdverseExitCandidate,false);
  stage=x.stage;
 }
 const trigger=v4ObserveClosedShortM5({route,side:"SHORT",entryTs,signedAverageEntryFill:100,stage,
  bar:{...m5,openTs:entryTs+12*H,observedAt:entryTs+12*H+M5,high:103,close:100.1}});
 assert.equal(trigger.initialAdverseExitCandidate,true);
 assert.throws(()=>v4ObserveClosedShortM5({route,side:"SHORT",entryTs,signedAverageEntryFill:100,stage,
  bar:{...m5,openTs:entryTs+12*H,observedAt:entryTs+12*H+M5-1,high:103}}),/CAUSALITY/);
 const no= v4ObserveClosedShortM5({route,side:"SHORT",entryTs,signedAverageEntryFill:100,
  stage:{peakFavorablePct:.011,lastM5OpenTs:entryTs+12*H-M5},
  bar:{...m5,openTs:entryTs+12*H,observedAt:entryTs+12*H+M5,high:103}});
 assert.equal(no.initialAdverseExitCandidate,false);
});
test("profit +5 to +2 with TWO completed bullish H1, not LONG, ATR or future H1",()=>{
 const stage={peakFavorablePct:.055,lastM5OpenTs:entryTs+2*H};
 const h1={checkedAt:entryTs+3*H,thirdH1Close:96.5,previousH1Close:97.5,lastH1Close:99};
 const input={route:"REC_X09_TIME_48H",side:"SHORT" as const,entryTs,signedAverageEntryFill:100,stage,h1};
 assert.equal(v4ShortProfitGivebackCandidate(input),true);
 assert.equal(v4ShortProfitGivebackCandidate({...input,stage:{...stage,peakFavorablePct:.049}}),false);
 assert.equal(v4ShortProfitGivebackCandidate({...input,h1:{...h1,lastH1Close:97.5}}),false);
 assert.equal(v4ShortProfitGivebackCandidate({...input,side:"LONG"}),false);
 assert.equal(v4ShortProfitGivebackCandidate({...input,route:"REC_X13_TP1.5_SL1_H24"}),false);
 assert.throws(()=>v4ShortProfitGivebackCandidate({...input,h1:{...h1,checkedAt:entryTs+3*H-1}}),/UNCLOSED_H1/);
});
test("12h cooldown only actual filled early short STOP, never candidate, profit or LONG",()=>{
 const actual={side:"SHORT" as const,actualFilledExitReason:"V4_SHORT_INITIAL_ADVERSE_FILLED",actualFillTs:entryTs+12*H};
 assert.equal(v4ShortInitialStopCooldownUntil(actual),entryTs+24*H);
 assert.equal(v4ShortInitialStopCooldownUntil({...actual,actualFilledExitReason:"V4_SHORT_PROFIT_GIVEBACK_FILLED"}),undefined);
 assert.equal(v4ShortInitialStopCooldownUntil({...actual,side:"LONG"}),undefined);
 assert.throws(()=>v4ShortInitialStopCooldownUntil({...actual,actualFillTs:NaN}),/FILL_PROOF/);
});
