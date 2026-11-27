import test from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {observeStable4PenguH1,observeStable4Q102H1,bindStable4NativeH1Observation,type SourceObservation} from "../lib/stable4-native-pengu-q102-source-observer";
import {buildPenguDualLsV2Signal,type PenguDualLsV2History} from "../lib/pengu-dual-ls-v2";
import {buildQuality102CausalV1Signal} from "../lib/disdex-quality102-causal-v1-signal";

const H=3_600_000,t=5_000*H,sha="a".repeat(40);
const history=(n:number)=>Array.from({length:n},(_,i)=>{
 const openTime=t-(n-i)*H;
 return {openTime,closeTime:openTime+H-1,open:100,high:100.05,low:99.95,close:100,volume:1000};
});
const pengu=(n=220):PenguDualLsV2History=>({pengu1h:history(n),btc1h:history(n),penguFunding:[]});
const qrows=(n=181*24)=>Array.from({length:n},(_,i)=>{
 const timestampMs=t-(n-i)*H;
 return {timestampMs,open:100,high:100.05,low:99.95,close:100,baseVolume:1000,quoteVolume:100000};
});
const qhistory=(n=181*24)=>({candlesBySymbol:{BTCUSDT:qrows(n),SOLUSDT:qrows(n)}} as const);
const occupancy={activePosition:false,unresolvedPendingEntry:false,basePositionActive:false};

test("native PENGU H1 flat-market replay matches pinned source and grants zero orders",()=>{
 const native=buildPenguDualLsV2Signal(pengu(),undefined,t,0,{recoveryV8Enabled:false,v64DynamicLongEnabled:false});
 const observed=observeStable4PenguH1({options:{recoveryV8Enabled:false,v64DynamicLongEnabled:false},history:pengu(),decisionTs:t,sourcePin:sha});
 assert.equal(native.side,0);
 assert.equal(observed.status,"NO_SOURCE_ENTRY");
 assert.equal(observed.reason,"NATIVE_PENGU_NO_ENTRY");
 assert.equal(observed.side,native.side);
 assert.equal(observed.asterM5EntryConfirmed,false);
 assert.equal(observed.orderAuthority,false);
});

test("native PENGU rejects missing, future, incomplete, desynchronised, or fake funding data",()=>{
 const valid=pengu();
 const run=(x:ReturnType<typeof pengu>)=>observeStable4PenguH1({options:{recoveryV8Enabled:false,v64DynamicLongEnabled:false},history:x,decisionTs:t,sourcePin:sha});
 assert.equal(run({...valid,pengu1h:valid.pengu1h.slice(1)}).status,"BLOCKED_SOURCE");
 assert.equal(run({...valid,pengu1h:[...valid.pengu1h,{...valid.pengu1h.at(-1)!,openTime:t,closeTime:t+H-1}]}).reason,"NATIVE_H1_HISTORY_OR_FUNDING_INVALID");
 assert.equal(run({...valid,btc1h:[...valid.btc1h.slice(0,-1),{...valid.btc1h.at(-1)!,closeTime:t+10}]}).status,"BLOCKED_SOURCE");
 assert.equal(run({...valid,btc1h:[...valid.btc1h.slice(0,-1),{...valid.btc1h.at(-1)!,openTime:t-2*H,closeTime:t-H-1}]}).status,"BLOCKED_SOURCE");
 assert.equal(run({...valid,penguFunding:[{fundingTime:t,fundingRate:.001}]}).status,"BLOCKED_SOURCE");
 assert.equal(observeStable4PenguH1({options:{recoveryV8Enabled:false,v64DynamicLongEnabled:false},history:valid,decisionTs:t,sourcePin:"not-a-sha"}).reason,"SOURCE_PIN_OR_CLOCK_INVALID");
 assert.equal(observeStable4PenguH1({history:valid,decisionTs:t,sourcePin:sha}).reason,"NATIVE_PENGU_RUNTIME_MODE_UNVERIFIED");
});

test("native Q102 H1 flat-market replay respects 181-day history and remains observational",()=>{
 const native=buildQuality102CausalV1Signal({history:qhistory(),decisionTs:t,sleeveOccupancy:occupancy});
 const observed=observeStable4Q102H1({history:qhistory(),decisionTs:t,sourcePin:sha,occupancy});
 assert.equal(native.side,0);
 assert.equal(observed.status,"NO_SOURCE_ENTRY");
 assert.equal(observed.side,native.side);
 assert.equal(observed.orderAuthority,false);
 assert.equal(observed.asterM5EntryConfirmed,false);
});

