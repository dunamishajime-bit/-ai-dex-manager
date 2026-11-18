/**
 * Source-pinned Quality102 HIGH_VOL S1/S2 market feature and raw-grid probe.
 *
 * CRITICAL: An upstream S1/S2 entry requires a genuine monthly rule selected
 * using prior 180-day closed outcomes and explicit upstream S1 vs S2
 * membership. This synthetic feed has neither; therefore its grid matches
 * are NOT entries, and NO entries/fills are emitted.
 *
 * The native source module is copied byte-for-byte from
 * 9118eeaa6c209dc6e37887cf5be139b3baaa005d.
 */
import {
 computeQuality102HighVolFeatures,
 matchQuality102HighVolGrid,
 generateQuality102HighVolSignals,
 type Quality102Candle,
 type Quality102HighVolFeatures
} from "./disdex-quality102-causal-pipeline";
import {QUALITY102_CAUSAL_V4_S34_MODEL} from "./disdexQuality102CausalV4Model";
import type {SyntheticMarket5m,SyntheticStep,MarketCandle5m,SyntheticSymbol}
 from "../synthetic-market";
const H=3600000;
const N=337;
const modelSymbols=Object.freeze([...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))]);
export const Q102_HV_SOURCE_PIN = Object.freeze({
 originalSha256:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
 sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
 requiredCompletedH1:337,
 monthlyTrainingDays:180,
 stageMembershipEvidenceAvailable:false,
 nativeEntryEnabled:false,
 fills:0
});
export type Q102HighVolSourceStatus =
 "NOT_CLOSED_H1"|"INSUFFICIENT_337H"|"INVALID_CLOSED_H1"|
 "FEATURES_EVALUATED_NO_MONTHLY_RULE";
