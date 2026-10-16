/**
 * Three-exit STOP cutover state machine.
 *
 * This module emits journal states and a NEXT ACTION description; it NEVER calls
 * any exchange API, and MUST NOT be used as order authority by itself.
 * Actual owner-ledger cutover remains blocked until signed Aster lifecycle
 * evidence, account lock, partial-fill reconciliation and operator permit pass.
 */
import {createHash} from "node:crypto";
import {
 THREE_EXIT_FLOOR_POLICY_ID,previewThreeExitFloorReplacement,
 type ExitFloorH1State,type ExistingSignedStop,type SignedFloorPosition,
} from "./exit-profit-floor-three";

export type ThreeFloorCutoverPhase =
 "INTENT_DURABLE_WRITE_REQUIRED"|"VENUE_PLACE_INFLIGHT"|"AWAIT_NEW_READBACK"|
 "NEW_VERIFIED"|"OLD_CANCEL_INFLIGHT"|"AWAIT_FINAL_READBACK"|
 "COMPLETE"|"MANUAL_REVIEW";

export interface ThreeFloorCutoverJournal {
 schema:"three-profit-floor-cutover/v1";
 policyId:typeof THREE_EXIT_FLOOR_POLICY_ID;
 owner:"Q102"|"V12_V4";
 legId:string;
 symbol:string;
 side:"LONG"|"SHORT";
 quantity:number;
 oldClientOrderId:string;
 newClientOrderId:string;
 oldStopPrice:number;
 desiredStopPrice:number;
 effectiveFromTs:number;
 startedAt:number;
 phase:ThreeFloorCutoverPhase;
 reviewReason?:string;
 readbackNewAt?:number;
 completedAt?:number;
 ordersSent:0; // The journal and this library never issue calls.
}
export type CutoverNext =
 "PERSIST_INITIAL_INTENT"|"RECORD_PLACE_INTENT_BEFORE_SUBMISSION"|
 "READ_NEW_ORDER_ONLY_NO_RETRY"|"PERSIST_NEW_VERIFICATION"|
 "RECORD_CANCEL_INTENT_BEFORE_CANCEL"|"READ_FINAL_NEW_AND_OLD"|
 "COMPLETE_NO_ACTION"|"STOP_AND_MANUAL_REVIEW";

const same=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-10,Math.abs(b)*1e-9);
const finite=(v:number)=>Number.isFinite(v)&&v>0;
const safeOld=(o:ExistingSignedStop,j:ThreeFloorCutoverJournal)=>
 o.clientOrderId===j.oldClientOrderId&&o.symbol===j.symbol&&
 o.side===(j.side==="LONG"?"SELL":"BUY")&&o.type==="STOP_MARKET"&&o.reduceOnly===true&&
 o.status==="NEW"&&o.executedQuantity===0&&finite(o.orderId)&&
 same(o.quantity,j.quantity)&&same(o.stopPrice,j.oldStopPrice);
const safeNew=(o:ExistingSignedStop,j:ThreeFloorCutoverJournal)=>
 o.clientOrderId===j.newClientOrderId&&o.symbol===j.symbol&&
 o.side===(j.side==="LONG"?"SELL":"BUY")&&o.type==="STOP_MARKET"&&o.reduceOnly===true&&
 o.status==="NEW"&&o.executedQuantity===0&&finite(o.orderId)&&
 same(o.quantity,j.quantity)&&same(o.stopPrice,j.desiredStopPrice);
const signedPosition=(p:SignedFloorPosition,j:ThreeFloorCutoverJournal,ts:number)=>
 p.symbol===j.symbol&&p.side===j.side&&same(p.quantity,j.quantity)&&
 finite(p.markPrice)&&Number.isFinite(p.capturedAt)&&p.capturedAt>=j.effectiveFromTs&&p.capturedAt<=ts&&
 (j.side==="LONG"?p.markPrice>j.desiredStopPrice:p.markPrice<j.desiredStopPrice);