test("native Q102 rejects 180-day-only, missing BTC, future candles and unverified owner occupancy",()=>{
 const run=(history:ReturnType<typeof qhistory>,state=occupancy)=>
   observeStable4Q102H1({history,decisionTs:t,sourcePin:sha,occupancy:state});
 assert.equal(run(qhistory(180*24)).reason,"NATIVE_Q102_181D_CLOSED_HISTORY_UNAVAILABLE");
 assert.equal(run({candlesBySymbol:{BTCUSDT:qrows()}} as any).status,"BLOCKED_SOURCE");
 const bad=qrows();bad[bad.length-1]={...bad.at(-1)!,timestampMs:t};
 assert.equal(run({candlesBySymbol:{BTCUSDT:qrows(),SOLUSDT:bad}}).status,"BLOCKED_SOURCE");
 assert.equal(observeStable4Q102H1({history:qhistory(),decisionTs:t,sourcePin:sha,occupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:"unknown" as any}}).reason,"NATIVE_Q102_OCCUPANCY_UNVERIFIED");
});


test("source-bound PENGU/Q102 observations remain ineligible until real ASTER M5 source confirmation",()=>{
 const native:SourceObservation={
  status:"NATIVE_ENTRY_OBSERVED",reason:"NATIVE_H1_SIGNAL_ONLY_M5_UNCONFIRMED",
  runner:"PENGU",symbol:"PENGUUSDT",side:-1,
  decisionTs:t,sourceDataCutoffTs:t-H,sourcePin:sha,
  gross:1,route:"SHORT_V20",orderAuthority:false,asterM5EntryConfirmed:false,
 };
 const candidate={
  sleeve:"PENGU" as const,symbol:"PENGUUSDT",side:"SHORT" as const,
  gross:1,route:"SHORT_V20",entryTs:t,sourceReleaseSha:sha,
  sourceDecisionTs:t,sourceComplete:true,
 };
 const bind=(observation:SourceObservation=native,c=candidate)=>
   bindStable4NativeH1Observation({candidate:c,observation});
 const good=bind();
 assert.equal(good.status,"NATIVE_H1_OBSERVED_ONLY");
 assert.equal(good.nativeH1Bound,true);
 assert.equal(good.eligibleForPortfolioEntry,false);
 assert.equal(good.orderAuthority,false);
 assert.equal(good.reason,"ASTER_M5_ENTRY_CONFIRMATION_NOT_SOURCE_CERTIFIED");
 for(const observation of [
  {...native,sourcePin:"b".repeat(40)},
  {...native,sourceDataCutoffTs:t},
  {...native,status:"NO_SOURCE_ENTRY" as const},
  {...native,gross:.5},
  {...native,side:1 as const},
  {...native,asterM5EntryConfirmed:true as any},
 ])assert.equal(bind(observation).status,"BLOCKED");
 assert.equal(bind(undefined as any,{...candidate,sourceComplete:false}).status,"BLOCKED");
 assert.equal(bind(undefined as any,{...candidate,entryTs:t+H}).status,"BLOCKED");
 assert.equal(bind(undefined as any,{...candidate,symbol:"ETHUSDT"}).status,"BLOCKED");
 assert.equal(bindStable4NativeH1Observation({
  observation:{...native,runner:"Q102",symbol:"SOLUSDT",route:"HIGH_VOL|SOLUSDT",side:1},
  candidate:{...candidate,sleeve:"Q102",symbol:"SOLUSDT",route:"HIGH_VOL|SOLUSDT",side:"LONG"},
 }).status,"NATIVE_H1_OBSERVED_ONLY");
});

test("181-day Q102 source minimum and PENGU funding cadence remain explicit in source",()=>{
 const q=readFileSync("lib/disdex-quality102-causal-v1-signal.ts","utf8");
 assert.match(q,/const MINIMUM_HISTORY_HOURS = 181 \* 24/);
 const p=readFileSync("lib/pengu-dual-ls-v2.ts","utf8");
 assert.match(p,/export function buildPenguDualLsV2Signal/);
});
