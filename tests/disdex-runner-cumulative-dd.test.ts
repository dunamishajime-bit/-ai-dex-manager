import assert from "node:assert/strict";
import test from "node:test";
import {RUNNER_DD_IDS,initializeRunnerCumulativeDd,advanceRunnerCumulativeDd,evaluateRunnerDdEntry,
  type RunnerDdObservation,type RunnerDdAmounts} from "../lib/disdex-runner-cumulative-dd";
const sha="a".repeat(40),t=1_800_000_000_000;
const zero=()=>Object.fromEntries(RUNNER_DD_IDS.map(k=>[k,0])) as RunnerDdAmounts;
function obs(atMs:number,accountEquityUsd:number,pnl:RunnerDdAmounts,externalNetFlowUsd=0):RunnerDdObservation{
  return {atMs,accountEquityUsd,netMtmPnlUsd:pnl,externalNetFlowUsd,
    exactReleaseSha:sha,proofId:"signed-venue-and-seven-ledgers-"+atMs,
    provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED"};
}
test("V4 DD ignores another runner loss; Q102 independently holds above 30 percent",()=>{
  const base=initializeRunnerCumulativeDd(obs(t,1000,zero()));
  const p={...zero(),Q102:-350};
  const next=advanceRunnerCumulativeDd(base,obs(t+60000,650,p));
  assert.equal(next.runners.V4.maximumDd,0);
  assert.equal(next.runners.Q102.maximumDd,.35);
  assert.equal(evaluateRunnerDdEntry(next,"V4",t+60001,sha).status,"ENTRY_ALLOWED_BY_THIS_DD_ONLY");
  assert.equal(evaluateRunnerDdEntry(next,"Q102",t+60001,sha).reason,"RUNNER_CUMULATIVE_MAX_DD_EXCEEDED");
  assert.equal(evaluateRunnerDdEntry(next,"Q102",t+60001,sha).orderAuthority,false);
});
test("maximum is cumulative, not reset by new day or recovery of current DD",()=>{
  let s=initializeRunnerCumulativeDd(obs(t,1000,zero()));
  s=advanceRunnerCumulativeDd(s,obs(t+60000,690,{...zero(),V4:-310}));
  assert.ok(s.runners.V4.maximumDd>.30);
  s=advanceRunnerCumulativeDd(s,obs(t+86_400_000,1200,{...zero(),V4:200}));
  assert.equal(s.runners.V4.currentDd,0);
  assert.ok(s.runners.V4.maximumDd>.30);
  assert.equal(evaluateRunnerDdEntry(s,"V4",t+86_400_001,sha).status,"BLOCKED");
});
test("cash deposit is a neutral flow; denominator is prior account equity",()=>{
  let s=initializeRunnerCumulativeDd(obs(t,1000,zero()));
  s=advanceRunnerCumulativeDd(s,obs(t+60000,1900,{...zero(),V4:-100},1000));
  assert.ok(Math.abs(s.runners.V4.currentDd-.1)<1e-12);
  assert.equal(s.runners.Q102.currentDd,0);
  assert.equal(s.accountEquityUsd,1900);
});
test("mutated, missing or non-reconciled snapshot fails closed",()=>{
  const s=initializeRunnerCumulativeDd(obs(t,1000,zero()));
  assert.throws(()=>advanceRunnerCumulativeDd(s,obs(t+60000,650,{...zero(),Q102:-100})),
    /ACCOUNT_TO_RUNNER_MTM_RECONCILIATION_FAILED/);
  assert.throws(()=>advanceRunnerCumulativeDd(s,obs(t+60000,1000,{V4:0} as RunnerDdAmounts)),
    /MISSING_RUNNER_NET_MTM/);
  assert.throws(()=>advanceRunnerCumulativeDd(s,obs(t,1000,zero())),/PROOF_OR_TIME_REPLAY/);
  assert.throws(()=>initializeRunnerCumulativeDd({...obs(t,1000,zero()),
    provenance:"FAKE" as RunnerDdObservation["provenance"]}),/INVALID_OR_UNVERIFIED/);
  assert.equal(evaluateRunnerDdEntry(s,"V4",t+180000,sha).status,"BLOCKED");
  assert.equal(evaluateRunnerDdEntry(s,"V4",t+1,"b".repeat(40)).status,"BLOCKED");
});
test("per runner index changes exactly by its own delta divided by prior account equity",()=>{
 let s=initializeRunnerCumulativeDd(obs(t,1000,zero()));
 s=advanceRunnerCumulativeDd(s,obs(t+60000,1100,{...zero(),V4:150,HYPE:-50}));
 assert.equal(s.runners.V4.index,1.15);
 assert.equal(s.runners.HYPE.index,.95);
 assert.ok(Math.abs(s.runners.HYPE.maximumDd-.05)<1e-12);
 assert.equal(s.runners.Q102.index,1);
});


test("corrupt runner DD snapshots with fabricated zero drawdown fail closed",()=>{
 const initial=initializeRunnerCumulativeDd(obs(t,1000,zero()));
 const actual=advanceRunnerCumulativeDd(initial,obs(t+60000,900,{...zero(),V4:-100}));
 const forged={...actual,runners:{...actual.runners,V4:{...actual.runners.V4,currentDd:0,maximumDd:0}}};
 assert.equal(evaluateRunnerDdEntry(forged,"V4",t+60000,sha).reason,"RUNNER_DD_STATE_INVALID");
 assert.throws(()=>advanceRunnerCumulativeDd(forged,obs(t+120000,900,{...zero(),V4:-100})),/RUNNER_CUMULATIVE_DD_STATE_INVALID/);
 assert.equal(evaluateRunnerDdEntry(actual,"V4",t+60000,sha).status,"ENTRY_ALLOWED_BY_THIS_DD_ONLY");
});

test("nonfinite clock, corrupted proof and denominator never qualify a runner",()=>{
 const s=initializeRunnerCumulativeDd(obs(t,1000,zero()));
 for(const bad of [{...s,updatedAt:NaN},{...s,updatedAt:0},{...s,proofId:""},{...s,accountEquityUsd:Infinity}]){
  assert.equal(evaluateRunnerDdEntry(bad,"V4",t+1,sha).status,"BLOCKED");
  assert.throws(()=>advanceRunnerCumulativeDd(bad,obs(t+60000,1000,zero())),/STATE_INVALID/);
 }
 assert.equal(evaluateRunnerDdEntry({...s,releaseSha:"bad"},"V4",t+1,"bad").status,"BLOCKED");
});
