import test from "node:test";
import assert from "node:assert/strict";
import {
 HOUR, createProductionState, planProductionEntry, applyProductionEvent, replayProductionJournal,
 productionGross, productionSnapshot, productionExitSpec, PRODUCTION_EXIT_CATALOG, evaluateProductionExit,
 type Leg, type InitialState,
} from "../lib/v12-v4-production-lifecycle";
import { evaluateV12V4Routes, type V12V4ShadowCandidate } from "../lib/v12-multilogic-v4-shadow";
import { computeProductionH1Features, type FeatureBar } from "../lib/v12-v4-production-features";
const ts=200*HOUR;
const initial:InitialState={equityUsd:1000,foreign:[],holdProtected:false};
function candidate(route="REC_X01_TIME_24H",symbol="ETHUSDT",gross=.1):V12V4ShadowCandidate {
 const base=evaluateV12V4Routes({symbol,sourceSide:"SHORT",sourceSignalTs:ts,age:2,volRatio:.5,er24:.5})[0];
 return {...base,route,family:route.startsWith("REC_Y")?"RECOVERY_Y_REVERSAL":"RECOVERY_X",symbol,requestedGross:gross,effectiveSide:"LONG"};
}
const normalizer:any={normalizeMarketQuantity:async(_s:string,q:number,px:number)=>{
 const quantity=Math.floor((q+1e-10)/.01)*.01;
 return {quantity,notional:quantity*px,stepSize:.01};
}};
async function reserve(state=createProductionState(initial),c=candidate(),eventId="r1"){
 return planProductionEntry(state,{candidate:c,ts,eventId,referencePrice:30,minimumOrderNotionalUsd:5,quantityNormalizer:normalizer,entryAtr:2});
}
test("41 executable exit catalog rows preserve two-pass overrides and one native state exit",()=>{
 assert.equal(PRODUCTION_EXIT_CATALOG.length,41);
 assert.deepEqual(productionExitSpec("FAILED_BREAK_REV_SHORT_6H"),{kind:"TIME",hours:9});
 assert.deepEqual(productionExitSpec("CONT_SHORT_MID_AGE24_48"),{kind:"TIME",hours:3});
 assert.deepEqual(productionExitSpec("REC_X07_TIME_6H"),{kind:"TIME",hours:6});
 assert.deepEqual(productionExitSpec("REC_X06_TIME_12H"),{kind:"TIME",hours:18});
 assert.equal(PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind==="NATIVE").length,1);
});
test("pending reservation, deferred partial fills and restart exactly preserve accounting",async()=>{
 let state=createProductionState(initial),r=await reserve(state);
 state=applyProductionEvent(state,r);
 assert.equal(state.legs[r.leg.id].qty,0);assert.equal(productionGross(state).v12,.1);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:r.leg.id,eventId:"f1",ts:ts+10,qty:2,price:30,feeUsd:.1});
 assert.equal(state.legs[r.leg.id].reservationUsd,40);
 assert.equal(productionGross(state).v12,.1);
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:r.leg.id,eventId:"term",ts:ts+20});
 assert.equal(productionGross(state).v12,.06);
 assert.deepEqual(replayProductionJournal(initial,state.journal),state);
 assert.deepEqual(applyProductionEvent(state,state.journal[1]),state);
 assert.throws(()=>applyProductionEvent(state,{...state.journal[1],ts:ts+1}),/EVENT_ID_CONFLICT/);
 assert.equal(productionSnapshot(state).orderEnabled,false);
});
test("same-symbol partial closes reduce only the selected virtual leg",async()=>{
 let state=createProductionState(initial);
 const r=await reserve(state);state=applyProductionEvent(state,r);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:r.leg.id,eventId:"f1",ts,qty:2,price:30,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:r.leg.id,eventId:"t1",ts});
 const r2=await reserve(state,candidate("REC_X02_TIME_36H"),"r2");state=applyProductionEvent(state,r2);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:r2.leg.id,eventId:"f2",ts,qty:2,price:30,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:r2.leg.id,eventId:"t2",ts});
 state=applyProductionEvent(state,{type:"EXIT_REQUEST",id:r.leg.id,eventId:"x",ts,qty:2});
 state=applyProductionEvent(state,{type:"EXIT_FILL",id:r.leg.id,eventId:"xf1",ts,qty:.5,price:40,feeUsd:.1,cooldownUntil:ts+HOUR});
 assert.equal(state.legs[r.leg.id].qty,1.5);assert.equal(state.legs[r2.leg.id].qty,2);
 assert.equal(state.legs[r.leg.id].realizedUsd,5);
 assert.equal(state.legs[r.leg.id].status,"PENDING_EXIT");
 assert.throws(()=>applyProductionEvent(state,{type:"EXIT_FILL",id:r.leg.id,eventId:"bad",ts,qty:2,price:40,feeUsd:0,cooldownUntil:ts}),/INVALID_EXIT_FILL/);
});
test("existing TSLA and PENGU owners block all V4 netting, pending foreign gross counts",async()=>{
 const state=createProductionState({...initial,foreign:[
 {owner:"V52/V50_POST_OPEN_BASIS",symbol:"TSLAUSDT",side:"LONG",qty:.38,gross:.2,pendingGross:.1,crypto:false},
 {owner:"PENGU",symbol:"PENGUUSDT",side:"SHORT",qty:7718,gross:1,pendingGross:.1,crypto:true}]});
 await assert.rejects(reserve(state,candidate("REC_X01_TIME_24H","PENGUUSDT")),/FOREIGN_SYMBOL_OWNERSHIP/);
 await assert.rejects(reserve(state,candidate("REC_X01_TIME_24H","TSLAUSDT")),/FOREIGN_SYMBOL_OWNERSHIP/);
 assert.equal(productionGross(state).crypto,1.1);assert.ok(Math.abs(productionGross(state).total-1.4)<1e-12);
});
test("precision floors; protected hold and worst-case cap reservations fail closed",async()=>{
 const r=await reserve();assert.equal(r.leg.requestedQty,3.33);
 await assert.rejects(reserve(createProductionState({...initial,holdProtected:true})),/HOLD_PROTECTED/);
 const state=createProductionState({...initial,foreign:[{owner:"PENGU",symbol:"PENGUUSDT",side:"SHORT",qty:7718,gross:3.45,pendingGross:0,crypto:true}]});
 await assert.rejects(reserve(state),/CRYPTO_GROSS_CAP/);
 const bad:any={normalizeMarketQuantity:async()=>({quantity:4,notional:120,stepSize:.01})};
 await assert.rejects(planProductionEntry(createProductionState(initial),{candidate:candidate(),ts,eventId:"bad",referencePrice:30,minimumOrderNotionalUsd:5,quantityNormalizer:bad}),/normalization increased/);
});
test("ATR stop-first same-bar ambiguity, gap-stop and H1 cutoff are executable",()=>{
 const c=candidate("REC_X13_TP1.5_SL1_H24");
 const leg:Leg={id:"leg",candidate:c,qty:1,entryNotional:100,requestedQty:1,reservationUsd:0,entryTs:ts,entryAtr:10,status:"OPEN",exitRemainingQty:0,realizedUsd:0,feesUsd:0,fundingUsd:0};
 const b={openTs:ts,open:100,high:120,low:85,close:100};
 assert.equal(evaluateProductionExit(leg,b,ts+HOUR)?.price,90);
 assert.equal(evaluateProductionExit(leg,{...b,open:80,low:75,close:85},ts+HOUR)?.price,80);
 assert.throws(()=>evaluateProductionExit(leg,b,ts+HOUR-1),/CAUSALLY_CLOSED/);
});
test("time deadline requires available exact next open; future open forbidden",()=>{
 const leg:Leg={id:"l",candidate:candidate(),qty:1,entryNotional:100,requestedQty:1,reservationUsd:0,entryTs:ts,status:"OPEN",exitRemainingQty:0,realizedUsd:0,feesUsd:0,fundingUsd:0};
 const b={openTs:ts+23*HOUR,open:100,high:101,low:99,close:100},at=ts+24*HOUR;
 assert.throws(()=>evaluateProductionExit(leg,b,at),/NEXT_OPEN_MISSING/);
 assert.equal(evaluateProductionExit(leg,b,at,{ts:at,price:105})?.price,105);
});
function bars(end:number,start=150):FeatureBar[]{
 return Array.from({length:end/HOUR-start},(_,i)=>{
 const t=(start+i)*HOUR,close=100+i*.25;
 return {openTs:t,open:close-.1,high:close+1,low:close-1,close,quoteVolume:100+i};
 });
}
test("closed H1 formulas ignore future bars, reject gaps, and normalize effective side",()=>{
 const b=bars(ts),btc=b.map(x=>({...x,close:200,open:200,high:201,low:199}));
 const f=computeProductionH1Features("ETHUSDT","LONG",ts,ts,b,btc);
 const future={openTs:ts,open:1,high:1e6,low:.1,close:1e5,quoteVolume:1e10};
 assert.deepEqual(computeProductionH1Features("ETHUSDT","LONG",ts,ts,[...b,future],btc),f);
 assert.throws(()=>computeProductionH1Features("ETHUSDT","LONG",ts,ts,b.filter(x=>x.openTs!==ts-20*HOUR),btc),/H1_GAP/);
 const short=computeProductionH1Features("ETHUSDT","SHORT",ts,ts,b,btc);
 assert.equal(short.features.bodyAtr,-f.features.bodyAtr!);
 assert.equal(short.features.rangeLoc24,1-f.features.rangeLoc24!);
 assert.equal(f.maxFeatureCloseTsMs,ts);
 assert.throws(()=>computeProductionH1Features("ETHUSDT","LONG",ts,ts-1,b,btc),/BEFORE_ENTRY/);
});

