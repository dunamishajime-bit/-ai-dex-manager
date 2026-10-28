import test from "node:test";
import assert from "node:assert/strict";
import {observeResidentProtection,q102ProofsFromIndependentEvidence,Q102_PRIMARY_OWNER_SHA} from "../lib/resident-stop-observation";
const now=1793196100000;
const id="q102-stop-"+"a".repeat(22);
function fixture(){
 const order:any={symbol:"RENDERUSDT",side:"BUY",type:"STOP_MARKET",clientOrderId:id,orderId:123450,reduceOnly:true,status:"NEW",origQty:"12",executedQty:"0",stopPrice:"106"};
 const state:any={
  strategyId:"QUALITY102_CAUSAL_V1",mode:"LIVE",runtimeCommitSha:Q102_PRIMARY_OWNER_SHA,updatedAt:now,pending:undefined,
  position:{symbol:"RENDERUSDT",side:-1,quantity:12,entryPrice:100,entryTs:now-3600000,hardStop:0.08,
   stopLedger:{plans:[{clientOrderId:id}]},
   residentStop:{protected:true,readBackStatus:"VERIFIED",symbol:"RENDERUSDT",side:"BUY",clientOrderId:id,
    quantity:12,originalQuantity:12,stopPrice:106,orderId:123450,lastReconciledAt:now}}
 };
 const hb:any={runtimeSha:Q102_PRIMARY_OWNER_SHA,expectedSha:Q102_PRIMARY_OWNER_SHA,
  serviceUnit:"disdex-quality102-causal-v1@"+Q102_PRIMARY_OWNER_SHA+".service",
  safetyState:"HEALTHY",mode:"LIVE",lastTickAt:now};
 return {order,state,hb,marker:Q102_PRIMARY_OWNER_SHA,pos:{symbol:"RENDERUSDT",positionAmt:"-12"}};
}
test("Q102 independent active exact SHA owner and readback yields VERIFIED",()=>{
 const x=fixture();
 const proof=q102ProofsFromIndependentEvidence([x.order],x.state,x.hb,x.marker,now);
 assert.equal(proof.length,1);
 const output=observeResidentProtection([x.pos],[x.order],{},"7688ed7c93a1918d8b44837339b7da5584a868f5",now,[],proof);
 assert.equal(output.positions[0].strategy,"Q102");
 assert.equal(output.unprotectedCount,0);
 assert.equal(output.ordersSent,0);
});
for (const [reason,modify] of [
 ["wrong marker",(x:any)=>x.marker="bad"],
 ["wrong live SHA",(x:any)=>x.state.runtimeCommitSha="bad"],
 ["wrong heartbeat",(x:any)=>x.hb.runtimeSha="bad"],
 ["stale health",(x:any)=>x.hb.lastTickAt=now-181000],
 ["stale state",(x:any)=>x.state.updatedAt=now-301000],
 ["unverified stop",(x:any)=>x.state.position.residentStop.protected=false],
 ["pending position change",(x:any)=>x.state.pending={phase:"submitted"}],
 ["missing stop ledger",(x:any)=>delete x.state.position.stopLedger],
 ["wrong stop ID",(x:any)=>x.state.position.residentStop.clientOrderId="q102-stop-"+("b".repeat(22))],
 ["partial quantity",(x:any)=>x.order.origQty="11"],
 ["nonreduceOnly",(x:any)=>x.order.reduceOnly=false],
 ["wrong side",(x:any)=>x.order.side="SELL"],
 ["canceled",(x:any)=>x.order.status="CANCELED"],
 ["stop too deep",(x:any)=>x.order.stopPrice="110"],
 ["stale independent stop proof",(x:any)=>x.state.position.residentStop.lastReconciledAt=now-301000],
] as const){
 test("Q102 multiSHA proof rejects "+reason,()=>{
  const x:any=fixture();modify(x);
  const proof=q102ProofsFromIndependentEvidence([x.order],x.state,x.hb,x.marker,now);
  assert.deepEqual(proof,[]);
  assert.equal(observeResidentProtection([x.pos],[x.order],{},"7688ed7c93a1918d8b44837339b7da5584a868f5",now,[],proof).unprotectedCount,1);
 });
}
