import type {AsterIncomeRow} from "./aster-v3-client";
import {applyProductionEvent,type State} from "./v12-v4-production-lifecycle";
/** One-to-one signed funding attribution. Ambiguous virtual-leg ownership is refused. */
export function reconcileV4Funding(state:State,rows:readonly AsterIncomeRow[],at:number):State{
 if(!Number.isFinite(at))throw Error("V4_FUNDING_TIME_INVALID");
 const seen=new Set<string>(),events:Array<{id:string;eventId:string;ts:number;amountUsd:number}>=[];
 for(const r of rows){
  if(r.incomeType!=="FUNDING_FEE"||r.asset!=="USDT"||!r.symbol||
    !Number.isFinite(r.time)||r.time>at||r.time<0||r.tranId===undefined)
    throw Error("V4_FUNDING_PROOF_INVALID");
  const key="venue-funding:"+r.symbol+":"+String(r.tranId);
  if(seen.has(key))throw Error("V4_FUNDING_DUPLICATE_RECORD");seen.add(key);
  const amountUsd=Number(r.income);
  if(!Number.isFinite(amountUsd))throw Error("V4_FUNDING_AMOUNT_INVALID");
  const legs=Object.values(state.legs).filter(l=>l.candidate.symbol===r.symbol&&
    ["OPEN","PENDING_EXIT"].includes(l.status)&&l.qty>0);
  if(legs.length!==1||state.foreign.some(f=>f.symbol===r.symbol&&f.qty>0))
    throw Error("V4_FUNDING_OWNER_AMBIGUOUS:"+r.symbol);
  events.push({id:legs[0].id,eventId:key,ts:at,amountUsd});
 }
 let next=state;
 for(const e of events){
  const prior=next.journal.find(x=>x.eventId===e.eventId);
  if(prior){
   if(prior.type!=="FUNDING"||prior.id!==e.id||prior.amountUsd!==e.amountUsd)
    throw Error("V4_FUNDING_EVENT_CONFLICT");
  }else next=applyProductionEvent(next,{...e,type:"FUNDING"});
 }
 return next;
}
