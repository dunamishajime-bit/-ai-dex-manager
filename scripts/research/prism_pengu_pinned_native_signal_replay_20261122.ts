/**
 * PRISM II pinned PENGU native candidate replayer, read-only.
 *
 * Run only against fully closed Aster public H1 historical archives.
 * Source dependency lib/pengu-dual-ls-v2.ts is the exact pinned blob
 * 06476fed9985a165cf73971e790322ef3d03bd90 (PENGU runtime 1657e173...).
 * This does not evaluate owner admission, position state, order fills or exits.
 */
import fs from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import crypto from "node:crypto";
import {
  buildPenguDualLsV2EvaluationSeries,
  isPenguV8V64DynamicLongSignal,
  selectPenguRecoveryV8Entry,
  type PenguDualLsV2History,
} from "../lib/pengu-dual-ls-v2";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";
const HOUR=3600000;
const START=Date.parse("2025-10-01T00:00:00Z");
const CUT=Date.parse("2026-10-01T00:00:00Z");
const END=Date.parse("2026-11-18T00:00:00Z");
const original=process.argv[2];
const forward=process.argv[3];
const output=process.argv[4];
if(!original || !forward || !output)throw Error("USAGE: <ORIGINAL_BT_ROOT> <FORWARD_PUBLIC_ROOT> <OUTPUT_DIR>");
fs.mkdirSync(output,{recursive:true});

