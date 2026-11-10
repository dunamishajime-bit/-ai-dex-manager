/**
 * Exact frozen native 46h exit replay for PRE native V12 source signals.
 * No funding is included because venue funding history is incomplete pre-2025-10.
 * Labels are therefore directional price return minus fee scenario only.
 */
import {readFileSync,writeFileSync,createWriteStream} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {createHash} from "node:crypto";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001");
const PIN=join(ROOT,"pinned-source","V4");
const DIR=join(ROOT,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110");
const {evaluateNativeProductionExit,productionExitSpec}=await import(pathToFileURL(join(PIN,"lib","v12-v4-production-lifecycle.ts")).href);
if(productionExitSpec("REC_G3_LATE_BTC_REL").kind!=="NATIVE")throw Error("NATIVE_EXIT_CONTRACT_DRIFT");
const H=3600000;
const src=readFileSync(join(DIR,"asof-native-v12-source-signals.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x)).filter(x=>x.period==="pre");
if(src.length!==962)throw Error("PRE_SOURCE_COUNT:"+src.length);
const syms=[...new Set(src.map(x=>x.symbol))],bars={},offset={};
for(const symbol of syms){
 const fn=symbol+"-1h-";
 const bufs=[
  readFileSync(join(ROOT,"aster-public-v3-h1-early",fn+"20250301-20250924.jsonl.gz")),
  readFileSync(join(ROOT,"aster-public-v3-h1",fn+"20250924-20261001.jsonl.gz"))
 ];
 const a=bufs.flatMap(b=>gunzipSync(b).toString("utf8").trim().split("\n")).map(x=>JSON.parse(x)).map(r=>({
  ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])}));
 if(a.some((z,i)=>i&&z.ts!==a[i-1].ts+H))throw Error("H1_GAP:"+symbol);
 bars[symbol]=a;offset[symbol]=a[0].ts;
}
function hbar(symbol,ts){
 const i=(ts-offset[symbol])/H,a=bars[symbol];
 return Number.isInteger(i)&&i>=0&&i<a.length?a[i]:null;
}
function simulate(e){
 const entry=e.decisionTs,symbol=e.symbol,side=e.side,atr=Number(e.atr),b0=hbar(symbol,entry);
 if(!b0)throw Error("ENTRY_BAR_MISSING");
 const ep=b0.open;
 const leg={entryTs:entry,entryAtr:atr,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",entryNotional:ep,qty:1,status:"OPEN",
  candidate:{route:"REC_G3_LATE_BTC_REL",effectiveSide:side}};
 let decision=null;
 for(let ts=entry;ts<entry+46*H;ts+=H){
  const b=hbar(symbol,ts),next=hbar(symbol,ts+H);
  if(!b)throw Error("H1_MISSING:"+symbol+":"+ts);
  const n=evaluateNativeProductionExit(leg,{openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close},ts+H,
   next?{ts:ts+H,price:next.open}:undefined);
  leg.nativeStop=n.stop;leg.nativePeak=n.peak;leg.previousExitBar={openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close};
  if(n.decision){decision=n.decision;break;}
 }
 if(!decision)throw Error("NO_NATIVE_EXIT:"+symbol+":"+entry);
 const sg=side==="LONG"?1:-1,gross=sg*(decision.price/ep-1);
 return {entryPrice:ep,exitPrice:decision.price,exitTs:decision.exitTs,exitReason:decision.reason,
  holdHours:(decision.exitTs-entry)/H,grossDirectionalReturn:gross,net10bpsNoFunding:gross-.001,net30bpsNoFunding:gross-.003};
}
const outp=join(DIR,"pre-native-v12-source-exits-no-funding.jsonl"),out=createWriteStream(outp,{encoding:"utf8"});
let wins10=0,wins30=0,sum10=0,sum30=0;
for(const e of src){
 const z=simulate(e);if(z.net10bpsNoFunding>0)wins10++;if(z.net30bpsNoFunding>0)wins30++;
 sum10+=z.net10bpsNoFunding;sum30+=z.net30bpsNoFunding;
 out.write(JSON.stringify({...e,...z,atrRatio:Number(e.atr)/z.entryPrice,absMomentum:Math.abs(Number(e.momentum))})+"\n");
}
out.end();await once(out,"finish");
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={status:"PRE_NATIVE_V12_EXACT_EXIT_NO_FUNDING_RESEARCH_LABELS",n:src.length,
 winRate10:wins10/src.length,winRate30:wins30/src.length,mean10:sum10/src.length,mean30:sum30/src.length,
 sum10,sum30,exitTapeSha256:sha(outp),sourceTapeSha256:sha(join(DIR,"asof-native-v12-source-signals.jsonl")),
 caveat:"PRE venue funding incomplete; no funding in labels. Frozen 2026 source/exit policy replayed retrospectively."};
writeFileSync(join(DIR,"pre_native_v12_source_exit_nofunding_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
