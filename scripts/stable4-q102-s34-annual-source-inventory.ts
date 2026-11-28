/** Offline annual S34 candidate inventory, not a selected trade or executable fill. */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {QUALITY102_CAUSAL_V4_S34_MODEL} from "../config/disdexQuality102CausalV4Model";
import {generateQuality102CausalV4S34Candidates} from "../lib/disdex-quality102-causal-v4-s34";
import type {Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
const H=3600000, START=Date.UTC(2025,9,1), END=Date.UTC(2026,9,1);
const [dataRoot,output]=process.argv.slice(2);
if(!dataRoot||!output)throw Error("INPUT_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const reviewed=JSON.parse(readFileSync(resolve("docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json"),"utf8"));
const symbols=[...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))].sort();
const routeCounts:Record<string,number>=Object.fromEntries(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>[x.key,0]));
const sourcePaths=["config/disdexQuality102CausalV4Model.ts","lib/disdex-quality102-causal-v4-s34.ts","lib/disdex-quality102-causal-selector.ts","lib/disdex-quality102-causal-v4-signal.ts"];
const pins=Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(p))]));
const coverage:Record<string,unknown>={}, events:ReturnType<typeof generateQuality102CausalV4S34Candidates>=[];
const expectedClocks=Array.from({length:(END-START)/H},(_,i)=>START+i*H).filter(t=>new Date(t).getUTCHours()%4===1);
for(const symbol of symbols){
 const doc=reviewed.perTicker[symbol.replace(/USDT$/,"")];
 const tape=new Map<number,Quality102Candle|null>();
 const files=[];
 for(const [key,folder] of [["early","aster-public-v3-h1-early"],["main","aster-public-v3-h1"]] as const){
  const meta=doc?.[key]; if(!meta?.file)continue;
  const raw=readFileSync(resolve(dataRoot,folder,meta.file));
  if(sha(raw)!==meta.sha256)throw Error("INPUT_SHA_MISMATCH:"+meta.file);
  files.push({folder,file:meta.file,sha256:meta.sha256});
  for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
   const row=JSON.parse(line);const [timestampMs,open,high,low,close,baseVolume,closeTs,quoteVolume]=row.slice(0,8).map(Number);
   const valid=Number.isSafeInteger(timestampMs)&&timestampMs%H===0&&closeTs===timestampMs+H-1&&[open,high,low,close,baseVolume,quoteVolume].every(Number.isFinite)&&low>0&&open>0&&close>0&&low<=Math.min(open,close)&&high>=Math.max(open,close)&&baseVolume>=0&&quoteVolume>=0;
   tape.set(timestampMs,tape.has(timestampMs)||!valid?null:{timestampMs,open,high,low,close,baseVolume,quoteVolume});
  }
 }
 let valid=0,missing=0,rawCandidates=0;const blockedByMonth:Record<string,number>={};
 for(const t of expectedClocks){
  const current=tape.get(t);const rows:Quality102Candle[]=[];
  for(let k=336;k>=1;k--){const row=tape.get(t-k*H);if(!row)break;rows.push(row);}
  if(!current||rows.length!==336){missing++;const m=new Date(t).toISOString().slice(0,7);blockedByMonth[m]=(blockedByMonth[m]??0)+1;continue;}
  valid++;
  const cs=generateQuality102CausalV4S34Candidates({symbol,rows,entryOpen:{timestampMs:t,open:current.open}});
  for(const c of cs){if(c.entryTs!==t||c.dataCutoffTs!==t-H||c.symbol!==symbol||!(c.key in routeCounts))throw Error("CAUSAL_SOURCE_CONTRACT");routeCounts[c.key]++;events.push(c);rawCandidates++;}
 }
 coverage[symbol]={decisionClocks:expectedClocks.length,valid,missing,rawCandidates,blockedByMonth,files};
 console.log(symbol,valid,missing,rawCandidates);
}
events.sort((a,b)=>a.entryTs-b.entryTs||a.key.localeCompare(b.key)||a.side-b.side);
const report={schema:"stable4-q102-s34-annual-source-inventory/v1",status:"PARTIAL_NATIVE_S34_RAW_CANDIDATES_ONLY",periodUtc:[new Date(START).toISOString(),new Date(END).toISOString()],sourcePins:pins,decisionClocks:expectedClocks.length,modelRoutes:QUALITY102_CAUSAL_V4_S34_MODEL.length,coverage,routeCounts,rawCandidates:events.length,distinctCandidateClocks:new Set(events.map(e=>e.entryTs)).size,events,limitations:["Only native S34 candidate generator, not final CAUSAL_V4 selection (HIGH_VOL priority, final improvement/exhaustion gate, occupancy and execution omitted)","ASTER-named pinned archive H1; 336 prior closed candles and current open only; missing and invalid clocks excluded, no proxy substitution","Not an execution or exit replay, no PnL or order authority"],orderAuthority:false,fullQ102AnnualReplay:false};
writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",report.rawCandidates,report.distinctCandidateClocks);
