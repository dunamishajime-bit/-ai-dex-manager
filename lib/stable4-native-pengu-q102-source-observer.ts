/** Source-native PENGU / Q102 H1 candidate observations; absolutely no order authority.
 * Do not pass these observations to execution or count as venue-confirmed fills.
 * Q102's 180-day source walk-forward and PENGU's H1 signal are evaluated by
 * their pinned source functions, never replaced by invented proxy rules.
 */
import {buildPenguDualLsV2Signal,type PenguDualLsV2History,type PenguDualLsV2SignalOptions} from "./pengu-dual-ls-v2";
import {buildQuality102CausalV1Signal,type Quality102CausalV1History,type Quality102CausalV1SleeveOccupancy} from "./disdex-quality102-causal-v1-signal";
import type {DisDexV35Candle} from "./disdex-v35-signal-engine";
import type {Quality102Candle} from "./disdex-quality102-causal-pipeline";

const H=3_600_000;
const PIN=/^[0-9a-f]{40}$/;
type Runner="PENGU"|"Q102";
export type SourceObservation={
  status:"NATIVE_ENTRY_OBSERVED"|"NO_SOURCE_ENTRY"|"BLOCKED_SOURCE";
  reason:string;runner:Runner;symbol:string|null;side:-1|0|1;
  decisionTs:number;sourceDataCutoffTs:number|null;sourcePin:string;
  gross:number;route:string|null;orderAuthority:false;asterM5EntryConfirmed:false;
};
const result=(runner:Runner,decisionTs:number,sourcePin:string,reason:string,
 status:SourceObservation["status"]="BLOCKED_SOURCE",
 attributes?:{symbol:string;side:-1|1;gross:number;route:string;cutoff:number}):SourceObservation=>({
 status,reason,runner,decisionTs,sourcePin,symbol:attributes?.symbol??null,
 side:attributes?.side??0,sourceDataCutoffTs:attributes?.cutoff??null,
 gross:attributes?.gross??0,route:attributes?.route??null,
 orderAuthority:false,asterM5EntryConfirmed:false,
});
const validClock=(ts:number,pin:string)=>Number.isSafeInteger(ts)&&ts>H&&ts%H===0&&PIN.test(pin);
const validPenguRows=(rows:readonly DisDexV35Candle[],ts:number):boolean=>{
 if(!Array.isArray(rows)||rows.length<169)return false;
 for(let i=0;i<rows.length;i++){
  const b=rows[i];
  if(!b||!Number.isSafeInteger(b.openTime)||b.openTime<=0||b.openTime%H!==0
    ||b.closeTime!==b.openTime+H-1||b.openTime>=ts
    ||[b.open,b.high,b.low,b.close,b.volume].some(x=>!Number.isFinite(x))
    ||b.open<=0||b.low<=0||b.high<Math.max(b.open,b.close)
    ||b.low>Math.min(b.open,b.close)||b.volume<0
    ||(i>0&&b.openTime!==rows[i-1].openTime+H))return false;
 }
 return rows.at(-1)!.openTime===ts-H;
};
const validQualityRows=(rows:readonly Quality102Candle[],ts:number):boolean=>{
 if(!Array.isArray(rows)||rows.length<181*24)return false;
 for(let i=0;i<rows.length;i++){
  const b=rows[i];
  if(!b||!Number.isSafeInteger(b.timestampMs)||b.timestampMs<=0||b.timestampMs%H!==0
    ||b.timestampMs>=ts
    ||[b.open,b.high,b.low,b.close,b.quoteVolume].some(x=>!Number.isFinite(x))
    ||b.open<=0||b.low<=0||b.high<Math.max(b.open,b.close)
    ||b.low>Math.min(b.open,b.close)||b.quoteVolume<0
    ||(i>0&&b.timestampMs!==rows[i-1].timestampMs+H))return false;
 }
 return rows.at(-1)!.timestampMs===ts-H;
};

/** The native source remains the decision maker. No position/order mutation. */
export function observeStable4PenguH1(input:{
 decisionTs:number;sourcePin:string;history:PenguDualLsV2History;
 options?:PenguDualLsV2SignalOptions;
}):SourceObservation{
 const {decisionTs,sourcePin,history}=input;
 if(!validClock(decisionTs,sourcePin))return result("PENGU",decisionTs,sourcePin,"SOURCE_PIN_OR_CLOCK_INVALID");
 if(!history||!validPenguRows(history.pengu1h,decisionTs)
    ||!validPenguRows(history.btc1h,decisionTs)
    ||history.pengu1h.length!==history.btc1h.length
    ||history.pengu1h.some((v,i)=>v.openTime!==history.btc1h[i].openTime)
    ||!Array.isArray(history.penguFunding)
    ||history.penguFunding.some(v=>!Number.isSafeInteger(v.fundingTime)||v.fundingTime>=decisionTs||!Number.isFinite(v.fundingRate)))
  return result("PENGU",decisionTs,sourcePin,"NATIVE_H1_HISTORY_OR_FUNDING_INVALID");
 try{
  const s=buildPenguDualLsV2Signal(history,undefined,decisionTs,0,{
    recoveryV8Enabled:input.options?.recoveryV8Enabled===true,
    v64DynamicLongEnabled:input.options?.v64DynamicLongEnabled===true,
  });
  if(s.referenceTs!==decisionTs-H)return result("PENGU",decisionTs,sourcePin,"NATIVE_SOURCE_CUTOFF_MISMATCH");
  if(s.side===0)return result("PENGU",decisionTs,sourcePin,"NATIVE_PENGU_NO_ENTRY","NO_SOURCE_ENTRY");
  if(s.entryTs!==decisionTs||s.side!==-1&&s.side!==1||
     !Number.isFinite(s.targetGross)||s.targetGross<=0||!s.entryVersion)
    return result("PENGU",decisionTs,sourcePin,"NATIVE_PENGU_ENTRY_UNVERIFIED");
  return result("PENGU",decisionTs,sourcePin,"NATIVE_H1_SIGNAL_ONLY_M5_UNCONFIRMED","NATIVE_ENTRY_OBSERVED",{
    symbol:"PENGUUSDT",side:s.side,gross:s.targetGross,route:s.entryVersion,cutoff:s.referenceTs,
  });
 }catch{
  return result("PENGU",decisionTs,sourcePin,"NATIVE_PENGU_EVALUATION_FAILED");
 }
}

