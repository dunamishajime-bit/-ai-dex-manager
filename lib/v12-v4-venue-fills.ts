/** Pure accounting over independently read venue order and user-trade records.
 * Does not submit orders, release shared reservations, or assert resident protection.
 */
import type {V12AsterOrderView} from "./v12-aster-live-adapter";
import {applyProductionEvent,type State,type Event} from "./v12-v4-production-lifecycle";
export type V4VenueTrade={symbol:string;id:string|number;orderId:string|number;side:string;
 price:string|number;qty:string|number;commission:string|number;commissionAsset:string;time:number};
export type V4EntryFillProof={order:V12AsterOrderView;trades:V4VenueTrade[]};
function number(value:unknown,label:string,zero=false){
 const n=Number(value);if(!Number.isFinite(n)||(zero?n<0:n<=0))throw Error("INVALID_VENUE_"+label);return n;
}
function equivalentEvent(a:Event,b:Event){
 const left={...a,ts:0},right={...b,ts:0};return JSON.stringify(left)===JSON.stringify(right);
}
function applyUnique(state:State,event:Event){
 const prior=state.journal.find(x=>x.eventId===event.eventId);
 if(prior){if(!equivalentEvent(prior,event))throw Error("VENUE_TRADE_ID_CONFLICT");return state;}
 return applyProductionEvent(state,event);
}
export function reconcileV4EntryTrades(state:State,legId:string,cid:string,proof:V4EntryFillProof,at:number):State{
 const leg=state.legs[legId],order=proof.order;
 if(!leg||!cid||!Number.isFinite(at)||at<leg.entryTs||
  order.symbol!==leg.candidate.symbol||order.clientOrderId!==cid||order.orderId===undefined||
  order.side!==(leg.candidate.effectiveSide==="LONG"?"BUY":"SELL")||order.reduceOnly===true)throw Error("ENTRY_ORDER_IDENTITY_CONFLICT");
 if(!["NEW","PARTIALLY_FILLED","FILLED","CANCELED","EXPIRED","REJECTED"].includes(order.status))throw Error("ENTRY_ORDER_STATUS_UNRESOLVED");
 const requested=number(order.quantity,"REQUESTED_QTY"),executed=number(order.executedQuantity,"EXECUTED_QTY",true);
 if(requested>leg.requestedQty+1e-8||executed>requested+1e-8)throw Error("ENTRY_VENUE_QTY_CONFLICT");
 const ids=new Set<string>();let quantity=0,quote=0;
 const fills:Event[]=[];
 for(const trade of proof.trades){
  if(trade.id===undefined||trade.id===null||String(trade.id)===""||trade.symbol!==order.symbol||
   String(trade.orderId)!==String(order.orderId)||trade.side!==order.side||
   !Number.isFinite(trade.time)||trade.time<leg.entryTs||trade.time>at)throw Error("TRADE_ORDER_IDENTITY_CONFLICT");
  const identity=trade.symbol+":"+String(trade.id);
  if(ids.has(identity))throw Error("DUPLICATE_VENUE_TRADE_RECORD");ids.add(identity);
  const qty=number(trade.qty,"TRADE_QTY"),price=number(trade.price,"TRADE_PRICE"),fee=number(trade.commission,"COMMISSION",true);
  if(trade.commissionAsset!=="USDT")throw Error("VENUE_COMMISSION_USD_CONVERSION_REQUIRED");
  quantity+=qty;quote+=qty*price;
  fills.push({type:"ENTRY_FILL",eventId:"venue-trade:"+identity,ts:at,id:legId,qty,price,feeUsd:fee});
 }
 // Apply atomically only after the full executed quantity is independently accounted for.
 if(Math.abs(quantity-executed)>Math.max(1e-8,executed*1e-10))throw Error("TRADE_HISTORY_INCOMPLETE");
 if(executed>0&&(Math.abs(quote-order.quoteQuantity)>Math.max(1e-6,quote*1e-8)||
  Math.abs(quote/executed-order.averagePrice)>Math.max(1e-8,order.averagePrice*1e-8)))throw Error("TRADE_QUOTE_HISTORY_CONFLICT");
 let next=state;
 for(const fill of fills)next=applyUnique(next,fill);
 if(["FILLED","CANCELED","EXPIRED","REJECTED"].includes(order.status)){
  const terminal:Event={type:"ENTRY_TERMINAL",eventId:"venue-terminal:"+order.symbol+":"+String(order.orderId),ts:at,id:legId};
  next=applyUnique(next,terminal);
 }
 return next;
}
