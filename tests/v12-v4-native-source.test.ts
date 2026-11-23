import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-source-20261009.json";
import {computeNativeV4Sources, nativeMomentumAgeHours} from "../lib/v12-v4-native-source";
const universe=Object.fromEntries(Object.entries(fixture.universe).map(([symbol,bars])=>[symbol,bars.map(b=>({...b,sourceCount:2 as const}))]));
test("closed H2 native candidates retain research direction, rank, ATR and phase diagnostics",()=>{
 const out=computeNativeV4Sources(universe,120,fixture.decisionTs);
 assert.equal(out.length,fixture.expected.length);
 for(const [i,row] of out.entries()){
  const expected=fixture.expected[i];
  assert.equal(row.source.symbol,expected.symbol);
  assert.equal(row.source.side,expected.side);
  assert.equal(row.rank,expected.rank);
  assert.equal(row.source.eligibleSourceEntryTs,expected.entry_ts_ms);
  assert.equal(row.source.momentumConditionAgeHours,expected.age);
  assert.ok(Math.abs(row.atr-expected.atr)<1e-12);
  assert.ok(Math.abs(row.source.nativeDiagnosticRet6!-expected.diag_ret6)<1e-12);
  assert.ok(Math.abs(row.source.nativeDiagnosticEma12Atr!-expected.diag_ema)<1e-10);
 }
});
test("future candles cannot change a native source at the decision boundary",()=>{
 const original=computeNativeV4Sources(universe,120,fixture.decisionTs);
 const augmented=structuredClone(universe);
 for(const bars of Object.values(augmented)){
  bars.push({...bars.at(-1)!,ts:fixture.decisionTs,endTs:fixture.decisionTs+7200000,close:1e8});
 }
 assert.deepEqual(computeNativeV4Sources(augmented,120,fixture.decisionTs),original);
 assert.throws(()=>computeNativeV4Sources(augmented,121,fixture.decisionTs),/UNCLOSED_NATIVE_H2/);
});
test("native source refuses shifted symbols and gaps in its 121-bar window",()=>{
 const shifted=structuredClone(universe);shifted.ETH[90].endTs+=7200000;
 assert.throws(()=>computeNativeV4Sources(shifted,120,fixture.decisionTs),/NATIVE_H2_ALIGNMENT/);
 const missing=structuredClone(universe);missing.BTC.splice(90,1);
 assert.throws(()=>computeNativeV4Sources(missing,119,fixture.decisionTs),/NATIVE_H2_WARMUP/);
});
test("90h momentum condition age caps at 96h and resets on the latest failed condition",()=>{
 const bars=Array.from({length:150},(_,i)=>({close:Math.exp(i*.002)}));
 assert.equal(nativeMomentumAgeHours(bars,149,"LONG"),96);
 assert.equal(nativeMomentumAgeHours(bars,149,"SHORT"),0);
 bars[149]={close:bars[104].close*1.01};
 assert.equal(nativeMomentumAgeHours(bars,149,"LONG"),0);
});

test("CONT uses native H2 phase diagnostics while recovery rules retain H1 features",async()=>{
 const {evaluateV12V4Routes}=await import("../lib/v12-multilogic-v4-shadow");
 const f={symbol:"ETHUSDT",sourceSide:"SHORT" as const,sourceSignalTs:fixture.decisionTs,age:30,
  sret6:-.01,ema12Dist:-1,nativeDiagnosticRet6:.01,nativeDiagnosticEma12Atr:1.5};
 assert.ok(evaluateV12V4Routes(f).some(x=>x.route==="CONT_SHORT_MID_AGE24_48"));
 assert.ok(!evaluateV12V4Routes({...f,sret6:.01,ema12Dist:1.5,nativeDiagnosticRet6:-.01})
  .some(x=>x.route==="CONT_SHORT_MID_AGE24_48"));
});

test("native allocation assigns the first frozen route before repairs, without duplicate sleeves",async()=>{
 const {default:fixture}=await import("./fixtures/v12-v4-native-route-20261009.json");
 const {adaptProductionCandidates}=await import("../lib/v12-v4-production-features");
 const out=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}});
 assert.deepEqual(out.candidates.map(x=>x.route),[fixture.expectedRoute]);
});
