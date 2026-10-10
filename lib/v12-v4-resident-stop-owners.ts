/** Strong one-to-one attribution of exchange STOPs to V4 virtual legs. */
import type {State} from "./v12-v4-production-lifecycle";
import type {V4OrderIntent} from "./v12-v4-execution-store";
import type {AsterOrderResponse} from "./aster-v3-client";
type StopView=Pick<AsterOrderResponse,"symbol"|"clientOrderId"|"side"|"type"|"reduceOnly"|"origQty"|"executedQty"|"status">;
export function verifyV4ResidentStops(
 state:State,intents:Record<string,V4OrderIntent>,openOrders:readonly StopView[]){
 const legs=Object.values(state.legs).filter(l=>l.qty>0);
 const allowed=new Set<string>();
 for(const leg of legs){
  const stops=Object.values(intents).filter(i=>i.legId===leg.id&&i.action==="STOP");
  const active=stops.filter(i=>openOrders.some(o=>o.clientOrderId===i.clientOrderId));
  if(active.length!==1)throw Error("V4_LEG_RESIDENT_STOP_OWNER_MISSING:"+leg.id);
  const intent=active[0],order=openOrders.find(o=>o.clientOrderId===intent.clientOrderId)!;
  if(!["ACKNOWLEDGED","TERMINAL"].includes(intent.stage)||
   order.symbol!==leg.candidate.symbol||order.type!=="STOP_MARKET"||
   order.reduceOnly!==true||order.side!==(leg.candidate.effectiveSide==="LONG"?"SELL":"BUY")||
   !["NEW","PARTIALLY_FILLED"].includes(String(order.status).toUpperCase()))
   throw Error("V4_LEG_STOP_VENUE_IDENTITY_INVALID:"+leg.id);
  const remaining=Number(order.origQty)-Number(order.executedQty);
  if(!Number.isFinite(remaining)||remaining<=0||
   Math.abs(remaining-leg.qty)>Math.max(1e-8,leg.qty*1e-7))
   throw Error("V4_LEG_STOP_REMAINING_QUANTITY_MISMATCH:"+leg.id);
  allowed.add(intent.clientOrderId);
 }
 const symbols=new Set(legs.map(l=>l.candidate.symbol));
 for(const o of openOrders){
  if(o.type==="STOP_MARKET"&&o.reduceOnly===true&&symbols.has(o.symbol)&&
    !allowed.has(o.clientOrderId??""))
    throw Error("V4_UNATTRIBUTED_RESIDENT_STOP:"+o.symbol);
 }
 return {verifiedLegs:legs.length,uniqueStopOrders:allowed.size,ready:true as const};
}
