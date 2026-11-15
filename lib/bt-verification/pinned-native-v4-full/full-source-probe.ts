/**
 * Full frozen V4 pure source-candidate evaluation on a causal artificial H1
 * market. The source module is the immutable Git 9118eeaa6... original
 * buildV4LiveDecisionBatch (including the original 14-symbol H2 source,
 * V2 route catalog and production candidate filters), with reversible
 * import-path changes only. Neither loadV4ClosedCandles() nor the live
 * runner/venue I/O is invoked.
 *
 * CRITICAL: Original source had an acknowledged HINDSIGHT_LEAKAGE_AND_Y06
 * research status. These are SOURCE_CANDIDATES, not verified V4 entries.
 * No live Production SHA parity or execution is claimed.
 */
import {buildV4LiveDecisionBatch,type V4LiveDecisionSnapshot,
 type V4VenueH1Bar} from "./v12-v4-live-candidate-builder";
import {V12_X1_ALL} from "./v12X1AllRuntime";
import type {SyntheticMarket5m,SyntheticStep,SyntheticSymbol,
 MarketCandle5m} from "../synthetic-market";

const H=3600_000;
const NEED_H1=245;
const SOURCE_SHA="9118eeaa6c209dc6e37887cf5be139b3baaa005d";
export type V4FullSourceStatus=
 "NOT_H2"|"MISSING_UNIVERSE"|"INSUFFICIENT_245H1"|
 "INVALID_OR_GAPPED_H1"|"SOURCE_RUNTIME_REJECTED"|
 "SOURCE_FILTER_ERRORS"|"SOURCE_CANDIDATES_EVALUATED";
