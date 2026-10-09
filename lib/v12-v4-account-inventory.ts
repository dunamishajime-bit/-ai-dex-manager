import type { AsterV3Client, AsterPositionRiskRow, AsterOrderResponse } from "./aster-v3-client";

/** Claims must be reconstructed from currently persisted runner ownership, never hardcoded historical quantities. */
export type V4OwnerClaim={ owner:string; symbol:string; side:"LONG"|"SHORT"; qty:number; protectedByStop:boolean };
export type V4InventoryVerdict={capturedAtMs:number;positions:number;openOrders:number;blockers:string[];verified:boolean};
export function verifyV4Inventory(positions:readonly AsterPositionRiskRow[],orders:readonly AsterOrderResponse[],
  claims:readonly V4OwnerClaim[],capturedAtMs:number):V4InventoryVerdict {
 const blockers:string[]=[];
 const add=(condition:boolean,reason:string)=>{if(condition)blockers.push(reason);};
 if(!Number.isFinite(capturedAtMs)||capturedAtMs<=0)throw Error("BAD_V4_CAPTURE_TIME");
 const live=positions.map(x=>({symbol:String(x.symbol).toUpperCase(),qty:Number(x.positionAmt)})).filter(x=>{
  if(!Number.isFinite(x.qty))throw Error("INVALID_VENUE_POSITION");return Math.abs(x.qty)>1e-9;
 });
 const keys=new Set<string>();
 for(const c of claims){
  if(!c.owner||!/^[A-Z0-9]+$/.test(c.symbol)||!(c.qty>0)||!Number.isFinite(c.qty)||!["LONG","SHORT"].includes(c.side))throw Error("INVALID_OWNER_CLAIM");
  const key=c.symbol+":"+c.side;if(keys.has(key))throw Error("DUPLICATE_POSITION_OWNER");keys.add(key);
  const row=live.find(p=>p.symbol===c.symbol&&(p.qty>0?"LONG":"SHORT")===c.side);
  add(!row,"CLAIMED_POSITION_ABSENT:"+c.symbol);
  if(row)add(Math.abs(Math.abs(row.qty)-c.qty)>Math.max(1e-8,c.qty*1e-7),"OWNERSHIP_QTY_MISMATCH:"+c.symbol);
  if(c.protectedByStop){
   const stops=orders.filter(o=>o.symbol===c.symbol&&o.reduceOnly===true&&
     o.side===(c.side==="LONG"?"SELL":"BUY")&&String(o.type).toUpperCase()==="STOP_MARKET"&&
     ["NEW","PARTIALLY_FILLED"].includes(String(o.status).toUpperCase())&&Number(o.origQty)>=c.qty-1e-8);
   add(stops.length!==1,"RESIDENT_STOP_NOT_EXACTLY_ONE:"+c.symbol);
  }
 }
 for(const p of live)add(!claims.some(c=>c.symbol===p.symbol&&c.side===(p.qty>0?"LONG":"SHORT")),"UNOWNED_LIVE_POSITION:"+p.symbol);
 for(const o of orders)add(!claims.some(c=>c.symbol===String(o.symbol).toUpperCase()),"UNRECONCILED_OPEN_ORDER:"+o.symbol);
 return {capturedAtMs,positions:live.length,openOrders:orders.length,blockers,verified:blockers.length===0};
}
export async function readV4SignedInventory(client:Pick<AsterV3Client,"getPositions"|"getOpenOrders">,
 claims:readonly V4OwnerClaim[],now:()=>number=Date.now){
 const start=now();
 const [positions,orders]=await Promise.all([client.getPositions(),client.getOpenOrders()]);
 const end=now();if(end<start||end-start>30000)throw Error("STALE_V4_SIGNED_READBACK");
 return verifyV4Inventory(positions,orders,claims,end);
}
