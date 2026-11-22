import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import {createHash} from "node:crypto";
import {buildPenguDualLsV2EvaluationSeries,isPenguV8V64DynamicLongSignal,selectPenguRecoveryV8Entry} from "./pengu-pin-source-1657e173/lib/pengu-dual-ls-v2";
const root=process.argv[2],oldFile=process.argv[3],outFile=process.argv[4],H=3600000;
const START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
if(!root||!oldFile||!outFile)throw Error("INPUTS_REQUIRED");
type Candle={openTime:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number};
const source:any={};
const get=(sym:string)=>{
 const map=new Map<number,Candle>(),hashes:any[]=[];
 for(const dirname of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const file of fs.readdirSync(path.join(root,dirname)).filter(x=>x.startsWith(sym+"-1h-")&&x.endsWith(".jsonl.gz"))){
   const raw=fs.readFileSync(path.join(root,dirname,file));
   hashes.push({path:dirname+"/"+file,sha256:createHash("sha256").update(raw).digest("hex")});
   for(const line of zlib.gunzipSync(raw).toString("utf8").split("\n"))if(line.trim()){
    const z=JSON.parse(line),t=Number(z[0]);
    const c:Candle={openTime:t,open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),volume:Number(z[5]),closeTime:Number(z[6])};
    if(map.has(t)&&JSON.stringify(map.get(t))!==JSON.stringify(c))throw Error("CONFLICT_DUPLICATE_1H:"+sym);
    map.set(t,c);
   }
  }
 }
 const rows=[...map.values()].sort((a,b)=>a.openTime-b.openTime);
 for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==H)throw Error("NON_HOURLY_"+sym);
 source[sym]={first:rows[0].openTime,last:rows.at(-1)!.openTime,files:hashes,count:rows.length};
 return rows;
};
const penguAll=get("PENGUUSDT"),pengu=penguAll.filter(x=>x.openTime>=Date.parse("2025-09-24T00:00:00Z")),btcFull=get("BTCUSDT");
const bmap=new Map(btcFull.map(x=>[x.openTime,x]));
const btc=pengu.map(x=>bmap.get(x.openTime));
if(btc.some(x=>!x))throw Error("BTC_H1_GAP");
const history={pengu1h:pengu,btc1h:btc as Candle[],penguFunding:[]};
const series=buildPenguDualLsV2EvaluationSeries(history,END);
const newEvents:any[]=[];
for(let i=0;i<series.length;i++){
 const r=series[i],f=r.features;if(!f||f.referenceTs<START||f.referenceTs>=END)continue;
 const short=Boolean(r.shortSignal),dynamicLong=isPenguV8V64DynamicLongSignal(series,i);
 let route="";
 if(short)route="SHORT_V20";
 else if(dynamicLong)route="LONG_V64";
 else if(r.recoveryV8) {
  const d=selectPenguRecoveryV8Entry({...r.recoveryV8,ordinaryLongEligible:dynamicLong,baseLongSignal:dynamicLong},true);
  if(d?.kind==="RECOVERY_V8")route="RECOVERY_V8";
 }
 if(route)newEvents.push({signalTs:f.referenceTs,entryTs:f.referenceTs+H,route,side:route==="SHORT_V20"?"SHORT":"LONG",symbol:"PENGUUSDT",pengu72h:f.penguReturn72h,btc24h:f.btcReturn24h});
}
const oldEvents=fs.readFileSync(oldFile,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x));
const key=(x:any)=>[x.signalTs,x.entryTs,x.route,x.side,x.symbol].join("|");
const oldKeys=new Map<string,number>(),newKeys=new Map<string,number>();
for(const x of oldEvents){const k=key(x);oldKeys.set(k,(oldKeys.get(k)||0)+1);}
for(const x of newEvents){const k=key(x);newKeys.set(k,(newKeys.get(k)||0)+1);}
const nOnly=newEvents.filter(x=>!oldKeys.has(key(x))),oOnly=oldEvents.filter(x=>!newKeys.has(key(x)));
const report={
 schema:"p107-pengu-pin-full-history-native-bulk-raw-signal-candidate-comparison/v1",
 pinnedSHA:"1657e173d250ad58f53e62f7bb0a3428fb405496",
 inputSources:source,oldTapeSHA256:createHash("sha256").update(fs.readFileSync(oldFile)).digest("hex"),
 nativeBulkHistoryBoundary:END,
 comparedAsBulkSeriesNotIndividual1000HWindows:true,legacy20250924TruncatedWarmup:true,
 dataCausalAssumption:"full-chronology batch evaluation; check per-time sliding-window identity before claiming exact production",
 oldCandidateCount:oldEvents.length,newBulkCandidateCount:newEvents.length,
 oldOnlyCount:oOnly.length,newOnlyCount:nOnly.length,
 oldOnlySamples:oOnly.slice(0,12),newOnlySamples:nOnly.slice(0,12),
 bulkNativeCandidateEvents:newEvents,
 fullProductionParity:false,venueOrdersSent:0
};
fs.writeFileSync(outFile,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({old:oldEvents.length,newBulk:newEvents.length,oldOnly:oOnly.length,newOnly:nOnly.length,oldExamples:oOnly.slice(0,3).map(x=>[x.signalTs,x.route]),newExamples:nOnly.slice(0,3)}));
