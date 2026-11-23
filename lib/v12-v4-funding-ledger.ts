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
    ["OPEN","PENDING_EXIT"].includes(l.status)&&l.qty>0&&r.time>=l.entryTs)
    .sort((a,b)=>a.id.localeCompare(b.id));
  if(!legs.length||state.foreign.some(f=>f.symbol===r.symbol&&f.qty>0)||
    new Set(legs.map(l=>l.candidate.effectiveSide)).size!==1)
    throw Error("V4_FUNDING_OWNER_AMBIGUOUS:"+r.symbol);
  // Aster one-way account funding is a single signed symbol charge.
  // Split among concurrently owned same-side virtual legs using their
  // quantity shares at the funding time. The final leg takes the exact
  // remainder, so signed total and idempotency are conserved.
  const total=legs.reduce((n,l)=>n+l.qty,0);
  if(!(total>0)||!Number.isFinite(total))throw Error("V4_FUNDING_OWNER_QTY_INVALID");
  let attributed=0;
  legs.forEach((leg,i)=>{
   const share=i===legs.length-1?amountUsd-attributed:amountUsd*(leg.qty/total);
   if(!Number.isFinite(share))throw Error("V4_FUNDING_ALLOCATION_INVALID");
   events.push({id:leg.id,eventId:legs.length===1?key:key+":"+leg.id,ts:at,amountUsd:share});
   attributed+=share;
  });
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
