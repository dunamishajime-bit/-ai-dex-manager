/**
 * PRISM III research-only IDLE 5m trade-volume-aware native-protection replay.
 *
 * 1. Verify original 849-candidate M5 replay is byte-economically identical.
 * 2. Reject a raw signal if NO positive-volume M5 trades in entry H1.
 * 3. Enter ONLY on first positive-volume M5 bar within entry H1.
 * 4. Reanchor 10% SHORT stop, 25% SHORT TP, DOT/RENDER native trail to
 *    that first TRADED entry price, keeping source native route and side.
 * 5. Max hold from actual entry and exit only on a traded M5 OPEN.
 *
 * No owner, account, live runner, exchange signed endpoints or orders touched.
 * Venue order book and future partial matches are NOT reproduced.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";
import {pathToFileURL} from "node:url";
const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const IN=ROOT+"/DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110/idle-route-candidates-no-cooldown.jsonl";
const REF=ROOT+"/DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110/idle-production-candidates-with-m5-exits.jsonl";
const WORK=process.env.PRISM_WORK;
if (!WORK) throw Error("PRISM_WORK_REQUIRED");
const OUTPUT=WORK+"/phase2_results";
fs.mkdirSync(OUTPUT,{recursive:true});
const END=Date.parse("2026-10-01T00:00:00Z"),MS=300000,H=3600000;
const {applyIdleProfitTrailBar}=await import(pathToFileURL(ROOT+"/pinned-source/IDLE/lib/disdex-exit-overlay-contract.ts").href);
const rows=fs.readFileSync(IN,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const old=fs.readFileSync(REF,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
if(rows.length!==849||old.length!==849)throw Error("REPLAY_EXPECTED_849_CANDIDATES");
const symset=new Set(rows.map(x=>x.symbol));const syms=[...symset];
const cache={},sourceHashes={},hourly={};
const shaBytes=b=>crypto.createHash("sha256").update(b).digest("hex");
const sha=p=>shaBytes(fs.readFileSync(p));
function load(sym){
 const parts=[
  ROOT+"/aster-public-v3-5m-prefix/"+sym+"-5m-20250924-20260803.jsonl.gz",
  ROOT+"/aster-public-v3-5m-suffix/"+sym+"-5m-20260803-20261001.jsonl.gz",
  ROOT+"/FORWARD_HOLDOUT_20261001_20261108/aster-m5/"+sym+"-5m-20261001-20261108T20.jsonl.gz"
 ];
 let m=new Map();sourceHashes[sym]=[];
 for(const p of parts){
  if(!fs.existsSync(p))throw Error("REQUIRED_M5_MISSING:"+p);
  sourceHashes[sym].push({file:path.basename(p),sha256:sha(p)});
  for(const s of zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n")){
   const z=JSON.parse(s),t=+z[0],b={timestampMs:t,open:+z[1],high:+z[2],
     low:+z[3],close:+z[4],volume:+z[5]};
   if(![t,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)
      || b.low<=0 || b.volume<0 || b.high<Math.max(b.open,b.low,b.close)
      || b.low>Math.min(b.open,b.close))throw Error("BAD_PUBLIC_OHLCV:"+sym+":"+t);
   if(m.has(t)){
    const old=m.get(t);
    if(["open","high","low","close","volume"].some(k=>Math.abs(old[k]-b[k])>1e-10))
     throw Error("PUBLIC_SOURCE_CONFLICTING_DUPLICATE:"+sym+":"+t);
   }
   m.set(t,b);
  }
 }
 const a=[...m.values()].sort((x,y)=>x.timestampMs-y.timestampMs);
 for(let i=1;i<a.length;i++){
  if(a[i].timestampMs-a[i-1].timestampMs!==MS)throw Error("M5_SOURCE_GAP:"+sym+":"+i);
 }
 const h1path=ROOT+"/aster-public-v3-h1/"+sym+"-1h-20250924-20261001.jsonl.gz";
 if(!fs.existsSync(h1path))throw Error("REQUIRED_H1_MISSING:"+sym);
 let hm=new Map();
 for(const s of zlib.gunzipSync(fs.readFileSync(h1path)).toString("utf8").trim().split("\n")){
  const z=JSON.parse(s);hm.set(+z[0],+z[1]);
 }
 hourly[sym]=hm;
 return {first:a[0].timestampMs,rows:a};
}
for(const sym of syms)cache[sym]=load(sym);
const ev=[];
const result=[];
const audit=[];
function baselineModel(c){
 const m=cache[c.symbol],idx=(c.entryTs-m.first)/MS;
 if(!Number.isInteger(idx)||idx<0)throw Error("BASE_ENTRY_M5_REQUIRED");
 const price=m.rows[idx].open,maxExit=c.entryTs+c.holdHours*H,tp=price*.75;
 let stop=price*1.10,trailState;
 for(let i=idx;i<m.rows.length;i++){
  const b=m.rows[i];
  if(b.timestampMs>=maxExit)
   return {entryPrice:price,exitTs:b.timestampMs,exitPrice:b.open,exitReason:"MAX_HOLD"};
  if(b.high>=stop)
   return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:Math.max(b.open,stop),exitReason:"IDLE_HARD_STOP"};
  if(b.low<=tp)
   return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:Math.min(b.open,tp),exitReason:"IDLE_TAKE_PROFIT"};
  if(c.symbol==="DOTUSDT"||c.symbol==="RENDERUSDT"){
   const t=applyIdleProfitTrailBar({side:"SHORT",entryPrice:price,state:trailState,bar:b});
   if(t.stopHit)
    return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:t.triggerPrice,exitReason:"IDLE_NATIVE_TRAIL"};
   trailState=t.state;
   if(t.state.stopPrice!==undefined)stop=Math.min(stop,t.state.stopPrice);
  }
 }
 throw Error("BASE_EXIT_EXHAUSTED");
}
function withVolume(c){
 const m=cache[c.symbol],start=(c.entryTs-m.first)/MS;
 if(!Number.isInteger(start)||start<0)throw Error("CANDIDATE_ENTRY_OFF_GRID");
 if(c.side!=="SHORT")throw Error("NON_SHORT_PINNED_IDLE_NOT_SUPPORTED");
 let entry=-1;
 for(let i=start;i<m.rows.length && m.rows[i].timestampMs<c.entryTs+H;i++){
  if(m.rows[i].volume>0){entry=i;break}
 }
 const firstVolume=entry>=0?m.rows[entry]:null;
 const h1open=hourly[c.symbol].get(c.entryTs);
 if(!(h1open>0))throw Error("NATIVE_H1_SIGNAL_PRICE_MISSING:"+c.symbol+":"+c.entryTs);
 if(!firstVolume){
  return {...c,status:"NO_TRADE_ENTRY_H1",
   originalNativeH1OpenPrice:h1open,
   firstTraded5mTs:null,entryPrice:null,exitPrice:null,exitTs:null,exitReason:null};
 }
 if(Math.abs(firstVolume.open/h1open-1)>1e-9)
  throw Error("NATIVE_H1_OPEN_NOT_FIRST_TRADED_M5_OPEN:"+c.symbol+":"+c.entryTs);
 const price=firstVolume.open;
 const maxExit=firstVolume.timestampMs+c.holdHours*H,tp=price*.75;
 let stop=price*1.10,trailState,exit=null;
 for(let i=entry;i<m.rows.length;i++){
  const b=m.rows[i];
  if(b.volume===0)continue; // stale prior-close candle is NOT a trade
  if(b.timestampMs>=maxExit){
   exit={exitTs:b.timestampMs,exitPrice:b.open,exitReason:"MAX_HOLD",exitTradeTs:b.timestampMs};break;
  }
  if(b.high>=stop){
   exit={exitTs:b.timestampMs+MS,exitPrice:Math.max(b.open,stop),
     exitReason:"IDLE_HARD_STOP",exitTradeTs:b.timestampMs};break;
  }
  if(b.low<=tp){
   exit={exitTs:b.timestampMs+MS,exitPrice:Math.min(b.open,tp),
     exitReason:"IDLE_TAKE_PROFIT",exitTradeTs:b.timestampMs};break;
  }
  if(c.symbol==="DOTUSDT"||c.symbol==="RENDERUSDT"){
   const tr=applyIdleProfitTrailBar({side:"SHORT",entryPrice:price,state:trailState,bar:b});
   if(tr.stopHit){
    exit={exitTs:b.timestampMs+MS,exitPrice:tr.triggerPrice,
      exitReason:"IDLE_NATIVE_TRAIL",exitTradeTs:b.timestampMs};break;
   }
   trailState=tr.state;
   if(tr.state.stopPrice!==undefined)stop=Math.min(stop,tr.state.stopPrice);
  }
 }
 if(!exit)throw Error("NO_MODEL_EXIT_BY_NEXT_PUBLIC_M5:"+c.symbol+":"+c.entryTs);
 return {...c,
   status:"VOLUME_TRADE_EXECUTION_PRICE_MODEL",
   originalNativeH1OpenPrice:h1open,
   originalSignalEntryTs:c.entryTs,
   entryTs:firstVolume.timestampMs,
   sourceEntryTs:c.entryTs,
   firstTraded5mTs:firstVolume.timestampMs,
   firstTradeDelayMinutes:(firstVolume.timestampMs-c.entryTs)/60000,
   entryPrice:price,exitTs:exit.exitTs,exitPrice:exit.exitPrice,
   exitReason:exit.exitReason,exitTradeTs:exit.exitTradeTs,
   grossReturn:-(exit.exitPrice/price-1),afterPeriod:exit.exitTs>END,
   semantics:"Pinned IDLE M5 protection functions on positive-volume M5 only; model does not certify exchange execution"
 };
}
for(let i=0;i<rows.length;i++){
 const c=rows[i];if(c.side!=="SHORT")throw Error("MIXED_NATIVE_IDLE_SIDE");
 const base=baselineModel(c),oldrow=old[i];
 for(const key of ["entryPrice","exitTs","exitPrice","exitReason"]){
  if(typeof base[key]==="number"){
   if(Math.abs(base[key]-oldrow[key])>1e-10)
    throw Error("BASE_849_NATIVE_LIFECYCLE_PARITY_FAILED:"+i+":"+key+":"+base[key]+":"+oldrow[key]);
  }else if(base[key]!==oldrow[key]){
   throw Error("BASE_849_REASON_CHANGED:"+i+":"+key);
  }
 const r=withVolume(c);r.id="IDLEP_"+String(i+1).padStart(5,"0");
 audit.push({id:r.id,symbol:r.symbol,route:r.route,
  originalSignalEntryTs:c.entryTs,firstTradedEntryTs:r.firstTraded5mTs,
  firstTradeDelayMinutes:r.firstTradeDelayMinutes??null,
  originalModelEntryPrice:oldrow.entryPrice,H1SourceEntryPrice:r.originalNativeH1OpenPrice,
  volumeAwareEntryPrice:r.entryPrice,
  originalExitTs:oldrow.exitTs,newExitTs:r.exitTs,
  originalExitPrice:oldrow.exitPrice,newExitPrice:r.exitPrice,
  originalExitReason:oldrow.exitReason,newExitReason:r.exitReason,
  originalGrossReturn:oldrow.grossReturn,
  newGrossReturn:r.grossReturn??null,status:r.status});
 result.push(r);
}
const csvrows=audit.map(z=>Object.values(z).map(x=>x==null?"":String(x).replaceAll('"','""')).map(x=>'"'+x+'"').join(","));
const keys=Object.keys(audit[0]);
fs.writeFileSync(OUTPUT+"/PRISM_IDLE_849_VOLUME_AWARE_ENTRY_EXIT_AUDIT.csv",
 keys.join(",")+"\n"+csvrows.join("\n")+"\n");
fs.writeFileSync(OUTPUT+"/PRISM_IDLE_VOLUME_AWARE_849_LIFECYCLE.jsonl",
 result.map(x=>JSON.stringify(x)).join("\n")+"\n");
const verdict={
 schema:"disdex-prism3-idle-volume-aware-native-exit/v1",
 pin_sha:"7688ed7c93a1918d8b44837339b7da5584a868f5",
 historical_source_original_count:old.length,source_parity_full:old.length,
 source_hashes:{originalCandidateSha256:sha(IN),originalModeledSha256:sha(REF),M5:sourceHashes},
 all_sides_short:rows.every(x=>x.side==="SHORT"),
 volume_replayed:result.filter(x=>x.status==="VOLUME_TRADE_EXECUTION_PRICE_MODEL").length,
 no_trade_H1:result.filter(x=>x.status==="NO_TRADE_ENTRY_H1").length,
 original_M5_model_price_inconsistent_gt5bps:audit.filter(x=>x.volumeAwareEntryPrice!=null&&
  Math.abs(x.volumeAwareEntryPrice/x.originalModelEntryPrice-1)>.0005).length,
 entry_delay_at_least_5min:audit.filter(x=>(x.firstTradeDelayMinutes??0)>=5).length,
 source_exit_reason_changed:audit.filter(x=>x.newExitReason!=null && x.newExitReason!==x.originalExitReason).length,
 matched_original_signals:result.length,
 modeled_winrate_30bps:{
  original:{n:old.length,wins:old.filter(x=>x.grossReturn>.003).length},
  volume:{
   n:result.filter(x=>x.grossReturn!==undefined).length,
   wins:result.filter(x=>x.grossReturn!==undefined && x.grossReturn>.003).length}},
 TIA_case_id260:audit[259],
 caveats:[
  "Previous 849 source entry/exit candidates all reproduce exactly before alteration",
  "Entry price now the first positive-volume M5 open within the signaled H1; no-trade H1 fails closed",
  "Native SHORT 10% hard STOP, 25% take profit, DOT/RENDER trail remain unchanged and reanchored to actual traded entry price",
  "This changes entry/exit economic behavior; no Production orders, state, funding or venue signed fills verified",
  "Do not deploy or claim portfolio DD until re-running full compound control with this new model",
  "Trailing stop model assumes execution at native contract trigger-price; no order-book model"
 ]
};
fs.writeFileSync(OUTPUT+"/PRISM_IDLE_849_VOLUME_AWARE_NATIVE_PARITY_SUMMARY.json",
 JSON.stringify(verdict,null,2)+"\n");
console.log("IDLE_849_VOLUME_AWARE_REPLAY",JSON.stringify({
 original:verdict.source_parity_full,volumeModeled:verdict.volume_replayed,
 noTrade:verdict.no_trade_H1,changedPriceGt5bps:verdict.original_M5_model_price_inconsistent_gt5bps,
 changedExitReason:verdict.source_exit_reason_changed,
 price30wins:verdict.modeled_winrate_30bps,
 caseTIA:verdict.TIA_case_id260}),"NO_LIVE_OPERATIONS");
