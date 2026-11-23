import type {V12AsterOrderView} from "./v12-aster-live-adapter";
import type {V4VenueTrade} from "./v12-v4-venue-fills";
import {cooldownAfterV4ShortInitialFill} from "./v12-v4-four-rule-policy";
import {applyProductionEvent,type State,type Event} from "./v12-v4-production-lifecycle";
import type {AsterIncomeRow,AsterUserTradeRow,AsterOrderResponse} from "./aster-v3-client";
import {advanceV4Intent,advanceV4Protection,type V4ExecutionDocument} from "./v12-v4-execution-store";
import {reconcileV4Funding} from "./v12-v4-funding-ledger";

/** Reconcile one externally closed leg from a complete signed, flat account read. */
export function reconcileV4ExternalFlatClose(doc:V4ExecutionDocument,proof:{
 positions:readonly {positionAmt:string}[];openOrders:readonly unknown[];pendingCount:number;
 stop:Pick<AsterOrderResponse,"clientOrderId"|"orderId"|"symbol"|"status"|"type"|"side"|"reduceOnly"|"origQty"|"executedQty">;
 trades:readonly AsterUserTradeRow[];funding:readonly AsterIncomeRow[];observedAt:number;
}):V4ExecutionDocument{
 const {positions,openOrders,pendingCount,stop,trades,funding,observedAt:at}=proof;
 if(!Number.isSafeInteger(at)||at<(doc.state.journal.at(-1)?.ts??0)||pendingCount!==0||openOrders.length||
    positions.some(p=>typeof p.positionAmt!=="string"||!p.positionAmt.trim()||Number(p.positionAmt)!==0))
  throw Error("V4_EXTERNAL_CLOSE_ACCOUNT_NOT_FLAT");
 const legs=Object.values(doc.state.legs).filter(l=>l.status!=="CLOSED"&&l.status!=="CANCELLED");
 if(doc.state.initial.holdProtected||doc.state.foreign.length||legs.length!==1)
  throw Error("V4_EXTERNAL_CLOSE_OWNER_AMBIGUOUS");
 const [leg]=legs,{symbol,effectiveSide,route}=leg.candidate;
 const entrySide=effectiveSide==="LONG"?"BUY":"SELL",closeSide=entrySide==="BUY"?"SELL":"BUY";
 const intents=Object.values(doc.intents),liveIntents=intents.filter(i=>i.stage!=="TERMINAL");
 const entries=intents.filter(i=>i.action==="ENTRY"&&i.legId===leg.id),protection=doc.protections[leg.id];
 const [entry]=entries,[ownedStop]=liveIntents;
 if(leg.status!=="OPEN"||!(leg.qty>0)||leg.reservationUsd!==0||leg.exitRemainingQty!==0||
    entries.length!==1||!entry.venueOrderId||liveIntents.length!==1||
    ownedStop.action!=="STOP"||ownedStop.stage!=="ACKNOWLEDGED"||ownedStop.legId!==leg.id||
    !ownedStop.venueOrderId||protection?.phase!=="STOP_CONFIRMED"||
    Object.values(doc.protections).some(p=>p.legId!==leg.id&&p.phase!=="CLOSED")||
    protection.protectedQty!==leg.qty||protection.stopClientOrderId!==ownedStop.clientOrderId||
    stop.clientOrderId!==ownedStop.clientOrderId||String(stop.orderId)!==ownedStop.venueOrderId||
    stop.symbol!==symbol||stop.type!=="STOP_MARKET"||stop.side!==closeSide||stop.reduceOnly!==true||
    !["EXPIRED","CANCELED"].includes(stop.status??"")||!String(stop.executedQty??"").trim()||
    Number(stop.executedQty)!==0||Number(stop.origQty)!==leg.qty)
  throw Error("V4_EXTERNAL_CLOSE_STOP_OR_ENTRY_NOT_ATTESTED");
 if(trades.length!==2||funding.length>=1000)throw Error("V4_EXTERNAL_CLOSE_HISTORY_NOT_EXACT");
 const [opened,closed]=[...trades].sort((a,b)=>Number(a.time)-Number(b.time));
 const idIsValid=(value:unknown)=>typeof value==="number"?Number.isSafeInteger(value)&&value>0:
  typeof value==="string"&&/^[1-9]\d*$/.test(value);
 for(const t of [opened,closed]){
  if(t.symbol!==symbol||!idIsValid(t.id)||!idIsValid(t.orderId)||!Number.isSafeInteger(t.time)||
     Number(t.qty)!==leg.qty||!Number.isFinite(Number(t.price))||!(Number(t.price)>0)||
     t.commissionAsset!=="USDT"||!t.commission?.trim()||!Number.isFinite(Number(t.commission))||Number(t.commission)<0)
   throw Error("V4_EXTERNAL_CLOSE_INVALID_TRADE");
 }
 if(String(opened.orderId)!==entry.venueOrderId||opened.side!==entrySide||closed.side!==closeSide||
    String(opened.id)===String(closed.id)||intents.some(i=>i.venueOrderId===String(closed.orderId))||
    opened.time!<leg.entryTs||closed.time!<=opened.time!||closed.time!>at||
    Math.abs(Number(opened.price)*leg.qty-leg.entryNotional)>1e-8||
    Math.abs(Number(opened.commission)-leg.feesUsd)>1e-8||
    funding.some(f=>f.symbol!==symbol||f.time<opened.time!||f.time>closed.time!))
  throw Error("V4_EXTERNAL_CLOSE_TRADE_OWNERSHIP_MISMATCH");
 const fillId="venue-exit:"+symbol+":"+closed.id;
 if(doc.state.journal.some(e=>e.eventId===fillId))throw Error("V4_EXTERNAL_CLOSE_FILL_ALREADY_RECORDED");
 let state=reconcileV4Funding(doc.state,funding,at);
 state=applyProductionEvent(state,{type:"EXIT_REQUEST",eventId:"external-exit-request:"+symbol+":"+closed.orderId,
  ts:at,id:leg.id,qty:leg.qty});
 state=applyProductionEvent(state,{type:"EXIT_FILL",eventId:fillId,ts:at,id:leg.id,qty:leg.qty,
  price:Number(closed.price),feeUsd:Number(closed.commission),actualFillTs:closed.time,
  cooldownUntil:Math.max(at,state.cooldown[symbol+":"+route]??0)});
 const terminal=advanceV4Intent({...doc,state},ownedStop.clientOrderId,"TERMINAL",at);
 return advanceV4Protection(terminal,leg.id,"CLOSED",at);
}
/** An ACK cannot prove a realized exit. Only signed user trades count. */
export function reconcileV4ExitTrades(state:State,id:string,cid:string,order:V12AsterOrderView,
 trades:V4VenueTrade[],at:number,cooldownUntil:number){
 const leg=state.legs[id];
 if(!leg||!["PENDING_EXIT","CLOSED","OPEN"].includes(leg.status)||order.clientOrderId!==cid||
  order.symbol!==leg.candidate.symbol||order.reduceOnly!==true||
  order.side!==(leg.candidate.effectiveSide==="LONG"?"SELL":"BUY")||
  !order.orderId||at<leg.entryTs||!Number.isFinite(cooldownUntil))throw Error("V4_EXIT_IDENTITY_INVALID");
 if(!["NEW","PARTIALLY_FILLED","FILLED","CANCELED","EXPIRED","REJECTED"].includes(order.status))
  throw Error("V4_EXIT_STATUS_UNRESOLVED");
 const executed=Number(order.executedQuantity),requested=Number(order.quantity);
 const exitRequest=[...state.journal].reverse().find((e):e is Extract<Event,{type:"EXIT_REQUEST"}>=>e.type==="EXIT_REQUEST"&&e.id===id);
 if(!exitRequest||!(requested>0)||!Number.isFinite(executed)||executed<0||executed>requested+1e-8||
  requested>exitRequest.qty+1e-8)throw Error("V4_EXIT_ORDER_QTY_INVALID");
 let quantity=0,quote=0,next=state;
 const seen=new Set<string>(),events:Event[]=[];
 const earlyShortExit=leg.plannedExit?.reason==="V4_SHORT_INITIAL_ADVERSE_CANDIDATE";
 let actualFillTs:number|undefined;
 for(const trade of trades){
  if(trade.symbol!==order.symbol||String(trade.orderId)!==String(order.orderId)||
   trade.side!==order.side||trade.commissionAsset!=="USDT"||
   !Number.isFinite(trade.time)||trade.time<leg.entryTs||trade.time>at)throw Error("V4_EXIT_TRADE_NOT_OWNED");
  const key=trade.symbol+":"+String(trade.id);
  if(trade.id===undefined||trade.id===null||seen.has(key))throw Error("V4_EXIT_TRADE_DUPLICATE");
  seen.add(key);
  const qty=Number(trade.qty),price=Number(trade.price),fee=Number(trade.commission);
  if(!(qty>0)||!(price>0)||!Number.isFinite(fee)||fee<0)throw Error("V4_EXIT_FILL_INVALID");
  quantity+=qty;quote+=qty*price;
  actualFillTs=actualFillTs===undefined?trade.time:Math.max(actualFillTs,trade.time);
  events.push({type:"EXIT_FILL",eventId:"venue-exit:"+key,ts:at,id,qty,price,feeUsd:fee,cooldownUntil});
 }
 if(Math.abs(quantity-executed)>Math.max(1e-8,executed*1e-10))
  throw Error("V4_EXIT_TRADE_HISTORY_INCOMPLETE");
 if(executed>0&&(Math.abs(quote-order.quoteQuantity)>Math.max(1e-6,quote*1e-8)||
  Math.abs(quote/executed-order.averagePrice)>Math.max(1e-8,order.averagePrice*1e-8)))
  throw Error("V4_EXIT_EXECUTION_PRICE_MISMATCH");
 const earlyCooldown=cooldownAfterV4ShortInitialFill({
  side:leg.candidate.effectiveSide,
  reason:earlyShortExit?"V4_SHORT_INITIAL_ADVERSE_FILLED":"OTHER_EXIT",
  actualFillTs,
 });
 if(earlyCooldown!==undefined){
  for(const event of events){
   if(event.type==="EXIT_FILL"){
    event.cooldownUntil=earlyCooldown;
    event.cooldownKey=leg.candidate.symbol+":SHORT";
    event.actualFillTs=actualFillTs;
    event.routeCooldown=false;
   }
  }
 }
 for(const event of events){
  const old=next.journal.find(x=>x.eventId===event.eventId);
  if(old){
   // The recorded cooldown is durable evidence. Re-reading an identical
   // venue trade at a later time must not rewrite the already-booked exit.
   const normalized=old.type==="EXIT_FILL"?{...event,cooldownUntil:old.cooldownUntil}:event;
   if(JSON.stringify({...old,ts:0})!==JSON.stringify({...normalized,ts:0}))
    throw Error("V4_EXIT_EVENT_CONFLICT");
  }else next=applyProductionEvent(next,event);
 }
 return {state:next,remainingQty:next.legs[id].qty,
  requiresReview:["FILLED","CANCELED","EXPIRED","REJECTED"].includes(order.status)&&next.legs[id].qty>0};
}
