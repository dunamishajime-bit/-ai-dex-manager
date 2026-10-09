import type {V12AsterOrderView} from "./v12-aster-live-adapter";
import type {V4VenueTrade} from "./v12-v4-venue-fills";
import {applyProductionEvent,type State,type Event} from "./v12-v4-production-lifecycle";
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
 for(const trade of trades){
  if(trade.symbol!==order.symbol||String(trade.orderId)!==String(order.orderId)||
   trade.side!==order.side||trade.commissionAsset!=="USDT"||
   !Number.isFinite(trade.time)||trade.time<leg.entryTs||trade.time>at||trade.time>cooldownUntil)throw Error("V4_EXIT_TRADE_NOT_OWNED");
  const key=trade.symbol+":"+String(trade.id);
  if(trade.id===undefined||trade.id===null||seen.has(key))throw Error("V4_EXIT_TRADE_DUPLICATE");
  seen.add(key);
  const qty=Number(trade.qty),price=Number(trade.price),fee=Number(trade.commission);
  if(!(qty>0)||!(price>0)||!Number.isFinite(fee)||fee<0)throw Error("V4_EXIT_FILL_INVALID");
  quantity+=qty;quote+=qty*price;
  events.push({type:"EXIT_FILL",eventId:"venue-exit:"+key,ts:at,id,qty,price,feeUsd:fee,cooldownUntil});
 }
 if(Math.abs(quantity-executed)>Math.max(1e-8,executed*1e-10))
  throw Error("V4_EXIT_TRADE_HISTORY_INCOMPLETE");
 if(executed>0&&(Math.abs(quote-order.quoteQuantity)>Math.max(1e-6,quote*1e-8)||
  Math.abs(quote/executed-order.averagePrice)>Math.max(1e-8,order.averagePrice*1e-8)))
  throw Error("V4_EXIT_EXECUTION_PRICE_MISMATCH");
 for(const event of events){
  const old=next.journal.find(x=>x.eventId===event.eventId);
  if(old){
   if(JSON.stringify({...old,ts:0})!==JSON.stringify({...event,ts:0}))
    throw Error("V4_EXIT_EVENT_CONFLICT");
  }else next=applyProductionEvent(next,event);
 }
 return {state:next,remainingQty:next.legs[id].qty,
  requiresReview:["FILLED","CANCELED","EXPIRED","REJECTED"].includes(order.status)&&next.legs[id].qty>0};
}
