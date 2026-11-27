import test from "node:test";import assert from "node:assert/strict";
import {evaluateStable4DryEntry,evaluateR21ResearchExit} from "../lib/stable4-seven-runner-dryrun-gate";
import {initializeRunnerCumulativeDd,advanceRunnerCumulativeDd,RUNNER_DD_IDS} from "../lib/disdex-runner-cumulative-dd";
const H=3600000,M=300000,sha="a".repeat(40),t=200*H;
const pnl=Object.fromEntries(RUNNER_DD_IDS.map(x=>[x,0])) as any;
const baseline={atMs:t,exactReleaseSha:sha,proofId:"signed-001",accountEquityUsd:1000,externalNetFlowUsd:0,netMtmPnlUsd:pnl,provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"} as const;
const base=initializeRunnerCumulativeDd(baseline);
const c={id:"A",sleeve:"V4" as const,symbol:"ETHUSDT",side:"SHORT" as const,gross:.3,route:"R21_OLD24",entryTs:t};
const x={candidate:c,open:[],equityUsd:1000,asof:t+60000,releaseSha:sha,ddState:base};
test("no DD proof, stale proof, 31% DD all fail closed",()=>{
 assert.equal(evaluateStable4DryEntry({...x,ddState:undefined}).reason,"RUNNER_DD_SOURCE_UNAVAILABLE");
 assert.equal(evaluateStable4DryEntry({...x,asof:t+3*M}).reason,"RUNNER_DD_STALE_OR_INVALID");
 const after=advanceRunnerCumulativeDd(base,{...baseline,atMs:t+H,proofId:"signed-002",netMtmPnlUsd:{...pnl,V4:-310},accountEquityUsd:690});
 const result=evaluateStable4DryEntry({...x,ddState:after,asof:t+H,candidate:{...c,entryTs:t+H}});
 assert.equal(result.reason,"RUNNER_CUMULATIVE_MAX_DD_EXCEEDED");assert.equal(result.orderAuthority,false);
});
test("same-symbol unresolved, R21 occupied, V4/crypto/total caps and known-equal DD",()=>{
 assert.equal(evaluateStable4DryEntry(x).status,"ELIGIBLE_OFFLINE");
 const y={id:"X",sleeve:"PENGU" as const,symbol:"ETHUSDT",gross:.5,stock:false,status:"UNKNOWN" as const,route:"SHORT_V20"};
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
