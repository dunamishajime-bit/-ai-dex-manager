/**
 * Exact Q102 HIGH_VOL base exit replay using the production pin helper.
 * Adopted opt-in overlays are intentionally not applied here.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";
const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const IN=ROOT+"/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/q102-high-vol-production-signals.jsonl";
const OUT=ROOT+"/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/q102-high-vol-base-exits.jsonl";
const SUM=ROOT+"/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/HIGH_VOL_EXIT_SUMMARY.json";
const rows=fs.readFileSync(IN,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const pipe=await import(pathToFileURL(ROOT+"/pinned-source/Q102/lib/disdex-quality102-causal-pipeline.ts").href);
const syms=[...new Set(rows.map(x=>x.symbol))];
const data={};
for(const sym of syms){
 const p=ROOT+"/aster-public-v3-h1-q102-warmup/"+sym+"-1h-20250301-20261001.jsonl.gz";
 data[sym]=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").map(JSON.parse).map(x=>({
   timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],baseVolume:+x[5],quoteVolume:+x[7]
 }));
}
const out=[];
for(const row of rows){
 const a=data[row.symbol],ei=a.findIndex(x=>x.timestampMs===row.entryTs);
 if(ei<0)throw Error("ENTRY_BAR_MISSING:"+row.id);
 const entryPrice=a[ei].open;
 const bars=a.slice(ei,ei+72);
 let x=null;
 try{x=pipe.simulateQuality102HighVolExit({side:row.side,entryPrice,hardStop:row.hardStop,bars});}
 catch(e){
   if(String(e?.message||e)!=="QUALITY102_HV_EXIT_BARS_INSUFFICIENT_FOR_72H")throw e;
 }
 out.push({...row,entryPrice,...(x??{status:"RIGHT_CENSORED_PERIOD_END"}),sourceRuntimeSha:"ef1ab178e26a7bf5bddb6473467765edba242e1d",
   exitEvidence:"PRODUCTION_PIN_simulateQuality102HighVolExit",adoptedExitPoliciesApplied:false});
}
fs.writeFileSync(OUT,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
const sec={};
for(const bps of [10,30]){
 const vals=out.filter(x=>Number.isFinite(x.grossReturn)).map(x=>x.grossReturn-bps/10000),w=vals.filter(x=>x>0),l=vals.filter(x=>x<=0);
 const gp=w.reduce((a,b)=>a+b,0),gl=-l.reduce((a,b)=>a+b,0);
 sec[bps+"bps"]={n:vals.length,wins:w.length,winRate:w.length/vals.length,mean:vals.reduce((a,b)=>a+b,0)/vals.length,pf:gl>0?gp/gl:null};
}
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const summary={status:"Q102_HIGH_VOL_BASE_EXIT_PRODUCTION_PIN_REPLAY",signals:rows.length,exits:out.filter(x=>Number.isFinite(x.grossReturn)).length,rightCensored:out.filter(x=>!Number.isFinite(x.grossReturn)).length,
 sections:sec,exitReasons:Object.fromEntries([...new Set(out.filter(x=>x.exitReason).map(x=>x.exitReason))].map(k=>[k,out.filter(x=>x.exitReason===k).length])),
 hashes:{input:sha(IN),output:sha(OUT)},adoptedExitPoliciesApplied:false};
fs.writeFileSync(SUM,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
