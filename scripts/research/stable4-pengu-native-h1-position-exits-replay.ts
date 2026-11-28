/** Research-only PENGU source-native H1 position helper replay (BASE and V8/V64).
 * Uses independently refetched Binance H1/funding and ASTER M5 price proxy.
 * No actual venue account, quote, fill, signed STOP or resident lifecycle.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {buildPenguDualLsV2EvaluationSeries,evaluatePenguDualLsV2PositionBar,isPenguV8V64DynamicLongSignal,cooldownHoursForPenguExit,type PenguDualLsV2History,type PenguDualLsV2Position,type PenguDualLsV2EvaluationRow} from "../../lib/pengu-dual-ls-v2";
import {createPenguShortV20State} from "../../lib/pengu-short-v20";
import {advancePenguShortV20TimedStops} from "../../lib/pengu-short-v20-timed-stop";
import {evaluateRecoveryV8PositionBar,type RecoveryV8DurableState} from "../../lib/pengu-recovery-v8";
const H=3600000,M=300000,END=Date.UTC(2026,9,1);
const [privateRoot,archiveRoot,output]=process.argv.slice(2);
if(!privateRoot||!archiveRoot||!output)throw Error("CLI_ARGS");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const inputNames={pengu:"PENGUUSDT_H1_20250720_20261001.json",btc:"BTCUSDT_H1_20250720_20261001.json",funding:"PENGUUSDT_FUNDING_20250720_20261001.json"};
const expected={pengu:"ea5df42ad4a1d1de9cef577104138860f5fd3563b73c1a4a03cc85a09a72a0c3",btc:"3adbbf56c632ae8ffd18078ac6813905053de28a109c36e721f12e8a34ac55b3",funding:"f2220113447f695ffd40a8cd59c4428d3dc9cb9c30ee8b7e3884dd3ee279738a"};
const readPrivate=(k:keyof typeof inputNames)=>{
 const raw=readFileSync(resolve(privateRoot,inputNames[k]));
 if(sha(raw)!==expected[k])throw Error("REFETCH_SOURCE_SHA:"+k);
 return JSON.parse(raw.toString("utf8"));
};
const history:PenguDualLsV2History={pengu1h:readPrivate("pengu"),btc1h:readPrivate("btc"),penguFunding:readPrivate("funding")};
if(history.pengu1h.length!==10512||history.btc1h.length!==10512||history.penguFunding.length!==2627)throw Error("REFETCH_HISTORY_COUNT");
const originalName="docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json";
const pinnedOriginal="d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc";
const rawOriginal=readFileSync(originalName);if(sha(rawOriginal)!==pinnedOriginal)throw Error("ORIGINAL_ENTRY_PIN");
const original=JSON.parse(rawOriginal.toString("utf8"));
if(original.orderAuthority!==false||original.arms.BASE.rawCandidates!==54||original.arms.V8_V64.rawCandidates!==112)throw Error("ENTRY_REPLAY_SCOPE");
const replayName="PENGU_NATIVE_REFETCH_20261128.json";
const rawReplay=readFileSync(resolve(privateRoot,replayName)),refetched=JSON.parse(rawReplay.toString("utf8"));
if(JSON.stringify(refetched.rawSignalEvents)!==JSON.stringify(original.rawSignalEvents)||JSON.stringify(refetched.arms)!==JSON.stringify(original.arms))throw Error("REFETCH_ENTRIES_DIFFER");
const qualityRaw=readFileSync("docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json");
if(sha(qualityRaw)!=="f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d")throw Error("M5_QUALITY_PIN");
const quality=JSON.parse(qualityRaw.toString("utf8"));
type Bar={ts:number;open:number;high:number;low:number;close:number;volume:number;trades:number};
const tape=new Map<number,Bar|null>();const files=[];
for(const f of quality.asterM5SourceFiles){
 const raw=readFileSync(resolve(archiveRoot,f.folder,f.file));
 if(sha(raw)!==f.sha256)throw Error("ASTER_M5_SHA");
 let count=0;
 for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
  const b=JSON.parse(line),[ts,open,high,low,close,volume,ct,quoteVolume,trades]=b.slice(0,9).map(Number);
  const valid=Number.isSafeInteger(ts)&&ts%M===0&&ct===ts+M-1
    &&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)
    &&Math.min(open,low,close)>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)
    &&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
  tape.set(ts,tape.has(ts)||!valid?null:{ts,open,high,low,close,volume,trades});count++;
 }
 if(count!==f.rows)throw Error("M5_FILE_ROWS");files.push({folder:f.folder,file:f.file,sha256:f.sha256,rows:count});
}
if(tape.size!==107136)throw Error("M5_TOTAL");
const rows=buildPenguDualLsV2EvaluationSeries(history,history.pengu1h.at(-1)!.closeTime+1);
if(rows.length!==history.pengu1h.length)throw Error("SOURCE_H1_ROWS");
const index=new Map<number,number>();
rows.forEach((r,i)=>{if(index.has(r.candle.openTime))throw Error("SOURCE_H1_DUPLICATE");index.set(r.candle.openTime,i)});
type Candidate={barTs:number;entryTs:number;symbol:string;side:"LONG"|"SHORT";route:"LONG_V2_FINAL"|"SHORT_V20"|"RECOVERY_V8";gross:number};
const MAX_STUDY_HOURS=132;const results:Record<string,any[]>={};
for(const arm of ["BASE","V8_V64"] as const){
 results[arm]=[];
 const events=original.rawSignalEvents[arm] as Candidate[];
 for(const e of events){
  const i=index.get(e.barTs),decision=i===undefined?undefined:rows[i];
  if(!decision?.features||decision.features.referenceTs!==e.barTs||e.entryTs!==e.barTs+H||!Number.isFinite(e.gross)||e.gross<=0)throw Error("DECISION_LINEAGE");
  const first=tape.get(e.entryTs),next=tape.get(e.entryTs+M);
  const r:any={entryTs:e.entryTs,decisionBarTs:e.barTs,route:e.route,side:e.side,gross:e.gross,
    firstConfirmedM5VolumePositive:Boolean(first&&first.volume>0),
    nextM5VolumePositiveExPost:Boolean(next&&next.volume>0),
    modelExecutionTs:e.entryTs+M,actualVenueFillVerified:false};
  if(!first||first.volume<=0){r.status="FIRST_M5_CONFIRMATION_UNAVAILABLE";results[arm].push(r);continue;}
  if(!next){r.status="NEXT_M5_OPEN_UNAVAILABLE";results[arm].push(r);continue;}
  const price=next.open;r.entryPriceProxy=price;
  let state:PenguDualLsV2Position={side:e.side==="LONG"?1:-1,entryTs:e.entryTs,entryPrice:price,
    quantity:1,gross:e.gross,highWaterMark:price,lowWaterMark:price,entryVersion:e.route};
  if(e.route==="SHORT_V20"){
   state.shortV20=createPenguShortV20State({entryPrice:price,requestedGross:e.gross,
     entryAtr24Ratio:decision.features.atr24Ratio,btcEma168Distance:decision.features.btcEma168Distance,
     btcReturn24h:decision.features.btcReturn24h});
  }
  if(e.route==="RECOVERY_V8"){
   state.recoveryV8={version:"RECOVERY_V8",side:1,entryTs:e.entryTs,entryPrice:price,
     quantity:1,originalQuantity:1,originalGross:e.gross,remainingGross:e.gross,
     partialDefenseTriggered:false,highWaterMark:price,logicalEntryPrice:price,
     recoveryExecutionPrice:price,protectionLifecycle:"MANUAL_REVIEW"};
  }
  const partial:any[]=[];
  let sourceExit:any,fail:string|undefined,checks=0;
  // The entry-hour H1 body includes 5 minutes before the model fill, so
  // reject that bar for STOP decisions rather than introduce pre-entry prices.
  // Actual resident-stop protection during that partial first hour is UNKNOWN.
  for(let j=i!+2;j<rows.length&&j<=i!+MAX_STUDY_HOURS+2;j++){
   const row=rows[j],f=row.features,now=row.candle.openTime+H;
   if(now>END){fail="STUDY_END_OPEN";break;}
   if(!f||f.referenceTs!==row.candle.openTime){fail="NATIVE_H1_FEATURES_MISSING";break;}
   checks++;
   let timed:any;
   if(e.route==="SHORT_V20"&&state.shortV20&&now>=e.entryTs+3*H){
    const closed=[];
    for(let t=e.entryTs;t<now;t+=M){
     const b=tape.get(t);
     if(!b){fail="M5_TIMED_CHECK_HISTORY_MISSING";break;}
     closed.push({timestampMs:t,open:b.open,high:b.high,low:b.low,close:b.close});
    }
    if(fail)break;
    try{
     const z=advancePenguShortV20TimedStops({position:state,state:state.shortV20,bars:closed});
     state.shortV20=z.state;timed=z.action;
    }catch{fail="NATIVE_M5_TIMED_CHECK_FAILED";break;}
   }
   if(e.route==="RECOVERY_V8"){
    if(!state.recoveryV8||!row.recoveryV8){fail="NATIVE_RECOVERY_ROW_MISSING";break;}
    const v64=isPenguV8V64DynamicLongSignal(rows,j);
    const recoveryRow={...row.recoveryV8,ordinaryLongEligible:v64,baseLongSignal:v64};
    const result=evaluateRecoveryV8PositionBar(state.recoveryV8,recoveryRow);
    if(result.events.includes("PARTIAL_DEFENSE")){
     partial.push({kind:"PARTIAL_DEFENSE",referenceTs:f.referenceTs,observedAfterTs:now,
       nativePartialQuantity:result.partialQuantity??null,
       modeledInstantStateUpdateNotActualFill:true});
    }
    state={...state,quantity:result.updatedPosition.quantity,recoveryV8:{...state.recoveryV8,...result.updatedPosition}};
    if(result.kind==="NONE"||result.kind==="PARTIAL_DEFENSE")continue;
    const reason=result.kind==="HARD_STOP"?"RECOVERY_V8_HARD_STOP":result.kind==="TRAILING_STOP"?"RECOVERY_V8_TRAILING_STOP":result.kind==="MAX_HOLD"?"RECOVERY_V8_MAX_HOLD":"RECOVERY_V8_YIELD_BASE_LONG";
    sourceExit={reason,referenceTs:f.referenceTs,observedAfterTs:now,nativeStopPrice:result.stopPrice??null,sourceEvents:result.events};
   }else{
    const base=evaluatePenguDualLsV2PositionBar(state,f);
    state=base.updatedPosition;
    if(base.exit){
     sourceExit={reason:base.exit.reason,referenceTs:f.referenceTs,observedAfterTs:now,nativeStopPrice:base.exit.stopPrice??null};
    }else if(timed){
     sourceExit={reason:timed.kind==="TIMED_NEGATIVE_3H_EXIT"?"SHORT_V20_TIMED_NEGATIVE_3H_EXIT":"SHORT_V20_TIMED_NEGATIVE_8H_EXIT",
       referenceTs:f.referenceTs,observedAfterTs:now,nativeStopPrice:null,
       m5ThresholdReferenceTs:timed.referenceTs,adversePct:timed.lossPct};
    }
   }
   if(sourceExit)break;
  }
  r.partialDefenseModelEvents=partial;
  r.nativeClosedH1Checks=checks;
  if(fail){r.status=fail;results[arm].push(r);continue;}
  if(!sourceExit){r.status="NATIVE_H1_EXIT_UNRESOLVED";results[arm].push(r);continue;}
  // A source-native exit is only known after the completed Binance H1 bar.
  // The ASTER next-hour M5 open is an unconfirmed price observation, not a fill.
  const mark=tape.get(sourceExit.observedAfterTs);
  r.exit={...sourceExit,modelExitClock:sourceExit.observedAfterTs,
    asterM5OpenPriceProxy:mark?.open??null,
    asterM5VolumePositiveExPost:Boolean(mark&&mark.volume>0),
    actualReduceOnlyFillVerified:false,
    cooldownHours:cooldownHoursForPenguExit(sourceExit.reason)};
  r.status=mark?"SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":"SOURCE_EXIT_ASTER_M5_PRICE_MISSING";
  results[arm].push(r);
 }
}
const summary=Object.fromEntries(Object.entries(results).map(([arm,rs])=>{
 const status:Record<string,number>={},reason:Record<string,number>={};
 for(const r of rs){status[r.status]=(status[r.status]??0)+1;if(r.exit?.reason)reason[r.exit.reason]=(reason[r.exit.reason]??0)+1;}
 return [arm,{rawCandidates:rs.length,modelStatus:status,sourceExitReasons:reason,modeledPartialEvents:rs.reduce((n,r)=>n+(r.partialDefenseModelEvents?.length??0),0)}];
}));
const sourcePaths=["scripts/research/stable4-pengu-native-h1-position-exits-replay.ts","lib/pengu-dual-ls-v2.ts","lib/pengu-short-v20.ts","lib/pengu-short-v20-timed-stop.ts","lib/pengu-recovery-v8.ts","config/penguDualLsV2Runtime.ts","config/penguRecoveryV8.ts"];
const report={schema:"stable4-pengu-all-routes-native-h1-position-helper-replay/v1",
 status:"PARTIAL_BINANCE_NATIVE_H1_EXIT_HELPERS_ASTER_M5_PRICE_PROXY_ONLY",
 periodUtc:original.periodUtc,refetchedPrivateInputSha256:expected,refetchedNativeEntryLedgerSha256:sha(rawReplay),
 oldLedgerSha256:pinnedOriginal,qualityEvidenceSha256:sha(qualityRaw),
 sourcePins:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(p))])),
 asterm5Files:files,summary,results,
 orderAuthority:false,fullPenguAnnualTradeReplay:false,fullSevenRunnerWalletReplay:false,productionEligible:false,
 limitations:[
 "Source-native PENGU H1 exit helpers and SHORT V20 timed M5 helper on independently re-fetched Binance market history; the raw H1 event parity matches frozen ledger, but the re-fetched H1 serialized byte pins differ from original. No automatic pin replacement",
 "First ASTER confirmed M5 positive volume known only at H1 entry t+5m. Next M5 open used as observational entry-price proxy; next-bar volume is ex-post ONLY, never permission to admit at its open. No actual venue quote or filled order",
 "Entry-hour H1 body includes five minutes before model entry and is deliberately skipped for STOP modeling. Missing resident STOP/partial-hour protection and intrabar price path can materially change outcomes",
 "SOURCE H1 STOP/trailing/timed conditions may trigger at prices not executable on ASTER. Every exit uses the next-hour ASTER M5 open as a hypothetical price, not a signed reduce-only fill or resident STOP confirmation",
 "RECOVERY V8 partial-defense uses immediate hypothetical quantity updates; actual partial order/fill and protection replacement are unavailable. Native event ordering during actual runtime/quote tick and H1 candle boundaries is not certified",
 "This is isolated alternative BASE vs V8/V64 event replay; no source-valid position occupancy/cooldown across events, shared seven-runner positions, fee/funding/Gross/DD/release authorization",
 ]};
writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify(summary));