async function readGz(file:string):Promise<unknown[]>{
 const z=createReadStream(file).pipe(createGunzip());
 const rl=readline.createInterface({input:z,crlfDelay:Infinity});
 const rows:unknown[]=[];
 for await (const line of rl)if(line.trim())rows.push(JSON.parse(line));
 return rows;
}
function parseCandle(v:unknown):DisDexV35Candle{
 if(!Array.isArray(v)||v.length<6)throw Error("INVALID_CANDLE_ROW");
 const [openTime,o,h,l,c,vol]=[Number(v[0]),Number(v[1]),Number(v[2]),Number(v[3]),Number(v[4]),Number(v[5])];
 if(![openTime,o,h,l,c,vol].every(Number.isFinite)||openTime<=0||!(l>0&&h>=Math.max(o,c,l)&&l<=Math.min(o,c,h)&&vol>=0))throw Error("INVALID_OHLCV");
 return {openTime,closeTime:openTime+HOUR-1,open:o,high:h,low:l,close:c,volume:vol};
}
function assertCandles(rows:DisDexV35Candle[],name:string){
 for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==HOUR)
  throw Error("NON_CONTIGUOUS_H1:"+name+":"+String(i));
}
async function load(symbol:string):Promise<{base:DisDexV35Candle[],full:DisDexV35Candle[],srcHashes:Record<string,string>}>{
 const originalFile=path.join(original,"aster-public-v3-h1",symbol+"-1h-20250924-20261001.jsonl.gz");
 const newFile=path.join(forward,symbol+"-1h-20261001-20261118.jsonl.gz");
 if(!fs.existsSync(originalFile)||!fs.existsSync(newFile))throw Error("INPUT_ARCHIVE_MISSING:"+symbol);
 const prev=(await readGz(originalFile)).map(parseCandle);
 const future=(await readGz(newFile)).map(parseCandle);
 if(prev.at(-1)?.openTime!==CUT-HOUR || future[0]?.openTime!==CUT || future.at(-1)?.openTime!==END-HOUR)throw Error("PERIOD_MISMATCH:"+symbol);
 assertCandles(prev,symbol+"_ORIGINAL");
 assertCandles(future,symbol+"_NEW");
 assertCandles([...prev,...future],symbol+"_JOINED");
 return {base:prev,full:[...prev,...future],srcHashes:{
   old_sha256:crypto.createHash("sha256").update(fs.readFileSync(originalFile)).digest("hex"),
   new_sha256:crypto.createHash("sha256").update(fs.readFileSync(newFile)).digest("hex")}};
}
async function main():Promise<void>{
const [p,b]=await Promise.all([load("PENGUUSDT"),load("BTCUSDT")]);
const aggregatedMode=process.env.PRISM_H1_REAGGREGATED_M5==="1";
if (aggregatedMode){
 const fn=path.join(output,"PENGU_H1_PUBLIC_M5_REAGGREGATED_READONLY.jsonl");
 if(!fs.existsSync(fn))throw Error("REAGGREGATED_RESEARCH_SOURCE_MISSING");
 const stored=fs.readFileSync(fn,"utf8").trim().split(/\r?\n/).map(z=>JSON.parse(z));
 const derived=new Map<number,number[]>(stored.map(x=>[Number(x[0]),x.map(Number)]));
 if(derived.size!==p.full.length)throw Error("AGGREGATED_H1_COUNT_MISMATCH");
 const transform=(bars:DisDexV35Candle[])=>bars.map(bar=>{
  const a=derived.get(bar.openTime);
  if(!a)throw Error("AGGREGATED_MISSING_TIMESTAMP");
  if(Math.abs(a[4]-bar.close)>1e-12 || Math.abs(a[5]-bar.volume)>Math.max(1e-6,bar.volume*1e-7))
   throw Error("AGGREGATED_CLOSE_VOLUME_CONFLICT");
  return {...bar,open:a[1],high:a[2],low:a[3]};
 });
 p.base=transform(p.base);p.full=transform(p.full);
 p.srcHashes["research_reaggregated_sha256"]=crypto.createHash("sha256").update(fs.readFileSync(fn)).digest("hex");
}

function getCandidates(pengu:DisDexV35Candle[],btc:DisDexV35Candle[],now:number){
 const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:[]};
 const rows=buildPenguDualLsV2EvaluationSeries(history,now);
 const openPrices=new Map(pengu.map(x=>[x.openTime,x.open]));
 const out:{
   route:string,side:string,signalTs:number,entryTs:number,entryReferenceOpenPrice:number,
   pengu72h:number,btc24h:number,
   features:Record<string,number>,m05ShadowPass:boolean|null
 }[]=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i], f=row.features;
  if(!f || row.candle.openTime<START || row.candle.openTime>=END)continue;
  const isShort=row.shortSignal;
  const isLong=isPenguV8V64DynamicLongSignal(rows,i);
  const recoveryRow=row.recoveryV8
     ? {...row.recoveryV8,ordinaryLongEligible:isLong,baseLongSignal:isLong} : undefined;
  const recovery=selectPenguRecoveryV8Entry(recoveryRow,true);
  const route=isShort?"SHORT_V20":isLong?"LONG_V64":recovery?"RECOVERY_V8":null;
  if(!route)continue;
  const ts=f.referenceTs+HOUR;
  const price=openPrices.get(ts);
  if(!price)continue;
  out.push({route,side:isShort?"SHORT":"LONG",signalTs:f.referenceTs,entryTs:ts,entryReferenceOpenPrice:price,
    pengu72h:f.penguReturn72h,btc24h:f.btcReturn24h,
    features:{p72:f.penguReturn72h,p24:f.penguReturn24h,b24:f.btcReturn24h,
      rel24:f.relativeReturn24h,btcEma168Dist:f.btcEma168Distance,
      volRatio:f.volumeRatio6OverPrior36,atr24:f.atr24Ratio,
      rsi14:f.rsi14,ema72:f.ema72,ema168:f.ema168,
      close:f.close,referenceTs:f.referenceTs},
    m05ShadowPass:row.m05ShadowPass??null
  });
 }
 return out;
}
const historic=getCandidates(p.base,b.base,CUT);
const rawFile=path.join(original,"native-new-signal-20251001-20261001","native-PENGU-raw-intentions.jsonl");
const raw=fs.readFileSync(rawFile,"utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x));
const match=(x:{route:string,side:string,signalTs:number,entryTs:number},y:{route:string,side:string,signalTs:number,entryTs:number})=>
 x.route===y.route&&x.side===y.side&&x.signalTs===y.signalTs&&x.entryTs===y.entryTs;
const originalMap=new Map(raw.map(x=>[x.signalTs+"_"+x.route+"_"+x.side,x]));
const replayMap=new Map(historic.map(x=>[x.signalTs+"_"+x.route+"_"+x.side,x]));
const missingOld=raw.filter(x=>!replayMap.has(x.signalTs+"_"+x.route+"_"+x.side));
const extraOld=historic.filter(x=>!originalMap.has(x.signalTs+"_"+x.route+"_"+x.side));
const compared=raw.filter(x=>replayMap.has(x.signalTs+"_"+x.route+"_"+x.side));
const priceBad=compared.filter(x=>Math.abs(replayMap.get(x.signalTs+"_"+x.route+"_"+x.side)!.entryReferenceOpenPrice/Number(x.entryReferenceOpenPrice)-1)>1e-9);
const featuresBad=compared.filter(x=>{
 const b=replayMap.get(x.signalTs+"_"+x.route+"_"+x.side)!;
 return Math.abs(b.pengu72h-x.pengu72h)>1e-10 || Math.abs(b.btc24h-x.btc24h)>1e-10;
});
const audit={schema:"disdex-prism-pengu-native-pinned-replay/v1",source_runtime_sha:"1657e173d250ad58f53e62f7bb0a3428fb405496",
 source_signal_blob:"06476fed9985a165cf73971e790322ef3d03bd90",
 original_count:raw.length,replay_count:historic.length,matched_count:compared.length,
 missing_old:missingOld.slice(0,30),extra_old:extraOld.slice(0,30),
 price_mismatch:priceBad.slice(0,20),features_mismatch:featuresBad.slice(0,20),
 data:{PENGUUSDT:p.srcHashes,BTCUSDT:b.srcHashes},
 eligible_for_forward:missingOld.length===0&&extraOld.length===0&&priceBad.length===0&&featuresBad.length===0};
fs.writeFileSync(path.join(output,aggregatedMode?"PENGU_H1_M5AGG_SIGNAL_SENSITIVITY.json":"PENGU_PINNED_SIGNAL_PARITY.json"),JSON.stringify({...audit,price_source:aggregatedMode?"M5_AGGREGATED_RESEARCH":"NATIVE_H1_PINNED"},null,2)+"\n");
console.log("PINNED_PARITY",JSON.stringify({old:raw.length,replayed:historic.length,missing:missingOld.length,extra:extraOld.length,priceBad:priceBad.length,featuresBad:featuresBad.length,sampleMissing:missingOld.slice(0,5),sampleExtra:extraOld.slice(0,5)}));
if(!audit.eligible_for_forward && !aggregatedMode){
 console.error("FAIL_CLOSED_PINNED_PENGU_ORIGINAL_116_PARITY_MISMATCH");
 process.exitCode=2;
}else{
 const all=getCandidates(p.full,b.full,END);
 const forwardOnly=all.filter(x=>x.entryTs>=CUT&&x.entryTs<END);
 fs.writeFileSync(path.join(output,aggregatedMode?"PENGU_FORWARD_SIGNALS_M5AGG_SENSITIVITY.json":"PENGU_PINNED_FORWARD_SIGNALS.json"),JSON.stringify({
  schema:"disdex-prism-pengu-pinned-forward-raw-signals/v1",
  interval:["2026-10-01T00:00:00Z","2026-11-18T00:00:00Z"],
  original_parity_pass:audit.eligible_for_forward,price_source:aggregatedMode?"M5_AGGREGATED_RESEARCH":"NATIVE_H1_PINNED",source_runtime_sha:audit.source_runtime_sha,
  unsigned_public_research_only:true,signals:forwardOnly},null,2)+"\n");
 console.log("FORWARD_NATIVE_SIGNALS",JSON.stringify({total:forwardOnly.length,by_route:forwardOnly.reduce((a,x)=>(a[x.route]=(a[x.route]||0)+1,a),{} as Record<string,number>),first:forwardOnly.slice(0,3)}));
}

}
void main().catch((error)=>{console.error(error);process.exitCode=1;});
