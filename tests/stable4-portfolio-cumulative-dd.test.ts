import test from "node:test";
import assert from "node:assert/strict";
import {initializePortfolioDd,advancePortfolioDd,evaluatePortfolioDdEntry} from "../lib/stable4-portfolio-cumulative-dd";
import {evaluateStable4DryEntry} from "../lib/stable4-seven-runner-dryrun-gate";
import {initializeRunnerCumulativeDd,RUNNER_DD_IDS} from "../lib/disdex-runner-cumulative-dd";
const H=3600000,sha="a".repeat(40),t=200*H;
const mark=(atMs:number,equity:number,proofId:string,externalNetFlow=0)=>({atMs,equity,proofId,externalNetFlow,releaseSha:sha,source:"OFFLINE_RECONCILED_MTM_ONLY" as const});
const b=initializePortfolioDd(mark(t,10000,"initial"));
test("neutral deposits, daily rollover and restart have no DD reset",()=>{
 let p=advancePortfolioDd(b,mark(t+H,8000,"loss"));
 assert.ok(Math.abs(p.maximumDd-.20)<1e-10);
 p=advancePortfolioDd(p,mark(t+25*H,13000,"deposit",5000));
 assert.ok(Math.abs(p.currentDd-.20)<1e-10);
 const serialized=JSON.parse(JSON.stringify(p));
 p=advancePortfolioDd(serialized,mark(t+26*H,8125,"loss2"));
 assert.ok(Math.abs(p.maximumDd-.50)<1e-10);
 p=advancePortfolioDd(p,mark(t+27*H,23000,"recovery"));
 assert.equal(p.maximumDd>0.49,true);
 assert.equal(evaluatePortfolioDdEntry(p,t+27*H,sha).reason,"PORTFOLIO_CUMULATIVE_MAX_DD_EXCEEDED");
});
test("30% inclusive, 30.01% blocked and never auto reset",()=>{
 const p=advancePortfolioDd(b,mark(t+H,7000,"limit"));
 assert.equal(evaluatePortfolioDdEntry(p,t+H,sha).status,"ELIGIBLE_OFFLINE");
 const next=advancePortfolioDd(p,mark(t+2*H,6999,"breach"));
 assert.equal(evaluatePortfolioDdEntry(next,t+2*H,sha).status,"BLOCKED");
 const recover=advancePortfolioDd(next,mark(t+3*H,14000,"recovered"));
 assert.equal(evaluatePortfolioDdEntry(recover,t+3*H,sha).reason,"PORTFOLIO_CUMULATIVE_MAX_DD_EXCEEDED");
});
test("stale, missing, bad source and invalid external flow fail closed",()=>{
 assert.equal(evaluatePortfolioDdEntry(undefined,t,sha).status,"BLOCKED");
 assert.equal(evaluatePortfolioDdEntry(b,t+3*60000,sha).status,"BLOCKED");
 assert.equal(evaluatePortfolioDdEntry(b,t, "b".repeat(40)).status,"BLOCKED");
 assert.throws(()=>advancePortfolioDd(b,mark(t+H,10000,"badFlow",11000)),/FLOW/);
 assert.throws(()=>advancePortfolioDd(b,mark(t+H,9000,"initial")),/PROOF_REPLAY/);
});
test("all seven candidate entries must pass portfolio and runner DD independently",()=>{
 const pnls=Object.fromEntries(RUNNER_DD_IDS.map(r=>[r,0])) as any;
 const runner=initializeRunnerCumulativeDd({atMs:t,accountEquityUsd:10000,externalNetFlowUsd:0,netMtmPnlUsd:pnls,
  exactReleaseSha:sha,proofId:"rinitial",provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"});
 const candidate={id:"r21",sleeve:"V4" as const,symbol:"ETHUSDT",side:"SHORT" as const,gross:.3,route:"R21_OLD24",entryTs:t};
 const base={candidate,open:[],asof:t+60000,releaseSha:sha,equityUsd:10000,ddState:runner,portfolioDdState:b};
 assert.equal(evaluateStable4DryEntry(base).status,"ELIGIBLE_OFFLINE");
 assert.equal(evaluateStable4DryEntry({...base,portfolioDdState:undefined}).reason,"PORTFOLIO_DD_MARK_UNAVAILABLE");
 const broken=advancePortfolioDd(b,mark(t+H,6999,"breach"));
 assert.equal(evaluateStable4DryEntry({...base,asof:t+H, candidate:{...candidate,entryTs:t+H},portfolioDdState:broken}).reason,"PORTFOLIO_CUMULATIVE_MAX_DD_EXCEEDED");
});


test("corrupted reported DD cannot contradict the time-weighted peak/index",()=>{
 const actual=advancePortfolioDd(b,mark(t+H,9000,"drop10"));
 const forged={...actual,currentDd:0,maximumDd:0};
 assert.equal(evaluatePortfolioDdEntry(forged,t+H,sha).reason,"PORTFOLIO_DD_STALE_OR_INVALID");
 assert.throws(()=>advancePortfolioDd(forged,mark(t+2*H,9000,"after-forgery")),/PORTFOLIO_DD_STATE_INVALID/);
 assert.equal(evaluatePortfolioDdEntry(actual,t+H,sha).status,"ELIGIBLE_OFFLINE");
});
