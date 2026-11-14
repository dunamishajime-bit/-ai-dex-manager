import {appendV4ExecutionEvent,advanceV4Intent,advanceV4Protection,type V4ExecutionDocument} from "./v12-v4-execution-store";
export function isV4LocalSlippageRejection(doc:V4ExecutionDocument,cid:string):boolean{
 const i=doc.intents[cid],leg=i&&doc.state.legs[i.legId];
 return Boolean(i&&i.action==="ENTRY"&&i.stage==="TERMINAL"&&i.venueOrderId===undefined&&
  leg&&leg.status==="CANCELLED"&&leg.qty===0&&leg.reservationUsd===0&&
  doc.protections[leg.id]?.phase==="CLOSED"&&doc.state.journal.some(e=>
   e.type==="ENTRY_TERMINAL"&&e.id===leg.id&&e.eventId==="local-slippage-rejected:"+cid));
}
/** Caller holds the account lease and possesses a typed pre-transmission failure. */
export function rejectV4UnsentSlippageEntry(doc:V4ExecutionDocument,cid:string,at:number):V4ExecutionDocument{
 const i=doc.intents[cid],leg=i&&doc.state.legs[i.legId];
 if(!i||i.action!=="ENTRY"||i.stage!=="SUBMITTING"||i.venueOrderId!==undefined||
  !leg||leg.status!=="PENDING_ENTRY"||leg.qty!==0||doc.protections[leg.id]?.phase!=="ENTRY_PREPARED")
  throw Error("V4_LOCAL_SLIPPAGE_REJECTION_STATE_CONFLICT");
 let next=appendV4ExecutionEvent(doc,{type:"ENTRY_TERMINAL",eventId:"local-slippage-rejected:"+cid,ts:at,id:leg.id});
 next=advanceV4Intent(next,cid,"TERMINAL",at);
 return advanceV4Protection(next,leg.id,"CLOSED",at,0);
}
