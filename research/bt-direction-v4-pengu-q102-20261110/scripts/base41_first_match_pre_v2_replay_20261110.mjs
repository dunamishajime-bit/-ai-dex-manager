/**
 * Reconstruct the pre-V2 first-matching V4 route from each frozen native V12
 * source event. Uses causal H1 features only and deliberately does NOT call
 * evaluateV12V4V2Routes / full-year priority JSON.
 *
 * Mirrors adaptProductionCandidates through its pre-V2 raw-route selection:
 *   computeProductionH1Features -> evaluateV12V4Routes -> allocationOrder -> first match.
 * Delayed candidates are reported as DEFERRED exactly as the live builder would
 * at that decision; they are not silently promoted.
 */
import {readFileSync,writeFileSync,createWriteStream} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {createHash} from "node:crypto";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001"),PIN=join(ROOT,"pinned-source","V4");
const DIR=join(ROOT,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110");
const [{resampleV12H1ToH2},{computeNativeV4Sources},{computeProductionH1Features},{evaluateV12V4Routes},{V12_X1_ALL}]=await Promise.all([
 import(pathToFileURL(join(PIN,"lib","v12-x1-all.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-v4-native-source.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-v4-production-features.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-multilogic-v4-shadow.ts")).href),
 import(pathToFileURL(join(PIN,"config","v12X1AllRuntime.ts")).href)
]);
const T0=Date.parse("2025-10-01T00:00:00Z"),T1=Date.parse("2026-10-01T00:00:00Z");
const syms=[...V12_X1_ALL.universe],h1={},h2={};
for(const s of syms){
 const fn=s+"USDT-1h-";
 const rows=[
  readFileSync(join(ROOT,"aster-public-v3-h1-early",fn+"20250301-20250924.jsonl.gz")),
  readFileSync(join(ROOT,"aster-public-v3-h1",fn+"20250924-20261001.jsonl.gz"))
 ].flatMap(b=>gunzipSync(b).toString("utf8").trim().split("\n")).map(x=>JSON.parse(x));
 h1[s]=rows.map(r=>({openTs:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),
   volume:Number(r[5]),quoteVolume:Number(r[7])}));
 h2[s]=resampleV12H1ToH2(rows.map(r=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:true})));
}
function allocationOrder(route){
 if(route==="CONT_SHORT_MID_AGE24_48")return 0;
 const m=/^REC_([GXYZ])(\d+)/.exec(route);if(!m)return -1;
 return (m[1]==="G"?10:m[1]==="X"?30:60)+Number(m[2]);
}
const outp=join(DIR,"base41-first-match-pre-v2-candidates.jsonl"),defp=join(DIR,"base41-first-match-pre-v2-deferred.jsonl"),invp=join(DIR,"base41-first-match-pre-v2-data-invalid.jsonl");
const out=createWriteStream(outp,{encoding:"utf8"}),defo=createWriteStream(defp,{encoding:"utf8"}),invo=createWriteStream(invp,{encoding:"utf8"});
const counts={pre:{source:0,matched:0,emitted:0,deferred:0,noRoute:0,dataInvalid:0},target:{source:0,matched:0,emitted:0,deferred:0,noRoute:0,dataInvalid:0}};
const routes={pre:{},target:{}},deferredRoutes={pre:{},target:{}};
for(let i=120;i<h2.BTC.length;i++){
 const t=h2.BTC[i].endTs;if(t>=T1)break;const period=t<T0?"pre":"target";
 const sources=computeNativeV4Sources(h2,i,t);
 for(const n of sources){
  counts[period].source++;
  const s=n.source,symbol=s.symbol.replace(/USDT$/,"");
  let source;
  try{ source=computeProductionH1Features(s.symbol,s.side,s.eligibleSourceEntryTs,t,h1[symbol],h1.BTC); }
  catch(err){ counts[period].dataInvalid++; invo.write(JSON.stringify({period,decisionTs:t,symbol:s.symbol,side:s.side,reason:String(err instanceof Error?err.message:err)})+"\
"); continue; }
  const obs={...source.features,sourceSide:s.side,sourceSignalTs:s.eligibleSourceEntryTs,age:s.momentumConditionAgeHours,
    coreRequestedGross:s.coreRequestedGross,nativeDiagnosticRet6:s.nativeDiagnosticRet6,
    nativeDiagnosticEma12Atr:s.nativeDiagnosticEma12Atr,...s.failedBreak};
  const matched=evaluateV12V4Routes(obs).filter(r=>r.route!=="FAILED_BREAK_REV_SHORT_6H")
    .sort((a,b)=>allocationOrder(a.route)-allocationOrder(b.route)).slice(0,1);
  if(!matched.length){counts[period].noRoute++;continue}
  counts[period].matched++;
  const r=matched[0],row={period,decisionTs:t,sourceSymbol:s.symbol,sourceSide:s.side,sourceRank:n.rank,
    sourceScore:n.score,sourceAtr:n.atr,sourceVolumeRatio:n.volumeRatio,sourceMomentum:n.momentum,
    sourceEntryGateReason:n.entryGateReason,momentumConditionAgeHours:s.momentumConditionAgeHours,
    route:r.route,family:r.family,effectiveSide:r.effectiveSide,sourceSignalTs:r.sourceSignalTs,
    eligibleEntryTs:r.eligibleEntryTs,entryDelayHours:r.entryDelayHours,baseRouteRank:r.rank,
    requestedGross:r.requestedGross,plannedExitPolicy:r.plannedExitPolicy,entryRuleTokens:r.entryRuleTokens,
    featureAtr14:source.atr14,features:r.features};
  if(r.eligibleEntryTs>t){
   counts[period].deferred++;deferredRoutes[period][r.route]=(deferredRoutes[period][r.route]||0)+1;
   defo.write(JSON.stringify({...row,status:"DEFERRED_AT_SOURCE_DECISION"})+"\n");
  }else{
   counts[period].emitted++;routes[period][r.route]=(routes[period][r.route]||0)+1;
   out.write(JSON.stringify({...row,status:"EMITTED_PRE_V2"})+"\n");
  }
 }
}
out.end();defo.end();invo.end();await Promise.all([once(out,"finish"),once(defo,"finish"),once(invo,"finish")]);
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={status:"BASE41_FIRST_MATCH_PRE_V2_CAUSAL_FEATURE_REPLAY_RESEARCH_ONLY",counts,routes,deferredRoutes,
 sourcePin:"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 hashes:{candidates:sha(outp),deferred:sha(defp),dataInvalid:sha(invp)},
 caveats:["Route catalog itself was research-derived in 2026; this removes V2 repairs/ranking but is not virgin historical policy.",
 "Delayed candidates are reported exactly as deferred at source decision; no invented future-state scheduler.",
 "One corrupt Aster BTC H1 bar at 2025-09-13T13:00Z is not cross-venue imputed; every feature window touching it fails closed.",
 "FAILED_BREAK core is excluded here and remains a separate native state-machine stream."]};
writeFileSync(join(DIR,"base41_first_match_pre_v2_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
