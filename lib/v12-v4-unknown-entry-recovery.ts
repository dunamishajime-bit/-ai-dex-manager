import {appendV4ExecutionEvent, advanceV4Intent, advanceV4Protection, type V4ExecutionDocument} from "./v12-v4-execution-store";

export type UnknownEntryVenueEvidence = {
  observedAt:number;
  order:{status:"NOT_FOUND";code:-2013};
  positions:readonly {symbol:string;positionAmt:number|string}[];
  openOrders:readonly unknown[];
  userTrades:readonly unknown[];
  income:readonly unknown[];
};

function symbolQty(rows:readonly {symbol:string;positionAmt:number|string}[],symbol:string){
  return rows.filter(row=>String(row.symbol).toUpperCase()===symbol.toUpperCase())
    .reduce((sum,row)=>sum+Math.abs(Number(row.positionAmt)),0);
}

/**
 * This is an operator-only local-state recovery. It never retries an order and
 * never calls a venue mutation endpoint. A missing order is resolvable only
 * when the signed venue reads show -2013, zero symbol exposure, no symbol open
 * order, no user-trade fill, and no symbol income in the submission window.
 */
export function assertUnknownEntryNoVenueExecution(
  doc:V4ExecutionDocument,
  clientOrderId:string,
  evidence:UnknownEntryVenueEvidence,
){
  const intent=doc.intents[clientOrderId],leg=intent&&doc.state.legs[intent.legId],protection=leg&&doc.protections[leg.id];
  if(!intent||!leg||!protection)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_IDENTITY_MISSING");
  if(intent.action!=="ENTRY"||intent.stage!=="UNKNOWN"||leg.status!=="PENDING_ENTRY"||leg.qty!==0||
    !(protection.phase==="ENTRY_PREPARED"||protection.phase==="ENTRY_SENT")||protection.protectedQty!==0)
    throw Error("V4_UNKNOWN_ENTRY_RECOVERY_STATE_NOT_BENIGN");
  if(!Number.isFinite(evidence.observedAt)||evidence.observedAt<intent.updatedAt||evidence.observedAt<protection.updatedAt)
    throw Error("V4_UNKNOWN_ENTRY_RECOVERY_TIMESTAMP_INVALID");
  if(evidence.order.status!=="NOT_FOUND"||evidence.order.code!==-2013)
    throw Error("V4_UNKNOWN_ENTRY_RECOVERY_ORDER_EVIDENCE_INVALID");
  if(symbolQty(evidence.positions,leg.candidate.symbol)>1e-12)
    throw Error("V4_UNKNOWN_ENTRY_RECOVERY_POSITION_PRESENT");
  if(evidence.openOrders.length>0)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_OPEN_ORDER_PRESENT");
  if(evidence.userTrades.length>0)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_TRADE_PRESENT");
  if(evidence.income.length>0)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_INCOME_PRESENT");
  return {intent,leg,protection};
}

export function resolveUnknownEntryNoVenueExecution(
  doc:V4ExecutionDocument,
  clientOrderId:string,
  evidence:UnknownEntryVenueEvidence,
){
  const {intent,leg}=assertUnknownEntryNoVenueExecution(doc,clientOrderId,evidence);
  const event={type:"ENTRY_TERMINAL" as const,
    eventId:`venue-unknown-entry-terminal:${clientOrderId}`,
    ts:evidence.observedAt,id:leg.id};
  let next=appendV4ExecutionEvent(doc,event);
  next=advanceV4Intent(next,clientOrderId,"TERMINAL",evidence.observedAt);
  next=advanceV4Protection(next,leg.id,"CLOSED",evidence.observedAt,0);
  return {document:next,terminalEvent:event};
}
