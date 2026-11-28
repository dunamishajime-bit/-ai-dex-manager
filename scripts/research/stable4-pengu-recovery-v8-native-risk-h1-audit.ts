/** Offline source-native Recovery V8 RISK exit helper, with ASTER H1 OHLC price model.
 * Explicitly excludes unavailable full Binance V8 feature rows, BASE_LONG yield,
 * exchange resident STOP, actual partial-fill confirmations and shared risk.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {evaluateRecoveryV8PositionBar,type RecoveryV8Position,type RecoveryV8FeatureRow} from "../../lib/pengu-recovery-v8";
import {PENGU_RECOVERY_V8} from "../../config/penguRecoveryV8";
const H=3600000,M=300000,END=Date.UTC(2026,9,1);
const [root,out]=process.argv.slice(2);if(!root||!out)throw Error("INPUTS_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const ledgerPath="docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json",
 qualityPath="docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json",
 invPath="docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json";
const pinned={ledger:"d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc",
 quality:"f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d"};
const a=readFileSync(ledgerPath),b=readFileSync(qualityPath),invRaw=readFileSync(invPath);
if(sha(a)!==pinned.ledger||sha(b)!==pinned.quality)throw Error("RESEARCH_INPUT_SHA");
const ledger=JSON.parse(a.toString("utf8")),quality=JSON.parse(b.toString("utf8")),inventory=JSON.parse(invRaw.toString("utf8"));
if(ledger.orderAuthority!==false||quality.orderAuthority!==false||ledger.executionParityProven!==false
 ||ledger.arms.V8_V64.rawCandidates!==112||quality.sourceH1LedgerSha256!==pinned.ledger)throw Error("SCOPE");
const recovery=ledger.rawSignalEvents.V8_V64.filter((e:any)=>e.route==="RECOVERY_V8");
if(recovery.length!==48||recovery.some((e:any)=>e.side!=="LONG"))throw Error("V8_LINEAGE");
const rawH1=inventory.perTicker?.PENGU?.main;
if(!rawH1?.file||rawH1.invalidH1!==0||rawH1.rows!==8928)throw Error("H1_LINEAGE");
const h1Bytes=readFileSync(resolve(root,"aster-public-v3-h1",rawH1.file));
if(sha(h1Bytes)!==rawH1.sha256)throw Error("ASTER_H1_SHA");
type Candle={timestampMs:number;open:number;high:number;low:number;close:number;volume:number};
const h1=new Map<number,Candle>();
for(const line of gunzipSync(h1Bytes).toString("utf8").split(/\r?\n/).filter(Boolean)){
 const r=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume]=r.slice(0,8).map(Number);
 if(!Number.isSafeInteger(timestampMs)||timestampMs%H!==0||closeTs!==timestampMs+H-1
   ||[open,high,low,close,volume,quoteVolume].some(x=>!Number.isFinite(x))
   ||Math.min(open,low,close)<=0||high<Math.max(open,close)||low>Math.min(open,close)||volume<0||quoteVolume<0||h1.has(timestampMs))throw Error("H1_INVALID_OR_DUPLICATE");
 h1.set(timestampMs,{timestampMs,open,high,low,close,volume});
}
if(h1.size!==8928)throw Error("H1_COUNT");
type M5={timestampMs:number;open:number;high:number;low:number;close:number;volume:number;trades:number};
const m5=new Map<number,M5|null>();const files=[];
for(const f of quality.asterM5SourceFiles){
 const raw=readFileSync(resolve(root,f.folder,f.file));
 if(sha(raw)!==f.sha256)throw Error("ASTER_M5_SHA");
 let n=0;
 for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
  const r=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume,trades]=r.slice(0,9).map(Number);
  const valid=Number.isSafeInteger(timestampMs)&&timestampMs%M===0&&closeTs===timestampMs+M-1
   &&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)
   &&Math.min(open,low,close)>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)
   &&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
  m5.set(timestampMs,m5.has(timestampMs)||!valid?null:{timestampMs,open,high,low,close,volume,trades});n++;
 }
 if(n!==f.rows)throw Error("M5_ROWS");
 files.push({folder:f.folder,file:f.file,sha256:f.sha256,rows:n});
}
if(m5.size!==quality.archiveClockCoverage.totalM5)throw Error("M5_TOTAL");
const outcomes=[];
for(const e of recovery){
 const first=m5.get(e.entryTs),next=m5.get(e.entryTs+M);
 const item:any={signalTs:e.barTs,originalEntryTs:e.entryTs,route:e.route,
   firstM5ConfirmedPositiveVolume:Boolean(first&&first.volume>0),
   followingM5PositiveVolumeExPost:Boolean(next&&next.volume>0),
   modelEntryTs:e.entryTs+M,orderAuthority:false};
 if(!first||first.volume<=0){item.status="FIRST_M5_CONFIRMATION_UNAVAILABLE";outcomes.push(item);continue;}
 if(!next){item.status="NEXT_M5_OPEN_PRICE_MISSING";outcomes.push(item);continue;}
 const entryPrice=next.open;item.entryPriceProxy=entryPrice;
 // Preserve actual V8 entry state geometry while retaining the source-lineage
 // requested gross. All quantity/partial/STOP executions remain hypothetical.
 let position:RecoveryV8Position={side:1,entryTs:e.entryTs+M,entryPrice,logicalEntryPrice:entryPrice,
   quantity:1,originalGross:e.gross,remainingGross:e.gross,partialDefenseTriggered:false,highWaterMark:entryPrice};
 const events:any[]=[];
 let lastReason:string|undefined,exitPriceProxy:number|undefined,unresolved:string|undefined;
 for(let t=e.entryTs+H;t<=e.entryTs+(PENGU_RECOVERY_V8.exit.maxHoldHours+2)*H;t+=H){
  if(t>=END){unresolved="STUDY_BOUNDARY";break;}
  const bar=h1.get(t);if(!bar){unresolved="ASTER_H1_EXIT_BAR_MISSING";break;}
  // SOURCE HELPER uses only referenceTs/high/low/baseLongSignal. BASE_LONG
  // yield is deliberately withheld: its complete Binance H1 row is unavailable.
  // This is therefore a RISK-ONLY sensitivity, never a complete V8 exit.
  const limited={referenceTs:t,high:bar.high,low:bar.low,baseLongSignal:false} as RecoveryV8FeatureRow;
  const native=evaluateRecoveryV8PositionBar(position,limited);
  if(native.events.includes("PARTIAL_DEFENSE")){
   events.push({kind:"PARTIAL_DEFENSE",decisionOpenTs:t,observedAfterTs:t+H,
    stopPrice:native.triggerPrice??null,volumePositive:bar.volume>0,
    quantityModel:native.partialQuantity??null,requiresActualPartialFill:true});
  }
  if(native.kind!=="NONE"&&native.kind!=="PARTIAL_DEFENSE"){
   lastReason=native.kind;exitPriceProxy=native.stopPrice??bar.close;
   events.push({kind:native.kind,decisionOpenTs:t,observedAfterTs:t+H,
    stopPrice:native.stopPrice??null,exitPriceProxy,volumePositive:bar.volume>0,
    sourceEvents:native.events,actualVenueFillVerified:false});break;
  }
  position=native.updatedPosition;
 }
 item.events=events;
 item.status=unresolved?unresolved:lastReason?"MODELED_SOURCE_NATIVE_RISK_EXIT_NOT_FILL":"UNRESOLVED_MODEL";
 item.exitReason=lastReason??null;
 item.exitPriceProxy=exitPriceProxy??null;
 item.modeledPartial=events.some(x=>x.kind==="PARTIAL_DEFENSE");
 item.yieldBaseLongNotReplayed=true;
 outcomes.push(item);
}
const stats:Record<string,number>={},reasons:Record<string,number>={};
for(const o of outcomes){stats[o.status]=(stats[o.status]??0)+1;if(o.exitReason)reasons[o.exitReason]=(reasons[o.exitReason]??0)+1;}
const sourcePaths=["scripts/research/stable4-pengu-recovery-v8-native-risk-h1-audit.ts","lib/pengu-recovery-v8.ts","config/penguRecoveryV8.ts","lib/pengu-dual-ls-v2.ts"];
const report={schema:"stable4-pengu-recovery-v8-native-risk-h1-observations/v1",
 status:"SOURCE_HELPER_RISK_EXIT_ONLY_NO_ACTUAL_FILL_OR_YIELD",
 inputPins:{...pinned,inventorySha256:sha(invRaw)},sourcePins:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(p))])),
 h1:{folder:"aster-public-v3-h1",file:rawH1.file,sha256:rawH1.sha256,rows:h1.size},m5Files:files,
 summary:{recoveryRawH1Candidates:48,modelStatus:stats,modeledExitReasons:reasons,modeledPartialCandidates:outcomes.filter(o=>o.modeledPartial).length},
 outcomes,orderAuthority:false,fullPenguAnnualTradeReplay:false,fullSevenRunnerWalletReplay:false,
 limitations:[
 "Source-native evaluateRecoveryV8PositionBar helper, but price input is ASTER closed H1 bars, whereas Binance H1 authored the source entry; no actual ASTER fill, protected STOP or cross-venue quote parity",
 "First positive ASTER 5m volume observed at t+5m. Next bar's open price is only a proxy at t+5m. Its future volume is recorded separately and is NEVER used for entry admission",
 "Risk-only isolated model, BASE_LONG yield disabled because complete Binance-native contemporaneous features and V8 yield precedence are not reconstructed. Exit outcomes can change materially if yield is restored",
 "No first partial-hour STOP fill proof, no intrabar H1 event ordering or guaranteed liquidity, and partial defense is modeled with instant quantity change without actual reduce-only fill",
 "No signed venue order lifecycle, no cooling or overlapping-slot replay, fees/funding, all-runner DD, gross, CI release certificate or Owner approval",
 ]};
writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify(report.summary));
