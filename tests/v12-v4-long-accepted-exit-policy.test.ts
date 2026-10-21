import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
import {v4LongTimeScope,v4InitialLongStage,v4ObserveLongClosedM5,
v4LongDesiredStop,v4AssertNoStopLoosening,v4LongProfitGuardScope,
v4LongProfit3Floor1Trigger,V4_LONG_PROFIT3_FLOOR1_ROUTES}
from "../lib/v12-v4-long-accepted-exit-policy";
const ts=3600000*200;
const bar={openTs:ts,open:100,high:102.2,low:99,close:101,observedAt:ts+300000};
test("TIME37 LONG only -8 -> -5 after *closed* +2% observation",()=>{
 assert.equal(PRODUCTION_EXIT_CATALOG.filter(c=>c.spec.kind==="TIME").length,37);
 for(const r of PRODUCTION_EXIT_CATALOG){
   assert.equal(v4LongTimeScope(r.route,"LONG"),r.spec.kind==="TIME");
   assert.equal(v4LongTimeScope(r.route,"SHORT"),false);
   if(r.spec.kind!=="TIME")continue;
   let state=v4InitialLongStage();
   assert.equal(v4LongDesiredStop(r.route,"LONG",100,state),92);
   assert.throws(()=>v4ObserveLongClosedM5(r.route,"LONG",ts,100,state,{...bar,observedAt:ts+299999}),/UNCLOSED/);
   state=v4ObserveLongClosedM5(r.route,"LONG",ts,100,state,bar);
   assert.equal(state.armed,true);
   assert.equal(state.armedAt,ts+300000);
   assert.equal(v4LongDesiredStop(r.route,"LONG",100,state),95);
   const revived=JSON.parse(JSON.stringify(state));
   assert.equal(v4LongDesiredStop(r.route,"LONG",100,revived),95);
   assert.deepEqual(v4ObserveLongClosedM5(r.route,"LONG",ts,100,revived,{...bar,openTs:ts+300000,observedAt:ts+600000}),revived);
 }
});
test("monotonic STOP; fail closed on missing M5, bad input, unsupported side",()=>{
 const none=v4InitialLongStage();
 assert.throws(()=>v4ObserveLongClosedM5("REC_X09_TIME_48H","LONG",ts,100,none,{...bar,openTs:ts+300000,observedAt:ts+600000}),/M5_GAP/);
 assert.throws(()=>v4ObserveLongClosedM5("REC_X09_TIME_48H","LONG",ts,100,none,{...bar,high:99}),/OHLC/);
 assert.throws(()=>v4ObserveLongClosedM5("REC_X09_TIME_48H","SHORT",ts,100,none,bar),/SCOPE/);
 assert.throws(()=>v4LongDesiredStop("REC_G3_LATE_BTC_REL","LONG",100,none),/SCOPE/);
 assert.doesNotThrow(()=>v4AssertNoStopLoosening(92,95));
 assert.throws(()=>v4AssertNoStopLoosening(95,92),/MUST_NOT_LOOSEN/);
});
test("+3 to +1 bearish confirmed: isolated to historically BT-validated X09/X10/X14 LONG",()=>{
 assert.equal(V4_LONG_PROFIT3_FLOOR1_ROUTES.length,3);
 for(const route of V4_LONG_PROFIT3_FLOOR1_ROUTES){
  assert.equal(v4LongProfitGuardScope(route,"LONG"),true);
  assert.equal(v4LongProfit3Floor1Trigger(route,"LONG",100,103.1,103,102,100.8),true);
  assert.equal(v4LongProfit3Floor1Trigger(route,"LONG",100,102.9,103,102,100.8),false);
  assert.equal(v4LongProfit3Floor1Trigger(route,"LONG",100,103.1,103,102,101.2),false);
  assert.equal(v4LongProfit3Floor1Trigger(route,"SHORT",100,103.1,103,102,100.8),false);
 }
 assert.equal(v4LongProfit3Floor1Trigger("REC_Y04_REV_D2_T36","LONG",100,103.1,103,102,100.8),false);
});
