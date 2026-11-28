import test from "node:test";import assert from "node:assert/strict";
import {coordinateStable4DryCandidates} from "../lib/stable4-seven-runner-dry-coordinator";
import {observeStable4ClosedAsterM5} from "../lib/stable4-native-aster-m5-causal-observation";
import type {SourceObservation} from "../lib/stable4-native-pengu-q102-source-observer";
import {initializePortfolioDd} from "../lib/stable4-portfolio-cumulative-dd";
import {initializeRunnerCumulativeDd,RUNNER_DD_IDS} from "../lib/disdex-runner-cumulative-dd";
const H=3600000,t=200*H,sha="a".repeat(40);
const f=(id:string,sleeve:any,symbol:string,route="BASE",gross=.3)=>({
 id,sleeve,symbol,route,gross,side:route.startsWith("R21_")?"SHORT" as const:"LONG" as const,
 entryTs:t,sourceReleaseSha:sha,sourceDecisionTs:t,sourceComplete:true});
const portfolio=initializePortfolioDd({atMs:t,releaseSha:sha,proofId:"portfolio1",equity:10000,externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
const net=Object.fromEntries(RUNNER_DD_IDS.map(x=>[x,0])) as any;
const dd=initializeRunnerCumulativeDd({atMs:t,exactReleaseSha:sha,proofId:"runner1",accountEquityUsd:10000,externalNetFlowUsd:0,netMtmPnlUsd:net,provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"});
const base={asof:t,releaseSha:sha,portfolioDdState:portfolio,ddState:dd,equityUsd:10000,
 allOwnerPositionsReconciled:true,r21SlotStateReconciled:true,lastR21ExitBySymbol:{},
 sourcePins:Object.fromEntries(RUNNER_DD_IDS.map(x=>[x,sha])) as Record<typeof RUNNER_DD_IDS[number],string>,open:[]};
test("seven native strategies sorted by frozen R26 precedence, no order authority",()=>{
 const a=[f("H","HYPE","ADAUSDT"),f("I","IDLE","JUPUSDT"),f("F","FET","FETUSDT","BASE",.7),
 f("V","V4","ETHUSDT","R21_OLD24"),f("Q","Q102","AVAXUSDT","BASE",.5),f("P","PENGU","PENGUUSDT","BASE",.75),f("S","V52","AMZN","V50",2)];
 const r=coordinateStable4DryCandidates({...base,candidates:a});
 assert.deepEqual(r.decisions.map(x=>x.candidateId),["S","P","V","Q","F","H","I"]);
 assert.deepEqual(r.decisions.map(x=>x.status),["RETAINED_OFFLINE","RETAINED_OFFLINE","RETAINED_OFFLINE","RETAINED_OFFLINE","RETAINED_OFFLINE","BLOCKED","BLOCKED"]);
 assert.equal(r.offlinePending.length,5);assert.equal(r.orderAuthority,false);
});
test("R21 one slot, cooldown, shared reconciliation, RENDER removal",()=>{
 const candidates=[f("A","V4","ETHUSDT","R21_OLD24"),f("B","V4","SOLUSDT","R21_NEW48")];
 const r=coordinateStable4DryCandidates({...base,candidates});
 assert.deepEqual(r.decisions.map(x=>x.status),["RETAINED_OFFLINE","BLOCKED"]);
 assert.equal(r.decisions[1].reason,"R21_SINGLE_SLOT_CONTRACT");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[candidates[0]],r21SlotStateReconciled:false}).decisions[0].reason,"R21_SLOT_NOT_RECONCILED");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[candidates[0]],lastR21ExitBySymbol:{ETHUSDT:t-3*H}}).decisions[0].reason,"R21_COOLDOWN_12H");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[f("I","IDLE","RENDERUSDT","IDLE_RENDER_RELATIVE_SHORT")]}).decisions[0].reason,"IDLE_R26_RENDER_REMOVED");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[candidates[0]],allOwnerPositionsReconciled:false}).decisions[0].reason,"ALL_OWNER_POSITIONS_UNVERIFIED");
});
test("M5-confirmed PENGU candidate retains its H1 decision timestamp",()=>{
 const at=t+5*60000;
 const p2=initializePortfolioDd({atMs:at,releaseSha:sha,proofId:"p2",equity:10000,externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
 const d2=initializeRunnerCumulativeDd({atMs:at,exactReleaseSha:sha,proofId:"r2",accountEquityUsd:10000,externalNetFlowUsd:0,netMtmPnlUsd:net,provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"});
 const candidate={...f("P91","PENGU","PENGUUSDT","SHORT_V20",.75),entryTs:at,side:"SHORT" as const};
 const r=coordinateStable4DryCandidates({...base,asof:at,portfolioDdState:p2,ddState:d2,candidates:[candidate]});
 assert.equal(r.decisions[0].status,"RETAINED_OFFLINE");
 assert.equal(r.orderAuthority,false);
});
test("same source timestamp, duplicate candidate and unknown owner fail closed",()=>{
 const a=f("V","V4","ETHUSDT","R21_OLD24");
 const r=coordinateStable4DryCandidates({...base,candidates:[a,a]});
 assert.equal(r.decisions[1].reason,"CANDIDATE_DUPLICATE");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[{...a,sourceDecisionTs:t-H}]}).decisions[0].reason,"NATIVE_SOURCE_UNVERIFIED");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[a],sourcePins:{...base.sourcePins,V4:"b".repeat(40)}}).decisions[0].reason,"NATIVE_SOURCE_UNVERIFIED");
 assert.equal(coordinateStable4DryCandidates({...base,candidates:[a],open:[{id:"missing",symbol:"BTCUSDT",sleeve:"V4",route:"X",gross:0,stock:false,status:"UNKNOWN"}]}).decisions[0].reason,"ALL_OWNER_POSITIONS_UNVERIFIED");
});


