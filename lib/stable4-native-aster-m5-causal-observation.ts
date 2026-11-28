/** Closed ASTER 5m / 15m tape observation after source-native Binance/ASTER H1.
 * No venue execution inference, no fill price or live order authority.
 * This is a causal/provenance guard to prepare a later, separately certified
 * source-native entry policy, NOT that policy itself.
 */
import {bindStable4NativeH1Observation,type SourceObservation} from "./stable4-native-pengu-q102-source-observer";

const M5=300_000;
const SHA256=/^[0-9a-f]{64}$/;
type Runner="PENGU"|"Q102";
type Side="LONG"|"SHORT";
export type ClosedAsterM5Bar={
 readonly symbol:string;
 readonly openTime:number;
 readonly closeTime:number;
 readonly open:number;readonly high:number;readonly low:number;
 readonly close:number;readonly volume:number;readonly trades:number;
 readonly archiveSha256:string;
};
export type H1NativeCandidate={
 readonly sleeve:Runner;readonly symbol:string;readonly side:Side;
 readonly route:string;readonly gross:number;
 readonly entryTs:number;readonly sourceReleaseSha:string;
 readonly sourceDecisionTs:number;readonly sourceComplete:boolean;
};
export type M5CausalObservation={
 readonly status:"BLOCKED"|"M5_TAPE_OBSERVED_ONLY";
 readonly reason:string;
 readonly runner:Runner;readonly symbol:string;readonly h1DecisionTs:number;
 readonly observedAtMs:number;readonly windowMinutes:5|15;
 readonly nativeH1Bound:boolean;readonly fullWindowClosed:boolean;
 readonly positiveVolumeBars:number;
 readonly allBarsPositiveVolume:boolean;
 readonly venueFillCertified:false;readonly executablePriceCertified:false;
 readonly eligibleForPortfolioEntry:false;readonly orderAuthority:false;
};
export function observeStable4ClosedAsterM5(input:{
 readonly candidate:H1NativeCandidate;
 readonly h1Observation?:SourceObservation;
 readonly observedAtMs:number;
 readonly windowMinutes:5|15;
 readonly venue:"ASTER_PUBLIC_KLINES";
 readonly archivePins:readonly string[];
 readonly bars:readonly ClosedAsterM5Bar[];
}):M5CausalObservation{
 const {candidate:c,h1Observation:h1,observedAtMs:now,windowMinutes:window,bars}=input;
 const out=(status:M5CausalObservation["status"],reason:string,positive=0,native=false,closed=false):M5CausalObservation=>({
  status,reason,runner:c.sleeve,symbol:c.symbol,h1DecisionTs:c.sourceDecisionTs,
  observedAtMs:now,windowMinutes:window,
  nativeH1Bound:native,fullWindowClosed:closed,
  positiveVolumeBars:positive,
  allBarsPositiveVolume:closed&&positive===window/5,
  venueFillCertified:false,executablePriceCertified:false,
  eligibleForPortfolioEntry:false,orderAuthority:false,
 });
 const native=bindStable4NativeH1Observation({candidate:c,observation:h1});
 if(native.status!=="NATIVE_H1_OBSERVED_ONLY")
  return out("BLOCKED","NATIVE_H1_SOURCE_BINDING_NOT_PROVEN");
 const start=c.sourceDecisionTs;
 const count=window===5?1:window===15?3:0;
 if(!count||input.venue!=="ASTER_PUBLIC_KLINES"||
    !Number.isSafeInteger(now)||now<=0||
    !Array.isArray(input.archivePins)||input.archivePins.length<1||input.archivePins.length>3||
    input.archivePins.some(pin=>typeof pin!=="string"||!SHA256.test(pin))||
    new Set(input.archivePins).size!==input.archivePins.length)
  return out("BLOCKED","ASTER_M5_PROVENANCE_UNVERIFIED",0,true);
 // H1 signal at start cannot inspect the candle [start,start+5m)
 // before its close; a three-bar confirmation cannot inspect beyond +15m.
 const completeAt=start+count*M5;
 if(now<completeAt)return out("BLOCKED","ASTER_M5_WINDOW_NOT_CLOSED",0,true);
 // Allow up to one complete M5 of read latency. Beyond that a live-entry
 // decision would be using an old signal; never reclassify a stale tape.
 if(now>=completeAt+M5)return out("BLOCKED","ASTER_M5_CONFIRMATION_STALE",0,true);
 if(!Array.isArray(bars)||bars.length!==count)
  return out("BLOCKED","ASTER_M5_REQUIRED_CANDLES_MISSING",0,true);
 const pins=new Set(input.archivePins);
 let positive=0;
 for(let i=0;i<count;i++){
  const bar=bars[i];
  if(!bar||bar.symbol!==c.symbol||!pins.has(bar.archiveSha256)||
     !Number.isSafeInteger(bar.openTime)||bar.openTime!==start+i*M5||
     bar.closeTime!==bar.openTime+M5-1||
     ![bar.open,bar.high,bar.low,bar.close,bar.volume,bar.trades].every(Number.isFinite)||
     bar.open<=0||bar.low<=0||bar.close<=0||
     bar.high<Math.max(bar.open,bar.close)||
     bar.low>Math.min(bar.open,bar.close)||bar.volume<0||
     !Number.isSafeInteger(bar.trades)||bar.trades<0||
     (bar.volume===0)!==(bar.trades===0))
   return out("BLOCKED","ASTER_M5_SOURCE_BAR_OR_SYMBOL_INVALID",0,true);
  positive+=Number(bar.volume>0);
 }
 if(positive===0)return out("M5_TAPE_OBSERVED_ONLY","ASTER_M5_ALL_ZERO_VOLUME_NO_EXECUTION_PROOF",0,true,true);
 if(positive<count)return out("M5_TAPE_OBSERVED_ONLY","ASTER_M5_PARTIAL_VOLUME_NO_EXECUTION_PROOF",positive,true,true);
 return out("M5_TAPE_OBSERVED_ONLY","ASTER_M5_POSITIVE_VOLUME_NOT_VENUE_FILL_PROOF",positive,true,true);
}
