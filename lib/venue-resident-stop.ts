import { createHash } from 'node:crypto';
import type { AsterV3Client, AsterOrderResponse } from './aster-v3-client';
import { normalizeRecoveryV8OrderValue } from './pengu-recovery-v8-protective-orders';

export interface ResidentStopPlan { symbol:string; side:'BUY'|'SELL'; quantity:number; stopPrice:number; reduceOnly:true; clientOrderId:string }
export interface ResidentStopOrder extends Omit<ResidentStopPlan,'reduceOnly'> { reduceOnly:boolean; status:string; orderId:number; executedQuantity:number; averagePrice:number; updatedAt?:number }
export interface ResidentStopGateway {
 normalize(plan:ResidentStopPlan):Promise<ResidentStopPlan>;
 openOrders(symbol:string):Promise<ResidentStopOrder[]>;
 place(plan:ResidentStopPlan):Promise<ResidentStopOrder>;
 getOrder(symbol:string,id:string):Promise<ResidentStopOrder>;
 cancel(symbol:string,id:string):Promise<void>;
}
export interface ResidentStopPosition { strategy:'PENGU'|'Q102'; symbol:string; side:1|-1; entryTs:number; entryPrice:number; quantity:number; stopFraction:number }
export interface ResidentStopProtection { protected:boolean; clientOrderId:string; orderId:number; symbol:string; side:'BUY'|'SELL'; quantity:number; originalQuantity:number; stopPrice:number; readBackStatus:'VERIFIED'|'UNVERIFIED'; lastReconciledAt:number }
const positive=(v:number)=>Number.isFinite(v)&&v>0;
const same=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-10,Math.abs(b)*1e-9);
export function residentStopPlan(p:ResidentStopPosition):ResidentStopPlan {
 if(!positive(p.entryTs)||!positive(p.entryPrice)||!positive(p.quantity)||!positive(p.stopFraction)||p.stopFraction>=1||![1,-1].includes(p.side)||!p.symbol)throw Error('RESIDENT_STOP_INVALID_ACTUAL_FILL');
 const stopPrice=p.entryPrice*(1-p.side*p.stopFraction);
 const digest=createHash('sha256').update(`${p.strategy}|${p.symbol}|${p.side}|${p.entryTs}|${p.entryPrice}|${p.quantity}|${stopPrice}`).digest('hex').slice(0,22);
 return{symbol:p.symbol.toUpperCase(),side:p.side===1?'SELL':'BUY',quantity:p.quantity,stopPrice,reduceOnly:true,clientOrderId:`${p.strategy.toLowerCase()}-stop-${digest}`};
}
function matches(o:ResidentStopOrder,p:ResidentStopPlan){return o.clientOrderId===p.clientOrderId&&o.symbol===p.symbol&&o.side===p.side&&o.reduceOnly===true&&['NEW','PARTIALLY_FILLED'].includes(o.status)&&same(o.quantity-o.executedQuantity,p.quantity)&&same(o.stopPrice,p.stopPrice)&&positive(o.orderId);}
export function validateResidentStopProtection(v:unknown):ResidentStopProtection|undefined {
 if(v===undefined)return undefined;
 const p=v as ResidentStopProtection;
 const allowed=['protected','clientOrderId','orderId','symbol','side','quantity','originalQuantity','stopPrice','readBackStatus','lastReconciledAt'];
 if(!p||typeof p!=='object'||Object.keys(p).some(k=>!allowed.includes(k))||typeof p.protected!=='boolean'||!/^((pengu)|(q102))-stop-[a-f0-9]{22}$/.test(p.clientOrderId)||!positive(p.orderId)||!p.symbol||!['BUY','SELL'].includes(p.side)||!positive(p.quantity)||!positive(p.originalQuantity)||p.originalQuantity<p.quantity||!positive(p.stopPrice)||!['VERIFIED','UNVERIFIED'].includes(p.readBackStatus)||p.protected!==(p.readBackStatus==='VERIFIED')||!positive(p.lastReconciledAt))throw Error('RESIDENT_STOP_STATE_MALFORMED');
 return p;
}
/** No blind retries; accepted-but-timed-out orders are adopted only on a later successful read. */
export async function ensureResidentStop(g:ResidentStopGateway,p:ResidentStopPosition,prior:ResidentStopProtection|undefined,now:number,persistIntent?:(plan:ResidentStopPlan)=>Promise<void>):Promise<ResidentStopProtection>{
 let plan=await g.normalize(residentStopPlan(p));
 if(!same(plan.quantity,p.quantity))throw Error('RESIDENT_STOP_QUANTITY_NORMALIZATION_MISMATCH');
 const prefix=`${p.strategy.toLowerCase()}-stop-`;
 let orders=await g.openOrders(plan.symbol);
 const partial=prior&&orders.find(o=>o.clientOrderId===prior.clientOrderId&&o.status==='PARTIALLY_FILLED'&&o.executedQuantity>0);
 if(partial&&matches(partial,{...plan,clientOrderId:prior!.clientOrderId})) plan={...plan,clientOrderId:prior!.clientOrderId};
 if(persistIntent)await persistIntent(plan);
 const relevant=()=>orders.filter(o=>o.clientOrderId.startsWith(prefix));
 const foreign=relevant().filter(o=>o.clientOrderId!==plan.clientOrderId&&o.clientOrderId!==prior?.clientOrderId);
 if(foreign.length||relevant().filter(o=>o.clientOrderId===plan.clientOrderId).length>1)throw Error('RESIDENT_STOP_DUPLICATE');
 let order=orders.find(o=>o.clientOrderId===plan.clientOrderId);
 if(!order){await g.place(plan);orders=await g.openOrders(plan.symbol);order=orders.find(o=>o.clientOrderId===plan.clientOrderId);}
 if(!order||!matches(order,plan))throw Error('RESIDENT_STOP_READ_BACK_MISMATCH');
 if(relevant().some(o=>o.clientOrderId!==plan.clientOrderId&&o.clientOrderId!==prior?.clientOrderId)||relevant().filter(o=>o.clientOrderId===plan.clientOrderId).length!==1)throw Error('RESIDENT_STOP_DUPLICATE');
 if(prior&&prior.clientOrderId!==plan.clientOrderId&&orders.some(o=>o.clientOrderId===prior.clientOrderId)){
  // New protection has been independently verified. A failed cancel remains degraded, never falsely protected.
  await g.cancel(plan.symbol,prior.clientOrderId);
  orders=await g.openOrders(plan.symbol);
  if(orders.some(o=>o.clientOrderId===prior.clientOrderId)||!orders.some(o=>matches(o,plan)))throw Error('RESIDENT_STOP_REPLACEMENT_READ_BACK_MISMATCH');
 }
 return{protected:true,clientOrderId:plan.clientOrderId,orderId:order.orderId,symbol:plan.symbol,side:plan.side,quantity:plan.quantity,originalQuantity:order.quantity,stopPrice:plan.stopPrice,readBackStatus:'VERIFIED',lastReconciledAt:now};
}
function fromVenue(o:AsterOrderResponse):ResidentStopOrder {
 const row=o as AsterOrderResponse&{stopPrice?:string};
 return{symbol:o.symbol,side:o.side as 'BUY'|'SELL',quantity:Number(o.origQty),stopPrice:Number(row.stopPrice),reduceOnly:o.reduceOnly===true,clientOrderId:String(o.clientOrderId||''),status:String(o.status||'UNKNOWN'),orderId:Number(o.orderId),executedQuantity:Number(o.executedQty),averagePrice:Number(o.avgPrice),updatedAt:Number(o.updateTime)};
}
export class AsterResidentStopGateway implements ResidentStopGateway {
 constructor(private readonly client:AsterV3Client){}
 async normalize(p:ResidentStopPlan){const s=(await this.client.getExchangeInfo()).symbols?.find(s=>s.symbol===p.symbol);const price=s?.filters?.find(f=>f.filterType==='PRICE_FILTER');const qty=s?.filters?.find(f=>f.filterType==='LOT_SIZE');if(!s||!price?.tickSize||!qty?.stepSize)throw Error('RESIDENT_STOP_VENUE_FILTERS_UNAVAILABLE');return{...p,quantity:Number(normalizeRecoveryV8OrderValue(p.quantity,qty.stepSize,s.quantityPrecision)),stopPrice:Number(normalizeRecoveryV8OrderValue(p.stopPrice,price.tickSize,s.pricePrecision))};}
 async openOrders(s:string){return(await this.client.getOpenOrders(s)).filter(o=>o.type==='STOP_MARKET').map(fromVenue);}
 async place(p:ResidentStopPlan){return fromVenue(await this.client.placeStopMarketOrder({symbol:p.symbol,side:p.side,quantity:String(p.quantity),stopPrice:String(p.stopPrice),positionSide:'BOTH',reduceOnly:true,newClientOrderId:p.clientOrderId,newOrderRespType:'RESULT'}));}
 async getOrder(s:string,id:string){return fromVenue(await this.client.getOrder(s,id));}
 async cancel(s:string,id:string){await this.client.cancelOrder(s,id);}
}

