import type { ResidentStopPlan } from './venue-resident-stop';
/** Durable intent precedes every venue mutation. Fills are cumulative per ID, never summed twice. */
export interface StopFill {clientOrderId:string;quantity:number;averagePrice:number;updatedAt:number;hardStop:boolean}
export interface StopLedger {originalQuantity:number;originalGross:number;plans:ResidentStopPlan[];fills:StopFill[]}
const same=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-9);
export function appendStopIntent(ledger:StopLedger|undefined,plan:ResidentStopPlan,quantity:number,gross:number):StopLedger {
 const out=ledger??{originalQuantity:quantity,originalGross:gross,plans:[],fills:[]};
 if(!out.plans.some(p=>p.clientOrderId===plan.clientOrderId))out.plans.push({...plan});return out;
}
export function validateStopLedger(v:unknown):StopLedger|undefined {
 if(v===undefined)return;
 const l=v as StopLedger;
 if(!l||!(l.originalQuantity>0)||!Number.isFinite(l.originalQuantity)||!(l.originalGross>0)||!Number.isFinite(l.originalGross)||!Array.isArray(l.plans)||!l.plans.length||l.plans.length>100||!Array.isArray(l.fills)||l.fills.length>100||Object.keys(l).some(k=>!['originalQuantity','originalGross','plans','fills'].includes(k)))throw Error('STOP_LEDGER_MALFORMED');
 for(const p of l.plans)if(!p.clientOrderId||!p.symbol||!['BUY','SELL'].includes(p.side)||p.reduceOnly!==true||!(p.quantity>0)||!Number.isFinite(p.quantity)||!(p.stopPrice>0)||!Number.isFinite(p.stopPrice))throw Error('STOP_LEDGER_PLAN_MALFORMED');
 for(const f of l.fills)if(!f.clientOrderId||!(f.quantity>0)||!Number.isFinite(f.quantity)||!(f.averagePrice>0)||!Number.isFinite(f.averagePrice)||!(f.updatedAt>0)||typeof f.hardStop!=='boolean')throw Error('STOP_LEDGER_FILL_MALFORMED');
 return l;
}
export async function reconcileStopLedger(l:StopLedger,remaining:number,read:(id:string)=>Promise<any>,pending?:{clientOrderId:string;phase:string},provided?:any) {
 const first=l.plans[0];const ids=[...new Set([...l.plans.map(p=>p.clientOrderId),...l.fills.map(f=>f.clientOrderId),...(pending&&pending.phase!=='planned'?[pending.clientOrderId]:[]),...(provided?[provided.clientOrderId]:[])])];
 for(const id of ids){
  const r=provided?.clientOrderId===id?provided:await read(id);
  if(!r||r.executionUnknown||r.status==='UNKNOWN')throw Error('STOP_LEDGER_ORDER_UNKNOWN:'+id);
  if(r.symbol!==first.symbol||r.clientOrderId!==id||r.side!==first.side||r.reduceOnly!==true||!Number.isFinite(r.executedQuantity)||r.executedQuantity<0)throw Error('STOP_LEDGER_FILL_IDENTITY:'+id);
  if(r.executedQuantity>0){if(!(r.averagePrice>0)||!Number.isFinite(r.averagePrice))throw Error('STOP_LEDGER_FILL_PRICE');const prior=l.fills.find(f=>f.clientOrderId===id);if(prior&&r.executedQuantity<prior.quantity-1e-8)throw Error('STOP_LEDGER_FILL_REGRESSED');const f={clientOrderId:id,quantity:r.executedQuantity,averagePrice:r.averagePrice,updatedAt:r.updatedAt||Date.now(),hardStop:l.plans.some(p=>p.clientOrderId===id)};if(prior)Object.assign(prior,f);else l.fills.push(f);}
 }
 const closedQuantity=l.fills.reduce((n,f)=>n+f.quantity,0);
 if(!same(closedQuantity,l.originalQuantity-remaining))throw Error('STOP_LEDGER_QUANTITY_UNRECONCILED');
 return{closedQuantity,averagePrice:closedQuantity?l.fills.reduce((n,f)=>n+f.quantity*f.averagePrice,0)/closedQuantity:0,originalGross:l.originalGross,hardStop:l.fills.some(f=>f.hardStop),updatedAt:Math.max(0,...l.fills.map(f=>f.updatedAt))};
}
export async function retireStopLedger(g:import('./venue-resident-stop').ResidentStopGateway,l:StopLedger,now:number){
 const {retireResidentStop}=await import('./venue-resident-stop');
 for(const p of l.plans){const o=await g.getOrder(p.symbol,p.clientOrderId);if(o.symbol!==p.symbol||o.clientOrderId!==p.clientOrderId||o.side!==p.side||o.reduceOnly!==true||!same(o.stopPrice,p.stopPrice)||!(o.orderId>0))throw Error('STOP_LEDGER_RETIRE_IDENTITY');await retireResidentStop(g,{protected:false,clientOrderId:o.clientOrderId,orderId:o.orderId,symbol:o.symbol,side:o.side,quantity:p.quantity,originalQuantity:o.quantity,stopPrice:o.stopPrice,readBackStatus:'UNVERIFIED',lastReconciledAt:now});}
}
