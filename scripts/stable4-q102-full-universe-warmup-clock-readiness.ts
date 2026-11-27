/** Exact configured Q102 universe and default 225d rolling source readiness. Offline only. */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {QUALITY102_CAUSAL_V4_S34_MODEL} from "../config/disdexQuality102CausalV4Model";
import {buildQuality102CausalV4Signal} from "../lib/disdex-quality102-causal-v4-signal";
import type {Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
const H=3600000,START=Date.UTC(2025,9,1),END=Date.UTC(2026,9,1),N=225*24;
const [root,output]=process.argv.slice(2);if(!root||!output)throw Error("INPUT_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const wiring="scripts/ops/root/disdex-current-runtime-wiring";
const runner="scripts/disdex-quality102-causal-v1-live-runner.ts";
const market="lib/disdex-quality102-causal-v1-market-data.ts";
const wr=readFileSync(wiring,"utf8"),lr=readFileSync(runner,"utf8");
const highVol=wr.match(/^QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS="([A-Z0-9,]+)"$/m)?.[1].split(",").sort();
if(!highVol||highVol.length!==9||!lr.includes("const DEFAULT_HISTORY_HOURS = 225 * 24;"))throw Error("SOURCE_CONFIG_CHANGED");
const symbols=[...new Set(["BTCUSDT",...highVol,...QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol)])].sort();
const ref="docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json";
const reviewed=JSON.parse(readFileSync(ref,"utf8"));
const alternateRef="docs/research/STABLE4_Q102_ASTER_H1_181D_ARCHIVE_SOURCE_INTEGRITY_20261128.json";
const alternate=JSON.parse(readFileSync(alternateRef,"utf8")).folders["aster-public-v3-h1-q102-warmup"];
const from=START-N*H,slots=(END-from)/H;
const tapes=new Map<string,{bars:(Quality102Candle|null)[],opens:(number|null)[],prefix:Uint32Array}>();
const files:unknown[]=[];
for(const symbol of symbols){
 const bars=Array<Quality102Candle|null>(slots).fill(null),opens=Array<number|null>(slots).fill(null),seen=new Set<number>();
 const meta=reviewed.perTicker[symbol.replace(/USDT$/,"")];
 const alt=alternate[symbol.replace(/USDT$/,"")];
 const archives=alt?[["aster-public-v3-h1-q102-warmup",{file:alt.filename,sha256:alt.sha256}]]:[["aster-public-v3-h1-early",meta?.early],["aster-public-v3-h1",meta?.main]];
 for(const [folder,item] of archives){
  if(!item?.file)continue;
  const raw=readFileSync(resolve(root,folder,item.file));if(sha(raw)!==item.sha256)throw Error("ARCHIVE_SHA_MISMATCH:"+item.file);
  files.push({symbol,folder,file:item.file,sha256:item.sha256});
  for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
   const r=JSON.parse(line),[timestampMs,open,high,low,close,baseVolume,closeTs,quoteVolume]=r.slice(0,8).map(Number),i=(timestampMs-from)/H;
   if(!Number.isSafeInteger(i)||i<0||i>=slots)continue;
   if(seen.has(i)){bars[i]=null;opens[i]=null;continue;}seen.add(i);
   if(Number.isFinite(open)&&open>0)opens[i]=open;
   if(closeTs===timestampMs+H-1&&[open,high,low,close,baseVolume,quoteVolume].every(Number.isFinite)&&Math.min(open,low,close)>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)&&baseVolume>=0&&quoteVolume>=0)bars[i]={timestampMs,open,high,low,close,baseVolume,quoteVolume};
  }
 }
 const prefix=new Uint32Array(slots+1);for(let i=0;i<slots;i++)prefix[i+1]=prefix[i]+(bars[i]===null?1:0);
 tapes.set(symbol,{bars,opens,prefix});
}
const missingCounts=Object.fromEntries(symbols.map(s=>[s,0])),byMonth:Record<string,{ready:number,blocked:number}>={};
const valid:number[]=[],blocked:number[]=[];
for(let t=START;t<END;t+=H){
 const i=(t-from)/H,m=new Date(t).toISOString().slice(0,7),month=byMonth[m]??(byMonth[m]={ready:0,blocked:0});
 let ok=true;
 for(const s of symbols){const a=tapes.get(s)!;if(a.prefix[i]-a.prefix[i-N]>0||a.opens[i]===null){missingCounts[s]++;ok=false;}}
 if(ok){valid.push(t);month.ready++;}else{blocked.push(t);month.blocked++;}
}
const candidatePath="docs/research/STABLE4_Q102_S34_ANNUAL_SOURCE_INVENTORY_20261128.json";
const candidates=JSON.parse(readFileSync(candidatePath,"utf8"));
const candidateClocks=new Set<number>(candidates.events.map((c:{entryTs:number})=>c.entryTs));
const eligibleCandidateClocks=valid.filter(t=>candidateClocks.has(t));
const sampled=new Set<number>();
for(const a of [valid,eligibleCandidateClocks])if(a.length)for(const q of [0,.5,1])sampled.add(a[Math.floor(q*(a.length-1))]);
const observations=[];
for(const decisionTs of [...sampled].sort((a,b)=>a-b)){
 const i=(decisionTs-from)/H;
 const candlesBySymbol=Object.fromEntries(symbols.map(s=>[s,tapes.get(s)!.bars.slice(i-N,i) as Quality102Candle[]]));
 const entryOpenBySymbol=Object.fromEntries(symbols.map(s=>[s,{timestampMs:decisionTs,open:tapes.get(s)!.opens[i]!}]));
 const signal=buildQuality102CausalV4Signal({history:{candlesBySymbol,entryOpenBySymbol},decisionTs,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}},{highVolSymbols:highVol});
 if(signal.dataCutoffTs!==decisionTs-H||signal.side!==0&&(!signal.symbol||!symbols.includes(signal.symbol)))throw Error("NATIVE_CAUSAL_CONTRACT");
 observations.push({decisionTs,candidateClock:candidateClocks.has(decisionTs),signal});
 console.log("NATIVE_SAMPLE",new Date(decisionTs).toISOString(),signal.side,signal.family,signal.reason);
}
const paths=[wiring,runner,market,"config/disdexQuality102CausalV4Model.ts","lib/disdex-quality102-causal-v4-signal.ts","lib/disdex-quality102-causal-v1-signal.ts","lib/disdex-quality102-causal-v4-s34.ts","lib/disdex-quality102-causal-pipeline.ts","lib/disdex-quality102-causal-selector.ts",ref,alternateRef,candidatePath,"scripts/stable4-q102-full-universe-warmup-clock-readiness.ts"];
const result={schema:"stable4-q102-full-universe-warmup-clock-readiness/v1",status:"PARTIAL_SOURCE_READY_CLOCKS_AND_NATIVE_SAMPLES_ONLY",periodUtc:[new Date(START).toISOString(),new Date(END).toISOString()],sourcePins:Object.fromEntries(paths.map(p=>[p,sha(readFileSync(p))])),highVol,symbols,historyHours:N,files,totalClocks:(END-START)/H,readyClocks:valid.length,blockedClocks:blocked.length,firstReadyUtc:valid.length?new Date(valid[0]).toISOString():null,lastReadyUtc:valid.length?new Date(valid.at(-1)!).toISOString():null,missingCounts,byMonth,eligibleCandidateClocks:eligibleCandidateClocks.length,observations,orderAuthority:false,fullQ102AnnualReplay:false,limitations:["Configured monitor/root source universe and default history, not attested effective LIVE environment","Separate archive-source arm: pinned whole Q102 warmup archives for its ten symbols, early/main pair for remaining symbols. No intra-symbol stitching to repair conflicting records; no cross-venue substitution. 225d closed history and current hour open only","Sample first/middle/last ready clocks and ready S34 candidate clocks with all sleeves assumed idle. Not an all-hour selection, real occupancy, execution or exit replay"]};
writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify({symbols:result.symbols.length,ready:result.readyClocks,blocked:result.blockedClocks,first:result.firstReadyUtc,last:result.lastReadyUtc,eligibleCandidateClocks:result.eligibleCandidateClocks,missingCounts,byMonth,observations:observations.length}));
