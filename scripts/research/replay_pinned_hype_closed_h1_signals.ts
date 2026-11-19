/** Isolated, order-free HYPE pure signal replay using source copied from a pinned Git commit. */
import {readFileSync, writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

type Candle={ts:number;open:number;high:number;low:number;close:number};
const HOUR=3600000;
const SHA="e0e4f1d8f22b62e9410188ef6e590a20e31f760f";
const START=Date.parse("2025-10-01T00:00:00Z");
const END=Date.parse("2026-10-01T00:00:00Z");

function hash(data:Buffer):string{return createHash("sha256").update(data).digest("hex");}
function bars(input:string):{byTs:Map<number,Candle>;sha256:string;count:number}{
 const blob=readFileSync(input);
 const text=gunzipSync(blob).toString("utf-8");
 const byTs=new Map<number,Candle>();
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  const raw=JSON.parse(line);
  if(!Array.isArray(raw)||raw.length<5)throw Error("INVALID_H1_SOURCE_ROW");
  const [ts,open,high,low,close]=raw.slice(0,5).map(Number);
  if(!Number.isSafeInteger(ts)||ts%HOUR!==0||[open,high,low,close].some(x=>!Number.isFinite(x)||x<=0)
     ||high<Math.max(open,close)||low>Math.min(open,close)||byTs.has(ts))
    throw Error("INVALID_OR_DUPLICATE_H1_CANDLE");
  byTs.set(ts,{ts,open,high,low,close});
 }
 return {byTs,sha256:hash(blob),count:byTs.size};
}
function sampleAt(map:Map<number,Candle>,entryTs:number):Candle[]{
 const rows:Candle[]=[];
 for(let i=73;i>=1;i--){
  const value=map.get(entryTs-i*HOUR);
  if(value)rows.push(value);
 }
 return rows;
}

async function main():Promise<void>{
 const [sourceRoot,repoRoot,hypePath,btcPath,modelEntryPath,outputPath]=process.argv.slice(2);
 if(!sourceRoot||!repoRoot||!hypePath||!btcPath||!modelEntryPath||!outputPath)
  throw Error("Usage: sourceRoot repoRoot hypeH1.gz btcH1.gz modeledEntryTimes.json output.json");
 const rel=["lib/hype-stable4-opportunity-signal.ts","config/disdexStable4Opportunity.ts"];
 const checks:Record<string,string>={};
 for(const path of rel){
  const disk=readFileSync(join(sourceRoot,path));
  const pinned=execFileSync("git",["-C",repoRoot,"show",SHA+":"+path],{maxBuffer:8*1024*1024});
  if(!disk.equals(pinned))throw Error("PURE_SOURCE_GIT_SHA_MISMATCH:"+path);
  checks[path]=hash(disk);
 }
 // The imported module is a single pure signal evaluator plus its immutable constants.
 const imported=await import(pathToFileURL(resolve(sourceRoot,rel[0])).href);
 const config=await import(pathToFileURL(resolve(sourceRoot,rel[1])).href);
 if(typeof imported.evaluateStable4HypeSignal!=="function")throw Error("PINNED_PURE_SIGNAL_UNAVAILABLE");
 const hype=bars(hypePath),btc=bars(btcPath);
 const entryTimes:unknown=JSON.parse(readFileSync(modelEntryPath,"utf-8"));
 if(!Array.isArray(entryTimes)||entryTimes.length!==5||entryTimes.some(x=>typeof x!=="string"||!Number.isFinite(Date.parse(x))||Date.parse(x)<START||Date.parse(x)>=END))
  throw Error("RESEARCH_ENTRY_PROVENANCE_INVALID");
 const reasons:Record<string,number>={};
 const candidates:{utc:string;entryPrice:number;reason:string}[]=[];
 let tested=0;
 for(let now=START;now<END;now+=6*HOUR){
  const outcome=imported.evaluateStable4HypeSignal({
   now,btc1h:sampleAt(btc.byTs,now),hype1h:sampleAt(hype.byTs,now),
  });
  tested++;
  if(typeof outcome.reason!=="string"||typeof outcome.accepted!=="boolean")throw Error("PINNED_SIGNAL_BAD_RETURN");
  reasons[outcome.reason]=(reasons[outcome.reason]??0)+1;
  if(outcome.accepted){
   if(outcome.signalTs!==now||typeof outcome.entryPrice!=="number"||outcome.entryPrice<=0)
    throw Error("PINNED_ACCEPTED_TIMESTAMP_OR_PRICE_INVALID");
   candidates.push({utc:new Date(now).toISOString().replace(".000Z","Z"),entryPrice:outcome.entryPrice,reason:outcome.reason});
  }
 }
 const researchEntries=[...entryTimes].sort() as string[];
 const accepted=new Set(candidates.map(x=>x.utc));
 const overlap=researchEntries.filter(x=>accepted.has(x));
 const report={
  schema:"disdex-bt-hype-pinned-pure-signal-replay/v1",
  source:"EXACT_GIT_BLOB_ISOLATED_PURE_FUNCTION",
  observed_live_git_commit:SHA,source_sha256:checks,
  market_h1_files:{hype_sha256:hype.sha256,btc_sha256:btc.sha256,hype_rows:hype.count,btc_rows:btc.count},
  period_start_inclusive:"2025-10-01T00:00:00Z",
  period_end_exclusive:"2026-10-01T00:00:00Z",
  six_hour_boundaries_tested:tested,
  accepted_pure_signal_count:candidates.length,
  accepted_pure_signals:candidates,
  research_modeled_hype_exits:researchEntries.length,
  modeled_research_entry_overlap:overlap.length,
  modeled_research_entries_not_in_pure_signal:researchEntries.filter(x=>!accepted.has(x)),
  rejects_by_reason:reasons,
  pinned_code_config_only:{
   hypeGross:config.DISDEX_STABLE4_OPPORTUNITY.hype.gross,
   stockGrossCap:config.DISDEX_STABLE4_OPPORTUNITY.portfolio.stockGrossCap,
   totalGrossCap:config.DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap,
   v4TotalGrossCap:config.DISDEX_STABLE4_OPPORTUNITY.portfolio.v4TotalGrossCap,
  },
  runtime_active_signal_mode_verified:false,
  order_admission_and_portfolio_priority_reexecuted:false,
  stop_exit_funding_and_fills_reexecuted:false,
  actual_exchange_fills_verified:false,
  production_bt_parity_certified:false,
 };
 writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n",{encoding:"utf-8"});
 console.log("PINNED_HYPE_PURE_SIGNAL_REPLAY tested="+tested+" accepted="+candidates.length+" source_modeled="+researchEntries.length+" overlap="+overlap.length);
 console.log("REJECTS="+JSON.stringify(reasons));
 console.log("PURE_SIGNAL_ONLY_NOT_PRODUCTION_BT");
}
main().catch(e=>{console.error(e instanceof Error?e.message:"unknown error");process.exitCode=1;});
