import test from "node:test";
import assert from "node:assert/strict";
import {initializePortfolioDd,advancePortfolioDd} from "../lib/stable4-portfolio-cumulative-dd";
import {initializeRunnerCumulativeDd,advanceRunnerCumulativeDd,RUNNER_DD_IDS} from "../lib/disdex-runner-cumulative-dd";
import {evaluateStable4DryEntry} from "../lib/stable4-seven-runner-dryrun-gate";
import {evaluateSevenRunnerDryEntryWithProjectedStopHeadroom as evaluate} from "../lib/stable4-source-only-seven-runner-stop-headroom";
const H=3_600_000,t=200*H,sha="b".repeat(40);
const pnl=Object.fromEntries(RUNNER_DD_IDS.map(x=>[x,0])) as any;
const rInit={atMs:t,exactReleaseSha:sha,proofId:"runner-base",accountEquityUsd:1000,
  externalNetFlowUsd:0,netMtmPnlUsd:pnl,
  provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED" as const};
const runner=initializeRunnerCumulativeDd(rInit);
const portfolio=initializePortfolioDd({atMs:t,releaseSha:sha,proofId:"p-base",equity:1000,
  externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
const candidate={id:"offline-R21",sleeve:"V4" as const,symbol:"ETHUSDT",side:"SHORT" as const,
  gross:.3,route:"R21_OLD24",entryTs:t};
const dryRun={candidate,open:[],equityUsd:1000,asof:t+60_000,releaseSha:sha,
  ddState:runner,portfolioDdState:portfolio};
const fixture={dryRun,protectedOpen:[],candidateEntryPriceProxy:100,
  candidateProtectiveStopPrice:108,allOwnersReconciled:true};

test("research 7-sleeve dry gate composes native DD/Gross with STOP8+2% reserve, never orders",()=>{
  assert.equal(evaluateStable4DryEntry(dryRun).status,"ELIGIBLE_OFFLINE");
  const decision=evaluate(fixture);
  assert.equal(decision.status,"ELIGIBLE_OFFLINE");
  assert.equal(decision.reason,"SEVEN_RUNNER_DD_GROSS_AND_PROJECTED_STOP_HEADROOM_MODEL_ONLY");
  assert.ok(Math.abs(decision.projectedStopRiskUsd!-30.9)<1e-10);
  assert.ok(Math.abs(decision.projectedAfterStopEquityUsd!-969.1)<1e-10);
  assert.equal(decision.orderAuthority,false);
  assert.equal(decision.liveRiskProof,false);
  assert.equal(decision.guaranteedDrawdownBound,false);
});

test("29%-near portfolio loss: source DD alone permits, 2% price gap headroom rejects",()=>{
  const equity=721;
  const p=advancePortfolioDd(portfolio,{atMs:t+H,equity,releaseSha:sha,proofId:"p-low",
    externalNetFlow:0,source:"OFFLINE_RECONCILED_MTM_ONLY"});
  const r=advanceRunnerCumulativeDd(runner,{...rInit,atMs:t+H,proofId:"r-low",
    accountEquityUsd:equity,netMtmPnlUsd:{...pnl,V4:equity-1000}});
  const x={...fixture,dryRun:{...dryRun,ddState:r,portfolioDdState:p,equityUsd:equity,
    asof:t+H,candidate:{...candidate,entryTs:t+H}}};
  assert.equal(evaluateStable4DryEntry(x.dryRun).status,"ELIGIBLE_OFFLINE");
  assert.equal(evaluate({...x,gapReservePct:0}).status,"ELIGIBLE_OFFLINE");
  const y=evaluate({...x,gapReservePct:.02});
  assert.equal(y.status,"BLOCKED");
  assert.equal(y.reason,"PROJECTED_STOP_PLUS_GAP_DD30_RESERVE_BLOCK");
  assert.ok(y.projectedAfterStopEquityUsd!<700);
  assert.equal(y.orderAuthority,false);
});

test("must have exact current R21 8% protective stop price; no alternative stop model silently accepted",()=>{
  assert.equal(evaluate({...fixture,candidateProtectiveStopPrice:107}).reason,
    "R21_SOURCE_STOP8_PRICE_NOT_PINNED");
  assert.equal(evaluate({...fixture,candidateProtectiveStopPrice:120}).status,"BLOCKED");
  assert.equal(evaluate({...fixture,candidateEntryPriceProxy:0}).status,"BLOCKED");
  assert.equal(evaluate({...fixture,allOwnersReconciled:false}).reason,
    "SOURCE_ONLY_FOREIGN_OWNERS_OR_POSITIONS_NOT_RECONCILED");
});

test("seven-runner dry ownership cannot bypass unproven open STOP or pending orders",()=>{
  const open={id:"PENGU-open",sleeve:"PENGU" as const,symbol:"PENGUUSDT",route:"LONG_V8",
    gross:.4,stock:false,status:"OPEN" as const};
  const protectedOpen={id:open.id,side:"LONG" as const,entryPrice:100,markPrice:101,
    protectiveStopPrice:95,entryNotionalUsd:400,stopProofKnown:true};
  const x={...fixture,dryRun:{...dryRun,open:[open]},protectedOpen:[protectedOpen]};
  assert.equal(evaluate(x).status,"ELIGIBLE_OFFLINE");
  assert.equal(evaluate({...x,protectedOpen:[]}).reason,
    "SEVEN_RUNNER_OPEN_STOP_PROOF_NOT_RECONCILED");
  assert.equal(evaluate({...x,dryRun:{...x.dryRun,open:[{...open,status:"PENDING"}]}}).status,"BLOCKED");
  assert.equal(evaluate({...x,protectedOpen:[{...protectedOpen,stopProofKnown:false}]}).status,"BLOCKED");
  assert.equal(evaluate({...x,protectedOpen:[{...protectedOpen,id:"unrelated"}]}).status,"BLOCKED");
});

test("preexisting seven-runner source gross/DD fail-closed is not overridden by stop headroom",()=>{
  const badGross={...fixture,dryRun:{...dryRun,candidate:{...candidate,gross:3.1}}};
  assert.equal(evaluate(badGross).reason,"SHARED_GROSS_CAP");
  assert.equal(evaluate({...fixture,dryRun:{...dryRun,ddState:undefined}}).reason,"RUNNER_DD_SOURCE_UNAVAILABLE");
  assert.equal(evaluate({...fixture,dryRun:{...dryRun,portfolioDdState:undefined}}).reason,
    "PORTFOLIO_DD_MARK_UNAVAILABLE");
  assert.equal(evaluate({...fixture,dryRun:{...dryRun,releaseSha:"c".repeat(40)}}).status,"BLOCKED");
});
