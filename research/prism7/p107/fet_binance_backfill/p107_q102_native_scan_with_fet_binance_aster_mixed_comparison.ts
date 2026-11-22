import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import {createHash} from "node:crypto";
import {buildQuality102CausalV4Signal} from "./q102-pin-source-c7310d34/lib/disdex-quality102-causal-v4-signal";
import {resolveQuality102CausalV1Runtime} from "./q102-pin-source-c7310d34/config/disdexQuality102CausalV1Runtime";
import {QUALITY102_CAUSAL_V4_S34_MODEL} from "./q102-pin-source-c7310d34/config/disdexQuality102CausalV4Model";
const H=3600000,D=24*H;
const START=Date.parse("2025-10-01T01:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
const root=process.argv[2], dest=process.argv[3];
if(!root||!dest)throw Error("DATA_ROOT_AND_OUTPUT_REQUIRED");
const roots=["aster-public-v3-h1-early","aster-public-v3-h1","aster-public-v3-h1-q102-warmup"];
const highVol="SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT".split(",");
const s34=[...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))].sort();
if(s34.length!==11)throw Error("PINNED_S34_MODEL_SYMBOL_COUNT_CHANGED");
const universe=[...new Set([...highVol,...s34,"BTCUSDT"])].sort();
type C={timestampMs:number,open:number,high:number,low:number,close:number,baseVolume:number,quoteVolume:number};
type S={rows:C[],idx:Map<number,number>,badPrefix:number[],gapPrefix:number[],sources:{file:string,sha256:string,bytes:number}[],start:number,end:number};
const stock:Record<string,S>={};
for(const sym of universe){
  const list:C[]=[],sources:S["sources"]=[];
  if(sym==="FETUSDT"){
    const p=process.argv[4];
    if(!p||!p.includes("MIXED_PROVENANCE"))throw Error("EXPLICIT_CROSS_VENUE_FET_INPUT_REQUIRED");
    const raw=fs.readFileSync(p);
    sources.push({file:"BINANCE_UM_BEFORE_ASTERV3_CUTOVER_THEN_ASTER:"+path.basename(p),sha256:createHash("sha256").update(raw).digest("hex"),bytes:raw.byteLength});
    for(const line of zlib.gunzipSync(raw).toString("utf8").split("\n"))if(line.trim()){
      const z=JSON.parse(line);
      list.push({timestampMs:Number(z[0]),open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),baseVolume:Number(z[5]),quoteVolume:Number(z[7])});
    }
  }else for(const dirname of roots){
    const folder=path.join(root,dirname);
    for(const name of fs.readdirSync(folder).filter(v=>v.startsWith(sym+"-1h-")&&v.endsWith(".jsonl.gz")).sort()){
      const p=path.join(folder,name),raw=fs.readFileSync(p);
      sources.push({file:dirname+"/"+name,sha256:createHash("sha256").update(raw).digest("hex"),bytes:raw.byteLength});
      const text=zlib.gunzipSync(raw).toString("utf8");
      for(const line of text.split("\n"))if(line.trim()){
        const z=JSON.parse(line);
        list.push({timestampMs:Number(z[0]),open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),baseVolume:Number(z[5]),quoteVolume:Number(z[7])});
      }
    }
  }
  if(!list.length)throw Error("SOURCE_MISSING:"+sym);
  list.sort((a,b)=>a.timestampMs-b.timestampMs);
  const rows:C[]=[];
  for(const z of list){
    const prev=rows[rows.length-1];
    if(prev&&prev.timestampMs===z.timestampMs){
      for(const k of ["open","high","low","close","baseVolume","quoteVolume"] as const)if(z[k]!==prev[k])throw Error("DUPLICATE_SOURCE_PRICE_CONFLICT:"+sym+":"+z.timestampMs+":"+k);
      continue;
    }
    rows.push(z);
  }
  const idx=new Map<number,number>(),badPrefix=[0],gapPrefix=[0];
  for(let i=0;i<rows.length;i++){
    const z=rows[i];idx.set(z.timestampMs,i);
    const bad=![z.timestampMs,z.open,z.high,z.low,z.close,z.baseVolume,z.quoteVolume].every(Number.isFinite)
      ||z.open<=0||z.high<=0||z.low<=0||z.close<=0||z.baseVolume<0||z.quoteVolume<0||z.high<Math.max(z.open,z.close)||z.low>Math.min(z.open,z.close)||z.high<z.low;
    badPrefix.push(badPrefix.at(-1)!+(bad?1:0));
    gapPrefix.push(gapPrefix.at(-1)!+((i&&rows[i].timestampMs-rows[i-1].timestampMs!==H)?1:0));
  }
  stock[sym]={rows,idx,badPrefix,gapPrefix,sources,start:rows[0].timestampMs,end:rows.at(-1)!.timestampMs};
}
const runtime=resolveQuality102CausalV1Runtime({
 QUALITY102_CAUSAL_V1_MODE:"LIVE",
 QUALITY102_CAUSAL_V1_SYMBOLS:highVol.join(","),
 QUALITY102_CAUSAL_V1_MAX_GROSS:"3.0",
 QUALITY102_CAUSAL_V1_ENABLED:"false",
 QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED:"false",
 QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED:"false",
 QUALITY102_CAUSAL_V1_OPERATOR_ARMED:"false"
});
if(runtime.maximumGross!==3||runtime.enabled||runtime.liveExecutionEnabled||runtime.liveTradingEnabled||runtime.operatorArmed)throw Error("RUNTIME_PIN_CONTRACT_CHANGED");
const tallies:Record<string,number>={},reasonCounts:Record<string,number>={},events:any[]=[],accepted:any[]=[],ex:Record<string,any[]>={};
const start=Date.now();
let sourceEvaluated=0,preflightBlocked=0;
for(let now=START;now<END;now+=4*H){
 const history:Record<string,readonly C[]>={},entry:Record<string,{timestampMs:number,open:number}>={};
 const failures:any[]=[];
 for(const sym of universe){
  const d=stock[sym],ix=d.idx.get(now);
  if(ix===undefined||ix<181*24){failures.push({symbol:sym,issue:"INSUFFICIENT_OR_NO_ENTRY_BAR",earliestEligibleUTC:new Date(d.start+181*D).toISOString()});continue;}
  const left=ix-181*24;
  if(d.badPrefix[ix]-d.badPrefix[left]>0){failures.push({symbol:sym,issue:"NATIVE_QUALITY102_INVALID_CANDLE"});continue;}
  if(d.gapPrefix[ix]-d.gapPrefix[left+1]>0){failures.push({symbol:sym,issue:"NATIVE_QUALITY102_NONCONTIGUOUS_1H"});continue;}
  history[sym]=d.rows.slice(left,ix);
  entry[sym]={timestampMs:now,open:d.rows[ix].open};
 }
 if(failures.length){
  preflightBlocked++;
  for(const f of failures){const k=f.symbol+":"+f.issue;tallies[k]=(tallies[k]||0)+1;if(!ex[k])ex[k]=[];if(ex[k].length<3)ex[k].push({decisionTs:new Date(now).toISOString(),...f});}
  continue;
 }
 sourceEvaluated++;
 let sig:any;
 try{
   sig=buildQuality102CausalV4Signal({history:{candlesBySymbol:history,entryOpenBySymbol:entry},decisionTs:now,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}}, {highVolSymbols:highVol});
 }catch(e:any){
   const reason="SOURCE_THROW:"+String(e?.message||e);
   reasonCounts[reason]=(reasonCounts[reason]||0)+1;
   if(!ex[reason])ex[reason]=[];
   if(ex[reason].length<3)ex[reason].push({decisionTs:new Date(now).toISOString()});
   continue;
 }
 const reason=String(sig.reason||"UNKNOWN");
 reasonCounts[reason]=(reasonCounts[reason]||0)+1;
 if(sig.dataCutoffTs>now-H)throw Error("FUTURE_DATA_CUTOFF");
 if(sig.side!==0){
   const eff=Math.min(runtime.maximumGross,sig.requestedGross);
   if(!(eff>0&&eff<=3))throw Error("EFFECTIVE_Q102_GROSS_INVALID");
   accepted.push({decisionTs:now,decisionUtc:new Date(now).toISOString(),symbol:sig.symbol,side:sig.side===1?"LONG":"SHORT",family:sig.family,variant:sig.variant,layer:sig.layer,requestedGross:sig.requestedGross,sourceRuntimeGrossLimit:runtime.maximumGross,effectiveGross:eff,reason,dataCutoffTs:sig.dataCutoffTs,exitPolicy:sig.exitPolicy,maxHoldHours:sig.maxHoldHours,hardStop:sig.hardStop});
 }
 if(sourceEvaluated%30===0)console.log("NATIVE_PROGRESS",sourceEvaluated,"/fullYear2200","elapsed_s",Math.round((Date.now()-start)/1000),"candidateCount",accepted.length);
}
const out={
 schema:"p107-q102-21-symbol-current-sha-full-eligible-period-native-raw-entry-scan/v1",
 sourceSha:"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7",
 dateWindow:["2025-10-01T01:00:00Z","2026-10-01T00:00:00Z"],
 highVolUniverseFromActualRunningProcess:highVol,
 s34UniverseFromPinnedSource:s34,
 sourceInputUniverse:universe,
 inputSources:Object.fromEntries(Object.entries(stock).map(([k,v])=>[k,{first:new Date(v.start).toISOString(),last:new Date(v.end).toISOString(),bars:v.rows.length,files:v.sources}])),
 runtimeFlags:{enabled:runtime.enabled,mode:runtime.mode,liveExecutionEnabled:runtime.liveExecutionEnabled,liveTradingEnabled:runtime.liveTradingEnabled,operatorArmed:runtime.operatorArmed,maximumGross:runtime.maximumGross},
 sourceNativeAssumptions:{sleeveOccupancyAlwaysFlat:true,liveEnabledOverridden:false,entryPriceSource:"actual ASTER public H1 entry open",portfolioGatesApplied:false,venueOrdersSent:0},
 sourceEvaluated,preflightBlocked,gridTotal:sourceEvaluated+preflightBlocked,
 preflightRejections:tallies,reasonCounts,examples:ex,
 selectedUnconstrainedSignalCandidates:accepted,
 selectedUnconstrainedCandidateCount:accepted.length,
 fullSTABLE4AccountBT:false,signedVenueFills:0,
 status:"Q102_PINNED_SOURCE_HYBRID_FET_BINANCE_WARMUP_RAW_SIGNAL_SCAN_NOT_ORDER_OR_PORTFOLIO_PARITY",fenSourceProvenance:"FET_H1_BINANCE_UM_PRE_20260109_18UTC_ASTERV3_AFTER_MIXED_FOR_RESEARCH"
};
fs.writeFileSync(dest,JSON.stringify(out,null,2)+"\n");
console.log("Q102_NATIVE_DONE",JSON.stringify({gridTotal:out.gridTotal,sourceEvaluated,preflightBlocked,candidates:accepted.length,sourceThrows:Object.keys(reasonCounts).filter(x=>x.startsWith("SOURCE_THROW")),seconds:Math.round((Date.now()-start)/1000)}));