/**
 * Initial intent is always persisted before the new STOP could be submitted.
 * The fingerprint clientOrderId remains identical across crashes and retries.
 */
export function prepareThreeFloorCutover(input:{
 state:ExitFloorH1State;
 signedPosition:SignedFloorPosition;
 signedOldStop:ExistingSignedStop;
 normalizedPrice:number;
 at:number;
}):ThreeFloorCutoverJournal{
 const{state,signedPosition:p,signedOldStop:o,normalizedPrice,at}=input;
 const review=previewThreeExitFloorReplacement({
  state,signedPosition:p,signedStop:o,normalizedRequestedStopPrice:normalizedPrice,observedAt:at,
 });
 if(review.kind!=="SHADOW_READY"||!review.newStopPrice||
    !state.effectiveFromTs)
  throw Error("THREE_EXIT_CUTOVER_PREFLIGHT_BLOCKED:"+review.reason);
 const id=createHash("sha256").update(JSON.stringify([
  THREE_EXIT_FLOOR_POLICY_ID,state.owner,state.legId,o.clientOrderId,
  review.newStopPrice,p.quantity,state.effectiveFromTs,
 ])).digest("hex").slice(0,23);
 const newId=(state.owner==="Q102"?"q102-floor-":"v4-floor-")+id;
 return {
  schema:"three-profit-floor-cutover/v1",policyId:THREE_EXIT_FLOOR_POLICY_ID,
  owner:state.owner,legId:state.legId,symbol:state.symbol,
  side:state.side,quantity:p.quantity,
  oldClientOrderId:o.clientOrderId,newClientOrderId:newId,
  oldStopPrice:o.stopPrice,desiredStopPrice:review.newStopPrice,
  effectiveFromTs:state.effectiveFromTs,startedAt:at,
  phase:"INTENT_DURABLE_WRITE_REQUIRED",ordersSent:0,
 };
}
export function nextThreeFloorCutoverAction(j:ThreeFloorCutoverJournal):CutoverNext{
 switch(j.phase){
 case "INTENT_DURABLE_WRITE_REQUIRED":return "PERSIST_INITIAL_INTENT";
 case "VENUE_PLACE_INFLIGHT":return "RECORD_PLACE_INTENT_BEFORE_SUBMISSION";
 case "AWAIT_NEW_READBACK":return "READ_NEW_ORDER_ONLY_NO_RETRY";
 case "NEW_VERIFIED":return "RECORD_CANCEL_INTENT_BEFORE_CANCEL";
 case "OLD_CANCEL_INFLIGHT":case "AWAIT_FINAL_READBACK":return "READ_FINAL_NEW_AND_OLD";
 case "COMPLETE":return "COMPLETE_NO_ACTION";
 default:return "STOP_AND_MANUAL_REVIEW";
 }
}
export type ThreeFloorCutoverEvent =
 {type:"INITIAL_INTENT_PERSISTED"}|
 {type:"PLACE_ATTEMPT_DURABLY_RECORDED"}|
 {type:"PLACE_ACK_OR_TIMEOUT"}|
 {type:"NEW_ORDER_READBACK";orders:readonly ExistingSignedStop[];position:SignedFloorPosition;at:number}|
 {type:"OLD_CANCEL_ATTEMPT_DURABLY_RECORDED"}|
 {type:"CANCEL_ACK_OR_TIMEOUT"}|
 {type:"FINAL_READBACK";orders:readonly ExistingSignedStop[];position:SignedFloorPosition;at:number}|
 {type:"EXECUTION_UNKNOWN";reason:string};
const unsafe=(j:ThreeFloorCutoverJournal,reason:string):ThreeFloorCutoverJournal=>
 ({...j,phase:"MANUAL_REVIEW",reviewReason:reason,ordersSent:0});

/**
 * Transitions require owner-signed venue snapshots. No commands execute here.
 * One unknown acknowledgement never becomes an unconditional second PLACE.
 */
