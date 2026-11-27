/** Exact native Q102 causal V1 HIGH_VOL monthly observation, read-only.
 * Public Binance BTC/SOL H1 and 181d+ warmup are checked BEFORE native source.
 * This is a limited TWO-SYMBOL source path; not full 7-runner execution or BT.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const H=3_600_000;
const START=Date.UTC(2025,2,1),END=Date.UTC(2026,9,1);
const TARGET_START=Date.UTC(2025,9,1);
const PINNED={
 "lib/disdex-quality102-causal-v1-signal.ts":"ae530d14fc088b5f018495f4a17ab5615388df57",
 "lib/disdex-quality102-causal-pipeline.ts":"388054044274f34c9156a343d22a72cc611f4071",
 "lib/disdex-quality102-causal-selector.ts":"6e309f2ccc08e2a8812493be00e5b591fe6f2cff",
 "config/disdexQuality102CausalV1Runtime.ts":"f679dde1007e7aa521d7e81c82d00ca543d3b2dc",
};
type Bar={timestampMs:number;open:number;high:number;low:number;close:number;baseVolume:number;quoteVolume:number};
function audit(path:string){
 const raw=readFileSync(path);
 return {data:JSON.parse(raw.toString("utf8")) as Bar[],sha256:createHash("sha256").update(raw).digest("hex")};
}
function fail(reason:string):never{throw Error("Q102_H1_SOURCE_FAIL_CLOSED:"+reason);}
function candles(b:Bar[],symbol:string):void{
 if(!Array.isArray(b)||b.length!==(END-START)/H)fail(symbol+"_FULL_SOURCE_HISTORY_MISSING");
 for(let i=0;i<b.length;i++){
  const row=b[i];
  if(!row||row.timestampMs!==START+i*H||![row.open,row.high,row.low,row.close,row.quoteVolume].every(Number.isFinite)
      ||row.open<=0||row.low<=0||row.high<Math.max(row.open,row.close)
      ||row.low>Math.min(row.open,row.close)||row.quoteVolume<0)fail(symbol+"_SOURCE_H1_"+i);
 }
}
function gitBlobSha(raw:Buffer){
 // Compare Git's canonical tracked blob, not Windows CRLF working-tree bytes.
 // Disallow mixed/bare CR so normalization cannot conceal a corrupted file.
 const text=raw.toString("utf8");
 if(/\r(?!\n)/.test(text))fail("SOURCE_MIXED_LINE_ENDINGS");
 const blob=Buffer.from(text.replace(/\r\n/g,"\n"),"utf8");
 return createHash("sha1").update("blob "+blob.length+"\0").update(blob).digest("hex");
}
(async()=>{
 const [root,btcPath,solPath,output]=process.argv.slice(2);
 if(!root||!btcPath||!solPath||!output)fail("CLI_ARGUMENTS_REQUIRED");
 const sourcePins:Record<string,string>={};
 for(const [name,pin] of Object.entries(PINNED)){
  const digest=gitBlobSha(readFileSync(resolve(root,name)));
  if(digest!==pin)fail("SOURCE_SHA_MISMATCH:"+name);
  sourcePins[name]=digest;
 }
 const btc=audit(btcPath),sol=audit(solPath);
 candles(btc.data,"BTCUSDT");
 candles(sol.data,"SOLUSDT");
 const native=await import(pathToFileURL(resolve(root,"lib/disdex-quality102-causal-v1-signal.ts")).href);
 if(typeof native.buildQuality102CausalV1Signal!=="function")fail("SOURCE_NOT_LOADED");
 const cases=[];
 for(let year=2025;year<=2026;year++){
  for(let month=0;month<12;month++){
   const decisionTs=Date.UTC(year,month,1);
   if(decisionTs<TARGET_START||decisionTs>=END)continue;
   const k=(decisionTs-START)/H;
   if(!Number.isSafeInteger(k)||k<181*24)fail("NATIVE_WARMUP_INSUFFICIENT");
   const b=btc.data.slice(0,k),s=sol.data.slice(0,k);
   const history={candlesBySymbol:{BTCUSDT:b,SOLUSDT:s},
    entryOpenBySymbol:{BTCUSDT:{timestampMs:decisionTs,open:btc.data[k].open},
      SOLUSDT:{timestampMs:decisionTs,open:sol.data[k].open}}};
   let result;
   try{
    const nativeSignal=native.buildQuality102CausalV1Signal({history,decisionTs,
     sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}});
    if(nativeSignal.dataCutoffTs!==decisionTs-H||nativeSignal.referenceTs!==decisionTs-H)
     fail("NATIVE_CAUSAL_CUTOFF_MISMATCH");
    result={
      status:nativeSignal.side===0?"NO_SOURCE_ENTRY":"RAW_H1_SIGNAL_ONLY",
      side:nativeSignal.side,symbol:nativeSignal.symbol??null,
      family:nativeSignal.family??null,requestedGross:nativeSignal.requestedGross,
      reason:nativeSignal.reason,dataCutoffTs:nativeSignal.dataCutoffTs,
      maxHoldHours:nativeSignal.maxHoldHours??null,hardStop:nativeSignal.hardStop??null,
    };
    if(nativeSignal.side!==0 && (!nativeSignal.symbol||!nativeSignal.family||
        !Number.isFinite(nativeSignal.requestedGross)||nativeSignal.requestedGross<=0))
     fail("NATIVE_H1_SIGNAL_INVALID");
   }catch(error){
    if(String(error).includes("Q102_H1_SOURCE_FAIL_CLOSED:"))throw error;
    result={status:"BLOCKED_NATIVE_SOURCE",reason:error instanceof Error?error.message:String(error)};
   }
   cases.push({decisionTs,monthUtc:new Date(decisionTs).toISOString().slice(0,7),
    hoursOfClosedHistory:k,nativeSource:result,orderAuthority:false,venueExecutionConfirmed:false});
   console.log("NATIVE_Q102_H1",year,month+1,result.status,result.reason);
  }
 }
 if(cases.length!==12)fail("YEAR_MONTH_COVERAGE_INCOMPLETE");
 const outcome={
  schema:"stable4-q102-binance-btc-sol-real-h1-monthly-native-v1",
  status:cases.some(x=>x.nativeSource.status==="BLOCKED_NATIVE_SOURCE")?
    "NATIVE_SOURCE_CHECKPOINTS_BLOCKED_REVIEW":"LIMITED_NATIVE_H1_MONTHLY_REPLAY_PASS_NO_TRADES",
  periodUtc:["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
  inputs:{BTCUSDT:{h1:btc.data.length,sha256:btc.sha256},
    SOLUSDT:{h1:sol.data.length,sha256:sol.sha256}},
  sourcePins,cases,
  summary:{
   months:cases.length,
   rawLong:cases.filter(x=>x.nativeSource.status==="RAW_H1_SIGNAL_ONLY"&&x.nativeSource.side===1).length,
   rawShort:cases.filter(x=>x.nativeSource.status==="RAW_H1_SIGNAL_ONLY"&&x.nativeSource.side===-1).length,
   noSignal:cases.filter(x=>x.nativeSource.status==="NO_SOURCE_ENTRY").length,
   blocked:cases.filter(x=>x.nativeSource.status==="BLOCKED_NATIVE_SOURCE").length,
  },
  limitations:[
   "BTC/SOL only, not 49-candidate Q102 native source universe, not multi-strategy S34/PB/MR/BRK/REV",
   "12 monthly H1 decision clocks only, not 8760 per-hour signals or completed position lifecycle",
   "Current H1 open exposed by source API only; no exchange order, ASTER quote/lot, M5 fill, funding or signed account",
   "No portfolio Gross, cumulative DD, protected resident STOP, R21 slot or seven-runner PnL",
  ],
  sourceOnly:true,rootCertificateIssued:false,
  orderAuthority:false,portfolioReplayComplete:false,productionEligible:false,
 };
 writeFileSync(output,JSON.stringify(outcome,null,2)+"\n",{flag:"wx"});
 console.log("NATIVE_Q102_SUMMARY",JSON.stringify(outcome.summary),outcome.status);
 if(outcome.summary.blocked)process.exitCode=2;
})().catch(e=>{console.error(String(e));process.exitCode=1});
