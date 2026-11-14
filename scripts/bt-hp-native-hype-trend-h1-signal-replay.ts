#!/usr/bin/env tsx
/**
 * Historical as-of entry SIGNAL parity for the pinned HYPE TREND source.
 * No fills, no capital allocation, no current LIVE account access.
 *
 * Requires offline copies of the immutable live TS source (and matching
 * archived signal/policy source), public BTC/HYPE H1, and a legacy
 * candidate-evidence ledger to independently reconcile signals.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {resolve,join} from "node:path";

type H1={openTime:number;open:number;high:number;low:number;close:number;volume:number};
type Raw={symbol:string;interval:string;rows:unknown[]};
type Signal={accepted:boolean;reason:string;signalTsMs:number|null};
type Candidate={signal_ts_ms:number;entry_ts_ms:number;strategy_id:string};
const HOUR=3600000;
const START=Date.parse("2025-10-01T00:00:00Z");
const END=Date.parse("2026-10-01T00:00:00Z");
function option(key:string):string{
 const i=process.argv.indexOf("--"+key);
 if(i<0||!process.argv[i+1]||process.argv[i+1].startsWith("--"))throw Error("MISSING_ARG:"+key);
 return process.argv[i+1];
}
function sha(bytes:Buffer|string):string{return createHash("sha256").update(bytes).digest("hex")}
function normalized(path:string):string{return readFileSync(path,"utf8").replace(/\r\n/g,"\n")}
export function parseCandles(raw:Raw,symbol:string):H1[]{
 if(raw.symbol!==symbol||raw.interval!=="1h"||!Array.isArray(raw.rows))throw Error("INVALID_H1_IDENTITY:"+symbol);
 const out:H1[]=[];
 for(const data of raw.rows){
  if(!Array.isArray(data)||data.length<7)throw Error("BAD_H1_ROW:"+symbol);
  const [openTime,open,high,low,close,volume,closeTime]=data.map(Number);
  if(![openTime,open,high,low,close,volume,closeTime].every(Number.isFinite)||
     openTime<=0||open<=0||low<=0||high<Math.max(open,close)||
     low>Math.min(open,close)||volume<0||closeTime!==openTime+HOUR-1||
     (out.length>0&&openTime!==out[out.length-1].openTime+HOUR))
   throw Error("H1_GAP_OR_INVALID_CANDLE:"+symbol+":"+openTime);
  out.push({openTime,open,high,low,close,volume});
 }
 if(out.length<300)throw Error("INSUFFICIENT_HYPE_TREND_H1_HISTORY:"+symbol);
 return out;
}
export function compareSignalSets(accepted:number[],expected:number[]):{
 matched:number;missing:number[];extra:number[];pass:boolean}{
 const a=new Set(accepted),b=new Set(expected);
 if(a.size!==accepted.length||b.size!==expected.length)throw Error("DUPLICATE_CANDIDATE_TIMESTAMPS");
 const missing=[...b].filter(x=>!a.has(x)).sort((x,y)=>x-y);
 const extra=[...a].filter(x=>!b.has(x)).sort((x,y)=>x-y);
 return {matched:a.size-extra.length,missing,extra,pass:missing.length===0&&extra.length===0};
}
export function compareHistoricalAdmissions(nativeEntryTimes:number[],researchEntryTimes:number[]){
 if(new Set(researchEntryTimes).size!==researchEntryTimes.length)throw Error("DUPLICATE_RESEARCH_HYPE_ENTRY_TIME");
 if(new Set(nativeEntryTimes).size!==nativeEntryTimes.length)throw Error("DUPLICATE_NATIVE_HYPE_ENTRY_TIME");
 const nearest=researchEntryTimes.map(time=>{
  const diff=Math.min(...nativeEntryTimes.map(x=>Math.abs(x-time)));
  return {researchEntryUtc:new Date(time).toISOString(),
    nativeCandidateSameHour:nativeEntryTimes.includes(time),
    nearestNativeCandidateHours:Number.isFinite(diff)?diff/HOUR:null};
 });
 return {researchEntryCount:researchEntryTimes.length,nativeCandidateCount:nativeEntryTimes.length,
   sameHourCount:nearest.filter(x=>x.nativeCandidateSameHour).length,
   withinOneHourCount:nearest.filter(x=>x.nearestNativeCandidateHours!==null&&
     x.nearestNativeCandidateHours<=1).length,nearest};
}
async function main(){
 const source=resolve(option("live-source-root"));
 const prior=resolve(option("old-source-root"));
 const btcPath=resolve(option("btc-h1"));
 const hypePath=resolve(option("hype-h1"));
 const expectedPath=resolve(option("prior-candidates"));
 const outPath=resolve(option("output"));
 const signature=["lib/hype-trend-long-signal.ts","config/hypeTrendLongPolicy.ts"];
 const normalizedShas:Record<string,string>={};
 for(const rel of signature){
  const current=normalized(join(source,rel)),old=normalized(join(prior,rel));
  if(current!==old)throw Error("PINNED_SIGNAL_SOURCE_NOT_IDENTICAL:"+rel);
  normalizedShas[rel]=sha(current);
 }
 const btc=parseCandles(JSON.parse(readFileSync(btcPath,"utf8")) as Raw,"BTCUSDT");
 const hype=parseCandles(JSON.parse(readFileSync(hypePath,"utf8")) as Raw,"HYPEUSDT");
 if(btc.length!==hype.length||btc.some((row,i)=>row.openTime!==hype[i].openTime))
  throw Error("BTC_HYPE_H1_ALIGNMENT_FAILED");
 if(btc[0].openTime>START-7*24*HOUR||hype[hype.length-1].openTime<END-HOUR)
  throw Error("H1_HISTORY_TIME_COVERAGE_INCOMPLETE");
 const old=JSON.parse(readFileSync(expectedPath,"utf8")) as Candidate[];
 if(!Array.isArray(old)||old.some(x=>x.strategy_id!=="HYPE_LONG"||
    x.entry_ts_ms!==x.signal_ts_ms+HOUR))
   throw Error("HYPE_PRIOR_CANDIDATES_NOT_SIGNAL_BASED");
 const live=await import(pathToFileURL(join(source,"lib/hype-trend-long-signal.ts")).href) as {
  buildHypeTrendSignal:(input:{btc:H1[];hype:H1[];now:number})=>Signal;
 };
 if(typeof live.buildHypeTrendSignal!=="function")throw Error("NATIVE_SIGNAL_IMPORT_FAILED");
 const accepted:{signalTsMs:number;entryTsMs:number;reason:string}[]=[];
 const reasons:Record<string,number>={};
 const minBars=241;
 for(let i=minBars-1;i<btc.length;i++){
  const now=btc[i].openTime+HOUR;
  if(now<START||now>=END)continue;
  // Strict as-of prefix: the native function sees no future candle.
  const signal=live.buildHypeTrendSignal({btc:btc.slice(0,i+1),hype:hype.slice(0,i+1),now});
  reasons[signal.reason]=(reasons[signal.reason]||0)+1;
  if(!signal.accepted)continue;
  if(signal.signalTsMs!==btc[i].openTime)throw Error("FUTURE_OR_REVERSED_HYPE_SIGNAL_TIME");
  accepted.push({signalTsMs:signal.signalTsMs,entryTsMs:now,reason:signal.reason});
 }
 const comparison=compareSignalSets(accepted.map(x=>x.signalTsMs),old.map(x=>x.signal_ts_ms));
 let researchOverlap:ReturnType<typeof compareHistoricalAdmissions>|null=null;
 let researchAuditSha256:string|null=null;
 if(process.argv.includes("--research-gate-audit")){
  const proofPath=resolve(option("research-gate-audit"));
  const data=readFileSync(proofPath);
  const gate=JSON.parse(data.toString("utf8")) as {schema?:string;signals?:Array<{sourceTime:string;route:string}>};
  if(gate.schema!=="disdex-bt-hype-asof-gate-evidence/v1"||!Array.isArray(gate.signals))
   throw Error("INVALID_RESEARCH_GATE_AUDIT_INPUT");
  if(gate.signals.some(x=>x.route!=="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"||
     !x.sourceTime.endsWith("Z")||!Number.isFinite(Date.parse(x.sourceTime))))
   throw Error("INCOMPATIBLE_RESEARCH_HYPE_SIGNAL_SOURCE");
  researchOverlap=compareHistoricalAdmissions(accepted.map(x=>x.entryTsMs),
    gate.signals.map(x=>Date.parse(x.sourceTime)));
  researchAuditSha256=sha(data);
 }

 const output={
  schema:"disdex-bt-native-hype-trend-h1-signal-replay/v1",
  status:comparison.pass?"CURRENT_HYPE_TREND_SIGNAL_MATCHES_PRIOR_PINNED_CANDIDATES":"CURRENT_HYPE_TREND_SIGNAL_CANDIDATE_MISMATCH",
  period:{startUtc:new Date(START).toISOString(),endExclusiveUtc:new Date(END).toISOString()},
  asOfOnly:true,sourceDefinitionsNormalizedIdentical:true,
  historicalH1Rows:btc.length,oldSourceCandidateCount:old.length,
  nativeAcceptedSignalCount:accepted.length,
  comparison,signalReasons:reasons,
  normalizedSourceSha256:normalizedShas,
  inputSha256:{btcH1:sha(readFileSync(btcPath)),hypeH1:sha(readFileSync(hypePath)),priorCandidates:sha(readFileSync(expectedPath))},
  researchOverlap,researchGateAuditSha256:researchAuditSha256,
  nativeSignals:accepted,
  liveFillParityCertified:false,stopParityCertified:false,
  sharedRiskParityCertified:false,portfolioEconomicParityCertified:false,
  noTradeActions:true,
 };
 writeFileSync(outPath,JSON.stringify(output,null,2)+"\n","utf8");
 console.log(JSON.stringify({status:output.status,signalCount:accepted.length,oldSignalCount:old.length,
   matched:comparison.matched,missing:comparison.missing.length,extra:comparison.extra.length,
   resultFileSha256:sha(readFileSync(outPath))}));
 if(!comparison.pass)process.exitCode=2;
}
if(process.argv[1]?.endsWith("bt-hp-native-hype-trend-h1-signal-replay.ts")){
 main().catch(error=>{console.error("HYPE_NATIVE_ASOF_FAIL_CLOSED:"+(error instanceof Error?error.message:String(error)));process.exitCode=1;});
}
