import {appendV4ExecutionEvent, advanceV4Intent, advanceV4Protection, type V4ExecutionDocument} from "./v12-v4-execution-store";

export type UnknownEntryVenueEvidence = {
  observedAt:number;
  order:{status:"NOT_FOUND";code:-2013};
  positions:readonly {symbol:string;positionAmt:number|string;positionSide?:string}[];
  openOrders:readonly unknown[];
  userTrades:readonly unknown[];
  income:readonly unknown[];
};

function signedSymbolQty(rows:readonly {symbol:string;positionAmt:number|string}[],symbol:string){
  return rows.filter(row=>String(row.symbol).toUpperCase()===symbol.toUpperCase())
    .reduce((sum,row)=>sum+Number(row.positionAmt),0);
}

function stateSymbolQty(doc:V4ExecutionDocument,symbol:string,ignoredLegId:string){
  return Object.values(doc.state.legs)
    .filter(leg=>leg.id!==ignoredLegId&&String(leg.candidate.symbol).toUpperCase()===symbol.toUpperCase()&&(leg.status==="OPEN"||leg.status==="PENDING_EXIT"))
    .reduce((sum,leg)=>sum+(String(leg.candidate.effectiveSide).toUpperCase()==="SHORT"?-1:1)*Number(leg.qty),0);
}

function protectionClientOrderIds(doc:V4ExecutionDocument,symbol:string,ignoredLegId:string){
  const ids=new Set<string>();
  for(const leg of Object.values(doc.state.legs)){
    if(leg.id===ignoredLegId||String(leg.candidate.symbol).toUpperCase()!==symbol.toUpperCase()||(leg.status!=="OPEN"&&leg.status!=="PENDING_EXIT"))continue;
    const protection=doc.protections[leg.id];
    if(!protection||Number(protection.protectedQty)<Number(leg.qty))throw Error("V4_UNKNOWN_ENTRY_RECOVERY_KNOWN_PROTECTION_STATE_INVALID");
    for(const [key,value] of Object.entries(protection)){
      if(/clientorderid/i.test(key)&&typeof value==="string"&&value.length>0)ids.add(value);
    }
  }
  return ids;
}

function openOrderClientOrderId(row:unknown){
  if(!row||typeof row!=="object")return "";
  const record=row as Record<string,unknown>;
  return String(record.clientOrderId??record.origClientOrderId??"");
}

/**
 * This is an operator-only local-state recovery. It never retries an order and
 * never calls a venue mutation endpoint. A missing order is resolvable only
 * when the signed venue reads show -2013, no additional symbol exposure beyond
 * independently reconciled V4 legs, no unknown symbol open order, no user-trade
 * fill, and no symbol income in the submission window. This same-symbol case is
 * intentionally strict: every existing V4 leg must retain its signed
 * reduce-only protection read-back.
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
  const symbol=leg.candidate.symbol;
  const venueQty=signedSymbolQty(evidence.positions,symbol),knownQty=stateSymbolQty(doc,symbol,leg.id);
  if(!Number.isFinite(venueQty)||Math.abs(venueQty-knownQty)>1e-9)
    throw Error("V4_UNKNOWN_ENTRY_RECOVERY_POSITION_PRESENT");
  const knownProtectionIds=protectionClientOrderIds(doc,symbol,leg.id);
  const venueOpenOrderIds=new Set<string>();
  for(const row of evidence.openOrders){
    const clientOrderId=openOrderClientOrderId(row);
    if(clientOrderId)venueOpenOrderIds.add(clientOrderId);
    if(!knownProtectionIds.has(clientOrderId))throw Error("V4_UNKNOWN_ENTRY_RECOVERY_OPEN_ORDER_PRESENT");
  }
  for(const clientOrderId of knownProtectionIds){
    if(!venueOpenOrderIds.has(clientOrderId))throw Error("V4_UNKNOWN_ENTRY_RECOVERY_KNOWN_PROTECTION_NOT_READ_BACK");
  }
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
