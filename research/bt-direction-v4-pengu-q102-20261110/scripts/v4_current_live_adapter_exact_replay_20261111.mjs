/**
 * Exact current V4 production candidate adapter replay over target year.
 * Uses active-pin-equivalent pinned source. Read-only research only.
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
const [{resampleV12H1ToH2},{computeNativeV4Sources},{adaptProductionCandidates},{V12_X1_ALL}]=await Promise.all([
 import(pathToFileURL(join(PIN,"lib","v12-x1-all.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-v4-native-source.ts")).href),
 import(pathToFileURL(join(PIN,"lib","v12-v4-production-features.ts")).href),
 import(pathToFileURL(join(PIN,"config","v12X1AllRuntime.ts")).href)
]);
const HOUR=3600000,T0=Date.parse("2025-10-01T00:00:00Z"),T1=Date.parse("2026-10-01T00:00:00Z");
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
const rolling=(arr,t)=>{let last=-1;for(let q=arr.length-1;q>=0;q--){if(arr[q].openTs+HOUR<=t){last=q;break;}}return last<0?[]:arr.slice(Math.max(0,last-499),last+1);};
const outp=join(DIR,"current-live-adapter-target-candidates-20261111.jsonl");
const filtp=join(DIR,"current-live-adapter-target-filtered-20261111.jsonl");
const defp=join(DIR,"current-live-adapter-target-deferred-20261111.jsonl");
const errp=join(DIR,"current-live-adapter-target-errors-20261111.jsonl");
const out=createWriteStream(outp,{encoding:"utf8"}),filt=createWriteStream(filtp,{encoding:"utf8"}),defo=createWriteStream(defp,{encoding:"utf8"}),erro=createWriteStream(errp,{encoding:"utf8"});
const counts={source:0,candidates:0,filtered:0,deferred:0,errors:0,noOutput:0};
const routeCounts={},filteredReasons={};
for(let i=120;i<h2.BTC.length;i++){
 const t=h2.BTC[i].endTs;if(t>=T1)break;if(t<T0)continue;
 const sources=computeNativeV4Sources(h2,i,t);
 for(const n of sources){
  counts.source++;
  const s=n.source,symbol=s.symbol.replace(/USDT$/,"");
  let result;
  try{
   result=adaptProductionCandidates({source:s,decisionTs:t,symbolBars:rolling(h1[symbol],t),btcBars:rolling(h1.BTC,t)});
  }catch(err){
   counts.errors++;erro.write(JSON.stringify({decisionTs:t,symbol:s.symbol,sourceSide:s.side,reason:String(err instanceof Error?err.message:err)})+"\n");continue;
  }
  if(!result.candidates.length&&!result.filtered.length&&!result.deferred.length)counts.noOutput++;
  for(const c of result.candidates){
   counts.candidates++;routeCounts[c.route]=(routeCounts[c.route]||0)+1;
   out.write(JSON.stringify({decisionTs:t,sourceSymbol:s.symbol,sourceSide:s.side,sourceRank:n.rank,sourceScore:n.score,
    sourceAtr:n.atr,entryGateReason:n.entryGateReason,policyTemporalCausal:result.policyTemporalCausal,
    frozenRankingHasFullYearHindsight:result.frozenRankingHasFullYearHindsight,...c})+"\n");
  }
  for(const c of result.filtered){
   counts.filtered++;filteredReasons[c.reason]=(filteredReasons[c.reason]||0)+1;
   filt.write(JSON.stringify({decisionTs:t,sourceSymbol:s.symbol,sourceSide:s.side,...c})+"\n");
  }
  for(const route of result.deferred){
   counts.deferred++;defo.write(JSON.stringify({decisionTs:t,sourceSymbol:s.symbol,sourceSide:s.side,route})+"\n");
  }
 }
}
out.end();filt.end();defo.end();erro.end();await Promise.all([once(out,"finish"),once(filt,"finish"),once(defo,"finish"),once(erro,"finish")]);

const candidates=readFileSync(outp,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const legacyPath=join(ROOT,"native-new-signal-20251001-20261001","native-V4-raw-intentions.jsonl");
const legacy=readFileSync(legacyPath,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const key=x=>[Number(x.decisionTs),String(x.symbol??x.sourceSymbol),String(x.side??x.effectiveSide)].join("|");
const cm=new Map(candidates.map(x=>[key({decisionTs:x.decisionTs,symbol:x.symbol,side:x.effectiveSide}),x]));
let exact=0,missing=0,routeMismatch=0,rankMismatch=0,grossMismatch=0,entryMismatch=0;
const mismatchSamples=[];
for(const z of legacy){
 const c=cm.get(key(z));
 if(!c){missing++;if(mismatchSamples.length<12)mismatchSamples.push({kind:"MISSING",legacy:z});continue;}
 let bad=false;
 if(c.route!==z.route){routeMismatch++;bad=true;}
 if(Number(c.rank)!==Number(z.rank)){rankMismatch++;bad=true;}
 if(Math.abs(Number(c.requestedGross)-Number(z.requestedGross))>1e-12){grossMismatch++;bad=true;}
 if(Number(c.eligibleEntryTs)!==Number(z.entryTs)){entryMismatch++;bad=true;}
 if(!bad)exact++;else if(mismatchSamples.length<12)mismatchSamples.push({kind:"FIELD",legacy:z,current:{route:c.route,rank:c.rank,requestedGross:c.requestedGross,eligibleEntryTs:c.eligibleEntryTs,effectiveSide:c.effectiveSide}});
}
const legacyKeys=new Set(legacy.map(key));
const extras=candidates.filter(c=>!legacyKeys.has(key({decisionTs:c.decisionTs,symbol:c.symbol,side:c.effectiveSide})));
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={
 status:"CURRENT_LIVE_ADAPTER_REPLAY_TARGET_COMPLETE",
 activePin:"53a0be396719f0284af4e11b35c66a4ac7d58f79",
 replaySourcePin:"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 relevantFilesByteEquivalentAcrossPins:true,
 period:["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
 counts,routeCounts,filteredReasons,
 legacyRows:legacy.length,currentCandidateRows:candidates.length,
 compare:{exact,missing,routeMismatch,rankMismatch,grossMismatch,entryMismatch,extraCurrentCandidates:extras.length,mismatchSamples,extraSamples:extras.slice(0,12).map(x=>({decisionTs:x.decisionTs,symbol:x.symbol,effectiveSide:x.effectiveSide,route:x.route,rank:x.rank,requestedGross:x.requestedGross,eligibleEntryTs:x.eligibleEntryTs}))},
 hashes:{candidates:sha(outp),filtered:sha(filtp),deferred:sha(defp),errors:sha(errp),legacy:sha(legacyPath)},
 caveats:["Current policy is replayed backward; route catalog/ranking/repairs were research-frozen in 2026 and are not historical as-deployed OOS evidence.","FAILED_BREAK native core is a separate stream and is not included in this adapter body."]
};
const sp=join(DIR,"current_live_adapter_target_summary_20261111.json");
writeFileSync(sp,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
