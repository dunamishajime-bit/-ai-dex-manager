/** PRISM VI source-native PENGU SHORT V20: pending SELL limit print-touch repricing.
An order is conceptually placed at last COMPLETED signal H1 CLOSE plus fixed
premium. M5 print crossing the limit only supplies an optimistic TOUCH, not a
signed executed fill. Ambiguous same-M5 STOP is fail-closed. All filled trades
replay source-pinned native SHORT V20 from first FULL H1 AFTER observed touch.
No live orders, true fill proof, funding, shared Gross, DD or deployment. */
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
const printTape=data(path.join(OUT,"PRISM6_PENGU_V20_SELL_LIMIT_53X9_PRINT_TOUCH_QUEUE.json"));
assert(printTape.sourcePin===PIN && printTape.naturalTradeCount===53 &&
 printTape.events.length===53*9,"PASSIVE_LIMIT_PRINT_SOURCE_CONTRACT_CHANGED");
const q=printTape.events;
const group=[...Object.keys(END)].sort();
const observed=[],unresolved=[];
for(const period of group){
 const previous=lines(getNativeExitFile(period)).filter(z=>z.route==="SHORT_V20");
 const byOriginal=new Map(previous.map(z=>[z.id,z]));
 const expect=period==="PRE_2025_AUG_SEP"?6:period==="BASE_2025_2026"?40:7;
 assert(previous.length===expect && byOriginal.size===expect,"SOURCE_EXIT_53_DISTRIBUTION_CHANGED");
 const events=q.filter(z=>z.period===period && z.historical_print_touches_limit);
 const p=loadH1("PENGUUSDT",period),b=loadH1("BTCUSDT",period);
 assert(p.length===b.length,"BTC_PENGU_SOURCE_UNALIGNED");
 const ev=buildPenguDualLsV2EvaluationSeries({pengu1h:p,btc1h:b,penguFunding:[]},END[period]);
 assert(ev.length===p.length,"PINNED_EVAL_LENGTH");
 const idx=new Map(ev.map((e,i)=>[e.candle.openTime,i]));
 const byH1=new Map(p.map(z=>[z.openTime,z]));
 for(const event of events){
  const source=byOriginal.get(event.sourceOriginalId);
  if(!source || source.sourceRuntimeSha!==PIN)throw Error("ORIGINAL_SOURCE_NATIVE_EXIT_MISSING");
  if(!event.historical_print_touches_limit || event.fillQuality==="AMBIGUOUS_SAME_BAR_STOP")
   throw Error("SOURCE_TOUCH_AMBIGUOUS_FILL_FAIL_CLOSED");
  if(event.stop_cross_before_first_completed_H1)
   throw Error("VENUE_RESIDENT_STOP_BEFORE_NEXT_H1_NOT_REPLAYED");
  if(event.sourcePin!==PIN || event.originalSourceEntryTs!==source.entryTs)
   throw Error("LIMIT_PLACEMENT_NOT_SOURCE_PINNED");
  const entry=event.firstTouchM5Ts;
  assert(entry>=event.limitPlacementTs && entry<event.limitPlacementTs+
    event.limitTTLHours*H,"LIMIT_TOUCH_NOT_WITHIN_PENDING_TTL");
  const nativeFirstFullH1=event.nativeEntryProcessFromH1Ts;
  assert(nativeFirstFullH1===Math.floor(entry/H)*H+H,"FIRST_FULL_H1_INCORRECT");
  const start=idx.get(nativeFirstFullH1);
  const anchor=idx.get(source.entryTs-H);
  if(start===undefined||anchor===undefined){unresolved.push({...event,failure:"NATIVE_ENTRY_ANCHOR_MISSING"});continue}
  const anchorFeature=ev[anchor].features;
  if(!anchorFeature || anchorFeature.referenceTs!==source.entryTs-H)
   throw Error("ORIGINAL_SIGNAL_FEATURE_MISSING_OR_INCOMPLETE");
  const gross=source.requestedGross;
  const ep=event.limitSellPrice;
  const subsequentPostTouchLow=event.post_touch_completed_M5_low_excluding_ambiguous_touch_bar;
  assert(ep>0 && subsequentPostTouchLow>0 && subsequentPostTouchLow<=ep,
    "POST_TOUCH_M5_LOW_BAD");
  const nativeV20=createPenguShortV20State({
    entryPrice:ep,requestedGross:gross,entryAtr24Ratio:anchorFeature.atr24Ratio,
    btcEma168Distance:anchorFeature.btcEma168Distance,btcReturn24h:anchorFeature.btcReturn24h
  });
  const pos0={side:-1,entryTs:entry,entryPrice:ep,quantity:1,gross,
    highWaterMark:ep,lowWaterMark:subsequentPostTouchLow,entryVersion:"SHORT_V20",
    shortV20:{...nativeV20,lowWater:subsequentPostTouchLow}};
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
   period,limitPremium:event.limitPremium,limitTTLHours:event.limitTTLHours,
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
  if(event.fillQuality!=="PUBLIC_M5_PRINT_TOUCH_NOT_SIGNED")
    throw Error("UNCONFIRMED_FILL_QUALITY");
  out.originalNaturalEntryTs=source.entryTs;
  out.limitOrderPlacementTs=event.limitPlacementTs;
  out.observedFirstM5TouchTs=event.firstTouchM5Ts;
  out.confirmedTouchNotSignedFill=true;
  out.nativeStartedFirstFullH1=nativeFirstFullH1;
  out.nativeExitModelSkipsTouchBarForCausalSafety=true;
  observed.push(out);
 }
}


