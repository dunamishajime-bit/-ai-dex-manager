/**
 * Native V12 source-vs-V2-selection standalone exit audit from frozen executable TS.
 * Uses evaluateNativeProductionExit on exact Aster H1 bars (no hindsight V2 ranking).
 * The native 46h stop/takeprofit/trailing model is NOT the same as the V2 41-route
 * productionExitSpec, and the raw signal population is NOT the integrated book.
 * Funds are independently modeled on public Aster settlement timestamps/marks.
 */
import {readFileSync,writeFileSync,createWriteStream} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001");
const N=join(ROOT,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110");
const pin=join(ROOT,"pinned-source","V4");
const t0=Date.parse("2025-10-01T00:00:00Z"),t1=Date.parse("2026-10-01T00:00:00Z"),H=3600000;
const {evaluateNativeProductionExit,productionExitSpec}=await import(pathToFileURL(join(pin,"lib","v12-v4-production-lifecycle.ts")).href);
if(productionExitSpec("REC_G3_LATE_BTC_REL").kind!=="NATIVE")throw Error("NATIVE_ADAPTER_CONTRACT_NOT_NATIVE");
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const raw=(p)=>readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(z=>JSON.parse(z));
const native=raw(join(N,"asof-native-v12-source-signals.jsonl")).filter(z=>z.period==="target");
const core=raw(join(N,"asof-native-v4-core-events.jsonl")).filter(z=>z.period==="target");
const legacy=raw(join(ROOT,"DIRECTION_RESEARCH_20261109","v4_source_strength_threeperiod.jsonl")).filter(z=>z.decisionTs>=t0&&z.decisionTs<t1);
if(native.length!==2018||legacy.length!==1394||core.length!==49)throw Error("SOURCE_COUNT_DRIFT");
const kept=new Set(legacy.map(z=>[z.sourceSignalTs,z.symbol,z.sourceSide].join("|")));
if(kept.size!==1394||native.filter(z=>kept.has([z.decisionTs,z.symbol,z.side].join("|"))).length!==1394)throw Error("KEEP_ORIGIN_MISMATCH");
const syms=[...new Set([...native,...core.map(z=>({symbol:z.symbol+"USDT"}))].map(z=>z.symbol))];
const bars={},offset={},funding={},fundingSha={};const barSha={};
for(const symbol of syms){
 const p=join(ROOT,"aster-public-v3-h1",symbol+"-1h-20250924-20261001.jsonl.gz");
 const a=gunzipSync(readFileSync(p)).toString("utf8").trim().split("\n").map(v=>JSON.parse(v)).map(z=>({
  ts:Number(z[0]),open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4])}));
 if(a.some((z,i)=>i&&z.ts!==a[i-1].ts+H))throw Error("H1_MISSING:"+symbol);
 bars[symbol]=a;offset[symbol]=a[0].ts;
 barSha[symbol]=sha(p);
 const f=join(ROOT,"aster-public-funding",symbol+"-20251001-20261001.json");
 funding[symbol]=JSON.parse(readFileSync(f,"utf8")).map(x=>[Number(x.fundingTime),Number(x.fundingRate)]).sort((a,b)=>a[0]-b[0]);
 fundingSha[symbol]=sha(f);
}
function hbar(symbol,ts){
 const a=bars[symbol],i=(ts-offset[symbol])/H;
 return Number.isInteger(i)&&i>=0&&i<a.length?a[i]:null;
}
function modeledFunding(symbol,side,entry,exit,entryPrice){
 let total=0,n=0;
 for(const [time,rate] of funding[symbol]){
  if(time<=entry||time>=exit)continue;
  const b=hbar(symbol,Math.floor(time/H)*H-H); // funding timestamps can carry subsecond venue offsets
  if(!b)throw Error("FUNDING_PREV_MARK_MISSING:"+symbol+":"+time);
  total+=(side==="LONG"?-1:1)*rate*b.close/entryPrice;
  n++;
 }
 return {fundingReturn:total,fundingEvents:n};
}
function simulate(e){
 const side=e.side,entry=e.decisionTs,atr=e.atr,symbol=e.symbol;
 if(!["SHORT","LONG"].includes(side)||!(atr>0))throw Error("BAD_NATIVE_INPUT");
 const first=hbar(symbol,entry);
 if(!first)return {status:"RIGHT_CENSORED_ENTRY_MISSING"};
 const ep=first.open;
 const leg={entryTs:entry,entryAtr:atr,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",
   entryNotional:ep,qty:1,status:"OPEN",
   candidate:{route:"REC_G3_LATE_BTC_REL",effectiveSide:side}};
 let decision=null,stop=null,peak=null,prev=null;
 for(let ts=entry;ts<Math.min(entry+46*H,t1);ts+=H){
  const b=hbar(symbol,ts),next=hbar(symbol,ts+H);
  if(!b)return {status:"RIGHT_CENSORED_H1_MISSING",at:ts};
  if(!next&&(ts+H)% (2*H)===0)return {status:"RIGHT_CENSORED_NEXT_OPEN_MISSING",at:ts};
  const n=evaluateNativeProductionExit(leg,{openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close},ts+H,
   next?{ts:ts+H,price:next.open}:undefined);
  decision=n.decision;
  leg.nativeStop=n.stop;leg.nativePeak=n.peak;
  leg.previousExitBar={openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close};
  if(decision)break;
 }
 if(!decision)return {status:"RIGHT_CENSORED_NO_EXIT"};
 if(decision.exitTs>t1)throw Error("EXIT_AFTER_END");
 const sg=side==="LONG"?1:-1;
 const gross=sg*(decision.price/ep-1);
 const f=modeledFunding(symbol,side,entry,decision.exitTs,ep);
 return {status:"MODELED_COMPLETE_NATIVE_46H",entryPrice:ep,exitPrice:decision.price,
  exitTs:decision.exitTs,exitReason:decision.reason,holdHours:(decision.exitTs-entry)/H,
  grossDirectionalReturn:gross,fundingModelReturn:f.fundingReturn,fundingEvents:f.fundingEvents,
  net10bps:gross+f.fundingReturn-.001,net30bps:gross+f.fundingReturn-.003};
}
const output=createWriteStream(join(N,"native_exit_h1_funding_independent_audit.jsonl"),{encoding:"utf8"});
const allRows=[];
for(const [family,arr] of [["V12_NATIVE",native],["FAILED_BREAK_CORE",core]]){
 for(const e of arr){
  const pos=family==="V12_NATIVE"?e:{
    symbol:e.symbol+"USDT",side:e.side,decisionTs:e.entry_ts_ms,atr:e.atr,
    rank:null,score:e.score};
  const z=simulate(pos);
  const record={family,id:[family,pos.decisionTs,pos.symbol,pos.side].join("|"),
    selectedByLegacyV2:family==="V12_NATIVE"?kept.has([pos.decisionTs,pos.symbol,pos.side].join("|")):null,
    symbol:pos.symbol,side:pos.side,decisionTs:pos.decisionTs,
    rank:pos.rank,score:pos.score,atr:pos.atr,...z};
  allRows.push(record);output.write(JSON.stringify(record)+"\n");
 }
}
output.end();await once(output,"finish");
const sections={};
for(const name of ["V12_NATIVE_SELECTED_BY_V2","V12_NATIVE_NOT_SELECTED_BY_V2","V12_NATIVE_ALL","FAILED_BREAK_CORE_ALL"]){
 let x=allRows.filter(r=>name==="V12_NATIVE_SELECTED_BY_V2"?r.family==="V12_NATIVE"&&r.selectedByLegacyV2:
  name==="V12_NATIVE_NOT_SELECTED_BY_V2"?r.family==="V12_NATIVE"&&!r.selectedByLegacyV2:
  name==="V12_NATIVE_ALL"?r.family==="V12_NATIVE":r.family==="FAILED_BREAK_CORE");
 const settled=x.filter(r=>r.status==="MODELED_COMPLETE_NATIVE_46H"),missing=x.length-settled.length;
 const v={candidates:x.length,completed:settled.length,rightCensored:missing,
  longCompleted:settled.filter(r=>r.side==="LONG").length,shortCompleted:settled.filter(r=>r.side==="SHORT").length,
  byExitReason:Object.fromEntries([...new Set(settled.map(r=>r.exitReason))].map(k=>[k,settled.filter(r=>r.exitReason===k).length]))};
 for(const cost of [10,30]){
  const field="net"+cost+"bps",vals=settled.map(r=>r[field]);
  const wins=vals.filter(z=>z>0),losses=vals.filter(z=>z<=0);
  const total=vals.reduce((a,b)=>a+b,0),positive=wins.reduce((a,b)=>a+b,0),negative=losses.reduce((a,b)=>a+b,0);
  v[cost+"bps"]={winCount:wins.length,lossCount:losses.length,winRate:vals.length?wins.length/vals.length:null,
   summedIndependentUnitNetReturns:total,meanUnitNetReturn:vals.length?total/vals.length:null,
   avgWin:wins.length?positive/wins.length:null,avgLoss:losses.length?negative/losses.length:null,
   profitFactor:negative<0?positive/-negative:null,
   netPositive:total>0};
 }
 sections[name]=v;
}
const summary={status:"RESEARCH_STANDALONE_NATIVE_46H_H1_PRICE_MODEL_FUNDING_PROXY_NOT_INTEGRATED_NOT_EXECUTABLE_NOT_OOS",
periodStart:"2025-10-01T00:00:00Z",periodEndExclusive:"2026-10-01T00:00:00Z",
nativeExitImplementation:"evaluateNativeProductionExit from pinned V4 production-lifecycle.ts with adapter route REC_G3_LATE_BTC_REL for NATIVE exit spec only",
notSameAs:"V2 shadow 41-route conditional exit and current live deployed venue orderbook",
entryFill:"next completed H2 boundary (same H1 open at decisionTs)",
entryPreregisteredCostsBps:[10,30],
fundingModel:"public funding rate and prior-completed H1 close / entry price, exclude events at entry or exit timestamp",
limitations:[
 "H1 stop-first model uses synthetic stop/TP fills at bar close timestamp, not signed venue fills; not M5 order execution",
 "Each native candidate is independently simulated; overlapping signals, slots, Gross and compounding ignored",
 "V12 native fixed 46h exit and core event separately; V2 41-route exit protocols have different economics",
 "Only native signals with settled exit by period end are in win rate; right-censored are explicitly excluded",
 "Frozen pin code in 2026 applied to 2025-2026 retrospectively: policy selection may still use historical information",
 "Native only is not fully production-certified; final route acceptance requires 10/30bps integrated risk"]
,sections,
inputHashes:{sourceNative:sha(join(N,"asof-native-v12-source-signals.jsonl")),coreNative:sha(join(N,"asof-native-v4-core-events.jsonl")),
legacy:sha(join(ROOT,"DIRECTION_RESEARCH_20261109","v4_source_strength_threeperiod.jsonl")),
h1BySymbol:barSha,fundingBySymbol:fundingSha},
resultHash:sha(join(N,"native_exit_h1_funding_independent_audit.jsonl"))};
writeFileSync(join(N,"native_exit_h1_funding_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log("NATIVE_H1_MODEL_SUMMARY="+JSON.stringify({sections,sha:summary.resultHash}));
