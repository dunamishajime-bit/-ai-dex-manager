import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const EARLY=ROOT+"/PENGU_EARLY_HOLDOUT_20250725_20250919";
const PIN=ROOT+"/pinned-source/PENGU";
const HOUR=3600000, END=Date.parse("2025-09-19T00:00:00Z");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const dual=await import(pathToFileURL(PIN+"/lib/pengu-dual-ls-v2.ts").href);

function loadH1(sym){
 const p=ROOT+"/aster-public-v3-h1-early/"+sym+"-1h-20250301-20250924.jsonl.gz";
 const gz=fs.readFileSync(p);
 const raw=zlib.gunzipSync(gz).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
 return {p,gz,rows:raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}))};
}
const P=loadH1("PENGUUSDT"),B0=loadH1("BTCUSDT");
const first=P.rows[0].openTime,last=P.rows[P.rows.length-1].openTime;
const B={...B0,rows:B0.rows.filter(x=>x.openTime>=first&&x.openTime<=last)};
if(B.rows.length!==P.rows.length)throw Error("H1_LEN");
for(let i=0;i<P.rows.length;i++)if(P.rows[i].openTime!==B.rows[i].openTime)throw Error("H1_TS_"+i);
const fundingPath=ROOT+"/aster-public-funding/PENGUUSDT-20250718-20250924.json";
const fundingRaw=fs.readFileSync(fundingPath);
const funding=JSON.parse(fundingRaw).map(x=>({fundingTime:+x.fundingTime,fundingRate:+x.fundingRate}));
const rows=dual.buildPenguDualLsV2EvaluationSeries({pengu1h:P.rows,btc1h:B.rows,penguFunding:funding},END);
const by=new Map();
for(let i=0;i<rows.length;i++)if(rows[i].features)by.set(rows[i].features.referenceTs,{row:rows[i],index:i});
const cands=fs.readFileSync(EARLY+"/native-PENGU-raw-intentions.jsonl","utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const out=[];
for(let i=0;i<cands.length;i++){
 const c=cands[i]; if(c.route!=="RECOVERY_V8")continue;
 const loc=by.get(+c.signalTs); if(!loc)throw Error("NO_FEATURE_"+i);
 const r=loc.row,rec=r.recoveryV8,v64=dual.isPenguV8V64DynamicLongSignal(rows,loc.index);
 const rr=rec?{...rec,ordinaryLongEligible:v64,baseLongSignal:v64}:undefined;
 const dec=dual.selectPenguRecoveryV8Entry(rr,true);
 if(dec?.kind!=="RECOVERY_V8"||r.shortSignal||v64)throw Error("ROUTE_REPLAY_MISMATCH_"+i);
 out.push({
   id:"EARLY_V8_"+String(out.length+1).padStart(3,"0"),signalTs:+c.signalTs,entryTs:+c.entryTs,
   pengu72h:c.pengu72h,btc24h:c.btc24h,
   rsiDelta6:rr.rsiDelta6,ema168DistancePct:rr.ema168DistancePct,btcReturn6hPct:rr.btcReturn6hPct,
   troughAgeHours:rr.troughAgeHours,recoveryCross:rr.recoveryCross
 });
}
const body=out.map(x=>JSON.stringify(x)).join("\n")+"\n";
const dest=EARLY+"/pengu-v8-entry-features-current-pin.jsonl";
fs.writeFileSync(dest,body);
console.log(JSON.stringify({n:out.length,output:dest,sha256:sha(Buffer.from(body)),
 inputs:{PENGU:sha(P.gz),BTC:sha(B0.gz),funding:sha(fundingRaw)}}));
for(const x of out)console.log(JSON.stringify(x));