test("mark-to-market gross uses current equity and exact quantities, and journal rejects gaps",async()=>{
 let state=createProductionState(initial),r=await reserve(state);
 state=applyProductionEvent(state,r);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:r.leg.id,eventId:"f1",ts,qty:2,price:30,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:r.leg.id,eventId:"t1",ts});
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"m",ts,equityUsd:500,prices:{ETHUSDT:40}});
 assert.equal(productionGross(state).v12,.16);
 assert.throws(()=>applyProductionEvent(state,{type:"EXIT_BAR",id:r.leg.id,eventId:"gap",ts:ts+2*HOUR,
   bar:{openTs:ts+HOUR,open:40,high:41,low:39,close:40}}),/STREAM_GAP/);
 state=applyProductionEvent(state,{type:"EXIT_BAR",id:r.leg.id,eventId:"b0",ts:ts+HOUR,
   bar:{openTs:ts,open:40,high:41,low:39,close:40}});
 assert.equal(state.legs[r.leg.id].lastExitBarTs,ts);
 assert.deepEqual(replayProductionJournal(initial,state.journal),state);
});
test("offline CLI evaluates causal robust candidate, persists explicit fills, and restarts",async()=>{
 const {evaluateOfflineInput}=await import("../scripts/v12-v4-production-offline");
 const sym=Array.from({length:50},(_,i)=>{
  const close=100-i*.1;
  return {openTs:(150+i)*HOUR,open:close+.05,high:close+.15,low:close-.15,close,quoteVolume:200-i};
 });
 const btc=sym.map(x=>({...x,open:200,high:200.15,low:199.85,close:200}));
 const out=await evaluateOfflineInput({initial,venueFilters:{ETHUSDT:{stepSize:.01,minQty:.01,minNotional:5}},actions:[
  {type:"CANDIDATES",input:{source:{symbol:"ETHUSDT",side:"SHORT",eligibleSourceEntryTs:ts,decisionTs:ts,
    momentumConditionAgeHours:30,sourceEngine:"buildV12Signals",sourceParityVerified:false},
    decisionTs:ts,symbolBars:sym,btcBars:btc}},
  {type:"PLAN",route:"CONT_SHORT_MID_AGE24_48",symbol:"ETHUSDT",ts,eventId:"r",referencePrice:95},
 ]});
 const l=Object.values(out.legs)[0] as Leg;
 assert.equal(l.qty,0);assert.equal(out.orderEnabled,false);assert.equal(out.nativeSignalGeneratorCertified,false);
 const restart=await evaluateOfflineInput({initial:out.initial,journal:out.journal,actions:[
  {type:"ENTRY_FILL",id:l.id,eventId:"fill",ts,qty:.1,price:95,feeUsd:.01},
  {type:"ENTRY_TERMINAL",id:l.id,eventId:"terminal",ts},
 ]});
 assert.equal(restart.legs[l.id].qty,.1);assert.equal(restart.legs[l.id].reservationUsd,0);
 await assert.rejects(evaluateOfflineInput({initial,actions:[{type:"PLAN",route:l.candidate.route,symbol:"ETHUSDT",ts,eventId:"bad",referencePrice:95}]}),/CAUSAL_CANDIDATE_ADAPTER/);
});

