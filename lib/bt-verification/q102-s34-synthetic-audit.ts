import {SyntheticMarket5m,type SyntheticScenario,type SyntheticFeedVersion} from "./synthetic-market";
import {inspectQ102NativeS34Source,Q102_NATIVE_S34_SOURCE_PIN}
 from "./pinned-native-q102/probe";

/**
 * Aggregate, read-only native S3/S4 Q102 candidate audit on artificial prices.
 * Not an execution model, not S1/S2 HIGH_VOL, not Online KNN, not Layer3.
 * Isolated from LIVE state and protected owner authentication.
 */
export type Q102NativeS34Audit = {
 schema:"disdex-bt-q102-native-s34-audit-v1";
 sourceRevision:string;sourceSha256:string;
 seed:number;scenario:SyntheticScenario;feedVersion:SyntheticFeedVersion;
 from:string;endExclusive:string;requiredWarmupHours:336;
 totalFiveMinuteTicks:number;
 nativeDecisionHours:number;warmupDecisionHours:number;evaluatedDecisionHours:number;
 rawNativeCandidates:number;gatedNativeCandidates:number;
 missingModelSymbols:readonly string[];
 processedModelSymbols:readonly string[];
 perSymbol:readonly {symbol:string;raw:number;gated:number}[];
 examples:readonly {at:string;symbol:string;family:string;variant:string;
  side:"LONG"|"SHORT";ret14:number;dataCutoffTs:number;entryTs:number}[];
 outcome:"PARTIAL_NATIVE_S34_SHADOW_NO_FILLS";
 fills:0;fullQ102:false;onlineLayer23:false;
 note:string;
};
export function auditQ102NativeS34(
 seed:number,scenario:SyntheticScenario,feedVersion:SyntheticFeedVersion="v1"
):Q102NativeS34Audit{
 const start="2025-10-01T00:00:00Z",endExclusive="2025-10-23T00:00:00Z";
 const feed=new SyntheticMarket5m(seed,scenario,{start,endExclusive,version:feedVersion});
 const stats=new Map<string,{raw:number;gated:number}>();
 const processed=new Set<string>(),missing=new Set<string>();
 const examples:Q102NativeS34Audit["examples"][number][]=[];
 let decisions=0,warmup=0,evaluated=0,raw=0,gated=0;
 const ticks=feed.runToEnd(step=>{
   if(!step.completedH1.some(x=>x.symbol==="BTCUSDT")||
      new Date(step.observedAt).getUTCHours()%4!==1)return;
   const result=inspectQ102NativeS34Source(feed,step);
   decisions++;
   if(result.status==="ASOF_GAP_OR_INVALID")
     throw Error("Q102_NATIVE_14D_AUDIT_FAIL_CLOSED_INPUT");
   if(result.status==="INSUFFICIENT_14D")warmup++;
   if(result.status==="EVALUATED_SOURCE_PARTIAL")evaluated++;
   for(const name of result.evaluatedSymbols)processed.add(name);
   for(const name of result.missingModelSymbols)missing.add(name);
   raw+=result.rawCandidates.length;
   gated+=result.gatedCandidates.length;
   for(const c of result.rawCandidates){
     const item=stats.get(c.symbol)??{raw:0,gated:0};
     item.raw++;stats.set(c.symbol,item);
   }
   for(const c of result.gatedCandidates){
     const item=stats.get(c.symbol)??{raw:0,gated:0};
     item.gated++;stats.set(c.symbol,item);
     if(examples.length<30)examples.push({
       at:step.observedAt,symbol:c.symbol,family:c.family,variant:c.variant,
       side:c.side===1?"LONG":"SHORT",ret14:c.ret14,
       dataCutoffTs:c.dataCutoffTs,entryTs:c.entryTs
     });
   }
 });
 if(decisions===0||warmup===0||evaluated===0||
    !missing.has("APTUSDT")||!missing.has("LDOUSDT")||
    !processed.has("AVAXUSDT")||!processed.has("UNIUSDT"))
   throw Error("Q102_NATIVE_14D_AUDIT_INCOMPLETE_FAIL_CLOSED");
 return {
   schema:"disdex-bt-q102-native-s34-audit-v1",
   sourceRevision:Q102_NATIVE_S34_SOURCE_PIN.git,
   sourceSha256:Q102_NATIVE_S34_SOURCE_PIN.candidateSha256,
   seed,scenario,feedVersion,from:start,endExclusive,
   requiredWarmupHours:336,totalFiveMinuteTicks:ticks,
   nativeDecisionHours:decisions,warmupDecisionHours:warmup,
   evaluatedDecisionHours:evaluated,
   rawNativeCandidates:raw,gatedNativeCandidates:gated,
   missingModelSymbols:[...missing].sort(),
   processedModelSymbols:[...processed].sort(),
   perSymbol:[...processed].sort().map(symbol=>({
     symbol,raw:stats.get(symbol)?.raw??0,gated:stats.get(symbol)?.gated??0
   })),
   examples,
   outcome:"PARTIAL_NATIVE_S34_SHADOW_NO_FILLS",
   fills:0,fullQ102:false,onlineLayer23:false,
   note:"Native source-pinned Q102 S3/S4 candidates only. S1/S2, Online AVAX KNN, UNI revival, held-slot comparison, fills, STOP, Shared Risk, Gross and V4 priority are NOT connected. Missing APT/LDO market symbols are exposed; all source prices are artificial and have no venue-volume parity."
 };
}
