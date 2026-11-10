import fs from "node:fs";import zlib from "node:zlib";import crypto from "node:crypto";import {pathToFileURL} from "node:url";
const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const IN=ROOT+"/DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110/idle-route-candidates-no-cooldown.jsonl";
const OUT=ROOT+"/DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110";
const END=Date.parse("2026-10-01T00:00:00Z"),MS=300000,H=3600000;
const {applyIdleProfitTrailBar}=await import(pathToFileURL(ROOT+"/pinned-source/IDLE/lib/disdex-exit-overlay-contract.ts").href);
const rows=fs.readFileSync(IN,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const syms=[...new Set(rows.map(x=>x.symbol))],cache={},inputHashes={};
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function load(sym){
 const parts=[
  ROOT+"/aster-public-v3-5m-prefix/"+sym+"-5m-20250924-20260803.jsonl.gz",
  ROOT+"/aster-public-v3-5m-suffix/"+sym+"-5m-20260803-20261001.jsonl.gz",
  ROOT+"/FORWARD_HOLDOUT_20261001_20261108/aster-m5/"+sym+"-5m-20261001-20261108T20.jsonl.gz"
 ];
 const all=[];inputHashes[sym]=[];
 for(const p of parts){
  if(!fs.existsSync(p))throw Error("M5_REQUIRED:"+p);
  inputHashes[sym].push({path:p,sha256:sha(p)});
  for(const str of zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n")){
   const z=JSON.parse(str);all.push({timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4]});
  }
 }
 const d=new Map();for(const x of all)d.set(x.timestampMs,x);
 const a=[...d.values()].sort((x,y)=>x.timestampMs-y.timestampMs);
 for(let i=1;i<a.length;i++)if(a[i].timestampMs-a[i-1].timestampMs!==MS)throw Error("M5_GAP:"+sym+":"+a[i-1].timestampMs);
 return {first:a[0].timestampMs,rows:a};
}
for(const s of syms)cache[s]=load(s);
function exitModel(c){
 const m=cache[c.symbol],idx=(c.entryTs-m.first)/MS;if(!Number.isInteger(idx)||idx<0)throw Error("ENTRY_M5:"+c.symbol+":"+c.entryTs);
 const price=m.rows[idx].open,maxExit=c.entryTs+c.holdHours*H,tp=price*.75;let stop=price*1.10,trailState;
 for(let i=idx;i<m.rows.length;i++){
  const b=m.rows[i];
  if(b.timestampMs>=maxExit)return {entryPrice:price,exitTs:b.timestampMs,exitPrice:b.open,exitReason:"MAX_HOLD"};
  if(b.high>=stop)return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:Math.max(b.open,stop),exitReason:"IDLE_HARD_STOP"};
  if(b.low<=tp)return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:Math.min(b.open,tp),exitReason:"IDLE_TAKE_PROFIT"};
  if(c.symbol==="DOTUSDT"||c.symbol==="RENDERUSDT"){
   const t=applyIdleProfitTrailBar({side:"SHORT",entryPrice:price,state:trailState,bar:b});
   if(t.stopHit)return {entryPrice:price,exitTs:b.timestampMs+MS,exitPrice:t.triggerPrice,exitReason:"IDLE_NATIVE_TRAIL"};
   trailState=t.state;if(t.state.stopPrice!==undefined)stop=Math.min(stop,t.state.stopPrice);
  }
 }
 throw Error("EXIT_M5_EXHAUSTED:"+c.symbol+":"+c.entryTs);
}
const out=rows.map((c,i)=>{const e=exitModel(c);return {...c,id:"IDLEP_"+String(i+1).padStart(5,"0"),...e,
 grossReturn:-(e.exitPrice/e.entryPrice-1),afterPeriod:e.exitTs>END,
 semantics:"Production signal pure functions + pinned M5 protection functions; modeled price execution"};});
const p=OUT+"/idle-production-candidates-with-m5-exits.jsonl";fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
const old=JSON.parse(fs.readFileSync(ROOT+"/native-new-signal-20251001-20261001/native-IDLE-all-intent-modeled-5m-exit-audit.json","utf8")).trades;
const om=new Map(out.map(x=>[[x.entryTs,x.symbol,x.route].join("|"),x]));let missing=0,mismatch=0;
for(const x of old){
 const y=om.get([x.entryTs,x.symbol,x.route].join("|"));if(!y){missing++;continue}
 if(Math.abs(+x.entryPrice-y.entryPrice)>1e-12||+x.exitTs!==y.exitTs||Math.abs(+x.exitPrice-y.exitPrice)>1e-12||x.exitReason!==y.exitReason)mismatch++;
}
const counts={};for(const x of out)counts[x.exitReason]=(counts[x.exitReason]||0)+1;
const summary={status:"PRODUCTION_IDLE_NO_COOLDOWN_WITH_M5_EXIT_MODEL",n:out.length,afterPeriod:out.filter(x=>x.afterPeriod).length,
 exitReasons:counts,oldN:old.length,oldMissing:missing,oldExitMismatch:mismatch,
 candidateSha256:sha(IN),outputSha256:sha(p),inputHashes,
 caveat:"M5 reproduces pinned protection logic but not venue quote/replace latency or signed execution."};
fs.writeFileSync(OUT+"/exit-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));