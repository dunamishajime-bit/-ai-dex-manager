/** PRISM VI — fixed-latency PENGU SHORT V20 redesign, 0/1/2/3/6h delay.
Every natural original SHORT signal is retained; price/stop/hold are recomputed
from the source-pinned native PositionBar engine after each delayed fill.
At 0h, require every one of 53 original source trade exits match exactly.
Delay durations are prespecified; no outcome-based threshold fit.
Research only. Not a venue fill, account PnL, Gross or production deployment. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {buildPenguDualLsV2EvaluationSeries,evaluatePenguDualLsV2PositionBar}
 from "../lib/pengu-dual-ls-v2.ts";
import {createPenguShortV20State} from "../lib/pengu-short-v20.ts";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const WORK=process.env.PRISM_WORK;
if(!WORK)throw Error("PRISM5_WORK_REQUIRED");
const OUT=path.join(WORK,"phase2_results");
const PRE=path.join(WORK,"prebaseline_public_20250801_20250924");
const POST=path.join(WORK,"forward_public_20261001_20261118");
const H=3600000;
const PIN="1657e173d250ad58f53e62f7bb0a3428fb405496";
const END={
 PRE_2025_AUG_SEP:Date.parse("2025-10-01T00:00:00Z"),
 BASE_2025_2026:Date.parse("2026-10-01T00:00:00Z"),
 POST_2026_OCT_NOV:Date.parse("2026-11-18T00:00:00Z")
};
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const assert=(v,m)=>{if(!v)throw Error(m);};
function data(file){
 if(!fs.existsSync(file))throw Error("INPUT_SOURCE_NOT_FOUND:"+file);
 return JSON.parse(fs.readFileSync(file,"utf8"));
}
function lines(file){
 if(!fs.existsSync(file))throw Error("SOURCE_NATIVE_EXIT_NOT_FOUND:"+file);
 return fs.readFileSync(file,"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
function loadH1(sym,period){
 const baseline=path.join(ROOT,"aster-public-v3-h1",sym+"-1h-20250924-20261001.jsonl.gz");
 const preceding=path.join(PRE,sym+"-1h-20250801-20250924"+
   (sym==="BTCUSDT"?"-RESEARCH_M5QA":"")+".jsonl.gz");
 const forward=path.join(POST,sym+"-1h-20261001-20261118.jsonl.gz");
 const sources=period==="PRE_2025_AUG_SEP"?[preceding,baseline]:
   period==="BASE_2025_2026"?[baseline]:[baseline,forward];
 const end=END[period],src=[];
 for(const file of sources){
  if(!fs.existsSync(file))throw Error("MISSING_H1_SOURCE:"+file);
  const raw=zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim();
  for(const line of raw.split(/\r?\n/).filter(Boolean)){
   const a=JSON.parse(line);const t=+a[0];
   if(t>=end)continue;
   src.push({openTime:t,closeTime:+a[6],open:+a[1],high:+a[2],
     low:+a[3],close:+a[4],volume:+a[5]});
  }
 }
 for(let i=1;i<src.length;i++){
  if(src[i].openTime-src[i-1].openTime!==H)
    throw Error("PINNED_H1_GAP_OR_DUP:"+sym+":"+period+":"+i);
 }
 assert(src.length>=168,"NOT_ENOUGH_H1_WARMUP");
 return src;
}
function getNativeExitFile(period){
 return period==="PRE_2025_AUG_SEP"
  ?path.join(OUT,"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl")
  :period==="BASE_2025_2026"
  ?path.join(ROOT,"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl")
  :path.join(OUT,"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl");
}
const DELAY_HOURS=[0,1,2,3,6];
const group=[...Object.keys(END)].sort();
const observed=[],unresolved=[];
for(const period of group){
 const previous=lines(getNativeExitFile(period)).filter(z=>z.route==="SHORT_V20");
 const byOriginal=new Map(previous.map(z=>[z.id,z]));
 assert(byOriginal.size===previous.length,"DUPLICATED_SOURCE_NATIVE_ID");
 const expectedCount=period==="PRE_2025_AUG_SEP"?6:period==="BASE_2025_2026"?40:7;
 assert(previous.length===expectedCount,"SOURCE_SHORT_V20_COUNT_CHANGED");
 const events=previous.flatMap(z=>DELAY_HOURS.map(delayHours=>({
    source_original_id:z.id,
    entryTs:z.entryTs+delayHours*H,
    delayHours,
    sourceNativeRuntimeSha:z.sourceRuntimeSha
 })));
 const p=loadH1("PENGUUSDT",period),b=loadH1("BTCUSDT",period);
 assert(p.length===b.length,"BTC_PENGU_SOURCE_UNALIGNED");
 const ev=buildPenguDualLsV2EvaluationSeries(
   {pengu1h:p,btc1h:b,penguFunding:[]},END[period]);
 assert(ev.length===p.length,"PINNED_EVAL_LENGTH");
 const idx=new Map(ev.map((e,i)=>[e.candle.openTime,i]));
 const byH1=new Map(p.map(z=>[z.openTime,z]));
 for(const event of events){
  const source=byOriginal.get(event.source_original_id);
  if(!source || source.sourceRuntimeSha!==PIN)throw Error("SOURCE_NATIVE_PIN_MISSING");
  if(+event.entryTs!==+source.entryTs+event.delayHours*H)throw Error("SOURCE_DELAY_TIMESTAMP_WRONG");
  const entry=+event.entryTs;
  const start=idx.get(entry);
  const anchor=idx.get(entry-H);
  if(start===undefined||anchor===undefined){unresolved.push({...event,failure:"H1_ANCHOR_NOT_IN_SOURCE"});continue;}
  const entryBar=byH1.get(entry);
  const f=ev[anchor].features;
  if(!entryBar || !f || f.referenceTs!==entry-H){
   unresolved.push({...event,failure:"MISSING_PREENTRY_SOURCE_FEATURES"});continue;
  }
  const gross=source.requestedGross;
  const ep=entryBar.open;
  const pos0={
   side:-1,entryTs:entry,entryPrice:ep,quantity:1,gross,
   highWaterMark:ep,lowWaterMark:ep,entryVersion:"SHORT_V20",
   shortV20:createPenguShortV20State({
    entryPrice:ep,requestedGross:gross,entryAtr24Ratio:f.atr24Ratio,
    btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h
   })
  };
  let pos=pos0;let final=null;
  for(let j=start;j<ev.length;j++){
   const e=ev[j],feat=e.features;
   if(!feat)continue;
   if(feat.referenceTs<entry)continue;
   if(feat.referenceTs+H>END[period])break;
   const update=evaluatePenguDualLsV2PositionBar(pos,feat);
   pos=update.updatedPosition;
   if(!update.exit)continue;
   const reason=update.exit.reason;
   let px,kind;
   if(update.exit.stopPrice!==undefined && (
      reason.includes("HARD_STOP")||reason.includes("TRAILING_STOP"))){
     px=+update.exit.stopPrice;kind="RESIDENT_STOP_PRICE_MODEL";
   }else{
     const next=byH1.get(feat.referenceTs+H);
     if(!next){final=null;break}
     px=next.open;kind="CAUSAL_NEXT_H1_OPEN";
   }
   if(!(px>0))throw Error("NON_POSITIVE_NATIVE_EXIT_PRICE");
   final={exitTs:feat.referenceTs+H,decisionReferenceTs:feat.referenceTs,
    exitPrice:px,exitReason:reason,exitPriceKind:kind};
   break;
  }
  if(!final){unresolved.push({...event,failure:"DEFERRED_NATIVE_EXIT_NOT_FOUND_BEFORE_HORIZON"});continue}
  const out={schema:"prism5-pin-short-v20-native-replay/v1",
   sourceOriginalId:event.source_original_id,entryVersion:"SHORT_V20",
   period,delayHours:event.delayHours,
   sourceNativeRuntimeSha:PIN,sourceOriginalEntryTs:source.entryTs,
   sourceOriginalExitTs:source.exitTs,
   entryTs:entry,entryPrice:ep,requestedGross:gross,
   entryFeatureReferenceTs:f.referenceTs,
   ...final,
   rawReturn:1-final.exitPrice/ep,
   cost10NetReturn:(1-final.exitPrice/ep)-.001,
   cost30NetReturn:(1-final.exitPrice/ep)-.003,
   nativeSourceEventPriceModel:true,venueSignedFill:false,
   sourceOriginalNet30:source.rawReturn-.003};
  if(event.delayHours===0){
    const parity={
      exitTime:out.exitTs===source.exitTs,
      exitReason:out.exitReason===source.exitReason,
      exitPrice:Math.abs(out.exitPrice-source.exitPrice)<1e-10,
      entryPrice:Math.abs(out.entryPrice-source.entryPrice)<1e-10};
    if(Object.values(parity).some(x=>!x)){
      throw Error("PRISM5_DIRECT_NATIVE_EXIT_PARITY_FAIL:"+
          JSON.stringify({id:event.source_original_id,period,parity,expected:source,got:out}).slice(0,2000));
    }
  }
  observed.push(out);
 }
}

assert(observed.filter(x=>x.delayHours===0).length===53,"ALL53_ORIGINAL_PINNED_EXIT_PARITY_REQUIRED");
assert(unresolved.length===0,"TIMING_VARIANT_UNRESOLVED_FAIL_CLOSED:"+JSON.stringify(unresolved.slice(0,6)));
assert(observed.length===53*DELAY_HOURS.length,"MISSING_DELAY_REPRICE");
const grouped=[];
for(const period of [...Object.keys(END),"ALL_SEEN"]){
 for(const delay of DELAY_HOURS){
  const base=observed.filter(x=>(period==="ALL_SEEN"||x.period===period)&&x.delayHours===delay);
  if(!base.length)continue;
  const native=observed.filter(x=>(period==="ALL_SEEN"||x.period===period)&&x.delayHours===0);
  const same=new Map(native.map(x=>[x.period+":"+x.sourceOriginalId,x]));
  for(const fee of [10,30]){
   const val=base.map(x=>fee===10?x.cost10NetReturn:x.cost30NetReturn);
   const win=val.filter(x=>x>0).length;
   const gain=val.reduce((z,x)=>z+Math.max(0,x),0);
   const loss=val.reduce((z,x)=>z+Math.max(0,-x),0);
   const flipWinToLoss=base.filter(x=>{
     const orig=same.get(x.period+":"+x.sourceOriginalId);
     return orig&&(fee===10?orig.cost10NetReturn>0:orig.cost30NetReturn>0)&&
       (fee===10?x.cost10NetReturn<=0:x.cost30NetReturn<=0);
   }).length;
   const flipLossToWin=base.filter(x=>{
     const orig=same.get(x.period+":"+x.sourceOriginalId);
     return orig&&(fee===10?orig.cost10NetReturn<=0:orig.cost30NetReturn<=0)&&
       (fee===10?x.cost10NetReturn>0:x.cost30NetReturn>0);
   }).length;
   grouped.push({period,delayHours:delay,costBps:fee,
    n:base.length,wins:win,winPct:100*win/base.length,
    meanNetPct:100*val.reduce((a,b)=>a+b,0)/base.length,
    pricePF:loss>0?gain/loss:null,
    flipNativeWinToLoss:flipWinToLoss,flipNativeLossToWin:flipLossToWin,
    priceFillModel:"NEXT_N_H1_OPEN_WITH_NATIVE_REEVAL",
    scope:"ISOLATED_NATIVE_TRADE_NOT_PORTFOLIO_GROSS"});
  }
 }
}
const evidence={schema:"disdex-prism6-V20-multihorizon-fixed-entry-delay/v1",
 sourcePin:PIN,sourceShortNaturalEvents:53,
 originalNativeExactExitParity:53,
 variantsDelayHours:DELAY_HOURS,
 repricedCount:observed.length,unresolved,
 grouped,events:observed,
 limitations:["Historical counterfactual: no signed venue fills or quote book",
 "Order pending after original natural signal, not an entry condition fitted to outcomes",
 "Delay 6h no claim of actual original signal validity, requires as-of expiration/revalidation",
 "Stops are source resident stop price model; no realized gaps or funding",
 "All source periods have been previously investigated, not untouched OOS",
 "Gross/portfolio concurrency/slippage DD not replayed"]};
fs.writeFileSync(path.join(OUT,"PRISM6_PENGU_V20_ALL53_DELAY_NATIVE_REPLAY.json"),JSON.stringify(evidence,null,2)+"\n");
console.log(JSON.stringify({status:"PRISM6_DELAY_NATIVE_53_PARITY",originalParity:53,
 repriced:observed.length,unresolved:unresolved.length,
 grouped30:grouped.filter(z=>z.costBps===30)},null,2));