/** Called only after an independent venue position read proves flat. */
export async function retireResidentStop(g:ResidentStopGateway,p:ResidentStopProtection):Promise<void>{
 const order=await g.getOrder(p.symbol,p.clientOrderId);
 if(order.symbol!==p.symbol||order.clientOrderId!==p.clientOrderId||order.orderId!==p.orderId||order.side!==p.side||order.reduceOnly!==true)throw Error("RESIDENT_STOP_RETIRE_IDENTITY_MISMATCH");
 if(["NEW","PARTIALLY_FILLED"].includes(order.status)){
  await g.cancel(p.symbol,p.clientOrderId);
  const after=await g.getOrder(p.symbol,p.clientOrderId);
  if(!["CANCELED","FILLED","EXPIRED"].includes(after.status))throw Error("RESIDENT_STOP_RETIRE_UNVERIFIED");
 }else if(!["CANCELED","FILLED","EXPIRED"].includes(order.status))throw Error("RESIDENT_STOP_RETIRE_UNKNOWN");
}

/** A quantity change is accepted only with exact venue STOP-fill evidence. */
export async function verifyResidentStopPartial(g:ResidentStopGateway,p:ResidentStopProtection,remaining:number){
 const o=await g.getOrder(p.symbol,p.clientOrderId);
 if(o.orderId!==p.orderId||o.symbol!==p.symbol||o.side!==p.side||!o.reduceOnly||o.status!=="PARTIALLY_FILLED"||!same(o.quantity,p.originalQuantity)||!same(o.quantity-o.executedQuantity,remaining)||!(remaining>0)||!positive(o.averagePrice)||!same(o.stopPrice,p.stopPrice))throw Error("RESIDENT_STOP_PARTIAL_FILL_UNVERIFIED");
 return o;
}
