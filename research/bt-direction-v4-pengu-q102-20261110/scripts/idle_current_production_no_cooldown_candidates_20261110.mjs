import fs from "node:fs";import zlib from "node:zlib";import crypto from "node:crypto";import {pathToFileURL} from "node:url";
const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PIN=ROOT+"/pinned-source/IDLE";
const OUT=ROOT+"/DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110";
fs.mkdirSync(OUT,{recursive:true});
const sig=await import(pathToFileURL(PIN+"/lib/idle-priority-short-signal.ts").href);
const pol=(await import(pathToFileURL(PIN+"/config/idlePriorityShortPolicy.ts").href)).IDLE_PRIORITY_SHORT_POLICY;
const H=3600000,START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
const symbols=Object.keys(pol.routes),all=["BTCUSDT",...symbols],bars={};
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),inputs={};
for(const sym of all){
 const p=ROOT+"/aster-public-v3-h1/"+sym+"-1h-20250924-20261001.jsonl.gz";
 const rows=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").map(JSON.parse).map(z=>({
  ts:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],quoteVolume:+z[7]
 }));
 for(let i=1;i<rows.length;i++)if(rows[i].ts-rows[i-1].ts!==H)throw Error("H1_GAP:"+sym+":"+i);
 bars[sym]=rows;inputs[sym]={rows:rows.length,sha256:sha(p)};
}
const out=[],errors={};
for(let t=START;t<END;t+=H){
 for(const sym of symbols){
  try{
   const si=Math.round((t-bars[sym][0].ts)/H),bi=Math.round((t-bars.BTCUSDT[0].ts)/H);
   const sr=bars[sym].slice(Math.max(0,si-160),si),br=bars.BTCUSDT.slice(Math.max(0,bi-160),bi);
   const f=sig.computeIdlePriorityFeatures(t,sr,br);
   const g=sig.evaluateIdleGenericCandidate(f);
   const d=sig.evaluateIdlePriorityShort(sym,f,g);
   if(d.accepted)out.push({strategy_id:"IDLE",source_runtime_sha:"7688ed7c93a1918d8b44837339b7da5584a868f5",
    entryTs:t,signalTs:f.signalTs,symbol:sym,side:"SHORT",route:d.route,requestedGross:pol.routes[sym].gross,
    holdHours:d.holdHours,features:f,genericArchetype:g.archetype,genericReason:g.reason,reason:d.reason});
  }catch(e){const k=String(e?.message||e);errors[k]=(errors[k]||0)+1;}
 }
}
const p=OUT+"/idle-route-candidates-no-cooldown.jsonl";fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
const oldPath=ROOT+"/native-new-signal-20251001-20261001/native-IDLE-raw-intentions.jsonl";
const old=fs.readFileSync(oldPath,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const key=x=>[x.entryTs,x.symbol,x.route].join("|"),newMap=new Map(out.map(x=>[key(x),x]));
let missing=0,featureMismatch=0;
for(const x of old){
 const y=newMap.get(key(x));if(!y){missing++;continue}
 for(const k of ["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]){
  const a=+x.features[k],b=+y.features[k];if(Math.abs(a-b)>1e-12){featureMismatch++;break}
 }
}
const bySymbol={};for(const s of symbols)bySymbol[s]=out.filter(x=>x.symbol===s).length;
const summary={status:"PRODUCTION_IDLE_ROUTE_CANDIDATES_NO_COOLDOWN",n:out.length,oldN:old.length,oldMissing:missing,oldFeatureMismatch:featureMismatch,
 bySymbol,errors,inputHashes:inputs,oldSha256:sha(oldPath),outputSha256:sha(p),
 semantics:"Production pure functions evaluated hourly; no lifecycle cooldown, no account/baseline/capacity admission."};
fs.writeFileSync(OUT+"/summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));