export type V4FullNativeSourceProbe={
 asOf:string;status:V4FullSourceStatus;
 sourceGitRevision:typeof SOURCE_SHA;
 expectedH1:245;
 currentProductionPinCertified:false;
 originalSourceCandidateCount:number;
 eligibleSourceCandidateCount:number;
 filteredSourceCandidateCount:number;
 nativeCoreEvents:number;
 sourceFingerprint:string|null;
 sourceErrors:readonly string[];
 candidateRoutes:readonly {symbol:string;route:string;side:"LONG"|"SHORT";
   rank:number;eligibleEntryTs:number;sourceAvailableAtTs:number}[];
 orderEnabled:false;realOrderEnabledV4:0;tradingMutation:0;
 fills:0;gross:null;pnl:null;
};
const blank=(asOf:string,status:V4FullSourceStatus,
 extra?:Partial<V4FullNativeSourceProbe>):V4FullNativeSourceProbe=>({
 asOf,status,sourceGitRevision:SOURCE_SHA,expectedH1:245,
 currentProductionPinCertified:false,originalSourceCandidateCount:0,
 eligibleSourceCandidateCount:0,filteredSourceCandidateCount:0,
 nativeCoreEvents:0,sourceFingerprint:null,sourceErrors:[],
 candidateRoutes:[],orderEnabled:false,realOrderEnabledV4:0,
 tradingMutation:0,fills:0,gross:null,pnl:null,...extra
});
function closedH1(symbol:string,
 rows:readonly MarketCandle5m[],now:number):V4VenueH1Bar[]{
 let priorClose:number|null=null;
 if(rows.length<NEED_H1)throw Error("V4_NATIVE_FULL_WARMUP");
 return rows.map(bar=>{
   const opening=Date.parse(bar.openTime),closed=Date.parse(bar.closedAt);
   if(bar.symbol!==symbol+"USDT"||bar.category!=="crypto"||
      bar.ticks!==12||bar.partialSession||
      !Number.isSafeInteger(opening)||opening%H!==0||
      closed!==opening+H||closed>now||
      (priorClose!==null&&opening!==priorClose)||
      ![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite)||
      Math.min(bar.open,bar.low,bar.close)<=0||
      bar.high<Math.max(bar.open,bar.close)||
      bar.low>Math.min(bar.open,bar.close)||
      bar.volume<=0)
     throw Error("V4_NATIVE_FULL_CAUSAL_SOURCE_MISSING_OR_INVALID");
   priorClose=closed;
   return {openTs:opening,open:bar.open,high:bar.high,
     low:bar.low,close:bar.close,
     // Synthetic market publishes quote-volume only. The native H1
     // consumption requires base volume; convert causally at observed
     // completed H1 close. Not an exact exchange base-volume parity.
     volume:bar.volume/bar.close,quoteVolume:bar.volume};
 });
}
export function inspectV4FullSourceBatch(
 asOf:string,history:Readonly<Record<string,readonly MarketCandle5m[]>>
):V4FullNativeSourceProbe{
 const now=Date.parse(asOf);
 if(!Number.isSafeInteger(now)||now%(2*H)!==0)
   return blank(asOf,"NOT_H2");
 const universe:readonly string[]=V12_X1_ALL.universe;
 if(universe.some(x=>!(x in history)))
   return blank(asOf,"MISSING_UNIVERSE");
 if(universe.some(x=>history[x].length<NEED_H1))
   return blank(asOf,"INSUFFICIENT_245H1");
 const rows:Record<string,V4VenueH1Bar[]>={};
 try{
   for(const sym of universe){
     rows[sym]=closedH1(sym,history[sym],now);
     if(rows[sym].at(-1)!.openTs!==now-H)
       throw Error("V4_NATIVE_FULL_LAST_H1_NOT_CLOSED");
   }
 }catch{
   return blank(asOf,"INVALID_OR_GAPPED_H1");
 }
 let batch:V4LiveDecisionSnapshot;
 try{
   batch=buildV4LiveDecisionBatch(rows,now);
 }catch(e){
   return blank(asOf,"SOURCE_RUNTIME_REJECTED",{
     sourceErrors:[e instanceof Error?e.message:String(e)]});
 }
 if(batch.decisionTs>now||
    batch.orderEnabled!==false||batch.realOrderEnabledV4!==0||
    batch.tradingMutation!==0)
   throw Error("V4_SOURCE_BATCH_FUTURE_OR_ORDER_PERMISSION");
 if(batch.errors.length>0)
   return blank(asOf,"SOURCE_FILTER_ERRORS",{
     sourceErrors:batch.errors,
     originalSourceCandidateCount:batch.candidateCount,
     filteredSourceCandidateCount:batch.filteredCount,
     nativeCoreEvents:batch.nativeCoreEvents.length,
     sourceFingerprint:batch.sourceFingerprint
   });
 const candidateRoutes:V4FullNativeSourceProbe["candidateRoutes"][number][]=[];
 for(const c of batch.candidates){
   if(!Number.isSafeInteger(c.eligibleEntryTs)||
      c.eligibleEntryTs<batch.decisionTs)
     throw Error("V4_SOURCE_CANDIDATE_ENTRY_TS_INVALID");
   candidateRoutes.push({
     symbol:c.symbol,route:c.route,side:c.effectiveSide,
     rank:c.rank,eligibleEntryTs:c.eligibleEntryTs,
     sourceAvailableAtTs:now
   });
 }
 return blank(asOf,"SOURCE_CANDIDATES_EVALUATED",{
   originalSourceCandidateCount:batch.candidateCount,
   eligibleSourceCandidateCount:batch.candidates.length,
   filteredSourceCandidateCount:batch.filteredCount,
   nativeCoreEvents:batch.nativeCoreEvents.length,
   sourceFingerprint:batch.sourceFingerprint,
   candidateRoutes
 });
}
export function inspectV4FullNativeSynthetic(
 feed:SyntheticMarket5m,step:SyntheticStep
):V4FullNativeSourceProbe{
 const now=Date.parse(step.observedAt);
 if(now%(2*H)!==0||
    !step.completedH1.some(c=>c.symbol==="BTCUSDT"&&
      Date.parse(c.closedAt)===now))
   return blank(step.observedAt,"NOT_H2");
 const symbolSet=new Set<string>(feed.description.symbols);
 const expected:readonly string[]=V12_X1_ALL.universe;
 if(expected.some(x=>!symbolSet.has(x+"USDT")))
   return blank(step.observedAt,"MISSING_UNIVERSE");
 const history:Record<string,readonly MarketCandle5m[]>={};
 for(const sym of expected)
   history[sym]=feed.historyH1((sym+"USDT") as SyntheticSymbol,500);
 return inspectV4FullSourceBatch(step.observedAt,history);
}
