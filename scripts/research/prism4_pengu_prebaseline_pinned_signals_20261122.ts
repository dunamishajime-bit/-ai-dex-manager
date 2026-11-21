/**
 * PRISM IV: source-pinned PENGU pre-baseline August–September 2025 candidate
 * regeneration without ANY tuning from those outcomes.
 *
 * Same native lib/pengu-dual-ls-v2.ts blob 06476fed... that reproduced the
 * 116 October2025–September2026 candidates. Compares BTC raw H1 with the
 * separately QA-repaired source (one independently malformed 2025-09-13 H1
 * high, independently bounded by 12 M5 OHLCV); never edits vendor raw bars.
 * No owner account, order endpoint, LIVE or Production write.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";
import {
 buildPenguDualLsV2EvaluationSeries,
 isPenguV8V64DynamicLongSignal,
 selectPenguRecoveryV8Entry,
 type PenguDualLsV2History
} from "../lib/pengu-dual-ls-v2.ts";
import type {DisDexV35Candle} from "../lib/disdex-v35-signal-engine";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PUBLIC=process.env.PRISM_PREBASELINE_PUBLIC;
const OUT=process.env.PRISM_FORWARD_DIR;
if(!PUBLIC || !OUT)throw Error("PREBASELINE_DATA_AND_OUTPUT_REQUIRED");
fs.mkdirSync(OUT,{recursive:true});
const H=3600000, AUG01=Date.parse("2025-08-01T00:00:00Z"),
      BEGIN=Date.parse("2025-08-08T00:00:00Z"),
      END=Date.parse("2025-09-24T00:00:00Z"),
      JOIN_END=Date.parse("2025-10-01T00:00:00Z");
const PIN="1657e173d250ad58f53e62f7bb0a3428fb405496";
const BLOB="06476fed9985a165cf73971e790322ef3d03bd90";
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
function getJSONL(file:string):any[]{
 if(!fs.existsSync(file))throw Error("CANDLE_ARCHIVE_MISSING:"+file);
 const t=zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim();
 return t.split("\n").filter(Boolean).map(JSON.parse);
}
function convert(row:any):DisDexV35Candle{
 if(!Array.isArray(row)||row.length<7)throw Error("BAD_SOURCE_ROW");
 const [o,h,l,c,v]=[1,2,3,4,5].map(i=>+row[i]);
 const ts=+row[0];
 if(![o,h,l,c,v,ts].every(Number.isFinite)||min(o,h,l,c)<=0 || v<0)
  throw Error("MALFORMED_OHLCV_NUMBER");
 return {openTime:ts,closeTime:ts+H-1,open:o,high:h,low:l,close:c,volume:v};
}
function min(...v:number[]):number{return Math.min(...v);}
function load(sym:string,bTCMode:"RAW_BTC"|"M5QA_BTC"):DisDexV35Candle[]{
 const original=path.join(PUBLIC,sym+"-1h-20250801-20250924"+(sym==="BTCUSDT"&&bTCMode==="M5QA_BTC"?"-RESEARCH_M5QA":"")+".jsonl.gz");
 const extension=path.join(ROOT,"aster-public-v3-h1",sym+"-1h-20250924-20261001.jsonl.gz");
 const a=getJSONL(original).map(convert);
 const e=getJSONL(extension).map(convert).filter(x=>x.openTime<JOIN_END);
 if(a.length!==1296||a[0].openTime!==AUG01||a.at(-1)?.openTime!==END-H)
  throw Error("PREBASELINE_H1_COVERAGE_FAILURE");
 if(e.length!==168||e[0].openTime!==END||e.at(-1)?.openTime!==JOIN_END-H)
  throw Error("NATIVE_WARM_EXTENSION_COVERAGE_FAILURE");
 const rows=[...a,...e];
 for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==H)
  throw Error("H1_NONCONTIGUOUS");
 return rows;
}
function scan(mode:"RAW_BTC"|"M5QA_BTC"){
 const pengu=load("PENGUUSDT",mode),btc=load("BTCUSDT",mode);
 const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:[]};
 const series=buildPenguDualLsV2EvaluationSeries(history,JOIN_END);
 const byopen=new Map(pengu.map(x=>[x.openTime,x.open]));
 const rows=[];
 for(let i=0;i<series.length;i++){
  const row=series[i],f=row.features;
  if(!f || row.candle.openTime<BEGIN || row.candle.openTime>=END)continue;
  const isS=row.shortSignal;
  const isL=isPenguV8V64DynamicLongSignal(series,i);
  const rec=row.recoveryV8?{...row.recoveryV8,ordinaryLongEligible:isL,baseLongSignal:isL}:undefined;
  const r=selectPenguRecoveryV8Entry(rec,true);
  const route=isS?"SHORT_V20":isL?"LONG_V64":r?"RECOVERY_V8":null;
  if(!route)continue;
  const entryTs=f.referenceTs+H;
  if(entryTs<BEGIN||entryTs>=END)continue;
  const p=byopen.get(entryTs);
  if(!(p&&p>0))throw Error("NO_NATIVE_ENTRY_REFERENCE_PRICE");
  rows.push({route,side:isS?"SHORT":"LONG",signalTs:f.referenceTs,
    entryTs,entryReferenceOpenPrice:p,
    pengu72h:f.penguReturn72h,btc24h:f.btcReturn24h,
    features:{p72:f.penguReturn72h,p24:f.penguReturn24h,b24:f.btcReturn24h,
      rel24:f.relativeReturn24h,btcEma168Dist:f.btcEma168Distance,
      volRatio:f.volumeRatio6OverPrior36,atr24:f.atr24Ratio,
      rsi14:f.rsi14,ema72:f.ema72,ema168:f.ema168,
      close:f.close,referenceTs:f.referenceTs},
    m05ShadowPass:row.m05ShadowPass??null});
 }
 return rows;
}
const qa=JSON.parse(fs.readFileSync(path.join(PUBLIC,"PREBASELINE_H1_M5_COHERENCE_QA.json"),"utf8"));
if(qa.status!=="H1_M5_SOURCE_QA_COMPLETE" ||
   qa.symbol.BTCUSDT.raw_H1_OHLCV_malformed!==1 ||
   qa.symbol.PENGUUSDT.raw_H1_OHLCV_malformed!==0)
 throw Error("RESEARCH_SOURCE_QUALITY_GATE_FAILED");
const raw=scan("RAW_BTC"),fixed=scan("M5QA_BTC");
const k=x=>x.entryTs+"_"+x.route+"_"+x.side;
const rawK=new Map(raw.map(x=>[k(x),x])),fixK=new Map(fixed.map(x=>[k(x),x]));
const lost=raw.filter(x=>!fixK.has(k(x))),extra=fixed.filter(x=>!rawK.has(k(x)));
const featureDelta=raw.filter(x=>fixK.has(k(x)) &&
  (x.pengu72h!==fixK.get(k(x)).pengu72h || x.btc24h!==fixK.get(k(x)).btc24h));
const out={
 schema:"disdex-prism-prebaseline-PENGU-pinned-natural-signals/v1",
 source_runtime_sha:PIN,source_signal_blob:BLOB,
 source_original_116_proof:"verified by separate PRISM II replay, same checked source blob",
 begin:BEGIN,endExclusive:END,source_qa:qa.symbol.BTCUSDT.source_ohlc_quality,
 raw_btc_candidate_count:raw.length,qa_btc_candidate_count:fixed.length,
 raw_qa_route_mismatch:lost.length+extra.length,raw_qa_feature_diff:featureDelta.length,
 raw_btc_would_remove_candidates:lost,raw_btc_would_add_candidates:extra,
 entry_signal_only:true,production_parity_certified:false,modeled_exits_not_yet_evaluated:true,
 signals:fixed
};
fs.writeFileSync(path.join(OUT,"PENGU_2025_AUG_SEP_PREBASELINE_PINNED_RAW_SIGNALS.json"),
 JSON.stringify(out,null,2)+"\n");
console.log("PREBASELINE_PINNED_CANDIDATES",JSON.stringify({raw:raw.length,qa:fixed.length,
  disagreement:out.raw_qa_route_mismatch,featureMismatch:featureDelta.length,
  byRoute:fixed.reduce((acc,x)=>(acc[x.route]=(acc[x.route]||0)+1,acc),{} as Record<string,number>),
  source_BTC_qa:qa.symbol.BTCUSDT.source_ohlc_quality
}),"NO_LIVE_TRADES");
