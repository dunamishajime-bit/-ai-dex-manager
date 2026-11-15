import test from "node:test";
import assert from "node:assert/strict";
import {assertStable4V4ReservationOwnership} from "../lib/stable4-v4-reservation-proof";
import {v4OrderIdentity} from "../lib/v12-v4-execution-store";
const sha="a".repeat(40),id="BNBUSDT:REC_X04_TIME_24H:SHORT:1800000000000",cid=v4OrderIdentity(sha,id,"ENTRY",0);
function fixture():any{
 const durable={legId:id,action:"ENTRY",sequence:0,symbol:"BNBUSDT",positionSide:"SHORT",quantity:.02,price:600,signalTs:1800000000000};
 return{sourceSha:sha,lease:{schema:"disdex-account-lock/v1",accountScope:"ASTER_FUTURES",ownerId:"V12_V4_RUNNER",reservations:[]},
  command:{clientOrderId:cid,symbol:"BNBUSDT",side:"SELL",quantity:.02,reduceOnly:false},
  row:{reservationId:cid,idempotencyKey:cid,strategyId:"V12_V4",sleeve:"CRYPTO",symbol:"BNBUSDT",side:"SHORT",runtimeSha:sha,status:"PENDING",notionalUsd:12,gross:.12},
  document:{schema:2,releaseSha:sha,state:{executionReview:null,legs:{[id]:{id,status:"PENDING_ENTRY",qty:0,entryTs:durable.signalTs,requestedQty:.02,reservationUsd:12,candidate:{symbol:"BNBUSDT",effectiveSide:"SHORT"}}}},intents:{[cid]:{clientOrderId:cid,legId:id,action:"ENTRY",sequence:0,stage:"SUBMITTING",command:durable}}}};
}
test("V4 may replace only its own replayed unsent durable reservation under the actual V4 lease",()=>{
 assert.doesNotThrow(()=>assertStable4V4ReservationOwnership(fixture()));
});
test("a peer lease or borrowed same-symbol reservation cannot claim V4 ownership",()=>{
 for(const change of [(v:any)=>v.lease.ownerId="HYPE_RUNNER",(v:any)=>v.row.strategyId="PENGU",(v:any)=>v.row.reservationId="borrowed",(v:any)=>v.row.idempotencyKey="borrowed",(v:any)=>v.row.notionalUsd=24,(v:any)=>v.row.runtimeSha="b".repeat(40)]){
  const v=fixture();change(v);assert.throws(()=>assertStable4V4ReservationOwnership(v),/OWN_RESERVATION_CONFLICT/);
 }
});
test("submitted/filled, mismatched command, forged identity, release drift and coercions fail closed",()=>{
 for(const change of [(v:any)=>v.document.intents[cid].stage="UNKNOWN",(v:any)=>v.document.intents[cid].venueOrderId="123",(v:any)=>v.document.state.legs[id].qty=.01,(v:any)=>v.command.quantity=.03,(v:any)=>v.command.side="BUY",(v:any)=>v.document.releaseSha="b".repeat(40),(v:any)=>v.row.status="RELEASED",(v:any)=>v.row.notionalUsd="12",(v:any)=>v.document.intents[cid].command.signalTs++, (v:any)=>v.document.intents[cid].sequence=1]){
  const v=fixture();change(v);assert.throws(()=>assertStable4V4ReservationOwnership(v),/OWN_RESERVATION_CONFLICT/);
 }
});