test("real V52 stock and crypto use distinct symbol grammar with shared gross",()=>{
 const good=coordinateStable4DryCandidates({...base,candidates:[
  f("S","V52","AMZN","V50",2),
  f("C","PENGU","PENGUUSDT","SHORT_V20",.75),
 ]});
 assert.deepEqual(good.decisions.map(x=>x.status),["RETAINED_OFFLINE","RETAINED_OFFLINE"]);
 const venue=coordinateStable4DryCandidates({...base,candidates:[f("S","V52","AMZNUSDT","V50",2)]});
 assert.equal(venue.decisions[0].status,"RETAINED_OFFLINE");
 const fake=coordinateStable4DryCandidates({...base,candidates:[f("S","V52","BADSTOCKUSDT","V50",2)]});
 assert.equal(fake.decisions[0].reason,"SOURCE_INVALID");
 const aliases=coordinateStable4DryCandidates({...base,candidates:[
  f("V1","V52","AMZN","V50",2), f("V2","V52","AMZNUSDT","V11",1),
 ]});
 assert.equal(aliases.decisions[1].reason,"SAME_SYMBOL_OWNERSHIP_UNRESOLVED");
 assert.equal(fake.orderAuthority,false);
});

test("native H1 to M5 source mode never books an ASTER fill from public-candle volume",()=>{
 const at=t+5*60_000,archive="b".repeat(64);
 const portfolioM5=initializePortfolioDd({atMs:at,releaseSha:sha,proofId:"m5-p",equity:10000,externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
 const ddM5=initializeRunnerCumulativeDd({atMs:at,exactReleaseSha:sha,proofId:"m5-r",accountEquityUsd:10000,externalNetFlowUsd:0,netMtmPnlUsd:net,provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"});
 const cand={...f("P2","PENGU","PENGUUSDT","SHORT_V20",.75),side:"SHORT" as const,entryTs:at,sourceDecisionTs:t};
 const nativeH1:SourceObservation={
  status:"NATIVE_ENTRY_OBSERVED",reason:"NATIVE_H1_SIGNAL_ONLY_M5_UNCONFIRMED",
  runner:"PENGU",symbol:"PENGUUSDT",side:-1,sourcePin:sha,sourceDataCutoffTs:t-H,
  decisionTs:t,gross:cand.gross,route:"SHORT_V20",orderAuthority:false,asterM5EntryConfirmed:false,
 };
 const observation=(volume:number)=>observeStable4ClosedAsterM5({
  candidate:{...cand,entryTs:t},
  h1Observation:nativeH1,observedAtMs:at,windowMinutes:5,
  venue:"ASTER_PUBLIC_KLINES",archivePins:[archive],
  bars:[{symbol:"PENGUUSDT",archiveSha256:archive,openTime:t,
         closeTime:at-1,open:100,high:101,low:99,close:100.5,
         volume,trades:volume===0?0:3}],
 });
 const strict=(proofs:Record<string,ReturnType<typeof observation>>={})=>coordinateStable4DryCandidates({
  ...base,asof:at,portfolioDdState:portfolioM5,ddState:ddM5,
  candidates:[cand],requireNativeM5Evidence:true,m5EvidenceByCandidateId:proofs,
 });
 assert.equal(strict().decisions[0].reason,"NATIVE_H1_M5_SOURCE_EVIDENCE_MISSING");
 const positive=observation(10);
 assert.equal(positive.status,"M5_TAPE_OBSERVED_ONLY");
 const result=strict({P2:positive});
 assert.equal(result.decisions[0].status,"BLOCKED");
 assert.equal(result.decisions[0].reason,"ASTER_M5_VOLUME_NOT_CERTIFIED_EXECUTABLE_FILL");
 assert.equal(result.offlinePending.length,0);
 assert.equal(result.orderAuthority,false);
 assert.equal(strict({P2:observation(0)}).decisions[0].reason,"ASTER_M5_ZERO_VOLUME_NO_EXECUTION_PROOF");
 assert.equal(strict({P2:{...positive,venueFillCertified:true as any}}).decisions[0].reason,"NATIVE_H1_M5_SOURCE_EVIDENCE_INVALID");
 assert.equal(strict({P2:{...positive,observedAtMs:at+300_000}}).decisions[0].reason,"NATIVE_H1_M5_SOURCE_EVIDENCE_INVALID");
 assert.equal(strict({P2:{...positive,symbol:"BTCUSDT"}}).decisions[0].reason,"NATIVE_H1_M5_SOURCE_EVIDENCE_INVALID");
});
