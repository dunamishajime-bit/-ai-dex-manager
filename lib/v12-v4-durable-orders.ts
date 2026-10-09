/**
 * Mutating transport bridge over the existing Aster adapter.
 * This is a transport component, not a LIVE activator or fill ledger.
 * Production callers must supply independent certification, signed inventory,
 * shared gross reservation and account lease guards. ACK never proves a fill
 * or resident protection; venue trades/open orders must be reconciled separately.
 */
import {AsterApiError} from "./aster-v3-client";
import type {V12AsterLiveAdapter} from "./v12-aster-live-adapter";
import {V4ExecutionStore,v4OrderIdentity,advanceV4Intent,type V4OrderAction,type V4OrderIntent} from "./v12-v4-execution-store";
export type V4DurableOrderCommand={
 legId:string;action:V4OrderAction;sequence:number;symbol:string;positionSide:"LONG"|"SHORT";
 quantity:number;price:number;signalTs:number;
};
type Gateway=Pick<V12AsterLiveAdapter,"executeEntry"|"executeExit"|"placeStopMarket"|"placeTakeProfit"|"queryOrderSameId">;
export type V4DispatchGuards={
 assertAuthority:(command:V4DurableOrderCommand)=>Promise<void>;
 assertAccountLease:()=>Promise<void>;
 /** Must be idempotent by clientOrderId and persist in shared pending exposure registry. */
 reserveShared:(clientOrderId:string,command:V4DurableOrderCommand)=>Promise<void>;
};
function commandOf(intent:V4OrderIntent):V4DurableOrderCommand{
 if(!intent.command)throw Error("DURABLE_ORDER_COMMAND_MISSING");
 const c=intent.command as V4DurableOrderCommand;
 if(c.legId!==intent.legId||c.action!==intent.action||c.sequence!==intent.sequence||
   !/^[A-Z0-9]+$/.test(c.symbol)||!["LONG","SHORT"].includes(c.positionSide)||
   ![c.quantity,c.price].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(c.signalTs))throw Error("INVALID_DURABLE_ORDER_COMMAND");
 return structuredClone(c);
}
export class V4DurableOrderDispatcher{
 constructor(readonly store:V4ExecutionStore,readonly gateway:Gateway,readonly guards:V4DispatchGuards){}
 prepare(command:V4DurableOrderCommand,ts:number):string{
  const doc=this.store.read();
  const cid=v4OrderIdentity(doc.releaseSha,command.legId,command.action,command.sequence);
  const intent:V4OrderIntent={clientOrderId:cid,legId:command.legId,action:command.action,sequence:command.sequence,
    stage:"PREPARED",createdAt:ts,updatedAt:ts,command:structuredClone(command)};
  commandOf(intent);
  const previous=doc.intents[cid];
  if(previous){
   if(JSON.stringify(previous.command)!==JSON.stringify(command))throw Error("DURABLE_ORDER_COMMAND_CONFLICT");
   return cid;
  }
  this.store.commit(doc.revision,{...doc,intents:{...doc.intents,[cid]:intent}});
  return cid;
 }
 async submit(cid:string,ts:number){
  let doc=this.store.read(),intent=doc.intents[cid];
  if(!intent||intent.stage!=="PREPARED")throw Error("ORDER_RECONCILIATION_REQUIRED");
  const command=commandOf(intent);
  await this.guards.assertAuthority(command);
  await this.guards.assertAccountLease();
  if(command.action==="ENTRY")await this.guards.reserveShared(cid,command);
  // A stale competing caller fails here before any venue mutation.
  doc=this.store.commit(doc.revision,advanceV4Intent(doc,cid,"SUBMITTING",ts));
  try{
   await this.guards.assertAccountLease();
   const common={symbol:command.symbol,quantity:command.quantity,clientOrderId:cid};
   let result;
   if(command.action==="ENTRY")result=await this.gateway.executeEntry({...common,side:command.positionSide,signalTs:command.signalTs,expectedPrice:command.price});
   else if(command.action==="EXIT")result=await this.gateway.executeExit({...common,positionSide:command.positionSide,signalTs:command.signalTs,expectedPrice:command.price});
   else{
    const conditional={...common,side:command.positionSide==="LONG"?"SELL" as const:"BUY" as const,stopPrice:command.price,reduceOnly:true as const};
    result=command.action==="STOP"?await this.gateway.placeStopMarket(conditional):await this.gateway.placeTakeProfit(conditional);
   }
   // Even a terminal ACK is not a fill proof. Read-only reconciliation follows.
   const ambiguous="executionUnknown" in result&&result.executionUnknown;
   this.store.commit(doc.revision,advanceV4Intent(doc,cid,ambiguous?"UNKNOWN":"ACKNOWLEDGED",ts));
   return result;
  }catch(error){
   const current=this.store.read();
   if(current.intents[cid].stage==="SUBMITTING")this.store.commit(current.revision,advanceV4Intent(current,cid,"UNKNOWN",ts));
   throw error;
  }
 }
 async reconcile(cid:string,ts:number){
  const doc=this.store.read(),intent=doc.intents[cid];
  if(!intent||intent.stage==="PREPARED")throw Error("ORDER_NOT_SUBMITTED");
  const command=commandOf(intent);
  const view=await this.gateway.queryOrderSameId(command.symbol,cid);
  // -2013/null is not evidence that an ambiguous submission was never executed.
  if(!view)return null;
  const expectedSide=command.action==="ENTRY"? (command.positionSide==="LONG"?"BUY":"SELL") : (command.positionSide==="LONG"?"SELL":"BUY");
  if(view.clientOrderId!==cid||view.symbol!==command.symbol||(view.side&&view.side!==expectedSide))throw Error("ORDER_READBACK_IDENTITY_CONFLICT");
  if(command.action!=="ENTRY"&&view.reduceOnly!==true)throw Error("ORDER_READBACK_NOT_REDUCE_ONLY");
  const terminal=["FILLED","CANCELED","EXPIRED","REJECTED"].includes(view.status);
  const target=terminal?"TERMINAL":"ACKNOWLEDGED";
  if(view.orderId!==undefined&&(!Number.isSafeInteger(view.orderId)||view.orderId<=0))throw Error("VENUE_ORDER_ID_INVALID");
  if(intent.venueOrderId!==undefined&&view.orderId!==undefined&&intent.venueOrderId!==String(view.orderId))throw Error("VENUE_ORDER_ID_CHANGED");
  let next=doc;
  if(intent.stage!=="TERMINAL"&&intent.stage!==target)next=advanceV4Intent(doc,cid,target,ts);
  if(view.orderId!==undefined&&intent.venueOrderId===undefined){
   next=structuredClone(next);next.intents[cid].venueOrderId=String(view.orderId);
   next.intents[cid].updatedAt=Math.max(next.intents[cid].updatedAt,ts);
  }
  if(next!==doc)this.store.commit(doc.revision,next);
  return view;
 }
}

