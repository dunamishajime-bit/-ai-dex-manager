import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {buildPenguDualLsV2Signal} from "./pengu-pin-source-1657e173/lib/pengu-dual-ls-v2";
import {PENGU_DUAL_LS_V2} from "./pengu-pin-source-1657e173/config/penguDualLsV2Runtime";
const root=process.argv[2],old=process.argv[3],out=process.argv[4],completedLookback=Number(process.argv[5]||1000),H=3600000;
if(!root||!old||!out||![999,1000].includes(completedLookback))throw Error("INVALID_INPUT");
const START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
type C={openTime:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number};
const load=(symbol:string)=>{
 const map=new Map<number,C>(),files:any[]=[];
 for(const folder of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const file of fs.readdirSync(path.join(root,folder)).filter(f=>f.startsWith(symbol+"-1h-")&&f.endsWith(".jsonl.gz"))){
   const buff=fs.readFileSync(path.join(root,folder,file));
   files.push({path:folder+"/"+file,sha256:createHash("sha256").update(buff).digest("hex")});
   for(const line of gunzipSync(buff).toString("utf8").split("\n"))if(line.trim()){
    const z=JSON.parse(line),t=Number(z[0]);
    map.set(t,{openTime:t,open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),volume:Number(z[5]),closeTime:Number(z[6])});
   }
  }
 }
 const rows=[...map.values()].sort((a,b)=>a.openTime-b.openTime);
 for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==H)throw Error("HOURLY_GAP:"+symbol);
 return{rows,files};
};
const pengu=load("PENGUUSDT"),btc=load("BTCUSDT");
const btcByTs=new Map(btc.rows.map(x=>[x.openTime,x]));
const alignedBTC=pengu.rows.map(x=>btcByTs.get(x.openTime));
if(alignedBTC.some(x=>!x))throw Error("BTC_NOT_ALIGNED");
const idx=new Map(pengu.rows.map((x,i)=>[x.openTime,i]));
const oldEvents=fs.readFileSync(old,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));
const candidateEvents:any[]=[],caught:any[]=[],counts:Record<string,number>={};
let assessed=0;
for(let now=START+H;now<END;now+=H){
 const i=idx.get(now-H);
 if(i===undefined||i+1<completedLookback){counts.INSUFFICIENT_H1=(counts.INSUFFICIENT_H1||0)+1;continue;}
 const p=pengu.rows.slice(i-completedLookback+1,i+1),b=alignedBTC.slice(i-completedLookback+1,i+1) as C[];
 if(p.at(-1)!.closeTime>=now||b.at(-1)!.closeTime>=now)throw Error("CAUSAL_FUTURE_BAR");
 assessed++;
 let sig:any;
 try{sig=buildPenguDualLsV2Signal({pengu1h:p,btc1h:b,penguFunding:[]},undefined,now,0,{recoveryV8Enabled:true,v64DynamicLongEnabled:true});}
 catch(e:any){
  caught.push({time:now,error:String(e?.message||e)});
  continue;
 }
 const route=sig.side===-1?"SHORT_V20":sig.side===1?(sig.entryVersion==="RECOVERY_V8"?"RECOVERY_V8":"LONG_V64"):"NONE";
 counts[route]=(counts[route]||0)+1;
 if(sig.side!==0){
  if(sig.entryTs!==now)throw Error("NEXT_BAR_ENTRY_TIMING_MISMATCH");
  if(sig.referenceTs!==now-H)throw Error("REFERENCE_TS_MISMATCH");
  const open=pengu.rows[i+1]?.open;
  if(!Number.isFinite(open)||open<=0)throw Error("MISSING_NEXT_ENTRY_OPEN");
  candidateEvents.push({signalTs:sig.referenceTs,entryTs:sig.entryTs,route,side:sig.side===-1?"SHORT":"LONG",symbol:"PENGUUSDT",
   nextOpenPrice:open,requestedGross:sig.targetGross,features:{pengu72h:sig.features?.penguReturn72h,btc24h:sig.features?.btcReturn24h},entryVersion:sig.entryVersion});
 }
 if(assessed%1000===0)console.log("ASOF_PROGRESS",completedLookback,assessed);
}
const key=(e:any)=>[e.signalTs,e.entryTs,e.route,e.side,e.symbol].join("|");
const existing=new Map(oldEvents.map((x:any)=>[key(x),x]));
const actualKeys=new Set(candidateEvents.map(key));
const extra=candidateEvents.filter(x=>!existing.has(key(x)));
const missing=oldEvents.filter(x=>!actualKeys.has(key(x)));
const outData={
 schema:"p107-pengu-full-year-exact-pinned-1000h-snapshot-raw-signal-compared/v1",
 currentPIN:"1657e173d250ad58f53e62f7bb0a3428fb405496",
 completedLookback,asofInputAssumption:"last N fully closed ASTER H1 bars, not an exchange-real-time signed inventory",
 period:[START,END],hoursAssessed:assessed,decisionBreakdown:counts,sourceExceptions:caught,
 oldCandidateCount:oldEvents.length,currentCandidateCount:candidateEvents.length,
 oldMatched:oldEvents.length-missing.length,
 additionalCandidateCount:extra.length,missingOldCandidateCount:missing.length,additionalCandidates:extra,missingOldSamples:missing.slice(0,15),
 inputOriginalSHA256:{pengu:pengu.files,btc:btc.files},
 candidates:candidateEvents,
 noActualVenueOrders:true,portfolioOrderAdmittanceProven:false,fullP107STABLE4Parity:false
};
fs.writeFileSync(out,JSON.stringify(outData,null,2)+"\n");
console.log("ASOF_COMPLETE",JSON.stringify({lookback:completedLookback,assessed,old:oldEvents.length,current:candidateEvents.length,additional:extra.length,oldMissing:missing.length,errors:caught.length,byRoute:counts,extras:extra.slice(0,5)}));
