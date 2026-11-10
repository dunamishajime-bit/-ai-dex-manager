import fs from "node:fs";import zlib from "node:zlib";import {pathToFileURL} from "node:url";import crypto from "node:crypto";
const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const input=ROOT+"/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/q102-high-vol-production-signals.jsonl";
const outDir=ROOT+"/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110";
const rows=fs.readFileSync(input,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const mod=await import(pathToFileURL(ROOT+"/pinned-source/Q102/lib/disdex-quality102-causal-pipeline.ts").href);
const cache={};
function bars(sym){
 if(cache[sym])return cache[sym];
 const p=ROOT+"/aster-public-v3-h1-q102-warmup/"+sym+"-1h-20250301-20261001.jsonl.gz";
 let rows=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").map(JSON.parse);
 const extraJson=ROOT+"/FORWARD_HOLDOUT_20261001_20261108/q102-highvol-h1/"+sym+"-1h-20261001-20261004.json";
 const extraGz=ROOT+"/FORWARD_HOLDOUT_20261001_20261108/aster-h1/"+sym+"-1h-20261001-20261108T20.jsonl.gz";
 if(fs.existsSync(extraJson)) rows=rows.concat(JSON.parse(fs.readFileSync(extraJson,"utf8")));
 else if(fs.existsSync(extraGz)) rows=rows.concat(zlib.gunzipSync(fs.readFileSync(extraGz)).toString("utf8").trim().split("\n").map(JSON.parse));
 const dedup=new Map();for(const x of rows)dedup.set(+x[0],x);
 const a=[...dedup.values()].sort((x,y)=>+x[0]-+y[0]).map(x=>({
  timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],quoteVolume:+x[7],baseVolume:+x[5]
 }));
 cache[sym]=a;return a;
}
const out=[];
for(const r of rows){
 const a=bars(r.symbol);const idx=a.findIndex(x=>x.timestampMs===r.entryTs);if(idx<0)throw Error("ENTRY_BAR_MISSING:"+r.id);
 const entryPrice=a[idx].open;const future=a.slice(idx,idx+72);if(future.length<72)throw Error("EXIT_BARS_SHORT:"+r.id+":"+future.length);
 const ex=mod.simulateQuality102HighVolExit({side:r.side,entryPrice,hardStop:r.hardStop,bars:future});
 out.push({...r,entryPrice,exitTs:ex.exitTs,exitPrice:ex.exitPrice,grossReturn:ex.grossReturn,holdHours:ex.holdHours,exitReason:ex.exitReason,exitPolicy:"HIGH_VOL_TRAIL72"});
}
const p=outDir+"/q102-high-vol-production-exits.jsonl";
fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
const counts={};for(const z of out)counts[z.exitReason]=(counts[z.exitReason]||0)+1;
const summary={status:"PRODUCTION_Q102_HIGH_VOL_EXIT_DIRECT_PIN",n:out.length,counts,
 inputSha256:crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex"),
 outputSha256:crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")};
fs.writeFileSync(outDir+"/HIGH_VOL_EXIT_SUMMARY.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));