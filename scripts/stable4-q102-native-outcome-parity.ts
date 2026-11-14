/** Offline exit/price/raw-return parity. Funding parity is a separate check. */
import {readFileSync,existsSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {modelStable4Q102Outcome} from "../lib/stable4-q102-shadow-outcome";
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001",H=3600000,M=300000;
const tape=join(root,"DIRECTION_RESEARCH_20261109/Q102_PRODUCTION_PARITY_CORRECTED_20261110/q102-production-candidates-adopted-ON.jsonl");
const raw=readFileSync(tape),rows=raw.toString("utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x));
const cache=new Map<string,any[]>();
function load(symbol:string,interval:"1h"|"5m"){
 const key=symbol+interval;if(cache.has(key))return cache.get(key)!;
 const files=interval==="5m"?[
  join(root,`aster-public-v3-5m-prefix/${symbol}-5m-20250924-20260803.jsonl.gz`),
  join(root,`aster-public-v3-5m-suffix/${symbol}-5m-20260803-20261001.jsonl.gz`),
 ]:[join(root,`aster-public-v3-h1-q102-warmup/${symbol}-1h-20250301-20261001.jsonl.gz`)];
 const map=new Map<number,any>();
 const add=(z:any)=>{const b={timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],quoteVolume:+z[7]};const prior=map.get(b.timestampMs);if(prior&&JSON.stringify(prior)!==JSON.stringify(b))throw Error("CONFLICTING_RESEARCH_BAR:"+key);map.set(b.timestampMs,b);};
 for(const file of files){if(!existsSync(file))throw Error("PARITY_SOURCE_MISSING:"+file);for(const line of gunzipSync(readFileSync(file)).toString("utf8").trim().split(/\r?\n/))if(line)add(JSON.parse(line));}
 const supplement=join(root,`Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/${symbol}-1h-20261001-20261003-supplement.json`);
 if(interval==="1h"&&existsSync(supplement))for(const z of JSON.parse(readFileSync(supplement,"utf8")))add(z);
 const result=[...map.values()].sort((a,b)=>a.timestampMs-b.timestampMs);cache.set(key,result);return result;
}
const failures:any[]=[],causalReferenceCorrections:any[]=[];
for(const row of rows){
 const now=row.exitTs+H,highVol=row.family==="HIGH_VOL";
 try{
  const out=modelStable4Q102Outcome({entryTs:row.entryTs,entryPrice:row.entryPrice,side:row.side,family:row.family,hardStop:row.hardStop,maxHoldHours:row.maxHoldHours,exitPolicy:highVol?"HIGH_VOL_TRAIL72":"FIXED_HOLD_STOP",now,
   fiveMinute:highVol?[]:load(row.symbol,"5m").filter(b=>b.timestampMs>=row.entryTs&&b.timestampMs+M<=now),
   hourly:highVol?load(row.symbol,"1h").filter(b=>b.timestampMs>=row.entryTs&&b.timestampMs+H<=now):[],
   funding:{from:row.entryTs,through:now,capturedAt:now,rows:[]}});
  const frozenTerminalTimestampDefect=createHash("sha256").update(raw).digest("hex")==="1d4ad73d9d4b668f20e77858b9a142afe74a02cb03c9cc6ea1e99104bb7ba585"
   &&row.id==="Q102HV_00019"&&row.exitReason==="72h_time"&&row.exitTs===row.entryTs+71*H
   &&out!==undefined&&out.exitTs===row.entryTs+72*H&&Math.abs(out.exitPrice-row.exitPrice)<1e-9&&Math.abs(out.rawReturn-row.rawReturn)<1e-9;
  if(frozenTerminalTimestampDefect)causalReferenceCorrections.push({id:row.id,referenceExitTs:row.exitTs,causalExitTs:out!.exitTs,reason:"Reference labels the last H1 close at its open timestamp; close becomes known one hour later. Never reproduce this look-ahead."});
  else if(!out||out.exitTs!==row.exitTs||Math.abs(out.exitPrice-row.exitPrice)>1e-9||Math.abs(out.rawReturn-row.rawReturn)>1e-9)
   failures.push({id:row.id,expected:{exitTs:row.exitTs,exitPrice:row.exitPrice,rawReturn:row.rawReturn,reason:row.exitReason},actual:out});
 }catch(error){failures.push({id:row.id,error:error instanceof Error?error.message:String(error)});}
}
console.log(JSON.stringify({status:failures.length?"NATIVE_OUTCOME_PARITY_FAILED":causalReferenceCorrections.length?"NATIVE_OUTCOME_PARITY_WITH_EXPLICIT_CAUSAL_CORRECTION":"NATIVE_OUTCOME_PARITY_PASS",source:tape,sourceSha256:createHash("sha256").update(raw).digest("hex"),samples:rows.length,exactMatches:rows.length-failures.length-causalReferenceCorrections.length,causalReferenceCorrections,failed:failures.length,fundingParityIncluded:false,firstFailures:failures.slice(0,10)},null,2));
if(failures.length)process.exitCode=1;