export function advanceThreeFloorCutover(j:ThreeFloorCutoverJournal,event:ThreeFloorCutoverEvent):ThreeFloorCutoverJournal{
 if(j.schema!=="three-profit-floor-cutover/v1"||j.policyId!==THREE_EXIT_FLOOR_POLICY_ID||
    j.ordersSent!==0||!j.legId||!j.symbol||
    !finite(j.quantity)||!finite(j.oldStopPrice)||!finite(j.desiredStopPrice)||
    !j.newClientOrderId||j.newClientOrderId===j.oldClientOrderId)
   throw Error("THREE_EXIT_CUTOVER_JOURNAL_IDENTITY_INVALID");
 if(j.phase==="COMPLETE"||j.phase==="MANUAL_REVIEW")
   throw Error("THREE_EXIT_CUTOVER_TERMINAL_JOURNAL");
 if(event.type==="EXECUTION_UNKNOWN")
   return unsafe(j,"VENUE_RESULT_UNKNOWN:"+event.reason.slice(0,150));
 switch(event.type){
 case "INITIAL_INTENT_PERSISTED":
   if(j.phase!=="INTENT_DURABLE_WRITE_REQUIRED")break;
   return {...j,phase:"VENUE_PLACE_INFLIGHT"};
 case "PLACE_ATTEMPT_DURABLY_RECORDED":
   if(j.phase!=="VENUE_PLACE_INFLIGHT")break;
   return {...j,phase:"AWAIT_NEW_READBACK"};
 case "PLACE_ACK_OR_TIMEOUT":
   if(j.phase!=="AWAIT_NEW_READBACK")break;
   return j; // No blind retry; read venue by exact clientOrderId.
 case "NEW_ORDER_READBACK":{
   if(j.phase!=="AWAIT_NEW_READBACK")break;
   if(event.at<j.startedAt||!signedPosition(event.position,j,event.at))
      return unsafe(j,"NEW_READBACK_POSITION_DRIFT_OR_MARK_CROSSED");
   const newActive=event.orders.filter(o=>o.clientOrderId===j.newClientOrderId);
   const oldActive=event.orders.filter(o=>o.clientOrderId===j.oldClientOrderId);
   if(newActive.length===0)return j; // Ambiguous ACK; wait for new signed readback.
   if(newActive.length!==1||oldActive.length!==1||
      !safeNew(newActive[0],j)||!safeOld(oldActive[0],j))
      return unsafe(j,"NEW_OR_OLD_STOP_UNSAFE_AFTER_READBACK");
   return {...j,phase:"NEW_VERIFIED",readbackNewAt:event.at};
 }
 case "OLD_CANCEL_ATTEMPT_DURABLY_RECORDED":
   if(j.phase!=="NEW_VERIFIED")break;
   return {...j,phase:"OLD_CANCEL_INFLIGHT"};
 case "CANCEL_ACK_OR_TIMEOUT":
   if(j.phase!=="OLD_CANCEL_INFLIGHT")break;
   return {...j,phase:"AWAIT_FINAL_READBACK"};
 case "FINAL_READBACK":{
   if(j.phase!=="OLD_CANCEL_INFLIGHT"&&j.phase!=="AWAIT_FINAL_READBACK")break;
   if(!j.readbackNewAt||event.at<j.readbackNewAt||!signedPosition(event.position,j,event.at))
      return unsafe(j,"FINAL_READBACK_POSITION_DRIFT");
   const newActive=event.orders.filter(o=>o.clientOrderId===j.newClientOrderId);
   const oldActive=event.orders.filter(o=>o.clientOrderId===j.oldClientOrderId);
   if(newActive.length!==1||!safeNew(newActive[0],j))
      return unsafe(j,"NEW_STOP_UNVERIFIED_AFTER_CANCEL");
   if(oldActive.length!==0)
      return unsafe(j,"OLD_STOP_STILL_ACTIVE_AFTER_CANCEL");
   return {...j,phase:"COMPLETE",completedAt:event.at};
 }
 }
 throw Error("THREE_EXIT_CUTOVER_INVALID_PHASE_TRANSITION:"+j.phase+":"+event.type);
}
