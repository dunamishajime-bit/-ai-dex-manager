import test from "node:test";
import assert from "node:assert/strict";
import { pendingV4OwnerProofs } from "../lib/disdex-pending-owner-evidence";

const sha="a".repeat(40), peer="b".repeat(40), at=1794099959191;
const serviceUnit=`disdex-v12-v4@${sha}.service`;
const workingDirectory=`/home/deploy/disdex-trading/releases/${sha}`;
const legId="XRPUSDT:REC_X13_TP1.5_SL1_H24:SHORT:1794099000000";
const clientOrderId="v12-v4-231ed20b6835c4148b5314d8da7e";
function sample(){
 const order={symbol:"XRPUSDT",clientOrderId,type:"STOP_MARKET",side:"BUY",reduceOnly:true,status:"NEW",
  origQty:"13.3",executedQty:"0",stopPrice:"1.05"};
 const ledger={schema:2,releaseSha:sha,state:{initial:{holdProtected:false},legs:{[legId]:{status:"OPEN",qty:13.3,entryNotional:13.3}}},
  protections:{[legId]:{phase:"STOP_CONFIRMED",protectedQty:13.3,stopClientOrderId:clientOrderId}},
  intents:{[clientOrderId]:{action:"STOP",stage:"ACKNOWLEDGED",legId}}};
 const heartbeat={schema:"disdex-v12-v4-runner-heartbeat/v1",releaseSha:sha,runtimeSha:sha,expectedSha:sha,
  mode:"LIVE",operationMode:"CERTIFIED",liveEnabled:true,limitedLive:false,orderEnabled:false,
  serviceUnit,workingDirectory,mainPid:91,heartbeatAt:at,lastTickAt:at-600000,safetyState:"BLOCKED",
  reason:`V4_PEER_ATTESTATION_RETRY_REQUIRED:V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:disdex-hype-long@${peer}.service`};
 return {order,ledger,heartbeat,runtime:{unit:serviceUnit,pid:91,cwd:workingDirectory}};
}
test("pending reconciliation can attest an exact resident STOP during a verified peer-entry block",()=>{
 const s=sample();
 assert.equal(pendingV4OwnerProofs([s.order],s.ledger,s.heartbeat,sha,at,sha,s.runtime).length,1);
});
test("stale or mismatched runtime, unknown review, and partial or unrelated STOP fail closed",()=>{
 for(const update of [
  (s:any)=>s.heartbeat.heartbeatAt-=181000,
  (s:any)=>s.runtime.pid++,
  (s:any)=>s.runtime.cwd="/tmp",
  (s:any)=>s.heartbeat.reason="V4_EXECUTION_REVIEW_REQUIRED",
  (s:any)=>s.ledger.state.executionReview="review",
  (s:any)=>s.ledger.intents[clientOrderId].legId="another",
  (s:any)=>s.order.executedQty="0.1",
  (s:any)=>s.order.reduceOnly=false,
 ]){
  const s=sample();update(s);
  assert.deepEqual(pendingV4OwnerProofs([s.order],s.ledger,s.heartbeat,sha,at,sha,s.runtime),[]);
 }
});
