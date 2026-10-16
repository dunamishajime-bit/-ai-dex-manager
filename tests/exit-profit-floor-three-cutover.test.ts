import test from "node:test";
import assert from "node:assert/strict";
import {
 observeThreeExitFloorH1,type ExistingSignedStop,type SignedFloorPosition,
 type ExitFloorH1State,EXIT_FLOOR_HOUR_MS as H,
} from "../lib/exit-profit-floor-three";
import {
 prepareThreeFloorCutover,advanceThreeFloorCutover,nextThreeFloorCutoverAction,
 type ThreeFloorCutoverJournal,
} from "../lib/exit-profit-floor-three-cutover";
const ts=350*H;
const base={owner:"Q102" as const,symbol:"ETHUSDT",side:"LONG" as const,entryTs:ts,
 entryPrice:100,entryQuantity:4,family:"MR",legId:"Q102:ETHUSDT:"+ts+":1"};
const candle={openTs:ts,open:103,high:104,low:102,close:103};
function arm(){
 const r=observeThreeExitFloorH1(base,candle,ts+H);
 assert.ok(r.state?.armed);
 return r.state!;
}
function signed(s:ExitFloorH1State=arm()){
 const at=s.effectiveFromTs!+1000;
 const pos:SignedFloorPosition={symbol:s.symbol,side:s.side,quantity:4,
  markPrice:106,capturedAt:at};
 const old:ExistingSignedStop={symbol:s.symbol,side:"SELL",clientOrderId:"q102-stop-old",
  orderId:11,type:"STOP_MARKET",reduceOnly:true,status:"NEW",quantity:4,
  executedQuantity:0,stopPrice:92,capturedAt:at,};
 return {at,pos,old};
}
function prepared(){
 const s=arm(),f=signed(s);
 const journal=prepareThreeFloorCutover({state:s,signedPosition:f.pos,
  signedOldStop:f.old,normalizedPrice:101,at:f.at});
 return {journal,stop:f.old,position:f.pos,at:f.at};
}
function placed(j:ThreeFloorCutoverJournal,old:ExistingSignedStop):ExistingSignedStop{
 return {...old,clientOrderId:j.newClientOrderId,stopPrice:j.desiredStopPrice,orderId:12};
}
function awaitNew(){
 const o=prepared();
 let j=advanceThreeFloorCutover(o.journal,{type:"INITIAL_INTENT_PERSISTED"});
 j=advanceThreeFloorCutover(j,{type:"PLACE_ATTEMPT_DURABLY_RECORDED"});
 return {...o,j};
}
function verified(){
 const o=awaitNew();
 const n=placed(o.j,o.stop);
 const v=advanceThreeFloorCutover(o.j,{type:"NEW_ORDER_READBACK",
  orders:[o.stop,n],position:o.position,at:o.at+2000});
 return {...o,j:v,newStop:n};
}
test("cutover is deterministically scoped and initialized with only a durable-intent action",()=>{
 const a=prepared(),b=prepared();
 assert.equal(a.journal.newClientOrderId,b.journal.newClientOrderId);
 assert.equal(a.journal.policyId,b.journal.policyId);
 assert.equal(a.journal.ordersSent,0);
 assert.equal(a.journal.phase,"INTENT_DURABLE_WRITE_REQUIRED");
 assert.equal(nextThreeFloorCutoverAction(a.journal),"PERSIST_INITIAL_INTENT");
 assert.equal(a.journal.newClientOrderId.startsWith("q102-floor-"),true);
 assert.equal(a.journal.newClientOrderId.length<=36,true);
});
test("two-phase simulated cutover never cancels before independent new STOP readback",()=>{
 const {j:current,newStop,stop,position,at}=verified();
 assert.equal(current.phase,"NEW_VERIFIED");
 assert.equal(current.readbackNewAt,at+2000);
 assert.equal(nextThreeFloorCutoverAction(current),"RECORD_CANCEL_INTENT_BEFORE_CANCEL");
 let j=advanceThreeFloorCutover(current,{type:"OLD_CANCEL_ATTEMPT_DURABLY_RECORDED"});
 assert.equal(j.phase,"OLD_CANCEL_INFLIGHT");
 j=advanceThreeFloorCutover(j,{type:"CANCEL_ACK_OR_TIMEOUT"});
 assert.equal(j.phase,"AWAIT_FINAL_READBACK");
 j=advanceThreeFloorCutover(j,{type:"FINAL_READBACK",
   orders:[newStop],position,at:at+3000});
 assert.equal(j.phase,"COMPLETE");assert.equal(j.ordersSent,0);
 assert.equal(nextThreeFloorCutoverAction(j),"COMPLETE_NO_ACTION");
 assert.throws(()=>advanceThreeFloorCutover(j,{type:"CANCEL_ACK_OR_TIMEOUT"}),/TERMINAL/);
});
test("ambiguous PLACE acknowledge requires exact-id readback and forbids blind resubmit",()=>{
 const {j:original,position,at}=awaitNew();
 const j=advanceThreeFloorCutover(original,{type:"PLACE_ACK_OR_TIMEOUT"});
 assert.deepEqual(j,original);
 assert.equal(nextThreeFloorCutoverAction(j),"READ_NEW_ORDER_ONLY_NO_RETRY");
 const missing=advanceThreeFloorCutover(j,{type:"NEW_ORDER_READBACK",
   orders:[],position,at:at+1000});
 assert.equal(missing.phase,"AWAIT_NEW_READBACK");
 assert.throws(()=>advanceThreeFloorCutover(missing,{type:"PLACE_ATTEMPT_DURABLY_RECORDED"}),/INVALID_PHASE/);
});
test("UNKNOWN STOP status, duplicate new STOP, and partial fills fail closed",()=>{
 const {j,stop,position,at}=awaitNew();
 const n=placed(j,stop);
 for(const rows of [
  [stop,{...n,status:"UNKNOWN"}],
  [stop,{...n,executedQuantity:1,status:"PARTIALLY_FILLED"}],
  [stop,n,n],
  [{...stop,executedQuantity:1,status:"PARTIALLY_FILLED"},n],
  [{...stop,stopPrice:95},n],
  [{...stop,quantity:5},n],
 ]){
  const v=advanceThreeFloorCutover(j,{type:"NEW_ORDER_READBACK",orders:rows,
      position,at:at+1000});
  assert.equal(v.phase,"MANUAL_REVIEW");
  assert.equal(nextThreeFloorCutoverAction(v),"STOP_AND_MANUAL_REVIEW");
 }
});
test("partial/mismatched actual venue position is not authorized",()=>{
 const {j,stop,position,at}=awaitNew(),newStop=placed(j,stop);
 for(const p of [{...position,quantity:3},{...position,markPrice:100.9},
                 {...position,side:"SHORT" as const},
                 {...position,capturedAt:ts}]){
  assert.equal(advanceThreeFloorCutover(j,{type:"NEW_ORDER_READBACK",
     orders:[stop,newStop],position:p,at:at+1500}).phase,"MANUAL_REVIEW");
 }
});
test("failed old-stop cancellation remains manual review, never completed",()=>{
 const {j,newStop,stop,position,at}=verified();
 const next=advanceThreeFloorCutover(
  advanceThreeFloorCutover(j,{type:"OLD_CANCEL_ATTEMPT_DURABLY_RECORDED"}),
  {type:"CANCEL_ACK_OR_TIMEOUT"});
 const bad=advanceThreeFloorCutover(next,{type:"FINAL_READBACK",orders:[stop,newStop],
   position,at:at+4000});
 assert.equal(bad.phase,"MANUAL_REVIEW");
 assert.match(bad.reviewReason!,/OLD_STOP_STILL_ACTIVE/);
});
test("new protective STOP disappearing after cancellation blocks completion",()=>{
 const {j,position,at}=verified();
 const a=advanceThreeFloorCutover(j,{type:"OLD_CANCEL_ATTEMPT_DURABLY_RECORDED"});
 const v=advanceThreeFloorCutover(a,{type:"FINAL_READBACK",
  orders:[],position,at:at+3500});
 assert.equal(v.phase,"MANUAL_REVIEW");
 assert.match(v.reviewReason!,/NEW_STOP_UNVERIFIED/);
});
test("missing signature, old STOP not NEW and mark already crossed block initial plan",()=>{
 const s=arm(),f=signed(s);
 for(const x of [
  {old:{...f.old,status:"UNKNOWN"},pos:f.pos},
  {old:{...f.old,reduceOnly:false},pos:f.pos},
  {old:f.old,pos:{...f.pos,markPrice:99}},
 ]){
  assert.throws(()=>prepareThreeFloorCutover({
    state:s,signedPosition:x.pos,signedOldStop:x.old,
    normalizedPrice:101,at:f.at}),/PREFLIGHT_BLOCKED/);
 }
});
test("unknown execution result blocks without declaring success",()=>{
 const o=awaitNew();
 const v=advanceThreeFloorCutover(o.j,{type:"EXECUTION_UNKNOWN",reason:"rate limit and missing GET"});
 assert.equal(v.phase,"MANUAL_REVIEW");
 assert.equal(v.ordersSent,0);
 assert.throws(()=>advanceThreeFloorCutover(v,{type:"PLACE_ACK_OR_TIMEOUT"}),/TERMINAL/);
});
test("replay of same intent is idempotent in identity and late ACK does not grant authority",()=>{
 const a=prepared(),b=prepared();
 assert.deepEqual(a.journal,b.journal);
 const pa=advanceThreeFloorCutover(a.journal,{type:"INITIAL_INTENT_PERSISTED"});
 assert.equal(pa.phase,"VENUE_PLACE_INFLIGHT");
 assert.equal(nextThreeFloorCutoverAction(pa),"RECORD_PLACE_INTENT_BEFORE_SUBMISSION");
 assert.throws(()=>advanceThreeFloorCutover(pa,{type:"PLACE_ACK_OR_TIMEOUT"}),/INVALID_PHASE/);
});
