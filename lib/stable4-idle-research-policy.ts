/** Offline research policy replay, not an order admission authority. */
export type IdleTapeRow={entryTs:number;symbol:string;route:string;features:{rel24:number;volumeRatio:number}};
const H=3600000;
export const JUP_REL_MIN=-0.04089204262472046,JUP_VOLUME_MIN=1.2568362211142174;
export type IdleResearchState={lastDecisionTs:number;taoRiskUntil:number};
export const initialIdleResearch=():IdleResearchState=>({lastDecisionTs:0,taoRiskUntil:0});
export function reviewIdleResearchBatch(prior:IdleResearchState,t:number,rows:IdleTapeRow[]){
 if(!Number.isSafeInteger(t)||t%H!==0||t<=prior.lastDecisionTs||rows.some(x=>x.entryTs!==t))throw Error("IDLE_RESEARCH_CLOCK");
 if(!Number.isSafeInteger(prior.taoRiskUntil)||prior.taoRiskUntil<0)throw Error("IDLE_RESEARCH_STATE");
 const tao=rows.some(x=>x.route==="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"&&x.symbol==="TAOUSDT");
 const state={lastDecisionTs:t,taoRiskUntil:Math.max(prior.taoRiskUntil,tao?t+12*H:0)};
 const decisions=rows.map(row=>{
  let reason="RETAINED";
  if(row.route==="IDLE_RENDER_RELATIVE_SHORT")reason="RENDER_REMOVED";
  else if(t<state.taoRiskUntil)reason="TAO_RISK_OFF";
  else if(row.route==="IDLE_JUP_RELATIVE_SHORT"){
   if(!Number.isFinite(row.features?.rel24)||!Number.isFinite(row.features?.volumeRatio))throw Error("IDLE_JUP_FEATURE_MISSING");
   if(row.features.rel24<JUP_REL_MIN||row.features.volumeRatio<JUP_VOLUME_MIN)reason="JUP_GATE";
  }
  return {row,retained:reason==="RETAINED",reason,orderAuthority:false as const};
 });
 return {state,decisions};
}


/** Reconstruct the R26 TAO risk-off windows from *completed* ASTER H1.
 * No restart-dependent memory and no permission to alter existing exits.
 */
import {computeIdlePriorityFeatures,evaluateIdleGenericCandidate,evaluateIdlePriorityShort,type IdleH1Candle,type IdleSignal} from "./idle-priority-short-signal";

export type IdleLatestClosedMarket={decisionTs:number;btc:readonly IdleH1Candle[];tao:readonly IdleH1Candle[]};
export type IdleLatestGate={retained:boolean;reason:"RETAINED"|"RENDER_REMOVED"|"TAO_RISK_OFF"|"JUP_GATE";orderAuthority:false;taoRiskUntil:number};
export function evaluateIdleLatestFromClosedMarket(market:IdleLatestClosedMarket,signal:Pick<IdleSignal,"route"|"symbol"|"features">):IdleLatestGate{
 const t=market.decisionTs;
 if(!Number.isSafeInteger(t)||t<=0||t%H!==0||signal.features.decisionTs!==t)throw Error("IDLE_LATEST_ASOF_INVALID");
 let taoRiskUntil=0;
 // The original research gate checks TAO route *signals*, not TAO fills.
 for(let k=11;k>=0;k--){
  const at=t-k*H;
  const f=computeIdlePriorityFeatures(at,market.tao,market.btc);
  const g=evaluateIdleGenericCandidate(f);
  if(evaluateIdlePriorityShort("TAOUSDT",f,g).accepted)taoRiskUntil=Math.max(taoRiskUntil,at+12*H);
 }
 const reason:IdleLatestGate["reason"] =
  signal.route==="IDLE_RENDER_RELATIVE_SHORT"?"RENDER_REMOVED":
  taoRiskUntil>t?"TAO_RISK_OFF":
  signal.route==="IDLE_JUP_RELATIVE_SHORT"&&
    (!Number.isFinite(signal.features.rel24)||!Number.isFinite(signal.features.volumeRatio)
      ||signal.features.rel24<JUP_REL_MIN||signal.features.volumeRatio<JUP_VOLUME_MIN)?"JUP_GATE":
    "RETAINED";
 return {retained:reason==="RETAINED",reason,orderAuthority:false,taoRiskUntil};
}
