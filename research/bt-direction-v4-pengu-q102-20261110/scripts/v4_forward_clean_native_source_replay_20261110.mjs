/**
 * Prospective-ish clean native V4 forward replay from frozen pin.
 * Decision inputs: only completed H1/H2 at each forward timestamp.
 * No v12-v4-v2-shadow route priority/filter is imported.
 */
import {readFileSync,writeFileSync,createWriteStream,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001");
const pin=join(ROOT,"pinned-source","V4");
const FWD=join(ROOT,"FORWARD_HOLDOUT_20261001_20261108");
const OUT=join(ROOT,"DIRECTION_RESEARCH_20261109","FORWARD_NATIVE_V4_CLEAN_20261110");
mkdirSync(OUT,{recursive:true});
const [{resampleV12H1ToH2},{computeNativeV4Sources},{stepNativeFailedBreakCore},{V12_X1_ALL}]=await Promise.all([
 import(pathToFileURL(join(pin,"lib","v12-x1-all.ts")).href),
 import(pathToFileURL(join(pin,"lib","v12-v4-native-source.ts")).href),
 import(pathToFileURL(join(pin,"lib","v12-v4-native-core.ts")).href),
 import(pathToFileURL(join(pin,"config","v12X1AllRuntime.ts")).href)
]);
const H=3600000,START=Date.parse("2026-10-01T00:00:00Z"),END=Date.parse("2026-11-08T20:00:00Z");
const syms=[...V12_X1_ALL.universe],h1={},h2={},hashes={};
for(const symbol of syms){
 const pre=join(ROOT,"aster-public-v3-h1",symbol+"USDT-1h-20250924-20261001.jsonl.gz");
 const fwd=join(FWD,"aster-h1",symbol+"USDT-1h-20261001-20261108T20.jsonl.gz");
 const inputs=[pre,fwd].map(p=>readFileSync(p));
 const recs=inputs.flatMap(b=>gunzipSync(b).toString("utf8").trim().split("\n")).map(x=>JSON.parse(x));
 const seen=new Map();
 for(const r of recs)seen.set(Number(r[0]),r);
 const rows=[...seen.values()].sort((a,b)=>Number(a[0])-Number(b[0]));
 for(let i=1;i<rows.length;i++)if(Number(rows[i][0])-Number(rows[i-1][0])!==H)throw Error("H1_GAP:"+symbol+":"+rows[i-1][0]+":"+rows[i][0]);
 h1[symbol]=rows.map(r=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:true}));
 h2[symbol]=resampleV12H1ToH2(h1[symbol]);
 hashes[symbol]={pre:createHash("sha256").update(inputs[0]).digest("hex"),forward:createHash("sha256").update(inputs[1]).digest("hex"),h1Rows:rows.length,h2Rows:h2[symbol].length};
}
const N=h2.BTC.length;
if(syms.some(s=>h2[s].length!==N||h2[s].some((v,i)=>v.endTs!==h2.BTC[i].endTs)))throw Error("H2_UNIVERSE_MISALIGNED");
const src=createWriteStream(join(OUT,"forward-native-v12-source-signals.jsonl"),{encoding:"utf8"});
const core=createWriteStream(join(OUT,"forward-native-v4-core-events.jsonl"),{encoding:"utf8"});
const states=Object.fromEntries(syms.filter(s=>s!=="BTC").map(s=>[s,{lastDecisionTs:null,setup:null}]));
let signals=0,cores=0,decisions=0;
for(let i=120;i<N;i++){
 const t=h2.BTC[i].endTs;
 if(t<START)continue;
 if(t>=END)break;
 decisions++;
 for(const v of computeNativeV4Sources(h2,i,t)){
  const ev=v.source;
  src.write(JSON.stringify({decisionTs:t,symbol:ev.symbol,side:ev.side,rank:v.rank,atr:v.atr,score:v.score,momentum:v.momentum,volumeRatio:v.volumeRatio,entryGateReason:v.entryGateReason,
   entryReferenceOpen:h1[ev.symbol.replace("USDT","")].find(x=>x.ts===t)?.open??null})+"\n");signals++;
 }
 for(const symbol of syms.filter(s=>s!=="BTC")){
  const step=stepNativeFailedBreakCore(states[symbol],symbol,h2[symbol].slice(i-60,i+1),h2.BTC.slice(i-60,i+1),t);
  states[symbol]=step.state;
  if(step.event){core.write(JSON.stringify(step.event)+"\n");cores++;}
 }
}
src.end();core.end();await Promise.all([once(src,"finish"),once(core,"finish")]);
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={status:"FORWARD_PRICE_CAUSAL_NATIVE_V4_NO_V2_SHADOW_FILTER",periodStart:"2026-10-01T00:00:00Z",periodEndExclusive:"2026-11-08T20:00:00Z",
 sourceRuntimePin:"3ad65403013b701db5d9e53e8814e6ab827a28e8",decisions,signals,cores,inputs:hashes,
 outputs:{sourceSha256:sha(join(OUT,"forward-native-v12-source-signals.jsonl")),coreSha256:sha(join(OUT,"forward-native-v4-core-events.jsonl"))},
 caveats:["Frozen code is evaluated forward of 2026-10-01 using only closed price bars; this removes the full-year V2 priority/filter from candidate generation.",
 "This step creates signals only; execution/PnL is evaluated separately.","End is 2026-11-08 20:00 UTC because that is the last supplied forward H1 boundary."]};
writeFileSync(join(OUT,"summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log("FORWARD_NATIVE_V4="+JSON.stringify({decisions,signals,cores,outputs:summary.outputs}));
