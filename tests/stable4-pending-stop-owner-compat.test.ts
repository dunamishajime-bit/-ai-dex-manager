/** Source-scoped pending no-order STOP ownership contracts. No venue or filesystem I/O. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  observeResidentProtection,
  resolveResidentStopOwnerPins,
  v4ProofsFromIndependentEvidence,
  v4ProofsFromBoundLedger,
  q102ProofsFromIndependentEvidence,
} from "../lib/resident-stop-observation";

const V4="a".repeat(40),Q102="b".repeat(40),SHARED="c".repeat(40);
const expectedPins={
  V12:V4,Q102,PENGU:SHARED,V52:SHARED,FET:SHARED,
  HYPE:SHARED,IDLE:SHARED,RESIDUAL:SHARED,
};
const rootPin=(runner:string,stopOwner:string,prefix:string,sha:string)=>({
  sha,stopOwner,serviceUnit:prefix+"@"+sha+".service",evidenceMode:"tick-v1",
  runner,
});
const rootManifest={
  schema:"disdex-runner-pin-manifest/v1",
  runners:{
    V12_V4:rootPin("V12_V4","V4_PRIMARY","disdex-v12-v4",V4),
    QUALITY102_CAUSAL_V1:rootPin("QUALITY102_CAUSAL_V1","Q102_PRIMARY","disdex-quality102-causal-v1",Q102),
    PENGU_V8:rootPin("PENGU_V8","PENGU_V8","disdex-pengu-dual-ls-v2",SHARED),
    V52:rootPin("V52","V52","disdex-v52-aster-only",SHARED),
    FET_BRK48_RESIDUAL:rootPin("FET_BRK48_RESIDUAL","FET_BRK48_RESIDUAL","disdex-fet-brk48",SHARED),
    HYPE_TREND_LONG:rootPin("HYPE_TREND_LONG","HYPE_TREND_LONG","disdex-hype-long",SHARED),
    IDLE_PRIORITY_SHORT:rootPin("IDLE_PRIORITY_SHORT","IDLE_PRIORITY_SHORT","disdex-idle-priority-short",SHARED),
  },
};
const now=1794862000000;
const stop={symbol:"SOLUSDT",clientOrderId:"v12-v4-abcd",orderId:123,type:"STOP_MARKET",
  side:"SELL",reduceOnly:true,status:"NEW",origQty:"1",executedQty:"0",stopPrice:"95"};
const legKey="SOLUSDT:fixture:LONG:1";
const ledger={releaseSha:V4,state:{legs:{[legKey]:{status:"OPEN",qty:1,entryNotional:100}}},
  protections:{[legKey]:{phase:"STOP_CONFIRMED",protectedQty:1,stopClientOrderId:stop.clientOrderId}}};
const heartbeat={runtimeSha:V4,expectedSha:V4,serviceUnit:"disdex-v12-v4@"+V4+".service",
  mode:"LIVE",safetyState:"HEALTHY",lastTickAt:now};

test("STOP pin projection requires exact root-owned manifest identity",()=>{
  assert.deepEqual(resolveResidentStopOwnerPins(rootManifest),expectedPins);
  assert.throws(()=>resolveResidentStopOwnerPins({...rootManifest,schema:"random"}),/MANIFEST_INVALID/);
  assert.throws(()=>resolveResidentStopOwnerPins({
    ...rootManifest,runners:{...rootManifest.runners,V12_V4:{...rootManifest.runners.V12_V4,sha:Q102}},
  }),/STOP_OWNER_PIN_INVALID/);
});
test("independent V4 evidence binds live stop, protection ledger, heartbeat and exact SHA",()=>{
  const rows=v4ProofsFromIndependentEvidence([stop],ledger,heartbeat,V4,now,V4);
  assert.equal(rows.length,1);
  assert.equal(rows[0].stopClientOrderId,stop.clientOrderId);
  assert.deepEqual(v4ProofsFromBoundLedger([stop],ledger,V4,V4),rows);
  assert.deepEqual(v4ProofsFromIndependentEvidence([stop],ledger,
    {...heartbeat,lastTickAt:now-180001},V4,now,V4),[]);
  assert.deepEqual(v4ProofsFromIndependentEvidence([stop],ledger,heartbeat,V4,now,Q102),[]);
  assert.deepEqual(v4ProofsFromIndependentEvidence([stop],ledger,heartbeat,"wrong",now,V4),[]);
  assert.deepEqual(v4ProofsFromBoundLedger([{...stop,reduceOnly:false}],ledger,V4,V4),[]);
});
test("pending no-order protection uses only explicit eight pinned owners and independent V4 proofs",()=>{
  const proofs=v4ProofsFromIndependentEvidence([stop],ledger,heartbeat,V4,now,V4);
  const positions=[{symbol:"SOLUSDT",positionAmt:"1"}];
  assert.throws(()=>observeResidentProtection(positions,[stop],{},SHARED,now,proofs,[],undefined),
    /EXPLICIT_OWNER_EVIDENCE_REQUIRED/);
  assert.throws(()=>observeResidentProtection(positions,[stop],{},SHARED,now,proofs,[],{V12:V4}),
    /EXPLICIT_OWNER_EVIDENCE_REQUIRED/);
  const observed=observeResidentProtection(positions,[stop],{},SHARED,now,proofs,[],expectedPins);
  assert.equal(observed.positions[0].protected,true);
  assert.equal(observed.positions[0].strategy,"V12_V4");
  assert.equal(observed.ordersSent,0);
  assert.equal(observed.cancelsSent,0);
  assert.equal(observed.unprotectedCount,0);
  assert.equal(observeResidentProtection(positions,[{...stop,stopPrice:"93"}],{},SHARED,now,proofs,[],expectedPins)
    .positions[0].protected,false);
  assert.equal(observeResidentProtection(positions,[stop,stop],{},SHARED,now,proofs,[],expectedPins)
    .positions[0].protected,false);
  assert.equal(observeResidentProtection(positions,[stop],{},SHARED,now,[],[],expectedPins)
    .positions[0].protected,false);
});
test("untrusted old-state owner SHA cannot inherit runtime SHA or environment defaults",()=>{
  const oldEnv=process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH;
  process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH="/var/lib/disdex/runner-pins.json";
  try{
    const states={FET:{runtimeCommitSha:Q102,updatedAt:now,
      position:{symbol:"FETUSDT",side:1,quantity:2,stopClientOrderId:"fet-stop-test",hardStop:1}}};
    const order={...stop,symbol:"FETUSDT",clientOrderId:"fet-stop-test",origQty:"2",stopPrice:"1"};
    const observed=observeResidentProtection([{symbol:"FETUSDT",positionAmt:"2"}],
      [order],states,SHARED,now,[],[],expectedPins);
    assert.equal(observed.unprotectedCount,1);
    assert.equal(observed.positions[0].protected,false);
  }finally{
    if(oldEnv===undefined)delete process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH;
    else process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH=oldEnv;
  }
});
test("legacy five-argument STOP observation contract remains unchanged",()=>{
  const states={FET:{runtimeCommitSha:SHARED,updatedAt:now,
    position:{symbol:"FETUSDT",side:1,quantity:2,stopClientOrderId:"fet-stop-test",hardStop:1}}};
  const order={...stop,symbol:"FETUSDT",clientOrderId:"fet-stop-test",origQty:"2",stopPrice:"1"};
  const row=observeResidentProtection([{symbol:"FETUSDT",positionAmt:"2"}],[order],
    states,SHARED,now);
  assert.equal(row.positions[0].protected,true);
  assert.equal(row.positions[0].strategy,"FET");
  assert.equal(row.ordersSent,0);
  assert.equal(Object.hasOwn(row,"ownerShaByStrategy"),false);
});
test("Q102 independent proofs reject stale, absent and unverified state",()=>{
  const state={runtimeCommitSha:Q102,mode:"LIVE",strategyId:"QUALITY102_CAUSAL_V1",
    updatedAt:now,position:null};
  const heart={runtimeSha:Q102,expectedSha:Q102,
    serviceUnit:"disdex-quality102-causal-v1@"+Q102+".service",
    mode:"LIVE",safetyState:"HEALTHY",lastTickAt:now};
  assert.deepEqual(q102ProofsFromIndependentEvidence([],state,heart,Q102,now,Q102),[]);
  assert.deepEqual(q102ProofsFromIndependentEvidence([],{
    ...state,position:{symbol:"APTUSDT",quantity:1,side:1},
  },{...heart,lastTickAt:now-200000},Q102,now,Q102),[]);
});
