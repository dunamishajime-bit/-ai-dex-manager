/**
 * Pure, read-only parser for runner-authored V12 diagnostic snapshots.
 * No gate is re-evaluated here, and no UI result can authorize a trade.
 */
export type V12GateCheckState = "PASS" | "BLOCK" | "NOT_APPLICABLE" | "NOT_EVALUATED";
export type V12GateCheckView = {
  status: V12GateCheckState;
  observed?: number;
  minimum?: number;
  maximum?: number;
  detail?: string;
};
export type V12AllGateAuditView = {
  schema: "v12-all-gates-audit/v1";
  checks: Record<string, V12GateCheckView>;
  strongScoreGap: boolean;
  strongScoreGapOnlyBaseFailure: boolean;
  independentBasePass: boolean;
  portfolioRank?: number;
};
export type V12GateDiagnosticsView = {
  schema: "v12-gate-diagnostics/v1";
  referenceTs?: number;
  freshness?: "fresh" | "stale";
  candidateCount?: number;
  baseEligibleCount?: number;
  portfolioRankedCount?: number;
  gateEvaluatedCount?: number;
  standardAcceptedCount?: number;
  hc175AcceptedCount?: number;
  finalSignalCount?: number;
  rejectedCount?: number;
  strongScoreGapCandidates?: number;
  strongScoreGapOnlyBaseFailure?: number;
  multiBaseFailureCandidates?: number;
  rejectionReasons: Record<string, number>;
  allCheckBlockCounts: Record<string, number>;
};
export type V12HistoryStats = {
  available: boolean;
  source: "V12_RUNNER_DAILY_DECISION_JSONL";
  daysRequested: number;
  daysRead: number;
  observedH2Bars: number;
  repeatedSelectedSignals: number;
  independent24hPerSymbol: number;
  independent46hPerSymbol: number;
  signalDaysJst: number;
  realOrderableCount: null;
  actualEntryCount: null;
  latestReferenceTs?: number;
  warning?: string;
};
const CHECKS = [
 "volume", "edgeToCost", "momentum", "btcDirection", "scoreStandard",
 "scoreStrongAlternative", "atrStrongAlternative", "momentumWeakAlternative",
 "atrWeakAlternative", "entryQuality", "portfolioSelection", "rank3Score", "winRate"
] as const;
function obj(x: unknown): Record<string,unknown> | null {
  return typeof x === "object" && x!==null && !Array.isArray(x) ? x as Record<string,unknown> : null;
}
function num(x:unknown):number|undefined {
  return typeof x==="number" && Number.isFinite(x)?x:undefined;
}
function countMap(x:unknown):Record<string,number>{
  const o=obj(x), result:Record<string,number>={};
  if(!o)return result;
  for(const [key,v] of Object.entries(o).slice(0,80))
    if(key.length<=100 && typeof v==="number" && Number.isInteger(v) && v>=0)
      result[key]=v;
  return result;
}
export function parseV12AllGateChecks(input:unknown):V12AllGateAuditView|undefined {
  const v=obj(input);if(!v||v.schema!=="v12-all-gates-audit/v1")return undefined;
  const raw=obj(v.checks);if(!raw)return undefined;
  const checks:Record<string,V12GateCheckView>={};
  for(const key of CHECKS){
    const check=obj(raw[key]);if(!check)continue;
    const status=check.status;
    if(status!=="PASS"&&status!=="BLOCK"&&status!=="NOT_APPLICABLE"&&status!=="NOT_EVALUATED")continue;
    checks[key]={status,
      ...(num(check.observed)!==undefined?{observed:num(check.observed)}:{}),
      ...(num(check.minimum)!==undefined?{minimum:num(check.minimum)}:{}),
      ...(num(check.maximum)!==undefined?{maximum:num(check.maximum)}:{}),
      ...(typeof check.detail==="string"?{detail:check.detail.slice(0,150)}:{})};
  }
  if(!Object.keys(checks).length)return undefined;
  return {schema:"v12-all-gates-audit/v1",checks,
    strongScoreGap:v.strongScoreGap===true,
    strongScoreGapOnlyBaseFailure:v.strongScoreGapOnlyBaseFailure===true,
    independentBasePass:v.independentBasePass===true,
    ...(num(v.portfolioRank)!==undefined?{portfolioRank:num(v.portfolioRank)}:{})};
}
export function parseV12GateDiagnostics(input:unknown):V12GateDiagnosticsView|undefined {
  const v=obj(input);if(!v||v.schema!=="v12-gate-diagnostics/v1")return undefined;
  const keys=["referenceTs","candidateCount","baseEligibleCount","portfolioRankedCount",
  "gateEvaluatedCount","standardAcceptedCount","hc175AcceptedCount","finalSignalCount",
  "rejectedCount","strongScoreGapCandidates","strongScoreGapOnlyBaseFailure",
  "multiBaseFailureCandidates"] as const;
  const base:{[key:string]:unknown}={schema:"v12-gate-diagnostics/v1"};
  for(const key of keys)if(num(v[key])!==undefined)base[key]=num(v[key]);
  if(v.freshness==="fresh"||v.freshness==="stale")base.freshness=v.freshness;
  return {...base,rejectionReasons:countMap(v.rejectionReasons),
    allCheckBlockCounts:countMap(v.allCheckBlockCounts)} as V12GateDiagnosticsView;
}
type Episode={referenceTs:number;symbol:string;side:string};
export function summarizeV12DecisionHistory(input:unknown[],since:number,daysRead:number,warning?:string):V12HistoryStats {
  const seen=new Set<string>();
  const refs=new Set<number>();
  const episodes:Episode[]=[];
  for(const value of input) {
    const row=obj(value);if(!row)continue;
    const ts=num(row.referenceTs);
    if(ts===undefined || ts<since || ts>Date.now()+10_000)continue;
    refs.add(ts);
    const candidates=Array.isArray(row.candidates)?row.candidates:[];
    for(const c of candidates){
      const item=obj(c);if(!item)continue;
      // Runner's actual selected Top3 + finalized win-rate gate, not raw score ranks.
      const rank=num(item.portfolioRank);
      if(rank===undefined || rank<1 || rank>3 || item.signalEligible!==true
        || (item.entryGateReason!=="ALLOW_STANDARD" && item.entryGateReason!=="ALLOW_HC175"))continue;
      const symbol=typeof item.symbol==="string"?item.symbol:"";
      const side=item.side==="LONG"||item.side==="SHORT"?item.side:"";
      if(!symbol || !side)continue;
      const key=ts+"|"+symbol+"|"+side;
      if(seen.has(key))continue;
      seen.add(key);
      episodes.push({referenceTs:ts,symbol,side});
    }
  }
  episodes.sort((a,b)=>a.referenceTs-b.referenceTs||a.symbol.localeCompare(b.symbol));
  function spaced(ms:number):number {
    const last=new Map<string,number>();let count=0;
    for(const e of episodes){
      const old=last.get(e.symbol);if(old!==undefined && e.referenceTs-old<ms)continue;
      last.set(e.symbol,e.referenceTs);count++;
    }return count;
  }
  const days=new Set(episodes.map(e=>new Date(e.referenceTs+9*3_600_000).toISOString().slice(0,10)));
  return {available:daysRead>0,source:"V12_RUNNER_DAILY_DECISION_JSONL",daysRequested:7,daysRead,
    observedH2Bars:refs.size,repeatedSelectedSignals:episodes.length,
    independent24hPerSymbol:spaced(24*3_600_000),
    independent46hPerSymbol:spaced(46*3_600_000),
    signalDaysJst:days.size,realOrderableCount:null,actualEntryCount:null,
    ...(refs.size?{latestReferenceTs:Math.max(...refs)}:{}),
    ...(warning?{warning}:{})};
}
