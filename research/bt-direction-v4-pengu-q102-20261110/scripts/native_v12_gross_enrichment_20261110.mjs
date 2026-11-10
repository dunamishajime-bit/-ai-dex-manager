/**
 * Enrich previously reconstructed native V12 source events with exact frozen
 * sizing/rank-cap semantics. Research-only; no V2 route priority and no orders.
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
const [{resampleV12H1ToH2,buildV12Signals,sizeV12Position,v12EntryGrossCapForSignal,v12EntryGrossMultiplierForSignal},{V12_X1_ALL},{selectNativeCoreEvents}]=await Promise.all([
 import(pathToFileURL(join(PIN,"lib","v12-x1-all.ts")).href),
 import(pathToFileURL(join(PIN,"config","v12X1AllRuntime.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-v4-native-core.ts")).href)
]);
const H=3600000,T0=Date.parse("2025-10-01T00:00:00Z"),T1=Date.parse("2026-10-01T00:00:00Z");
const syms=[...V12_X1_ALL.universe],h1={},h2={};
for(const s of syms){
 const fn=s+"USDT-1h-";
 const bufs=[
  readFileSync(join(ROOT,"aster-public-v3-h1-early",fn+"20250301-20250924.jsonl.gz")),
  readFileSync(join(ROOT,"aster-public-v3-h1",fn+"20250924-20261001.jsonl.gz"))
 ];
 const rows=bufs.flatMap(b=>gunzipSync(b).toString("utf8").trim().split("\n")).map(x=>JSON.parse(x));
 h1[s]=rows.map(r=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:true}));
 h2[s]=resampleV12H1ToH2(h1[s]);
}
const prior=readFileSync(join(DIR,"asof-native-v12-source-signals.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x));
const targetPrior=new Map(prior.filter(x=>x.period==="target").map(x=>[[x.decisionTs,x.symbol,x.side].join("|"),x]));
if(targetPrior.size!==2018)throw Error("PRIOR_TARGET_COUNT");
const out=createWriteStream(join(DIR,"asof-native-v12-source-signals-gross-enriched.jsonl"),{encoding:"utf8"});
let count=0,hc=0,rank3=0;const grossCounts=new Map();
for(let i=120;i<h2.BTC.length;i++){
 const t=h2.BTC[i].endTs;if(t<T0)continue;if(t>=T1)break;
 const truncated=Object.fromEntries(syms.map(s=>[s,h2[s].slice(0,i+1)]));
 const signals=buildV12Signals(truncated,i);
 for(const signal of signals){
  const symbol=signal.symbol+"USDT",key=[t,symbol,signal.side].join("|"),base=targetPrior.get(key);
  if(!base)throw Error("SOURCE_MATCH_MISSING:"+key);
  if(base.rank!==signal.rank||Math.abs(base.atr-signal.atr)>1e-12||base.entryGateReason!==signal.entryGateReason)throw Error("SOURCE_MATCH_DRIFT:"+key);
  const hi=h1[signal.symbol].findIndex(x=>x.ts===t);
  if(hi<0)throw Error("ENTRY_H1_MISSING:"+key);
  const entryPrice=h1[signal.symbol][hi].open;
  const sizing=sizeV12Position(1,entryPrice,signal.atr,signal.side);
  const mult=v12EntryGrossMultiplierForSignal(signal);
  const multipliedGross=sizing.requestedGross*mult;
  const rankedCap=v12EntryGrossCapForSignal(signal);
  const rankedRequestGross=Math.min(multipliedGross,rankedCap);
  const emptyPortfolioAcceptedGross=Math.min(rankedRequestGross,V12_X1_ALL.perPositionEntryGrossCap);
  if(!(emptyPortfolioAcceptedGross>0&&emptyPortfolioAcceptedGross<=1))throw Error("BAD_GROSS");
  const row={...base,entryReferenceOpen:entryPrice,entryQualityClass:signal.entryQualityClass??"STANDARD",
   entryGrossMultiplier:mult,baseRiskSizingGross:sizing.requestedGross,rankedGrossCap:rankedCap,
   rankedRequestGross,emptyPortfolioAcceptedGross,
   grossSemantics:"sizeV12Position*signalMultiplier -> rank cap -> perPosition cap; aggregate/shared capacity deferred to integrated replay"};
  out.write(JSON.stringify(row)+"\n");count++;if(mult>1)hc++;if(signal.rank===3)rank3++;
  const g=emptyPortfolioAcceptedGross.toFixed(4);grossCounts.set(g,(grossCounts.get(g)||0)+1);
 }
}
out.end();await once(out,"finish");
if(count!==2018)throw Error("ENRICHED_COUNT:"+count);
// Select native failed-break core events with the exact frozen top3/gross helper.
const core=readFileSync(join(DIR,"asof-native-v4-core-events.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x)).filter(x=>x.period==="target");
const prices=new Map();
for(const e of core){
 const t=e.entry_ts_ms,s=e.symbol;
 const ix=h1[s].findIndex(x=>x.ts===t);if(ix<0)throw Error("CORE_PRICE_MISSING");
 prices.set(s+"|"+t,h1[s][ix].open);
}
const selected=selectNativeCoreEvents(core.map(({period,...x})=>x),prices);
const coreOut=createWriteStream(join(DIR,"asof-native-v4-core-events-selected-gross.jsonl"),{encoding:"utf8"});
for(const e of selected)coreOut.write(JSON.stringify({...e,symbol:e.symbol+"USDT"})+"\n");
coreOut.end();await once(coreOut,"finish");
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={status:"RESEARCH_NATIVE_V12_GROSS_ENRICHED_NO_V2_PRIORITY",
 targetCount:count,highConfidenceCount:hc,rank3Count:rank3,grossHistogram:Object.fromEntries([...grossCounts].sort()),
 coreRawCount:core.length,coreSelectedCount:selected.length,
 sourcePin:"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 formulas:["sizeV12Position","v12EntryGrossMultiplierForSignal","v12EntryGrossCapForSignal","selectNativeCoreEvents"],
 caveats:["emptyPortfolioAcceptedGross excludes contemporaneous account/shared capacity; integrated replay applies capacity later",
 "frozen source policy is 2026 code retrospectively replayed, not as-deployed 2025 production"],
 hashes:{source:sha(join(DIR,"asof-native-v12-source-signals-gross-enriched.jsonl")),
 core:sha(join(DIR,"asof-native-v4-core-events-selected-gross.jsonl"))}};
writeFileSync(join(DIR,"native_v12_gross_enrichment_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