/** Q102 monthly native causal V1 source; a missing 180d history is NOT a zero trade. */
export function observeStable4Q102H1(input:{
 decisionTs:number;sourcePin:string;history:Quality102CausalV1History;
 occupancy:Quality102CausalV1SleeveOccupancy;
}):SourceObservation{
 const {decisionTs,sourcePin,history,occupancy}=input;
 if(!validClock(decisionTs,sourcePin))return result("Q102",decisionTs,sourcePin,"SOURCE_PIN_OR_CLOCK_INVALID");
 const entries=history?.candlesBySymbol?Object.entries(history.candlesBySymbol):[];
 if(entries.length<2||!entries.some(([s])=>s==="BTCUSDT")||
    entries.some(([s,rows])=>!/^[A-Z0-9]{2,20}USDT$/.test(s)||!validQualityRows(rows,decisionTs)))
   return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_181D_CLOSED_HISTORY_UNAVAILABLE");
 if(!occupancy||typeof occupancy.activePosition!=="boolean"||
    typeof occupancy.unresolvedPendingEntry!=="boolean"||
    (occupancy.basePositionActive!==undefined&&typeof occupancy.basePositionActive!=="boolean"))
   return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_OCCUPANCY_UNVERIFIED");
 try{
  const s=buildQuality102CausalV1Signal({history,decisionTs,sleeveOccupancy:occupancy});
  if(s.referenceTs!==decisionTs-H||s.dataCutoffTs!==decisionTs-H)
   return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_CUTOFF_MISMATCH");
  if(s.side===0)return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_NO_ENTRY","NO_SOURCE_ENTRY");
  if(!s.symbol||s.side!==-1&&s.side!==1||!s.family||
      !Number.isFinite(s.requestedGross)||s.requestedGross<=0)
   return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_ENTRY_UNVERIFIED");
  return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_H1_SIGNAL_ONLY_VENUE_UNCONFIRMED","NATIVE_ENTRY_OBSERVED",{
   symbol:s.symbol,side:s.side,gross:s.requestedGross,route:s.family+"|"+s.symbol,cutoff:s.dataCutoffTs,
  });
 }catch{
  return result("Q102",decisionTs,sourcePin,"NATIVE_Q102_SOURCE_EVALUATION_FAILED");
 }
}


/** Source observation can constrain research selection, but CANNOT certify
 * Binance->ASTER 5m entry confirmation or live/venue parity. A separately
 * pinned and source-tested M5 entry policy is mandatory before admission.
 */
export type NativeSourceBinding={
 status:"BLOCKED"|"NATIVE_H1_OBSERVED_ONLY";
 reason:string;nativeH1Bound:boolean;eligibleForPortfolioEntry:false;orderAuthority:false;
};
export function bindStable4NativeH1Observation(input:{
 candidate:{sleeve:Runner;symbol:string;side:"LONG"|"SHORT";route:string;
  gross:number;entryTs:number;sourceReleaseSha:string;sourceDecisionTs:number;
  sourceComplete:boolean};
 observation?:SourceObservation;
}):NativeSourceBinding{
 const blocked=(reason:string):NativeSourceBinding=>({
  status:"BLOCKED",reason,nativeH1Bound:false,
  eligibleForPortfolioEntry:false,orderAuthority:false,
 });
 const {candidate:c,observation:o}=input;
 if(!o||o.runner!==c.sleeve||o.status!=="NATIVE_ENTRY_OBSERVED")
  return blocked("NATIVE_H1_ENTRY_OBSERVATION_MISSING");
 if(!validClock(c.sourceDecisionTs,c.sourceReleaseSha)||c.entryTs!==c.sourceDecisionTs||
    c.sourceReleaseSha!==o.sourcePin||o.decisionTs!==c.sourceDecisionTs||
    o.sourceDataCutoffTs!==c.sourceDecisionTs-H||
    o.symbol!==c.symbol||o.side!==(c.side==="LONG"?1:-1)||
    o.route!==c.route||!Number.isFinite(c.gross)||c.gross<=0||
    Math.abs(c.gross-o.gross)>1e-9||c.sourceComplete!==true||
    o.orderAuthority!==false||o.asterM5EntryConfirmed!==false)
  return blocked("NATIVE_H1_SOURCE_BINDING_MISMATCH");
 return {status:"NATIVE_H1_OBSERVED_ONLY",reason:"ASTER_M5_ENTRY_CONFIRMATION_NOT_SOURCE_CERTIFIED",
  nativeH1Bound:true,eligibleForPortfolioEntry:false,orderAuthority:false};
}