test("reversal preemption waits for actual closes and cannot delete an opposing virtual leg",async()=>{
 let state=createProductionState(initial),r=await reserve(state);
 state=applyProductionEvent(state,r);
 const c={...candidate("REC_Y15_REV_D0_T3"),effectiveSide:"SHORT" as const};
 await assert.rejects(reserve(state,c,"reverse"),/PREEMPT_CLOSE_FILL_REQUIRED/);
 assert.equal(state.legs[r.leg.id].status,"PENDING_ENTRY");
 assert.equal(state.legs[r.leg.id].reservationUsd,100);
});
test("equity DD admission fails closed and existing virtual-leg exits remain available",async()=>{
 let state=createProductionState(initial);
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"dd",ts,equityUsd:780,prices:{}});
 assert.ok(state.maxDrawdown>0.21);
 await assert.rejects(reserve(state),/DD_OVER_OPERATOR_LIMIT/);
 const r=await reserve(createProductionState(initial));
 assert.throws(()=>applyProductionEvent(state,r),/RESERVATION_RECHECK_FAILED/);
});
test("closing records cooldown; caller cannot release foreign ownership or forge reservations",async()=>{
 let state=createProductionState(initial),r=await reserve(state);state=applyProductionEvent(state,r);
 state=applyProductionEvent(state,{type:"ENTRY_FILL",id:r.leg.id,eventId:"f",ts,qty:.1,price:30,feeUsd:0});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:r.leg.id,eventId:"t",ts});
 state=applyProductionEvent(state,{type:"EXIT_REQUEST",id:r.leg.id,eventId:"x",ts,qty:.1});
 state=applyProductionEvent(state,{type:"EXIT_FILL",id:r.leg.id,eventId:"xf",ts,qty:.1,price:30,feeUsd:0,cooldownUntil:ts+2*HOUR});
 const c={...candidate(),sourceSignalTs:ts+HOUR,eligibleEntryTs:ts+HOUR};
 await assert.rejects(planProductionEntry(state,{candidate:c,ts:ts+HOUR,eventId:"cool",referencePrice:30,minimumOrderNotionalUsd:5,quantityNormalizer:normalizer}),/COOLDOWN/);
 assert.throws(()=>applyProductionEvent(createProductionState(initial),{...r,leg:{...r.leg,qty:999}}),/INVALID_RESERVATION/);
});

