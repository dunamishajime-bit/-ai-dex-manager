import test from "node:test";
import assert from "node:assert/strict";
import {attachAdoptedR21CandidateBatch,adoptedR21M5Exit,adoptedR21StopPrice} from "../lib/v12-v4-adopted-r21";
import {planProductionEntry,applyProductionEvent,createProductionState,replayProductionJournal,productionExitSpec,PRODUCTION_EXIT_CATALOG,type State} from "../lib/v12-v4-production-lifecycle";
import {appendV4ClosedExitBars} from "../lib/v12-v4-live-exit-feed";
import {assertV4CertifiedSource,assertV4CertifiedOrder} from "../lib/v12-v4-certified-gates";
import {approvedV4TimeStopQuote} from "../lib/v12-v4-time-stop-approval";
import type {V4LiveDecisionSnapshot,V4VenueH1Bar} from "../lib/v12-v4-live-candidate-builder";
import type {V12V4ShadowCandidate} from "../lib/v12-multilogic-v4-shadow";
import type {Candidate,Route} from "../lib/stable4-research-decision-observation";
const H=3600000,M=300000,t=200*H,sha="a".repeat(40);
const initial={equityUsd:1000,foreign:[],holdProtected:false};
const h1=Array.from({length:15},(_,i)=>({openTs:t-(15-i)*H,open:100,high:101,low:99,close:100,quoteVolume:10,volume:1})) as V4VenueH1Bar[];
const base={schema:"v12-v4-live-decision/v1",candidateCount:0,candidates:[],entryAtrByCandidate:{},errors:[],
 sourceFingerprint:"b".repeat(64),orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0,
 capturedAtMs:t+60000,decisionTs:t} as unknown as V4LiveDecisionSnapshot;
function raw(route:Route="R21_OLD24",symbol="ETH",ts=t):Candidate{
 return {id:[route,symbol,ts].join("|"),route,symbol:symbol+"USDT",ts,gross:.30,side:"SHORT"};
}
function candidate(route:Route="R21_OLD24",symbol="ETH"):V12V4ShadowCandidate{
 const a=attachAdoptedR21CandidateBatch(base,{candidates:[raw(route,symbol)]},{[symbol]:h1},t+60000);
 assert.equal(a.candidateCount,1);return a.candidates[0];
}
function legacy(side:"LONG"|"SHORT"){return {...candidate(),route:"REC_Y06_REV_D0_T72",family:"RECOVERY_Y_REVERSAL",effectiveSide:side};}
const normalizer={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,stepSize:.001})} as any;
async function reserve(s:State,c:V12V4ShadowCandidate,eventId="r1",min=5){
 return planProductionEntry(s,{candidate:c,ts:c.eligibleEntryTs,observedAtMs:c.eligibleEntryTs+60000,eventId,referencePrice:100,minimumOrderNotionalUsd:min,entryAtr:2,quantityNormalizer:normalizer});
}
async function open(route:Route="R21_OLD24"){
 let s=createProductionState(initial);const r=await reserve(s,candidate(route));
 s=applyProductionEvent(s,r);
 s=applyProductionEvent(s,{type:"ENTRY_FILL",eventId:"f",id:r.leg.id,ts:t+60000,qty:3,price:100,feeUsd:0});
 s=applyProductionEvent(s,{type:"ENTRY_TERMINAL",eventId:"term",id:r.leg.id,ts:t+60000});
 return {s,id:r.leg.id};
}
const m5=(ts:number,o=100,h=105,l=95,c=100,at=ts+M)=>({openTs:ts,open:o,high:h,low:l,close:c,observedAt:at});

