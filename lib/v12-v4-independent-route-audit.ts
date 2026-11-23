/** Standalone read-only exhaustive V4 route audit.
 * Scans the production 41-route catalog independently, including routes that
 * would have been skipped by production's first-match .slice(0, 1).
 * A candidate is NOT an order and shadow admission is not venue certification.
 */
import {
  V12_V4_ROUTE_CATALOG,
  evaluateV12V4Routes,
  type V12V4Features,
  type V12V4ShadowCandidate,
} from "./v12-multilogic-v4-shadow";
import { evaluateV12V4V2Routes } from "./v12-v4-v2-shadow";
import {
  computeProductionH1Features,
  type SourceEvidence,
  type FeatureBar,
} from "./v12-v4-production-features";
export type IndependentRouteVerdict = {
  route:string; qualified:boolean; deferred:boolean; admission:string;
  symbol:string; eligibleEntryTs:number|null; sourceEngine:SourceEvidence["sourceEngine"];
};
const H2 = 2*3600_000;
function allocationOrder(route: string):number {
  if (route==="CONT_SHORT_MID_AGE24_48") return 0;
  const m=/^REC_([GXYZ])(\d+)/.exec(route);
  if (!m) return -1;
  return ({G:10,X:30,Y:60,Z:60} as Record<string,number>)[m[1]]+Number(m[2]);
}
export function identifyFallbacks(verdicts: readonly IndependentRouteVerdict[], initialRoute:string|null) {
  const initial=verdicts.find(v=>v.route===initialRoute);
  const fallback=initial && !initial.qualified && !initial.deferred
    ? verdicts.filter(v=>v.qualified && v.route!==initialRoute)
    : [];
  return {initialRoute, initialRejected:!!initial && !initial.qualified && !initial.deferred,
    viableFallbackRoutes:fallback.map(x=>x.route), potentialFallbackCount:fallback.length,
    actualOrderEligible:false as const};
}
export function evaluateIndependentV4RoutesReadOnly(input: {
  source:SourceEvidence; decisionTs:number;
  symbolBars:readonly FeatureBar[]; btcBars:readonly FeatureBar[];
  activeRunnerSinceMs:number; excludedDowntime?:readonly {fromMs:number;toMs:number}[];
}) {
  const {source:s,decisionTs:t}=input;
  if (!Number.isFinite(t) || t%H2!==0 || !Number.isFinite(input.activeRunnerSinceMs))
    throw Error("V4_AUDIT_INVALID_H2_BOUNDARY");
  // Never miscount stopped/reconfigured V4 as legitimate observation opportunities.
  if(t<input.activeRunnerSinceMs || input.excludedDowntime?.some(x=>t>=x.fromMs&&t<x.toMs))
    return {schema:"v12-v4-41route-exhaustive-audit/v1" as const,
      readOnly:true as const,orderEnabled:false as const,tradingMutation:0 as const,
      eligibleWindow:false as const,registeredRoutes:V12_V4_ROUTE_CATALOG.length,
      independentlyEvaluatedRoutes:0,sourceEligibleRoutes:0,
      qualifiedRoutes:[] as V12V4ShadowCandidate[],
      verdicts:[] as IndependentRouteVerdict[],firstSelectedRoute:null,
      fallbacks:{initialRoute:null,initialRejected:false,viableFallbackRoutes:[],potentialFallbackCount:0,
        actualOrderEligible:false as const}};
  const raw=computeProductionH1Features(s.symbol,s.side,s.eligibleSourceEntryTs,t,input.symbolBars,input.btcBars);
  const obs:V12V4Features={...raw.features,sourceSide:s.side,sourceSignalTs:s.eligibleSourceEntryTs,
    age:s.momentumConditionAgeHours,coreRequestedGross:s.coreRequestedGross,
    nativeDiagnosticRet6:s.nativeDiagnosticRet6,nativeDiagnosticEma12Atr:s.nativeDiagnosticEma12Atr,...s.failedBreak};
  const sourceEligible=evaluateV12V4Routes(obs)
    .filter(c=>s.sourceEngine==="FAILED_BREAK_NATIVE"
      ?c.route==="FAILED_BREAK_REV_SHORT_6H":c.route!=="FAILED_BREAK_REV_SHORT_6H")
    .sort((a,b)=>allocationOrder(a.route)-allocationOrder(b.route));
  const sourceByRoute=new Map(sourceEligible.map(c=>[c.route,c]));
  const verdicts:IndependentRouteVerdict[]=[];
  const qualifiedRoutes:V12V4ShadowCandidate[]=[];
  for (const route of V12_V4_ROUTE_CATALOG) {
    const candidate=sourceByRoute.get(route.route);
    if(!candidate){verdicts.push({route:route.route,qualified:false,deferred:false,
      admission:"SOURCE_ROUTE_TOKEN_BLOCK",symbol:s.symbol,eligibleEntryTs:null,sourceEngine:s.sourceEngine});continue;}
    if(candidate.eligibleEntryTs>t) {
      verdicts.push({route:candidate.route,qualified:false,deferred:true,admission:"WAIT_ENTRY_BOUNDARY",
        symbol:s.symbol,eligibleEntryTs:candidate.eligibleEntryTs,sourceEngine:s.sourceEngine});continue;
    }
    const atEntry=computeProductionH1Features(s.symbol,candidate.effectiveSide,candidate.eligibleEntryTs,t,
      input.symbolBars,input.btcBars);
    const res=evaluateV12V4V2Routes([{...obs,v2EntryFeatures:{
      ...atEntry.features,entryTsMs:candidate.eligibleEntryTs,lastClosedBarTsMs:atEntry.lastClosedBarTsMs,
    }}]);
    const accepted=res.candidates.find(x=>x.route===candidate.route);
    const filtered=res.filtered.find(x=>x.route===candidate.route);
    if(accepted) qualifiedRoutes.push(accepted);
    verdicts.push({route:candidate.route,qualified:!!accepted,deferred:false,
      admission:accepted?"PASSED_ROUTE_REPAIRS":filtered?.reason??"SOURCE_REPAIR_REJECTED",
      symbol:s.symbol,eligibleEntryTs:candidate.eligibleEntryTs,sourceEngine:s.sourceEngine});
  }
  const firstSelectedRoute=sourceEligible[0]?.route??null;
  return {schema:"v12-v4-41route-exhaustive-audit/v1" as const,
    readOnly:true as const,orderEnabled:false as const,tradingMutation:0 as const,
    eligibleWindow:true as const,registeredRoutes:V12_V4_ROUTE_CATALOG.length,
    independentlyEvaluatedRoutes:verdicts.length,sourceEligibleRoutes:sourceEligible.length,
    qualifiedRoutes,verdicts,firstSelectedRoute,
    fallbacks:identifyFallbacks(verdicts,firstSelectedRoute)};
}
