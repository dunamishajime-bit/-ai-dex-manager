import test from "node:test";import assert from "node:assert/strict";
import {coordinateStable4DryCandidates} from "../lib/stable4-seven-runner-dry-coordinator";
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
 f("V","V4","ETHUSDT","R21_OLD24"),f("Q","Q102","AVAXUSDT","BASE",.5),f("P","PENGU","PENGUUSDT","BASE",.75),f("S","V52","AMZNUSDT","V50",2)];
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
