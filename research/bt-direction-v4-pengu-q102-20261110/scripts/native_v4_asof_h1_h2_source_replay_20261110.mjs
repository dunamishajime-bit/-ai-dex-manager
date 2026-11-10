/**
 * Price-chronological native-source H1/H2 replay (no full-year V2 priority table).
 * The frozen code was made in 2026, so replay on 2025 history is a
 * retrospective counterfactual, NOT historical deployed Production or fresh OOS.
 * No trading credentials, orders, STOP changes, or runtime writes.
 */
import {readFileSync,writeFileSync,createWriteStream,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
const BT=process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001";
const root=resolve(BT);
const pin=join(root,"pinned-source","V4");
const outdir=join(root,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110");
mkdirSync(outdir,{recursive:true});
const [{resampleV12H1ToH2,buildV12Signals},{computeNativeV4Sources},{stepNativeFailedBreakCore},{V12_X1_ALL}]=await Promise.all([
  import(pathToFileURL(join(pin,"lib","v12-x1-all.ts")).href),
  import(pathToFileURL(join(pin,"lib","v12-v4-native-source.ts")).href),
  import(pathToFileURL(join(pin,"lib","v12-v4-native-core.ts")).href),
  import(pathToFileURL(join(pin,"config","v12X1AllRuntime.ts")).href)
]);
const H=3600000, targetStart=Date.parse("2025-10-01T00:00:00Z"),targetEnd=Date.parse("2026-10-01T00:00:00Z");
const syms=[...V12_X1_ALL.universe];
const h1={},h2={},hashes={},diagnostics={};
for(const symbol of syms){
 const filename=symbol+"USDT-1h-";
 const a=join(root,"aster-public-v3-h1-early",filename+"20250301-20250924.jsonl.gz");
 const b=join(root,"aster-public-v3-h1",filename+"20250924-20261001.jsonl.gz");
 const ra=readFileSync(a),rb=readFileSync(b);
 const records=[gunzipSync(ra).toString("utf8"),gunzipSync(rb).toString("utf8")].flatMap(t=>t.trim().split("\n")).map(t=>JSON.parse(t));
 for(let i=0;i<records.length;i++){
  const r=records[i];const t=Number(r[0]),p=i?Number(records[i-1][0]):null;
  if(i&&t-p!==H)throw Error("H1_GAP_OR_DUPLICATE:"+symbol+":"+i+":"+(t-p));
  if(r.length<8||Number(r[6])>=t+H||t%H)throw Error("UNCLOSED_OR_INVALID_H1:"+symbol+":"+i);
 }
 h1[symbol]=records.map(r=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:true}));
 h2[symbol]=resampleV12H1ToH2(h1[symbol]);
 if(h2[symbol].length!==records.length/2)throw Error("H2_LOSSY:"+symbol+":"+h2[symbol].length);
 if(h2[symbol].some((x,i)=>i&&x.ts!==h2[symbol][i-1].endTs))throw Error("H2_GAP:"+symbol);
 hashes[symbol]={earlySha256:createHash("sha256").update(ra).digest("hex"),mainSha256:createHash("sha256").update(rb).digest("hex"),h1Rows:records.length,h2Rows:h2[symbol].length};
 diagnostics[symbol]={firstH1:records[0][0],lastH1:records.at(-1)[0]};
}
const N=h2.BTC.length;
if(syms.some(s=>h2[s].length!==N||h2[s].some((v,i)=>v.endTs!==h2.BTC[i].endTs)))throw Error("H2_UNIVERSE_MISALIGNED");
const srcStream=createWriteStream(join(outdir,"asof-native-v12-source-signals.jsonl"),{encoding:"utf8"});
const coreStream=createWriteStream(join(outdir,"asof-native-v4-core-events.jsonl"),{encoding:"utf8"});
const sourceCounts={pre:0,target:0},coreCounts={pre:0,target:0},symbolCounts={pre:{},target:{}},gates={};
let maxSignals=0;
const states=Object.fromEntries(syms.filter(s=>s!=="BTC").map(s=>[s,{lastDecisionTs:null,setup:null}]));
let badEntryTimestamps=0,scanChecks=0;
for(let i=120;i<N;i++){
 const t=h2.BTC[i].endTs;
 if(t>=targetEnd)break;
 const source=computeNativeV4Sources(h2,i,t);
 const check=buildV12Signals(Object.fromEntries(syms.map(s=>[s,h2[s].slice(0,i+1)])),i);
 if(source.length!==check.length)throw Error("NATIVE_OUTPUT_COUNT_MISMATCH:"+i);
 maxSignals=Math.max(maxSignals,source.length);scanChecks++;
 const period=t<targetStart?"pre":"target";
 for(const v of source){
  const ev=v.source;
  if(ev.decisionTs!==t||ev.eligibleSourceEntryTs!==t)badEntryTimestamps++;
  if(!Number.isFinite(v.score)||!Number.isFinite(v.atr)||v.atr<=0)throw Error("BAD_SOURCE_SCORE_ATR");
  const row={period,index:i,decisionTs:t,symbol:ev.symbol,side:ev.side,sourceEntryTs:ev.eligibleSourceEntryTs,
   sourceEngine:ev.sourceEngine,sourceParityVerified:ev.sourceParityVerified,rank:v.rank,score:v.score,atr:v.atr,
   volumeRatio:v.volumeRatio,entryGateReason:v.entryGateReason,momentum:v.momentum,
   entryReferenceOpen:h1[ev.symbol.replace("USDT","")][(i+1)*2]?.open??null};
  sourceCounts[period]++;gates[v.entryGateReason]=(gates[v.entryGateReason]||0)+1;
  const k=ev.symbol+"|"+ev.side;
  symbolCounts[period][k]=(symbolCounts[period][k]||0)+1;
  srcStream.write(JSON.stringify(row)+"\n");
 }
 for(const symbol of syms.filter(s=>s!=="BTC")){
  const step=stepNativeFailedBreakCore(states[symbol],symbol,h2[symbol].slice(i-60,i+1),h2.BTC.slice(i-60,i+1),t);
  states[symbol]=step.state;
  if(step.event){
   coreCounts[period]++;
   coreStream.write(JSON.stringify({period,...step.event})+"\n");
  }
 }
}
srcStream.end();coreStream.end();
await Promise.all([once(srcStream,"finish"),once(coreStream,"finish")]);
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={
 status:"PRICE_CAUSAL_RETROSPECTIVE_FROZEN_2026_PIN_NOT_UNTOUCHED_OOS_NOT_VENUE_FILLED",
 sourceRuntimePin:"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 nativeSourceCode:"lib/v12-v4-native-source.ts + lib/v12-x1-all.ts",nativeCoreCode:"lib/v12-v4-native-core.ts",
 dateStartInclusive:"2025-03-01T00:00:00Z",periodStart:"2025-10-01T00:00:00Z",periodEndExclusive:"2026-10-01T00:00:00Z",
 symbols:syms,inputs:hashes,barRange:diagnostics,decisionH2Count:scanChecks,
 sourceSignalCounts:sourceCounts,coreEventCounts:coreCounts,symbolCounts,entryGateCounts:gates,
 maxSignalsAtDecision:maxSignals,badEntryTimestamps,
 outputs:{nativeSourceSignalsSha256:sha(join(outdir,"asof-native-v12-source-signals.jsonl")),
 nativeCoreEventsSha256:sha(join(outdir,"asof-native-v4-core-events.jsonl"))},
 caveats:["Source Runtime built in 2026; cannot call 2025 replay true prospective OOS",
 "Source signals are selected ranked native top3, not every potential universe candidate",
 "The candidate snapshot is NOT executable PnL or an actual venue trade",
 "No V2 41-route hindsight priority or repaired-filter imported",
 "No H1 fill slippage, STOP execution or production owner-enabled orders simulated"]
};
writeFileSync(join(outdir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log("REPLAY_SUMMARY="+JSON.stringify({decisionH2Count:scanChecks,sourceCounts,coreCounts,maxSignals,badEntryTimestamps,hashes:summary.outputs,dir:outdir}));
