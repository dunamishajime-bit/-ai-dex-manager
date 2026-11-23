/** Read-only native source replay. No venue client, credentials or order bridge. */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {resampleV12H1ToH2,type V12Bar} from "../lib/v12-x1-all";
import {computeNativeV4Sources} from "../lib/v12-v4-native-source";
const [dataRoot,expectedPath,outputPath]=process.argv.slice(2);
if(!dataRoot||!expectedPath||!outputPath)throw Error("USAGE DATA_ROOT EXPECTED OUTPUT");
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const hashes:Record<string,string>={};
const raw:Record<string,V12Bar[]>={};
for(const symbol of V12_X1_ALL.universe){
 const body=readFileSync(join(dataRoot,symbol+"USDT.jsonl"),"utf8");hashes[symbol]=digest(body);
 const h1=body.split(/\r?\n/).filter(Boolean).map(line=>{
  const b=JSON.parse(line);return {ts:Number(b.event_time_ms),open:Number(b.open),high:Number(b.high),
   low:Number(b.low),close:Number(b.close),volume:Number(b.base_volume),closed:true};
 });
 raw[symbol]=resampleV12H1ToH2(h1);
}
let common=new Set(raw.BTC.map(b=>b.endTs));
for(const bars of Object.values(raw)){
 const times=new Set(bars.map(b=>b.endTs));common=new Set([...common].filter(t=>times.has(t)));
}
const universe=Object.fromEntries(Object.entries(raw).map(([symbol,bars])=>[symbol,bars.filter(b=>common.has(b.endTs))]));
const body=readFileSync(expectedPath,"utf8"),expected=body.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
const start=Date.parse("2026-08-11T00:00:00Z"),end=Date.parse("2026-10-08T00:00:00Z")-74*3600000;
const expectedMap=new Map(expected.map(x=>[x.symbol+"|"+x.side+"|"+x.entry_ts_ms,x]));
const actual:any[]=[],mismatches:any[]=[],gaps:any[]=[];
let decisions=0;
for(let index=120;index<universe.BTC.length;index++){
 const now=universe.BTC[index].endTs;if(now<start||now>=end)continue;
 decisions++;
 try{
  for(const row of computeNativeV4Sources(universe,index,now)){
   const s=row.source,key=s.symbol+"|"+s.side+"|"+s.eligibleSourceEntryTs,wanted=expectedMap.get(key);
   const a={key,rank:row.rank,atr:row.atr,age:s.momentumConditionAgeHours,
    diag_ret6:s.nativeDiagnosticRet6,diag_ema:s.nativeDiagnosticEma12Atr,score:row.score,
    momentum:row.momentum,volumeRatio:row.volumeRatio,entryGateReason:row.entryGateReason};
   actual.push(a);
   if(!wanted){mismatches.push({key,reason:"UNEXPECTED_NATIVE_SOURCE"});continue;}
   expectedMap.delete(key);
   for(const field of ["rank","atr","age","diag_ret6","diag_ema","score","momentum","volumeRatio","entryGateReason"]){
    const got=a[field as keyof typeof a],ref=wanted[field];
    if(typeof got==="number"&&typeof ref==="number"?Math.abs(got-ref)>1e-10:got!==ref)
      mismatches.push({key,field,got,expected:ref});
   }
  }
 }catch(error){gaps.push({now,error:String(error)});}
}
for(const key of expectedMap.keys())mismatches.push({key,reason:"MISSING_NATIVE_SOURCE"});
const report={status:mismatches.length===0&&gaps.length===0?"PASS_NATIVE_SOURCE_REPLAY":"BLOCKED_NATIVE_SOURCE_REPLAY",
 decisions,expectedRows:expected.length,actualRows:actual.length,mismatches,gaps,
 sourceHashes:{generator:digest(readFileSync("lib/v12-v4-native-source.ts","utf8")),
  nativeLibrary:digest(readFileSync("lib/v12-x1-all.ts","utf8")),expected:digest(body),market:hashes},
 limitations:["Native baseline candidate source only; Core failed-break state machine and integrated all8 admission are separate.",
 "Previously viewed external period; no pristine prospective performance claim.",
 "No venue execution or full development inc_keys identity parity claim."],
 orderEnabled:false,tradingMutation:0,actual};
writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,decisions,expectedRows:expected.length,actualRows:actual.length,
 mismatches:mismatches.slice(0,10),gaps:gaps.slice(0,10)}));
if(report.status!=="PASS_NATIVE_SOURCE_REPLAY")process.exitCode=1;
