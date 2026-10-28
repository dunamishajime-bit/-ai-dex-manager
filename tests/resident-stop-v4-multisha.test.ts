import test from "node:test";
import assert from "node:assert/strict";
import {observeResidentProtection,v4ProofsFromIndependentEvidence,V4_PRIMARY_OWNER_SHA} from "../lib/resident-stop-observation";
const at=1793182593836;
const key="DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000";
const client="v12-v4-98ded39746ed3502a4d7b0e26ef9";
function sample(){
 const order={symbol:"DOGEUSDT",type:"STOP_MARKET",side:"BUY",reduceOnly:true,status:"NEW",origQty:"226",executedQty:"0",stopPrice:"0.08696",clientOrderId:client,orderId:3161652232};
 const ledger:any={releaseSha:V4_PRIMARY_OWNER_SHA,state:{legs:{[key]:{status:"OPEN",qty:226,entryNotional:18.19752}}},protections:{[key]:{phase:"STOP_CONFIRMED",protectedQty:226,stopClientOrderId:client}}};
 const hb:any={runtimeSha:V4_PRIMARY_OWNER_SHA,expectedSha:V4_PRIMARY_OWNER_SHA,mode:"LIVE",safetyState:"HEALTHY",serviceUnit:`disdex-v12-v4@${V4_PRIMARY_OWNER_SHA}.service`,lastTickAt:at};
 return {order,ledger,hb,marker:V4_PRIMARY_OWNER_SHA,pos:{symbol:"DOGEUSDT",positionAmt:"-226"}};
}
test("exact multi-SHA V4 STOP owner becomes VERIFIED without live mutations",()=>{
 const s=sample();
 const proof=v4ProofsFromIndependentEvidence([s.order],s.ledger,s.hb,s.marker,at);
 assert.equal(proof.length,1);
 const obs=observeResidentProtection([s.pos],[s.order],{},"7688ed7c93a1918d8b44837339b7da5584a868f5",at,proof);
 assert.equal(obs.unprotectedCount,0);
 assert.equal(obs.positions[0].strategy,"V12_V4");
 assert.equal(obs.positions[0].readBackStatus,"VERIFIED");
 assert.equal(obs.ordersSent,0);
});
for(const [label,modify] of [
 ["wrong release",(s:any)=>s.ledger.releaseSha="bad"],
 ["wrong marker",(s:any)=>s.marker="bad"],
 ["wrong heartbeat sha",(s:any)=>s.hb.runtimeSha="bad"],
 ["stale tick",(s:any)=>s.hb.lastTickAt=at-181000],
 ["wrong unit",(s:any)=>s.hb.serviceUnit="old"],
 ["stop canceled",(s:any)=>s.order.status="CANCELED"],
 ["stop not reduceOnly",(s:any)=>s.order.reduceOnly=false],
 ["wrong side",(s:any)=>s.order.side="SELL"],
 ["qty mismatch",(s:any)=>s.order.origQty="225"],
 ["owner qty mismatch",(s:any)=>s.ledger.protections[key].protectedQty=225],
 ["missing protected qty",(s:any)=>delete s.ledger.protections[key].protectedQty],
 ["missing stop ID",(s:any)=>delete s.ledger.protections[key].stopClientOrderId],
 ["pending stop",(s:any)=>s.ledger.protections[key].phase="PENDING"],
 ["too deep STOP",(s:any)=>s.order.stopPrice="0.10"],
 ["unknown client id",(s:any)=>s.order.clientOrderId="v12-v4-unknown"],
] as const){
 test("V4 owner fails closed for "+label,()=>{
  const s:any=sample();modify(s);
  const proof=v4ProofsFromIndependentEvidence([s.order],s.ledger,s.hb,s.marker,at);
  assert.equal(proof.length,0);
  assert.equal(observeResidentProtection([s.pos],[s.order],{},"7688ed7c93a1918d8b44837339b7da5584a868f5",at,proof).unprotectedCount,1);
 });
}
