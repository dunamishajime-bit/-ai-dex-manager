/**
 * Frozen STABLE4 research candidate PRETARGET regime checks for PENGU.
 * These are not the PENGU native entry or exit algorithms.
 * Source: portfolio_stable4_hype6_q102_dualhealth_validation_20261114.py
 * Owner research source SHA256
 * e58b735a528f369d1017fd2469efdf7873c48fcfd92dde4727af40fa8a5d1d4c
 *
 * No trade may be created from a pretarget regime gate: an independently
 * generated and admissible native source candidate is required.
 */
import type {MarketCandle5m,SyntheticMarket5m} from "./synthetic-market";
const HOUR=3_600_000;
export const STABLE4_PENGU_RESEARCH_PRETARGET=Object.freeze({
 shortV20Btc24hMax:-0.010836782776818987,
 shortV20Pengu72hMax:-0.05237466490617382,
 recoveryV8Btc24hMax:0.011611625094354983,
 source:"STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION_20261114",
 nativeRunnerSignalConnected:false
});
export type PenguResearchGateStatus=
 "SOURCE_INSUFFICIENT"|"SOURCE_NOT_CAUSAL"|"PRETARGET_PASS_NO_CANDIDATE"|"PRETARGET_BLOCK";
export type PenguResearchGateResult={
 asOf:string;btc24h:number|null;pengu72h:number|null;
 shortV20:{status:PenguResearchGateStatus;conditionPass:boolean};
 recoveryV8:{status:PenguResearchGateStatus;conditionPass:boolean};
 candidateSourceAvailable:false;
 admittedPositions:0;
 note:string;
};
function fail(asOf:string,status:PenguResearchGateStatus):PenguResearchGateResult{
 return {asOf,btc24h:null,pengu72h:null,shortV20:{status,conditionPass:false},
  recoveryV8:{status,conditionPass:false},candidateSourceAvailable:false,admittedPositions:0,
  note:"PENGU pretarget regime only; native entry and position management are absent"};
}
function strictClosedClose(symbol:"BTCUSDT"|"PENGUUSDT",rows:readonly MarketCandle5m[],asOf:number,lookback:number):number|null{
 if(rows.length<=lookback)return null;
 const series=rows.slice(-(lookback+1));
 let previousEnd:number|null=null;
 for(const c of series){
  const opening=Date.parse(c.openTime),end=Date.parse(c.closedAt);
  if(c.symbol!==symbol||c.category!=="crypto"||c.partialSession||c.ticks!==12||
     !Number.isFinite(opening)||opening%HOUR!==0||end!==opening+HOUR||
     end>asOf||!Number.isFinite(c.close)||c.close<=0||
     !Number.isFinite(c.high)||!Number.isFinite(c.low)||!Number.isFinite(c.open)||
     c.open<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||
     !Number.isFinite(c.volume)||c.volume<0||previousEnd!==null&&opening!==previousEnd)
     throw Error("PENGU_RESEARCH_NONCAUSAL_H1");
  previousEnd=end;
 }
 if(previousEnd!==asOf)throw Error("PENGU_RESEARCH_STALE_BAR");
 return series[series.length-1].close/series[0].close-1;
}
export function evaluatePenguPretargetAt(
 asOf:string,btcHistory:readonly MarketCandle5m[],
 penguHistory:readonly MarketCandle5m[]
):PenguResearchGateResult{
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||now%HOUR!==0)
   return fail(asOf,"SOURCE_NOT_CAUSAL");
 if(btcHistory.length<25||penguHistory.length<73)
   return fail(asOf,"SOURCE_INSUFFICIENT");
 try{
   const btc24h=strictClosedClose("BTCUSDT",btcHistory,now,24);
   const pengu72h=strictClosedClose("PENGUUSDT",penguHistory,now,72);
   if(btc24h===null||pengu72h===null)
     return fail(asOf,"SOURCE_INSUFFICIENT");
   const short=btc24h<=STABLE4_PENGU_RESEARCH_PRETARGET.shortV20Btc24hMax&&
      pengu72h<=STABLE4_PENGU_RESEARCH_PRETARGET.shortV20Pengu72hMax;
   const recovery=btc24h<=STABLE4_PENGU_RESEARCH_PRETARGET.recoveryV8Btc24hMax;
   return {asOf,btc24h,pengu72h,
     shortV20:{status:short?"PRETARGET_PASS_NO_CANDIDATE":"PRETARGET_BLOCK",conditionPass:short},
     recoveryV8:{status:recovery?"PRETARGET_PASS_NO_CANDIDATE":"PRETARGET_BLOCK",conditionPass:recovery},
     candidateSourceAvailable:false,admittedPositions:0,
     note:"Research PRETARGET filter only: no PENGU native V20/V8 signal candidate, no ordering, no fill, no exposure"};
 }catch{
   return fail(asOf,"SOURCE_NOT_CAUSAL");
 }
}
/** The gate inspects only actually emitted closed H1 bars at this timestamp. */
export function probeSyntheticPenguAt(feed:SyntheticMarket5m,asOf:string):PenguResearchGateResult{
 return evaluatePenguPretargetAt(asOf,
  feed.historyH1("BTCUSDT",96),feed.historyH1("PENGUUSDT",96));
}
