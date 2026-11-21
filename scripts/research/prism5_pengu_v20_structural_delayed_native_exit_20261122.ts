/**
 * PRISM5 PENGU SHORT V20: replay unchanged native exits and new two-hour
 * confirmation entries through the SAME pinned pure-function exit engine.
 *
 * Original 10 direct entries must pass exact 10/10 parity against previously
 * validated pinned source native tapes; otherwise FAIL CLOSED.
 * New 9 delayed entries keep source ATR/state from their NEW completed H1
 * and are independently exited by evaluatePenguDualLsV2PositionBar.
 *
 * A delayed signal has different opening price, gross occupancy and hold
 * time: it must NOT inherit old 53 exit price, win/loss label or stop.
 *
 * No live orders, no signed fills, no account risk, no funding or shared
 * position-occupancy simulation. No production deployment.
 */
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
const direct=data(path.join(OUT,"PRISM5_PENGU_V20_STRUCTURE_DIRECT_NATIVE_QUEUE.json")).events;
const deferred=data(path.join(OUT,"PRISM5_PENGU_V20_STRUCTURE_DEFERRED_NATIVE_QUEUE.json")).events;
assert(direct.length===10 && deferred.length===9,"PRISM5_QUEUE_COUNTS_CHANGED");
const group=[...Object.keys(END)].sort();
const observed=[],unresolved=[];
for(const period of group){
 const events=[
  ...direct.filter(x=>x.period===period).map(x=>({...x,kind:"DIRECT"})),
  ...deferred.filter(x=>x.period===period).map(x=>({...x,kind:"DEFERRED"}))];
 if(events.length===0)continue;
 const p=loadH1("PENGUUSDT",period),b=loadH1("BTCUSDT",period);
 assert(p.length===b.length,"BTC_PENGU_SOURCE_UNALIGNED");
 const ev=buildPenguDualLsV2EvaluationSeries(
  {pengu1h:p,btc1h:b,penguFunding:[]},END[period]);
 assert(ev.length===p.length,"PINNED_EVAL_LENGTH");
 const idx=new Map(ev.map((e,i)=>[e.candle.openTime,i]));
 const byH1=new Map(p.map(z=>[z.openTime,z]));
 const previous=lines(getNativeExitFile(period)).filter(z=>z.route==="SHORT_V20");
 const byOriginal=new Map(previous.map(z=>[z.id,z]));
 assert(byOriginal.size===previous.length,"DUPLICATED_SOURCE_NATIVE_ID");
 for(const event of events){
  const source=byOriginal.get(event.source_original_id);
  if(!source){unresolved.push({...event,failure:"ORIGINAL_SOURCE_NATIVE_EXIT_MISSING"});continue;}
  if(source.sourceRuntimeSha!==PIN)throw Error("NATIVE_EXIT_PIN_SHA_MISMATCH");
  if(event.kind==="DIRECT" && +event.entryTs!==+source.entryTs)
   throw Error("DIRECT_EVENT_ENTRY_MOVED_FROM_NATIVE");
  if(event.kind==="DEFERRED" && +event.entryTs<=+source.entryTs)
   throw Error("DEFERRED_ENTRY_NOT_LATER");
  const entry=+event.entryTs;
  const start=idx.get(entry);
  const anchor=idx.get(entry-H);
  if(start===undefined||anchor===undefined){unresolved.push({...event,failure:"H1_ANCHOR_NOT_IN_SOURCE"});continue;}
  const entryBar=byH1.get(entry);
  const f=ev[anchor].features;
  if(!entryBar || !f || f.referenceTs!==entry-H){
   unresolved.push({...event,failure:"MISSING_PREENTRY_SOURCE_FEATURES"});continue;
  }
  if(event.kind==="DEFERRED" && Math.abs(entryBar.open-event.entryReferenceOpenPrice)>1e-12)
   throw Error("DEFERRED_OPEN_CHANGED_SINCE_RESEARCH_CLASSIFICATION");
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
   period,kind:event.kind,
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
  if(event.kind==="DIRECT"){
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
assert(observed.filter(x=>x.kind==="DIRECT").length===10,
 "PRISM5_DIRECT_PARITY_NONEXHAUSTIVE");
const q=observed.filter(x=>x.kind==="DEFERRED");
const missing=unresolved.filter(x=>x.kind==="DEFERRED");
const grouped=[];
for(const period of [...Object.keys(END),"ALL_KNOWN_PERIODS"]){
 const a=observed.filter(x=>period==="ALL_KNOWN_PERIODS"||x.period===period);
 if(!a.length)continue;
 for(const k of ["DIRECT","DEFERRED","ALL_REPRICE_BUT_NOT_PORTFOLIO"]){
  const b=a.filter(x=>k==="ALL_REPRICE_BUT_NOT_PORTFOLIO"||x.kind===k);
  if(!b.length)continue;
  for(const fee of [10,30]){
   const results=b.map(x=>fee===10?x.cost10NetReturn:x.cost30NetReturn);
   const win=results.filter(x=>x>0).length;
   const good=results.reduce((a,x)=>a+Math.max(x,0),0);
   const bad=results.reduce((a,x)=>a+Math.max(-x,0),0);
   grouped.push({period,kind:k,costBps:fee,qty:b.length,
     winnerQty:win,winRate:win/b.length,
     meanReturn:results.reduce((a,x)=>a+x,0)/b.length,
     pricePF:bad>0?good/bad:null});
  }
 }
}
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,"PRISM5_PENGU_V20_STRUCTURE_NATIVE_REPRICED_19.json"),
 JSON.stringify({schema:"prism5-v20-pure-native-direct-and-deferred/v1",
  sourcePin:PIN,sourceDirectCount:direct.length,sourceDeferredCount:deferred.length,
  directNativeExitParity:10,
  nativeRepricedCount:observed.length,
  deferredNativeCount:q.length,unresolved,cohorts:grouped,events:observed,
  limitations:[
   "Native pinned pure function at new entry, not signed venue execution.",
   "Deferred entries alter subsequent occupancy and opportunity. This is only isolated-trade replay.",
   "Resident STOP at configured threshold price, not exchange book fills.",
   "Real 3h/8h timed STOP implementation mismatch remains subject to source pin.",
   "All periods have already been seen by the researcher; no blind OOS claims."
  ]},null,2)+"\n");
console.log(JSON.stringify({status:"PRISM5_REPRICING",observed:observed.length,
 directNativeParity:10,deferredRepriced:q.length,deferredUnresolved:missing.length,
 cohort30:grouped.filter(x=>x.costBps===30)},null,2));
