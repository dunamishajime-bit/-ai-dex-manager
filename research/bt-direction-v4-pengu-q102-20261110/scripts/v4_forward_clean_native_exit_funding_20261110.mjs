/**
 * Clean forward V4 native exit/funding audit.
 * Inputs are the forward native source/core tapes generated without V2 hindsight filtering.
 */
import {readFileSync,writeFileSync,createWriteStream} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001");
const FWD=join(ROOT,"FORWARD_HOLDOUT_20261001_20261108");
const N=join(ROOT,"DIRECTION_RESEARCH_20261109","FORWARD_NATIVE_V4_CLEAN_20261110");
const pin=join(ROOT,"pinned-source","V4");
const t0=Date.parse("2026-10-01T00:00:00Z"),t1=Date.parse("2026-11-08T20:00:00Z"),H=3600000;
const {evaluateNativeProductionExit,productionExitSpec}=await import(pathToFileURL(join(pin,"lib","v12-v4-production-lifecycle.ts")).href);
if(productionExitSpec("REC_G3_LATE_BTC_REL").kind!=="NATIVE")throw Error("NATIVE_EXIT_CONTRACT_CHANGED");
const raw=p=>readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(x=>JSON.parse(x));
const native=raw(join(N,"forward-native-v12-source-signals.jsonl"));
const core=raw(join(N,"forward-native-v4-core-events.jsonl"));
if(native.length!==184||core.length!==8)throw Error("FORWARD_SOURCE_COUNT_DRIFT");
const syms=[...new Set([...native.map(x=>x.symbol),...core.map(x=>x.symbol+"USDT")])];
const bars={},offset={},funding={},barSha={},fundingSha={};
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
for(const symbol of syms){
 const p=join(FWD,"aster-h1",symbol+"-1h-20261001-20261108T20.jsonl.gz");
 const a=gunzipSync(readFileSync(p)).toString("utf8").trim().split("\n").map(x=>JSON.parse(x)).map(z=>({
  ts:Number(z[0]),open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4])}));
 if(a.some((z,i)=>i&&z.ts!==a[i-1].ts+H))throw Error("H1_GAP:"+symbol);
 bars[symbol]=a;offset[symbol]=a[0].ts;barSha[symbol]=sha(p);
 const fp=join(FWD,"funding",symbol+"-funding-20261001-20261109.json");
 funding[symbol]=JSON.parse(readFileSync(fp,"utf8")).map(x=>[Number(x.fundingTime),Number(x.fundingRate)]).sort((a,b)=>a[0]-b[0]);
 fundingSha[symbol]=sha(fp);
}
function hbar(symbol,ts){const a=bars[symbol],i=(ts-offset[symbol])/H;return Number.isInteger(i)&&i>=0&&i<a.length?a[i]:null}
function fund(symbol,side,entry,exit,ep){
 let total=0,n=0;
 for(const [time,rate] of funding[symbol]){
  if(time<=entry||time>=exit)continue;
  const b=hbar(symbol,Math.floor(time/H)*H-H);
  if(!b)throw Error("FUND_MARK_MISSING:"+symbol+":"+time);
  total+=(side==="LONG"?-1:1)*rate*b.close/ep;n++;
 }
 return {return:total,n};
}
function sim(e){
 const symbol=e.symbol,side=e.side,entry=e.decisionTs,atr=e.atr;
 const first=hbar(symbol,entry);if(!first)return {status:"ENTRY_MISSING"};
 const ep=first.open;
 const leg={entryTs:entry,entryAtr:atr,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",
  entryNotional:ep,qty:1,status:"OPEN",candidate:{route:"REC_G3_LATE_BTC_REL",effectiveSide:side}};
 let decision=null;
 for(let ts=entry;ts<entry+46*H;ts+=H){
  if(ts>=t1)return {status:"RIGHT_CENSORED_PERIOD_END"};
  const b=hbar(symbol,ts),next=hbar(symbol,ts+H);
  if(!b)return {status:"RIGHT_CENSORED_H1_MISSING",at:ts};
  if(!next)return {status:"RIGHT_CENSORED_NEXT_OPEN_MISSING",at:ts+H};
  const n=evaluateNativeProductionExit(leg,{openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close},ts+H,
    next?{ts:ts+H,price:next.open}:undefined);
  leg.nativeStop=n.stop;leg.nativePeak=n.peak;leg.previousExitBar={openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close};
  if(n.decision){decision=n.decision;break}
 }
 if(!decision)return {status:"RIGHT_CENSORED_NO_EXIT"};
 if(decision.exitTs>t1)return {status:"RIGHT_CENSORED_PERIOD_END"};
 const sg=side==="LONG"?1:-1,gross=sg*(decision.price/ep-1),f=fund(symbol,side,entry,decision.exitTs,ep);
 return {status:"COMPLETE",entryPrice:ep,exitPrice:decision.price,exitTs:decision.exitTs,exitReason:decision.reason,
  holdHours:(decision.exitTs-entry)/H,grossDirectionalReturn:gross,fundingReturn:f.return,fundingEvents:f.n,
  net10bps:gross+f.return-.001,net30bps:gross+f.return-.003};
}
const out=createWriteStream(join(N,"forward-native-v4-clean-exits.jsonl"),{encoding:"utf8"});
const rows=[];
for(const [family,a] of [["V12_NATIVE",native],["FAILED_BREAK_CORE",core]]){
 for(const e of a){
  const pos=family==="V12_NATIVE"?e:{symbol:e.symbol+"USDT",side:e.side,decisionTs:e.entry_ts_ms,atr:e.atr,rank:e.rank??null,score:e.score};
  const z=sim(pos);const r={family,id:[family,pos.decisionTs,pos.symbol,pos.side].join("|"),...pos,...z};rows.push(r);out.write(JSON.stringify(r)+"\n");
 }
}
out.end();await once(out,"finish");
function sec(a){
 const c=a.filter(x=>x.status==="COMPLETE"),r={candidates:a.length,complete:c.length,rightCensored:a.length-c.length,
  long:c.filter(x=>x.side==="LONG").length,short:c.filter(x=>x.side==="SHORT").length,
  exitReasons:Object.fromEntries([...new Set(c.map(x=>x.exitReason))].map(k=>[k,c.filter(x=>x.exitReason===k).length]))};
 for(const bps of [10,30]){
  const vals=c.map(x=>x["net"+bps+"bps"]),w=vals.filter(x=>x>0),l=vals.filter(x=>x<=0),gp=w.reduce((a,b)=>a+b,0),gl=-l.reduce((a,b)=>a+b,0);
  r[bps+"bps"]={n:vals.length,wins:w.length,winRate:w.length/vals.length,mean:vals.reduce((a,b)=>a+b,0)/vals.length,
    sum:vals.reduce((a,b)=>a+b,0),pf:gl>0?gp/gl:null};
 }
 return r;
}
const summary={status:"FORWARD_CLEAN_NATIVE_V4_EXIT_AUDIT_NOT_INTEGRATED",periodStart:"2026-10-01T00:00:00Z",periodEndExclusive:"2026-11-08T20:00:00Z",
 sections:{source:sec(rows.filter(x=>x.family==="V12_NATIVE")),core:sec(rows.filter(x=>x.family==="FAILED_BREAK_CORE")),all:sec(rows)},
 caveats:["No V2 hindsight route filter or route-specific shadow exit used.","Standalone candidate returns ignore overlap/slots/shared gross/compounding.","H1 native exit model is model execution, not signed venue fill.","Right-censored candidates are excluded from win-rate metrics."],
 hashes:{source:sha(join(N,"forward-native-v12-source-signals.jsonl")),core:sha(join(N,"forward-native-v4-core-events.jsonl")),ledger:sha(join(N,"forward-native-v4-clean-exits.jsonl")),h1:barSha,funding:fundingSha}};
writeFileSync(join(N,"forward-native-v4-clean-exit-summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log("FORWARD_CLEAN_EXIT="+JSON.stringify(summary.sections));