export type Q102HighVolFeaturePreview = {
 symbol:string;
 ret24:number;ret14d:number;rsi14:number;atrPct:number;volumeRatio:number;
 gridLongThresholds:number;gridShortThresholds:number;
};
export type Q102HighVolShadowResult={
 schema:"disdex-bt-q102-highvol-feature-shadow-v1";
 at:string;status:Q102HighVolSourceStatus;
 evaluatedSymbols:readonly string[];
 insufficientSymbols:readonly string[];
 missingSymbols:readonly string[];
 features:readonly Q102HighVolFeaturePreview[];
 rawGridThresholdMatches:number;
 monthlySelectedRuleAvailable:false;
 stageS1S2MembershipKnown:false;
 nativeEntrySignals:0;fills:0;
 warning:string;
};
const fresh=(at:string,status:Q102HighVolSourceStatus,
 other?:Partial<Q102HighVolShadowResult>):Q102HighVolShadowResult=>({
 schema:"disdex-bt-q102-highvol-feature-shadow-v1",
 at,status,evaluatedSymbols:[],insufficientSymbols:[],missingSymbols:[],
 features:[],rawGridThresholdMatches:0,
 monthlySelectedRuleAvailable:false,stageS1S2MembershipKnown:false,
 nativeEntrySignals:0,fills:0,
 warning:"RAW HIGH_VOL GRID ONLY. Missing genuine preceding 180d monthly selector and S1/S2 membership. NOT an entry, order or production-parity decision.",
 ...other
});
function toNative(
 symbol:string,source:readonly MarketCandle5m[],asOfMs:number
):Quality102Candle[]{
 if(source.length<N)throw Error("Q102_HIGHVOL_NEEDS_337_H1");
 let end:number|null=null;
 return source.map(x=>{
   const start=Date.parse(x.openTime),closed=Date.parse(x.closedAt);
   if(x.symbol!==symbol||x.category!=="crypto"||x.partialSession||
      x.ticks!==12||!Number.isFinite(start)||start%H!==0||
      closed!==start+H||closed>asOfMs||
      end!==null&&end!==start||
      ![x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||
      x.open<=0||x.close<=0||x.low<=0||x.volume<0||
      x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))
        throw Error("Q102_HIGHVOL_NONCAUSAL_SOURCE_REJECTED");
   end=closed;
   return {
     timestampMs:start,open:x.open,high:x.high,low:x.low,close:x.close,
     quoteVolume:x.volume,
     baseVolume:x.volume/x.close
   };
 });
}
export function inspectQ102NativeHighVolFeaturesAt(
 symbol:string,history:readonly MarketCandle5m[],asOf:string
):{features:Quality102HighVolFeatures;rawGridThresholdMatches:number;
 gridLongThresholds:number;gridShortThresholds:number;nativeEntries:0}{
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||now%H!==0)throw Error("Q102_HIGHVOL_H1_ASOF_REQUIRED");
 const rows=toNative(symbol,history,now);
 if(rows.at(-1)!.timestampMs+H!==now)
   throw Error("Q102_HIGHVOL_STALE_H1");
 const features=computeQuality102HighVolFeatures(rows,rows.length-1);
 const matches=matchQuality102HighVolGrid(features);
 // With ZERO legitimate prior-180d monthly rules, the original signal
 // generator must have ZERO actual entry candidates. A known next-hour
 // open is not supplied, so no future OHLC data is fabricated for it here.
 return {
   features,rawGridThresholdMatches:matches.length,
   gridLongThresholds:matches.filter(x=>x.side===1).length,
   gridShortThresholds:matches.filter(x=>x.side===-1).length,
   nativeEntries:0
 };
}
export function inspectQ102NativeHighVolSyntheticAt(
 feed:SyntheticMarket5m,step:SyntheticStep
):Q102HighVolShadowResult{
 const now=Date.parse(step.observedAt);
 if(!Number.isFinite(now)||now%H!==0||
    !step.completedH1.some(x=>x.symbol==="BTCUSDT"&&Date.parse(x.closedAt)===now))
    return fresh(step.observedAt,"NOT_CLOSED_H1");
 const universe=new Set<string>(feed.description.symbols);
 const missing=modelSymbols.filter(x=>!universe.has(x));
 const insufficient:string[]=[];
 const evaluated:string[]=[];
 const features:Q102HighVolFeaturePreview[]=[];
 let matches=0;
 try{
   for(const symbol of modelSymbols){
     if(!universe.has(symbol))continue;
     const history=feed.historyH1(symbol as SyntheticSymbol, N);
     if(history.length<N){insufficient.push(symbol);continue}
     const info=inspectQ102NativeHighVolFeaturesAt(symbol,history,step.observedAt);
     evaluated.push(symbol);
     matches+=info.rawGridThresholdMatches;
     features.push({
       symbol,ret24:info.features.ret24,ret14d:info.features.ret14d,
       rsi14:info.features.rsi14,atrPct:info.features.atrPct,
       volumeRatio:info.features.volumeRatio,
       gridLongThresholds:info.gridLongThresholds,
       gridShortThresholds:info.gridShortThresholds
     });
   }
 }catch {
   return fresh(step.observedAt,"INVALID_CLOSED_H1",{
     evaluatedSymbols:evaluated,insufficientSymbols:insufficient,
     missingSymbols:missing
   });
 }
 return fresh(step.observedAt,evaluated.length===0?
   "INSUFFICIENT_337H":"FEATURES_EVALUATED_NO_MONTHLY_RULE",{
   evaluatedSymbols:evaluated,insufficientSymbols:insufficient,
   missingSymbols:missing,features,rawGridThresholdMatches:matches
 });
}
/** A test-only source bridge to show the original generator remains gated. */
export function highVolTestSourceWithMonthlyRules(input:{
 symbol:string;stage:"S1"|"S2";bars:readonly Quality102Candle[];
 monthlyRules:ReadonlyMap<number,import("./disdex-quality102-causal-pipeline").Quality102HighVolRule>
}){
 return generateQuality102HighVolSignals(input);
}
