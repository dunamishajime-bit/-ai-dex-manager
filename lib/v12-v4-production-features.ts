/**
 * Exact closed-H1 formula port of run_v12_missed_route_decomposition.feat and
 * run_v12_v4_route_repair_secondpass.feat. No use of a bar with close time > decision time.
 * Native source candidate, momentum age and failed-break setup remain externally proven inputs.
 */
import { HOUR, type H1Bar } from "./v12-v4-production-lifecycle";
import { evaluateV12V4Routes, type V12V4Features, type V12V4Side } from "./v12-multilogic-v4-shadow";
import { evaluateV12V4V2Routes, type V12V4V2Features } from "./v12-v4-v2-shadow";
export type FeatureBar = H1Bar & { quoteVolume: number };
export type SourceEvidence = {
  symbol: string; side: V12V4Side; eligibleSourceEntryTs: number; decisionTs: number;
  momentumConditionAgeHours: number; coreRequestedGross?: number;
  nativeDiagnosticRet6?: number; nativeDiagnosticEma12Atr?: number;
  sourceEngine: "buildV12Signals" | "FAILED_BREAK_NATIVE";
  sourceParityVerified: boolean;
  failedBreak?: Pick<V12V4Features,"freshUpward90hOnset"|"structuralUpBreak"|"failedBelowWithin6h"|"oppositeClvBodyConfirm">;
};
function indexClosed(bars: readonly FeatureBar[], t: number, at: number) {
  if (!Number.isFinite(t) || t%HOUR!==0 || !Number.isFinite(at) || at<t) throw Error("FEATURE_DECISION_BEFORE_ENTRY_BOUNDARY");
  const map=new Map<number,FeatureBar>();
  for (const b of bars) {
    if (!Number.isFinite(b.openTs)||b.openTs%HOUR!==0) throw Error("INVALID_H1_TIMESTAMP");
    // Future bars are excluded even when a historical replay supplied them.
    if (b.openTs+HOUR>Math.min(t,at)) continue;
    if (map.has(b.openTs)) throw Error("DUPLICATE_H1_BAR");
    if (![b.open,b.high,b.low,b.close].every(n=>Number.isFinite(n)&&n>0) ||
      !Number.isFinite(b.quoteVolume)||b.quoteVolume<0 ||
      b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low>b.high) throw Error("INVALID_H1_BAR");
    map.set(b.openTs,b);
  }
  for(let i=48;i>0;i--) if(!map.has(t-i*HOUR)) throw Error("FEATURE_H1_GAP:"+String(t-i*HOUR));
  return map;
}
export function computeProductionH1Features(symbol: string, side: V12V4Side, entryTs: number,
  decisionTs: number, symbolBars: readonly FeatureBar[], btcBars: readonly FeatureBar[]) {
  if (!["LONG","SHORT"].includes(side)) throw Error("INVALID_FEATURE_SIDE");
  const sm=indexClosed(symbolBars,entryTs,decisionTs), bm=indexClosed(btcBars,entryTs,decisionTs);
  const get=(m: Map<number,FeatureBar>,i:number)=>m.get(entryTs-i*HOUR)!;
  const prev=get(sm,1), px=prev.close, sg=side==="LONG"?1:-1;
  const atr=(n:number)=>{
    let total=0;
    for(let i=n;i>0;i--){const b=get(sm,i),p=get(sm,i+1);total+=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));}
    return total/n;
  };
  const A=atr(14);if(!(A>0))throw Error("FEATURE_ATR_ZERO");
  const ret=(m:Map<number,FeatureBar>,n:number)=>get(m,1).close/get(m,n+1).close-1;
  const ema=(xs:number[],n:number)=>xs.slice(1).reduce((a,x)=>2/(n+1)*x+(1-2/(n+1))*a,xs[0]);
  const closes=Array.from({length:48},(_,i)=>get(sm,48-i).close);
  const prior=Array.from({length:24},(_,i)=>get(sm,25-i));
  const vols=prior.map(b=>b.quoteVolume).sort((a,b)=>a-b), med=(vols[11]+vols[12])/2;
  if(!(med>0))throw Error("FEATURE_VOLUME_MEDIAN_ZERO");
  const hi=Math.max(...prior.map(b=>b.high)),lo=Math.min(...prior.map(b=>b.low));
  const loc=hi>lo?(px-lo)/(hi-lo):0.5;
  const recent=Array.from({length:13},(_,i)=>get(sm,13-i));
  const favored=sg===1?Math.max(...recent.map(b=>b.high)):Math.min(...recent.map(b=>b.low));
  const er=closes.slice(-25),den=er.slice(1).reduce((s,x,i)=>s+Math.abs(x-er[i]),0);
  const sr24=ret(sm,24),br24=ret(bm,24),clv=prev.high>prev.low?(px-prev.low)/(prev.high-prev.low):0.5;
  const f: Omit<V12V4Features,"sourceSignalTs"|"sourceSide"> = {
    symbol:symbol.toUpperCase(),sret6:sg*ret(sm,6),btc6:sg*ret(bm,6),btc24:sg*br24,
    rel12:sg*(ret(sm,12)-ret(bm,12)),rel24:sg*(sr24-br24),
    ema12Dist:sg*(px-ema(closes.slice(-24),12))/A,
    break24Atr:sg===1?(px-hi)/A:(lo-px)/A,volRatio:prev.quoteVolume/med,
    er24:den>0?Math.abs(er.at(-1)!-er[0])/den:0,rangeLoc24:sg===1?loc:1-loc,
    pullback12Atr:sg===1?(favored-px)/A:(px-favored)/A,compression:atr(6)/atr(24),
    bodyAtr:sg*(px-prev.open)/A,clv:sg===1?clv:1-clv,
  };
  return { features:f, atr14:A, lastClosedBarTsMs:entryTs-HOUR, maxFeatureCloseTsMs:entryTs,
    formulas:"PYTHON_MISSED_DECOMPOSITION_AND_SECOND_PASS" as const };
}
export function adaptProductionCandidates(args:{
  source:SourceEvidence; decisionTs:number; symbolBars:readonly FeatureBar[]; btcBars:readonly FeatureBar[];
}) {
  const s=args.source;
  if(!["buildV12Signals","FAILED_BREAK_NATIVE"].includes(s.sourceEngine)||typeof s.sourceParityVerified!=="boolean")throw Error("INVALID_SOURCE_ENGINE");
  if (!s.symbol || !Number.isFinite(s.momentumConditionAgeHours)||s.momentumConditionAgeHours<0||
    !Number.isFinite(s.decisionTs)||s.decisionTs>s.eligibleSourceEntryTs) throw Error("INVALID_SOURCE_EVIDENCE");
  const source=computeProductionH1Features(s.symbol,s.side,s.eligibleSourceEntryTs,args.decisionTs,args.symbolBars,args.btcBars);
  const obs:V12V4V2Features={...source.features,sourceSide:s.side,sourceSignalTs:s.eligibleSourceEntryTs,
    age:s.momentumConditionAgeHours,coreRequestedGross:s.coreRequestedGross,
    nativeDiagnosticRet6:s.nativeDiagnosticRet6,nativeDiagnosticEma12Atr:s.nativeDiagnosticEma12Atr,...s.failedBreak};
  // Allocation order is frozen discovery order, separate from portfolio firing rank.
  // First matching source route is chosen before either repair pass; rejected repairs do not fall through.
  const allocationOrder=(route:string)=>{
    if(route==="CONT_SHORT_MID_AGE24_48")return 0;
    const m=/^REC_([GXYZ])(\d+)/.exec(route);
    if(!m)return -1;
    return (m[1]==="G"?10:m[1]==="X"?30:60)+Number(m[2]);
  };
  const raw=evaluateV12V4Routes(obs).filter(r=>s.sourceEngine==="FAILED_BREAK_NATIVE"
    ? r.route==="FAILED_BREAK_REV_SHORT_6H" : r.route!=="FAILED_BREAK_REV_SHORT_6H")
    .sort((a,b)=>allocationOrder(a.route)-allocationOrder(b.route)).slice(0,1), candidates=[] as ReturnType<typeof evaluateV12V4V2Routes>["candidates"],
    filtered=[] as ReturnType<typeof evaluateV12V4V2Routes>["filtered"], deferred:string[]=[];
  for(const r of raw){
    if(r.eligibleEntryTs>args.decisionTs){deferred.push(r.route);continue;}
    // Repairs at entry use effective side, including Core SHORT and flipped recovery legs.
    const ef=computeProductionH1Features(s.symbol,r.effectiveSide,r.eligibleEntryTs,args.decisionTs,args.symbolBars,args.btcBars);
    const result=evaluateV12V4V2Routes([{...obs,v2EntryFeatures:{
      ...ef.features,entryTsMs:r.eligibleEntryTs,lastClosedBarTsMs:ef.lastClosedBarTsMs,
    }}]);
    candidates.push(...result.candidates.filter(c=>c.route===r.route));
    filtered.push(...result.filtered.filter(c=>c.route===r.route));
  }
  candidates.sort((a,b)=>a.eligibleEntryTs-b.eligibleEntryTs||a.rank-b.rank||a.route.localeCompare(b.route));
  return {candidates,filtered,deferred,sourceFeatures:source.features,
    sourceParityVerified:s.sourceParityVerified, sourceEngine:s.sourceEngine,
    featureCausal:true as const, nativeSourceParityCertified:false as const,
    frozenRankingHasFullYearHindsight:true as const,
    rankingTrainingCutoffExclusiveMs:Date.parse("2026-08-11T00:00:00Z"),
    policyTemporalCausal:s.eligibleSourceEntryTs>=Date.parse("2026-08-11T00:00:00Z"),
    orderEnabled:false as const, realOrderEnabledV4:0 as const};
}
