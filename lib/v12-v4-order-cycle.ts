import type {AsterV3Client,AsterUserTradeRow} from "./aster-v3-client";
import {V4DurableOrderDispatcher} from "./v12-v4-durable-orders";
import {V4ExecutionStore} from "./v12-v4-execution-store";
import {V4SharedReservations} from "./v12-v4-shared-reservations";
import {reconcileV4EntryTrades,type V4VenueTrade} from "./v12-v4-venue-fills";
import {reconcileV4ExitTrades} from "./v12-v4-venue-exit";
import {applyProductionEvent} from "./v12-v4-production-lifecycle";
import {reconcileV4Funding} from "./v12-v4-funding-ledger";
/** Venue GET-only reconciliation; this class never sends orders.
 * The separate durable dispatcher owns submitted mutations.
 */
export class V4OrderCycle{
 constructor(readonly store:V4ExecutionStore,readonly dispatcher:V4DurableOrderDispatcher,
  readonly reservations:V4SharedReservations,
  readonly client:Pick<AsterV3Client,"getUserTrades"|"getIncomeHistory">){}
 private async signedTrades(symbol:string,orderId:number,from:number,to:number):Promise<V4VenueTrade[]>{
  const all=await this.client.getUserTrades(symbol,{startTime:Math.max(0,from),endTime:to,limit:1000});
  if(all.length===1000)throw Error("V4_VENUE_TRADE_HISTORY_MAY_BE_TRUNCATED");
  return all.filter(t=>String(t.orderId)===String(orderId)).map((t:AsterUserTradeRow)=>({
   symbol:t.symbol,id:t.id as string|number,orderId:t.orderId as string|number,
   side:String(t.side??""),qty:String(t.qty??""),price:String(t.price??""),
   commission:String(t.commission??""),commissionAsset:String(t.commissionAsset??""),time:Number(t.time),
  }));
 }
 private lookup(cid:string){
  const doc=this.store.read(),intent=doc.intents[cid];
  if(!intent||!doc.state.legs[intent.legId])throw Error("V4_UNKNOWN_ORDER_INTENT");
  return {doc,intent};
 }
 async reconcileEntry(cid:string,at:number){
  const original=this.lookup(cid);
  if(original.intent.action!=="ENTRY")throw Error("V4_NOT_ENTRY_INTENT");
  const order=await this.dispatcher.reconcile(cid,at);
  if(!order)throw Error("V4_AMBIGUOUS_ENTRY_NOT_ABSENT_PROOF");
  const {doc,intent}=this.lookup(cid),leg=doc.state.legs[intent.legId];
  const trades=await this.signedTrades(order.symbol,Number(order.orderId),leg.entryTs,at);
  const state=reconcileV4EntryTrades(doc.state,intent.legId,cid,{order,trades},at);
  if(state!==doc.state)this.store.commit(doc.revision,{...doc,state});
  await this.reservations.synchronize(cid);
  return this.store.read();
 }
 async reconcileExit(cid:string,at:number,cooldownUntil:number){
  const original=this.lookup(cid);
  if(!["EXIT","STOP","TAKE_PROFIT"].includes(original.intent.action))
   throw Error("V4_NOT_EXIT_INTENT");
  const order=await this.dispatcher.reconcile(cid,at);
  if(!order)throw Error("V4_AMBIGUOUS_EXIT_NOT_ABSENT_PROOF");
  let {doc,intent}=this.lookup(cid);
  const leg=doc.state.legs[intent.legId];
  if(["STOP","TAKE_PROFIT"].includes(intent.action)&&leg.status==="OPEN"&&order.executedQuantity>0){
   if(!(order.quantity>0)||Math.abs(order.quantity-leg.qty)>Math.max(1e-8,leg.qty*1e-7))
    throw Error("V4_RESIDENT_STOP_OWNER_QTY_MISMATCH");
   const event={type:"EXIT_REQUEST" as const,eventId:"venue-protection-close:"+cid,
    ts:at,id:leg.id,qty:leg.qty};
   doc=this.store.commit(doc.revision,{...doc,state:applyProductionEvent(doc.state,event)});
  }
  const trades=await this.signedTrades(order.symbol,Number(order.orderId),leg.entryTs,at);
  const result=reconcileV4ExitTrades(doc.state,intent.legId,cid,order,trades,at,cooldownUntil);
  if(result.state!==doc.state)this.store.commit(doc.revision,{...doc,state:result.state});
  if(result.requiresReview)throw Error("V4_EXIT_RESIDUAL_REQUIRES_RECONCILIATION");
  return this.store.read();
 }
 async reconcileFunding(from:number,to:number,recordedAt:number=to){
  if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(recordedAt)||
     from<0||from>=to||to>recordedAt||to-from>86_400_000)
   throw Error("V4_FUNDING_RANGE_INVALID");
  const snapshot=this.store.read();
  const legs=Object.values(snapshot.state.legs).filter(l=>l.qty>0);
  if(!legs.length)return snapshot;
  const symbols=new Set(legs.map(l=>l.candidate.symbol));
  const incomes=await this.client.getIncomeHistory({
   incomeType:"FUNDING_FEE",startTime:from,endTime:to,limit:1000
  });
  if(incomes.length===1000)throw Error("V4_FUNDING_HISTORY_MAY_BE_TRUNCATED");
  // Aster may return inclusive start/end timestamps. Persist disjoint
  // funding windows (from, to] so a boundary settlement is never rebooked
  // under a different set of virtual owners after the next cycle.
  const relevant=incomes.filter(r=>Number(r.time)>from&&Number(r.time)<=to&&
    symbols.has(String(r.symbol))&&
    legs.some(l=>l.candidate.symbol===r.symbol&&Number(r.time)>=l.entryTs));
  const doc=this.store.read();
  let next=reconcileV4Funding(doc.state,relevant,recordedAt);
  next=applyProductionEvent(next,{type:"FUNDING_SCAN",
    eventId:"funding-scan:"+from+":"+to,ts:recordedAt,fromMs:from,throughMs:to});
  if(next===doc.state)return doc;
  return this.store.commit(doc.revision,{...doc,state:next});
 }
 /** Catch up from the durable journal before processing any live STOP/Exit. */
 async reconcileFundingUpTo(at:number){
  if(!Number.isFinite(at)||at<0)throw Error("V4_FUNDING_CLOCK_INVALID");
  for(let count=0;count<45;count++){
   const state=this.store.read().state;
   const legs=Object.values(state.legs).filter(l=>l.qty>0);
   if(!legs.length)return this.store.read();
   const previous=[...state.journal].reverse().find(e=>e.type==="FUNDING_SCAN");
   const lastEnd=previous?.type==="FUNDING_SCAN"?previous.throughMs:0;
   const earliest=Math.min(...legs.map(l=>l.entryTs));
   const from=Math.max(lastEnd,earliest);
   if(from>=at)return this.store.read();
   const to=Math.min(at,from+86_400_000);
   await this.reconcileFunding(from,to,at);
  }
  throw Error("V4_FUNDING_CATCHUP_TOO_OLD_REQUIRES_REVIEW");
 }
}
