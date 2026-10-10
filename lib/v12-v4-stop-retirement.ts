/** Signed account / journal identity rules before retiring STOP after a verified EXIT. */
import type {State} from "./v12-v4-production-lifecycle";
import type {V4OrderIntent} from "./v12-v4-execution-store";
import type {AsterOrderResponse,AsterPositionRiskRow} from "./aster-v3-client";

type Stop=Pick<AsterOrderResponse,"symbol"|"clientOrderId"|"side"|"type"|"reduceOnly"|"origQty"|"executedQty"|"status">;
type Position=Pick<AsterPositionRiskRow,"symbol"|"positionAmt">;

export function planV4RetiredStops(args:{
 state:State;intents:Record<string,V4OrderIntent>;
 openOrders:readonly Stop[];positions:readonly Position[];
}):string[]{
 const {state,intents,openOrders,positions}=args;
 const retired=Object.values(state.legs).filter(l=>l.qty===0&&l.status==="CLOSED");
 const active=Object.values(state.legs).filter(l=>l.qty>0);
 const retire:string[]=[];
 for(const leg of retired){
  const owned=Object.values(intents).filter(i=>i.legId===leg.id&&i.action==="STOP");
  const stillOpen=owned.filter(i=>openOrders.some(o=>o.clientOrderId===i.clientOrderId));
  if(stillOpen.length===0)continue;
  if(stillOpen.length!==1)throw Error("V4_CLOSED_LEG_STOP_AMBIGUOUS:"+leg.id);
  const id=stillOpen[0].clientOrderId;
  const order=openOrders.find(o=>o.clientOrderId===id)!;
  if(order.symbol!==leg.candidate.symbol||order.type!=="STOP_MARKET"||
     order.reduceOnly!==true||order.side!==(leg.candidate.effectiveSide==="LONG"?"SELL":"BUY")||
     !["NEW"].includes(String(order.status).toUpperCase())||
     !(Number(order.origQty)>0)||Number(order.executedQty)!==0)
    throw Error("V4_CLOSED_LEG_STOP_NOT_SAFE_TO_CANCEL:"+leg.id);
  // Aster one-way venue quantity must equal the remaining V4-owned legs;
  // other peer same-symbol occupancy is not enough evidence to auto-cancel.
  const same=active.filter(l=>l.candidate.symbol===leg.candidate.symbol);
  const sides=new Set(same.map(l=>l.candidate.effectiveSide));
  if(sides.size>1)throw Error("V4_CLOSED_LEG_OPPOSING_OWNER");
  const expected=same.reduce((n,l)=>n+l.qty*(l.candidate.effectiveSide==="LONG"?1:-1),0);
  const signed=positions.filter(p=>p.symbol===leg.candidate.symbol);
  const actual=signed.reduce((n,p)=>n+Number(p.positionAmt),0);
  if(signed.length>1||!Number.isFinite(actual)||
    Math.abs(expected-actual)>Math.max(1e-8,Math.abs(expected)*1e-7))
    throw Error("V4_CLOSED_LEG_ACCOUNT_EXPOSURE_CONFLICT:"+leg.candidate.symbol);
  // Another open leg's STOP must exist and be correctly sized before
  // reducing the old stop's protective coverage.
  for(const other of same){
   const matches=Object.values(intents).filter(i=>i.legId===other.id&&i.action==="STOP"&&
     openOrders.some(o=>o.clientOrderId===i.clientOrderId));
   if(matches.length!==1)throw Error("V4_REMAINING_LEG_STOP_NOT_PROTECTED:"+other.id);
   const otherOrder=openOrders.find(o=>o.clientOrderId===matches[0].clientOrderId)!;
   if(otherOrder.reduceOnly!==true||otherOrder.type!=="STOP_MARKET"||
      otherOrder.side!==(other.candidate.effectiveSide==="LONG"?"SELL":"BUY")||
      Number(otherOrder.origQty)-Number(otherOrder.executedQty)!==other.qty)
    throw Error("V4_REMAINING_LEG_STOP_QTY_CONFLICT:"+other.id);
  }
  retire.push(id);
 }
 return retire;
}