const expectedTouched=q.filter(x=>x.historical_print_touches_limit);
assert(unresolved.length===0,"TOUCH_NATIVE_EXIT_MODEL_UNRESOLVED:"+JSON.stringify(unresolved.slice(0,4)));
assert(observed.length===expectedTouched.length,"TOUCHED_NATIVE_SOURCE_COVERAGE_INCOMPLETE");
const lookup=new Map(observed.map(x=>[
 x.period+":"+x.sourceOriginalId+":"+x.limitPremium+":"+x.limitTTLHours,x]));
assert(lookup.size===observed.length,"DUPLICATE_LIMIT_TRADE");
const groupSummary=[];
const allEvents=q.map(x=>{
 const id=x.period+":"+x.sourceOriginalId+":"+x.limitPremium+":"+x.limitTTLHours;
 const modeled=lookup.get(id);
 if(Boolean(modeled)!==Boolean(x.historical_print_touches_limit))
  throw Error("TOUCH_AND_REPRICED_COVERAGE_MISMATCH");
 return {
  period:x.period,sourceOriginalId:x.sourceOriginalId,
  limitPremium:x.limitPremium,limitTTLHours:x.limitTTLHours,
  signalAt:x.limitPlacementTs,limit:x.limitSellPrice,
  observedTouch:x.historical_print_touches_limit,
  firstPrintTouchTs:x.firstTouchM5Ts??null,
  fillQuality:x.fillQuality,
  nativeRepriced:modeled??null};
});
for(const period of [...Object.keys(END),"ALL_SEEN"]){
 for(const premium of printTape.premiums){
  for(const ttl of printTape.ttlHours){
   const group=allEvents.filter(x=>(period==="ALL_SEEN"||x.period===period)&&
     x.limitPremium===premium&&x.limitTTLHours===ttl);
   if(!group.length)continue;
   for(const fee of [10,30]){
    const net=group.map(x=>x.nativeRepriced
      ?fee===10?x.nativeRepriced.cost10NetReturn:x.nativeRepriced.cost30NetReturn:0);
    const fills=net.filter((_,i)=>group[i].nativeRepriced!==null);
    const wins=net.filter(z=>z>0).length;
    const gain=net.reduce((a,z)=>a+Math.max(0,z),0);
    const loss=net.reduce((a,z)=>a+Math.max(0,-z),0);
    groupSummary.push({period,premium,ttlHours:ttl,costBps:fee,
      originalSignals:group.length,printTouched:fills.length,
      noPrintTouch:group.length-fills.length,assumedFillRate:fills.length/group.length,
      winsFilled:wins,
      winRateFilled:fills.length?wins/fills.length:null,
      winPctOfAllNaturalSignals:100*wins/group.length,
      meanNetPctPerOriginalSignal:100*net.reduce((a,z)=>a+z,0)/group.length,
      meanNetPctPerModeledFill:fills.length?
       100*fills.reduce((a,z)=>a+z,0)/fills.length:null,
      pricePF:loss>0?gain/loss:null,
      stopSameM5Unresolved:group.filter(x=>x.fillQuality==="AMBIGUOUS_SAME_BAR_STOP").length,
      status:"TOUCH_PRICE_PROXY_NOT_SIGNED_VENUE_FILL"});
   }
  }
 }
}
const file={schema:"prism6-v20-source-native-sell-limit-positive-M5-print-proxy/v1",
 sourcePin:PIN,originalSourceShort53:53,
 limitPrintSourceRecords:q.length,assumedFillNativeReprices:observed.length,
 unresolved,groupSummary,events:allEvents,
 limitations:["A printed high touches a SELL limit but does NOT prove this user's hypothetical order filled.",
 "Queue priority, funding, maker fees, orderbook and actual venue quotes are unknown.",
 "The fill-bar itself has unknown order of high and low; no same-M5 early resident stop success credited.",
 "Native exit begins only from first full H1 AFTER a hypothetical M5 touch; later resident stops are modeled.",
 "No shared-gross portfolio rerun or cross-Runner opportunity accounting.",
 "Research period observations have been seen already; not a blind OOS or Production ready."]};
fs.writeFileSync(path.join(OUT,"PRISM6_PENGU_V20_SELL_LIMIT_53X9_NATIVE_PRICE_REPLAY.json"),
 JSON.stringify(file,null,2)+"\n");
console.log(JSON.stringify({status:"PRISM6_LIMIT_PRICE_REPLAY",
 sourceShort:53,sourceVariants:q.length,repriced:observed.length,
 unresolved:unresolved.length,
 summary30:groupSummary.filter(x=>x.costBps===30)},null,2));