test("native G3 reuses frozen production trailing levels, persisted state, and mandatory native ATR evidence",async()=>{
 const c={...candidate("REC_G3_LATE_BTC_REL"),family:"RECOVERY_G",effectiveSide:"LONG" as const};
 await assert.rejects(reserve(createProductionState(initial),c),/NATIVE_SOURCE_ATR_EVIDENCE_REQUIRED/);
 const leg:Leg={id:"native",candidate:c,qty:1,entryNotional:100,requestedQty:1,reservationUsd:0,
  entryTs:ts,entryAtr:10,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",status:"OPEN",
  exitRemainingQty:0,realizedUsd:0,feesUsd:0,fundingUsd:0};
 const {evaluateNativeProductionExit}=await import("../lib/v12-v4-production-lifecycle");
 const b0={openTs:ts,open:100,high:110,low:99,close:105};
 const n0=evaluateNativeProductionExit(leg,b0,ts+HOUR);
 assert.equal(n0.stop,75.23);assert.equal(n0.decision,null);
 const n1=evaluateNativeProductionExit({...leg,nativeStop:n0.stop,nativePeak:n0.peak,previousExitBar:b0},
  {openTs:ts+HOUR,open:105,high:111,low:104,close:110},ts+2*HOUR,{ts:ts+2*HOUR,price:108});
 assert.equal(n1.stop,109);assert.equal(n1.decision?.reason,"TRAILING_CROSSED_BEFORE_REPLACEMENT");
 assert.equal(n1.decision?.price,108);
 assert.throws(()=>evaluateNativeProductionExit(leg,b0,ts),/CAUSALLY_CLOSED/);
});
test("claimed source parity never certifies native generation or unlocks order authority",async()=>{
 const {evaluateOfflineInput}=await import("../scripts/v12-v4-production-offline");
 await assert.rejects(evaluateOfflineInput({initial,orderEnabled:true}),/AUTHORITY_FORBIDDEN/);
 await assert.rejects(evaluateOfflineInput({initial,actions:[{orderEnabled:true}]}),/AUTHORITY_FORBIDDEN/);
 await assert.rejects(evaluateOfflineInput({initial,policyId:"OTHER"}),/POLICY_MISMATCH/);
 const b=bars(ts),btc=b.map(x=>({...x,open:200,high:201,low:199,close:200}));
 const out=await evaluateOfflineInput({initial,actions:[{type:"CANDIDATES",input:{
  source:{symbol:"ETHUSDT",side:"LONG",eligibleSourceEntryTs:ts,decisionTs:ts,momentumConditionAgeHours:2,
    sourceEngine:"buildV12Signals",sourceParityVerified:true},decisionTs:ts,symbolBars:b,btcBars:btc}}]});
 assert.equal(out.featureAudits[0].sourceParityVerified,true);
 assert.equal(out.featureAudits[0].nativeSourceParityCertified,false);
 assert.equal(out.nativeSignalGeneratorCertified,false);
 assert.equal(out.orderEnabled,false);assert.equal(out.realOrderEnabledV4,0);
 assert.equal(out.featureAudits[0].policyTemporalCausal,false);
});