test("selected R21 replaces only legacy Y06 SHORT, keeps long and old 41 route certificate separate",()=>{
 const short=legacy("SHORT"),long=legacy("LONG");
 const b={...base,candidates:[short,long],candidateCount:2};
 const x=attachAdoptedR21CandidateBatch(b,{candidates:[raw()]},{ETH:h1},t+60000);
 assert.equal(x.adoptedR21?.sourceStatus,"AVAILABLE");
 assert.equal(x.adoptedR21?.legacyCertificateAccepted,false);
 assert.equal(x.candidateCount,2);
 assert.ok(x.candidates.some(c=>c.route==="REC_Y06_REV_D0_T72"&&c.effectiveSide==="LONG"));
 assert.ok(!x.candidates.some(c=>c.route==="REC_Y06_REV_D0_T72"&&c.effectiveSide==="SHORT"));
 const r=x.candidates.find(c=>c.route==="R21_OLD24")!;
 assert.equal(r.requestedGross,.30);assert.equal(r.rank,999);
 assert.equal(x.entryAtrByCandidate["ETHUSDT|R21_OLD24|SHORT|"+t],2);
 assert.equal(PRODUCTION_EXIT_CATALOG.length,41);
 assert.equal(productionExitSpec("R21_OLD24").hours,24);
 assert.equal(productionExitSpec("R21_NEW48").hours,48);
 assert.equal(x.orderEnabled,false);
});
test("missing, stale, malformed and gapped R21 source never falls back to old Y06",()=>{
 const b={...base,candidates:[legacy("SHORT")],candidateCount:1};
 for(const [input,bars,at] of [
  [undefined,{ETH:h1},t+60000],
  [{candidates:[raw()]},{ETH:h1},t+16*60000],
  [{candidates:[{...raw(),gross:.25}]},{ETH:h1},t+60000],
  [{candidates:[raw()]},{ETH:h1.slice(1)},t+60000],
 ] as const){
  const x=attachAdoptedR21CandidateBatch(b,input as any,bars as any,at);
  assert.equal(x.candidateCount,0);assert.ok(x.errors.length);assert.equal(x.adoptedR21?.sourceStatus,"UNAVAILABLE");
 }
 const empty=attachAdoptedR21CandidateBatch(b,{candidates:[]},{ETH:h1},t+60000);
 assert.equal(empty.candidateCount,0);assert.equal(empty.errors.length,0);
});
test("durable reservation enforces 0.30x and a single slot across OLD24 and NEW48, including pending",async()=>{
 const s=createProductionState(initial),r=await reserve(s,candidate());
 assert.equal(r.leg.reservationUsd,300);
 await assert.rejects(reserve(s,{...candidate(),requestedGross:.25}),/R21_FROZEN_CANDIDATE_CONTRACT/);
 await assert.rejects(reserve(s,candidate(),"r-min",301),/MIN_LIFT_BLOCKED/);
 const other=await reserve(s,candidate("R21_NEW48","SOL"),"r-other");
 const pending=applyProductionEvent(s,r);
 await assert.rejects(reserve(pending,candidate("R21_NEW48","SOL"),"r2"),/R21_SINGLE_SLOT_OCCUPIED/);
 assert.throws(()=>applyProductionEvent(pending,other),/RESERVATION_OWNERSHIP_RECHECK_FAILED/);
 assert.deepEqual(replayProductionJournal(initial,pending.journal),pending);
});
test("OLD24 no TP or legacy four-rule early exit, NEW48 exact TP8, both STOP8 first",async()=>{
 assert.equal(adoptedR21StopPrice("R21_OLD24",100),108);
 assert.equal(adoptedR21M5Exit("R21_OLD24",t,100,m5(t,100,105,90),t,t+M),null);
 assert.equal(adoptedR21M5Exit("R21_NEW48",t,100,m5(t,90,101,89),t,t+M)?.price,92);
 assert.equal(adoptedR21M5Exit("R21_NEW48",t,100,m5(t,109,110,90),t,t+M)?.price,109);
 assert.equal(adoptedR21M5Exit("R21_NEW48",t,100,m5(t,100,108,90),t,t+M)?.reason,"R21_HARD_STOP8");
 const a=await open("R21_NEW48");
 const next=appendV4ClosedExitBars(a.s,a.id,{closed:[],closedM5:[m5(t,100,105,90)]},t+M);
 assert.equal(next.legs[a.id].plannedExit?.reason,"R21_TARGET");
 assert.equal(next.legs[a.id].plannedExit?.price,92);
 assert.equal(next.legs[a.id].r21LastM5OpenTs,t);
 assert.deepEqual(replayProductionJournal(initial,next.journal),next);
});
test("OLD24 time exit requires contiguous M5 coverage and exact deadline open",async()=>{
 const a=await open();
 const until=t+24*H;
 const closedM5=Array.from({length:288},(_,i)=>m5(t+i*M,100,105,95,100,until));
 const closed=Array.from({length:24},(_,i)=>({openTs:t+i*H,open:100,high:105,low:95,close:100}));
 assert.throws(()=>appendV4ClosedExitBars(a.s,a.id,{closed},until),/R21_M5_EXIT_SOURCE_REQUIRED/);
 assert.throws(()=>appendV4ClosedExitBars(a.s,a.id,{closed,closedM5:closedM5.slice(1)},until),/M5_GAP/);
 assert.throws(()=>appendV4ClosedExitBars(a.s,a.id,{closed,closedM5},until),/NEXT_OPEN_MISSING/);
 const x=appendV4ClosedExitBars(a.s,a.id,{closed,closedM5,nextOpen:{ts:until,price:97}},until);
 assert.equal(x.legs[a.id].plannedExit?.exitTs,until);assert.equal(x.legs[a.id].plannedExit?.price,97);
 assert.equal(x.legs[a.id].plannedExit?.reason,"TIME");
 assert.equal(x.legs[a.id].fourRuleState?.shortInitialExitFired,false);
});
test("partial close does not free R21 slot; actual final fill establishes shared 12h cooldown",async()=>{
 const a=await open(),at=t+M;
 let s=applyProductionEvent(a.s,{type:"EXIT_REQUEST",eventId:"exit",id:a.id,ts:at,qty:3});
 s=applyProductionEvent(s,{type:"EXIT_FILL",eventId:"partial",id:a.id,ts:at+5000,qty:1,price:101,feeUsd:0,cooldownUntil:at+5000,actualFillTs:at});
 assert.equal(s.legs[a.id].status,"PENDING_EXIT");
 assert.equal(s.cooldown["ETHUSDT:R21"],undefined);
 assert.throws(()=>applyProductionEvent(s,{type:"EXIT_FILL",eventId:"missing-clock",id:a.id,ts:at+6000,qty:2,price:101,feeUsd:0,cooldownUntil:at+6000}),/R21_ACTUAL_CLOSE_FILL_CLOCK_REQUIRED/);
 s=applyProductionEvent(s,{type:"EXIT_FILL",eventId:"full",id:a.id,ts:at+6000,qty:2,price:101,feeUsd:0,cooldownUntil:at+6000,actualFillTs:at+1000});
 assert.equal(s.legs[a.id].status,"CLOSED");
 assert.equal(s.cooldown["ETHUSDT:R21"],at+1000+12*H);
 const c={...candidate("R21_NEW48"),eligibleEntryTs:t+H,sourceSignalTs:t+H};
 await assert.rejects(reserve(s,c,"r-cool"),/COOLDOWN/);
 assert.deepEqual(replayProductionJournal(initial,s.journal),s);
});
test("legacy 41-route certificate and TIME37 STOP approval never authorize new R21",async()=>{
 const x=attachAdoptedR21CandidateBatch(base,{candidates:[raw()]},{ETH:h1},t+60000);
 await assert.rejects(assertV4CertifiedSource(sha,x),/R21_EXACT_NEW_ROUTE_SOURCE_CERT_REQUIRED/);
 await assert.rejects(assertV4CertifiedOrder(sha,{legId:"ETHUSDT:R21_OLD24:SHORT:"+t,action:"ENTRY",sequence:0,symbol:"ETHUSDT",positionSide:"SHORT",quantity:1,price:100,signalTs:t}),/R21_EXACT_NEW_ROUTE_ORDER_CERT_REQUIRED/);
 assert.throws(()=>approvedV4TimeStopQuote({route:"R21_NEW48",side:"SHORT",signedAverageEntryFill:100,approval:{} as any}),/R21_EXACT_NEW_ROUTE_STOP_APPROVAL_REQUIRED/);
});
