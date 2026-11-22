import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {loadV4ClosedCandles,buildV4LiveDecisionBatch} from "./v4-pin-source-e788abc8/lib/v12-v4-live-candidate-builder";
import {V12_X1_ALL} from "./v4-pin-source-e788abc8/config/v12X1AllRuntime";
import {V12_V4_MAXIMUM_DRAWDOWN} from "./v4-pin-source-e788abc8/config/v12V4AdoptionRiskPolicy";
const H=3600000;
const base=process.argv[2],out=process.argv[3],runMode=process.argv[4]||"sample";
if(!base||!out)throw Error("MISSING_CLI");
const rawBy:Record<string,any[][]>={},shaBy:Record<string,any[]>={};
for(const symbol of V12_X1_ALL.universe){
 const files:any[]=[];
 for(const folder of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const f of fs.readdirSync(path.join(base,folder)).filter(v=>v.startsWith(symbol+"USDT-1h-")&&v.endsWith(".jsonl.gz")).sort()){
   const blob=fs.readFileSync(path.join(base,folder,f));
   files.push({path:folder+"/"+f,sha256:createHash("sha256").update(blob).digest("hex")});
   const src=gunzipSync(blob).toString("utf8");
   if(!rawBy[symbol])rawBy[symbol]=[];
   for(const line of src.split("\n"))if(line.trim())rawBy[symbol].push(JSON.parse(line));
  }
 }
 const rows=rawBy[symbol]||[];
 if(rows.length===0)throw Error("MISSING_SYMBOL:"+symbol);
 rows.sort((a,b)=>Number(a[0])-Number(b[0]));
 const unique:any[][]=[];
 for(const z of rows){
  if(unique.length&&Number(unique.at(-1)![0])===Number(z[0])){
   if(JSON.stringify(unique.at(-1))!==JSON.stringify(z))throw Error("CONFLICT_DUPLICATE:"+symbol);
   continue;
  }
  unique.push(z);
 }
 for(let i=1;i<unique.length;i++)if(Number(unique[i][0])-Number(unique[i-1][0])!==H)throw Error("V4_INPUT_NONHOURLY:"+symbol);
 rawBy[symbol]=unique;
 shaBy[symbol]=files;
}
const start=Date.parse("2025-10-01T00:00:00Z"),end=Date.parse("2026-10-01T00:00:00Z");
const grid=runMode==="sample"?[
 Date.parse("2025-10-01T00:00:00Z"),
 Date.parse("2025-10-10T12:00:00Z"),
 Date.parse("2026-08-03T00:00:00Z"),
 Date.parse("2026-09-30T22:00:00Z")
]:runMode==="pilot"?
 Array.from({length:60},(_,i)=>Date.parse("2026-08-01T00:00:00Z")+i*2*H):
 Array.from({length:(end-start)/(2*H)},(_,i)=>start+i*2*H);
async function main(){
const findings:any[]=[],counts:Record<string,number>={};
for(const now of grid){
 const mock={getKlines:async(symbol:string,interval:string,limit:number)=>{
  if(interval!=="1h"||limit!==500)throw Error("V4_NOT_EXACT_INPUT_WINDOW");
  const s=symbol.replace(/USDT$/,""),rows=rawBy[s];
  if(!rows)throw Error("UNEXPECTED_SYMBOL:"+symbol);
  // All archived ASTER H1 timestamps are strictly hourly; verify once and index causally.
  const startMs=Number(rows[0][0]),upper=Math.max(0,Math.min(rows.length,Math.floor((now-startMs)/H)));
  if(upper>0&&Number(rows[upper-1][0])+H>now)throw Error("V4_INPUT_FUTURE_BAR");
  return rows.slice(Math.max(0,upper-limit),upper);
 }};
 try{
  const candles=await loadV4ClosedCandles(mock as any,now,0);
  const snap=buildV4LiveDecisionBatch(candles,now);
  if(snap.orderEnabled||snap.realOrderEnabledV4!==0||snap.tradingMutation!==0)throw Error("V4_UNEXPECTED_ORDER_ENABLED");
  const z={decisionTs:now,decisionUtc:new Date(now).toISOString(),result:"PIN_SOURCE_NATIVE_DECISION",sourceFingerprint:snap.sourceFingerprint,sourceCount:snap.sourceCount,candidateCount:snap.candidateCount,filteredCount:snap.filteredCount,errors:snap.errors,btcRegime:snap.btcRegime,nativeCoreEvents:snap.nativeCoreEvents.length,candidates:snap.candidates.map(c=>({symbol:c.symbol,route:c.route,rank:c.rank,effectiveSide:c.effectiveSide,eligibleEntryTs:c.eligibleEntryTs}))};
  findings.push(z);counts[z.result]=(counts[z.result]||0)+1;
 }catch(e:any){
  const err=String(e?.message||e);
  findings.push({decisionTs:now,decisionUtc:new Date(now).toISOString(),result:"PIN_SOURCE_FAIL_CLOSED",reason:err});
  const label="REJECT:"+err;counts[label]=(counts[label]||0)+1;
 }
}
if(V12_V4_MAXIMUM_DRAWDOWN!==0.21)throw Error("V4_DD21_POLICY_SOURCE_CHANGED");
const output={
 schema:"p107-v4-current-pin-native-H1-closed-source-only/v1",
 pin:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
 V4MaximumDrawdownPolicy:V12_V4_MAXIMUM_DRAWDOWN,mode:runMode,
 fullAccountBT:false,noOrders:true,
 universe:[...V12_X1_ALL.universe],inputs:shaBy,
 gridTotal:grid.length,statusBreakdown:counts,
 results:findings
};
fs.writeFileSync(out,JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({mode:runMode,gridTotal:grid.length,counts,acceptedSourceCandidateCount:findings.filter(x=>x.result==="PIN_SOURCE_NATIVE_DECISION").reduce((sum,x)=>sum+x.candidateCount,0),output:out}));

}
main().catch(e=>{console.error("V4_SOURCE_NATIVE_FAILED",String(e?.message||e));process.exitCode=1;});