/** Readback bypasses legacy protection-fill notification classification. */
export function createV4AsterOrderGateway(adapter:V12AsterLiveAdapter):Gateway{
 return {
  executeEntry:input=>adapter.executeEntry(input),
  executeExit:input=>adapter.executeExit(input),
  placeStopMarket:input=>adapter.placeStopMarket(input),
  placeTakeProfit:input=>adapter.placeTakeProfit(input),
  queryOrderSameId:async(symbol,cid)=>{
   try{
    const raw=await adapter.client.getOrder(symbol,cid);
    const number=(value:unknown)=>{const n=Number(value??0);if(!Number.isFinite(n)||n<0)throw Error("INVALID_VENUE_ORDER_NUMBER");return n;};
    return {symbol:String(raw.symbol??"").toUpperCase(),clientOrderId:String(raw.clientOrderId??""),
     orderId:raw.orderId,status:String(raw.status??"UNKNOWN").toUpperCase(),side:raw.side,type:raw.type,
     reduceOnly:raw.reduceOnly,quantity:number(raw.origQty),executedQuantity:number(raw.executedQty),
     averagePrice:number(raw.avgPrice),quoteQuantity:number(raw.cumQuote),
     updatedAt:raw.updateTime,stopPrice:number(raw.stopPrice)};
   }catch(error){if(error instanceof AsterApiError&&error.code===-2013)return null;throw error;}
  },
 };
}
