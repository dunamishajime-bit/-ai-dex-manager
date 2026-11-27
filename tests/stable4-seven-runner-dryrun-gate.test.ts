import {initializePortfolioDd,advancePortfolioDd} from "../lib/stable4-portfolio-cumulative-dd";
import test from "node:test";import assert from "node:assert/strict";
import {evaluateStable4DryEntry,evaluateR21ResearchExit} from "../lib/stable4-seven-runner-dryrun-gate";
import {initializeRunnerCumulativeDd,advanceRunnerCumulativeDd,RUNNER_DD_IDS} from "../lib/disdex-runner-cumulative-dd";
const H=3600000,M=300000,sha="a".repeat(40),t=200*H;
const pnl=Object.fromEntries(RUNNER_DD_IDS.map(x=>[x,0])) as any;
const baseline={atMs:t,exactReleaseSha:sha,proofId:"signed-001",accountEquityUsd:1000,externalNetFlowUsd:0,netMtmPnlUsd:pnl,provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"} as const;
const base=initializeRunnerCumulativeDd(baseline);
const portfolio=initializePortfolioDd({atMs:t,releaseSha:sha,proofId:"portfolio-initial",equity:1000,externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
const c={id:"A",sleeve:"V4" as const,symbol:"ETHUSDT",side:"SHORT" as const,gross:.3,route:"R21_OLD24",entryTs:t};
const x={candidate:c,open:[],equityUsd:1000,asof:t+60000,releaseSha:sha,ddState:base,portfolioDdState:portfolio};
test("no DD proof, stale proof, 31% DD all fail closed",()=>{
 assert.equal(evaluateStable4DryEntry({...x,ddState:undefined}).reason,"RUNNER_DD_SOURCE_UNAVAILABLE");
 assert.equal(evaluateStable4DryEntry({...x,asof:t+3*M}).reason,"PORTFOLIO_DD_STALE_OR_INVALID");
 const after=advanceRunnerCumulativeDd(base,{...baseline,atMs:t+H,proofId:"signed-002",netMtmPnlUsd:{...pnl,V4:-310},accountEquityUsd:690});
 const result=evaluateStable4DryEntry({...x,ddState:after,asof:t+H,candidate:{...c,entryTs:t+H}});
 assert.equal(result.reason,"PORTFOLIO_DD_STALE_OR_INVALID");assert.equal(result.orderAuthority,false);
});
test("same-symbol unresolved, R21 occupied, V4/crypto/total caps and known-equal DD",()=>{
 assert.equal(evaluateStable4DryEntry(x).status,"ELIGIBLE_OFFLINE");
 const y={id:"X",sleeve:"PENGU" as const,symbol:"ETHUSDT",gross:.5,stock:false,status:"OPEN" as const,route:"SHORT_V20"};
 assert.equal(evaluateStable4DryEntry({...x,open:[y]}).reason,"SAME_SYMBOL_OWNERSHIP_UNRESOLVED");
 assert.equal(evaluateStable4DryEntry({...x,open:[{...y,symbol:"SOLUSDT",route:"R21_OLD24"}]}).reason,"R21_SINGLE_SLOT_CONTRACT");
 assert.equal(evaluateStable4DryEntry({...x,open:[{...y,symbol:"SOLUSDT",sleeve:"V4",gross:1.8}]}).reason,"V4_GROSS_CAP");
 assert.equal(evaluateStable4DryEntry({...x,open:[{...y,symbol:"SOLUSDT",gross:2.9}]}).reason,"SHARED_GROSS_CAP");
});
test("R21 STOP8 precedes TP8 if both touched; worse-open gap; exact H24 time",()=>{
 const bars=[{ts:t,open:100,high:109,low:88,close:90},{ts:t+M,open:90,high:92,low:87,close:88}];
 assert.deepEqual(evaluateR21ResearchExit({route:"R21_NEW48",entryTs:t,entryPrice:100,asof:t+M,bars}),{kind:"STOP8",ts:t+M,price:108,orderAuthority:false});
 assert.equal(evaluateR21ResearchExit({route:"R21_OLD24",entryTs:t,entryPrice:100,asof:t+M,bars:[{...bars[0],open:110,high:112,low:90,close:99}]}).price,110);
 const flat=Array.from({length:288},(_,i)=>({ts:t+i*M,open:100,high:100.01,low:99.99,close:100}));
 assert.deepEqual(evaluateR21ResearchExit({route:"R21_OLD24",entryTs:t,entryPrice:100,asof:t+24*H,bars:[...flat,{ts:t+24*H,open:101,high:101.01,low:100.99,close:101}]}),{kind:"TIME",ts:t+24*H,price:101,orderAuthority:false});
 assert.equal(evaluateR21ResearchExit({route:"R21_OLD24",entryTs:t,entryPrice:100,asof:t+M,bars:[]}).kind,"SOURCE_UNAVAILABLE");
});

test("portfolio DD does not disable a resident STOP exit",()=>{
 const at=t+H;
 const breached=advancePortfolioDd(portfolio,{atMs:at,releaseSha:sha,proofId:"dd-breach",equity:699,externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
 const d=evaluateStable4DryEntry({...x,portfolioDdState:breached,asof:at,candidate:{...c,entryTs:at}});
 assert.equal(d.reason,"PORTFOLIO_CUMULATIVE_MAX_DD_EXCEEDED");
 const r=evaluateR21ResearchExit({route:"R21_NEW48",entryTs:at,entryPrice:100,asof:at+M,
   bars:[{ts:at,open:101,high:110,low:99,close:105}]});
 assert.equal(r.kind,"STOP8");assert.equal(r.orderAuthority,false);
});


test("nonfinite capital, unknown direction and invalid V4 cap never pass dry-run admission",()=>{
 assert.equal(evaluateStable4DryEntry({...x,equityUsd:Infinity}).reason,"CANDIDATE_OR_PROOF_INVALID");
 assert.equal(evaluateStable4DryEntry({...x,equityUsd:NaN}).reason,"CANDIDATE_OR_PROOF_INVALID");
 assert.equal(evaluateStable4DryEntry({...x,candidate:{...c,side:"INVALID" as any}}).reason,"SOURCE_INVALID");
 assert.equal(evaluateStable4DryEntry({...x,v4GrossCap:NaN}).reason,"SOURCE_INVALID");
 assert.equal(evaluateStable4DryEntry({...x,v4GrossCap:Infinity}).reason,"SOURCE_INVALID");
});


test("unknown owner, duplicate IDs, false stock classification and invalid open rows are blocked",()=>{
 const position={id:"existing",sleeve:"V52" as const,symbol:"AMZNUSDT",route:"V50",gross:1,stock:true,status:"OPEN" as const};
 const evaluate=(open:any[])=>evaluateStable4DryEntry({...x,open}).reason;
 assert.equal(evaluate([position]),"ALL_OBSERVED_RISK_CHECKS_WITHIN_LIMIT");
 assert.equal(evaluate([{...position,status:"UNKNOWN"}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,status:"CLOSED"}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,stock:false}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,sleeve:"PENGU",stock:true}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,gross:0}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,gross:Infinity}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([position,{...position,symbol:"TSLAUSDT"}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,id:c.id}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([null]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
 assert.equal(evaluate([{...position,symbol:"NOT_A_SYMBOL"}]),"OPEN_OWNER_EXPOSURE_UNVERIFIED");
});


test("account denominator must match both independently fresh DD equity snapshots",()=>{
 assert.equal(evaluateStable4DryEntry(x).status,"ELIGIBLE_OFFLINE");
 assert.equal(evaluateStable4DryEntry({...x,equityUsd:1100}).reason,"ACCOUNT_MTM_EQUITY_MISMATCH");
 const forgedPortfolio={...portfolio,equity:1100};
 assert.equal(evaluateStable4DryEntry({...x,portfolioDdState:forgedPortfolio}).reason,"ACCOUNT_MTM_EQUITY_MISMATCH");
 const forgedRunner={...base,accountEquityUsd:1100};
 assert.equal(evaluateStable4DryEntry({...x,ddState:forgedRunner}).reason,"ACCOUNT_MTM_EQUITY_MISMATCH");
 assert.equal(evaluateStable4DryEntry({...x,equityUsd:1000.005}).status,"ELIGIBLE_OFFLINE");
});
