import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {reviewOrderOrigin,reviewDeterministicOrderOwner} from "../lib/stable4-mtm-order-origin-review";
import {deterministicIdleClientOrderId} from "../lib/idle-priority-short-live";
const signalTs=1790000000000;
const idleProof={runner:"IDLE",symbol:"DOTUSDT",proofId:"archived-signal-evidence",signalTs,action:"ENTRY"} as const;
const idle={symbol:"DOTUSDT",orderId:"123",clientOrderId:deterministicIdleClientOrderId(idleProof),side:"SELL",reduceOnly:false} as const;
test("namespace separates V4, legacy, IDLE, PENGU recovery, guard and operator",()=>{
 for(const [id,origin] of [["v12-v4-"+"a".repeat(28),"V4"],["v12-entry-"+"a".repeat(22),"LEGACY_V12"],[idle.clientOrderId,"IDLE"],["recv8-"+"a".repeat(30),"PENGU_RECOVERY"],["mg-1-2-penguusdt-1790000000000","MARGIN_GUARD"],["web_ad_example_1_x","WEB_OR_OPERATOR"],["operator-tsla-close-example","WEB_OR_OPERATOR"],["v12-v4-short","UNKNOWN"],["recv8-short","UNKNOWN"]]) assert.equal(reviewOrderOrigin(id),origin);
});
test("IDLE requires exact deterministic ID, symbol, action, timestamp and side",()=>{
 const r=reviewDeterministicOrderOwner(idle,[idleProof]);
 assert.equal(r.status,"OWNER_CANDIDATE_ONLY");
 assert.equal(r.ownerAttestationIssued,false);
 assert.equal(r.orderAuthority,false);
 for(const p of [[],[{...idleProof,signalTs:signalTs+1}],[{...idleProof,symbol:"JUPUSDT"}],[idleProof,idleProof]]) assert.equal(reviewDeterministicOrderOwner(idle,p).status,"BLOCKED");
 assert.equal(reviewDeterministicOrderOwner({...idle,side:"BUY"},[idleProof]).status,"BLOCKED");
 assert.equal(reviewDeterministicOrderOwner({...idle,reduceOnly:true},[idleProof]).status,"BLOCKED");
});
test("PENGU Recovery V8 exact role and entry timestamp are required",()=>{
 const p={runner:"PENGU",symbol:"PENGUUSDT",proofId:"archived-logical-entry",entryTs:signalTs,role:"partial-24h",closeSide:"SELL"} as const;
 const cid=("recv8-"+createHash("sha256").update("PENGU_RECOVERY_V8|PENGUUSDT|"+signalTs+"|partial-24h").digest("hex")).slice(0,36);
 const order={symbol:"PENGUUSDT",orderId:"456",clientOrderId:cid,side:"SELL",reduceOnly:true} as const;
 assert.equal(reviewDeterministicOrderOwner(order,[p]).status,"OWNER_CANDIDATE_ONLY");
 assert.equal(reviewDeterministicOrderOwner(order,[{...p,role:"full-hard"}]).status,"BLOCKED");
 assert.equal(reviewDeterministicOrderOwner({...order,reduceOnly:false},[p]).status,"BLOCKED");
 assert.equal(reviewDeterministicOrderOwner(order,[{...p,closeSide:"BUY"}]).status,"BLOCKED");
});
test("manual and forced closing order origin never assigns the closed position owner",()=>{
 for(const clientOrderId of ["mg-1-2-penguusdt-1790000000000","web_ad_example_1_x","operator-tsla-close-example"]) {
  const r=reviewDeterministicOrderOwner({...idle,clientOrderId},[idleProof]);
  assert.equal(r.status,"BLOCKED");
  assert.equal(r.orderAuthority,false);
 }
});
