/** Research-only: actual native PENGU V20 timed M5 helper over source-pinned market candles.
 * This is an isolated native timed-stop evaluation; NOT native entry fill, full V20
 * H1 phase, ordinary STOP/trail, Recovery V8, or shared-wallet BT.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {advancePenguShortV20TimedStops} from "../../lib/pengu-short-v20-timed-stop";
import type {PenguDualLsV2ShortV20State} from "../../lib/pengu-dual-ls-v2";
const M=300000,START=Date.UTC(2025,9,1),END=Date.UTC(2026,9,1),H=3600000;
const [archiveRoot,outPath]=process.argv.slice(2);
if(!archiveRoot||!outPath)throw Error("REQUIRED_ARGS");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const evidencePaths={
 native:"docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json",
 quality:"docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json",
};
const evidencePins={
 native:"d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc",
 quality:"f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d",
};
const docs=Object.fromEntries(Object.entries(evidencePaths).map(([id,p])=>{
 const raw=readFileSync(p);if(sha(raw)!==evidencePins[id as keyof typeof evidencePins])throw Error("LEDGER_PIN_MISMATCH:"+id);
 return [id,JSON.parse(raw.toString("utf8"))];
}));
const native=docs.native,quality=docs.quality;
if(native.orderAuthority!==false||native.executionParityProven!==false||quality.orderAuthority!==false
 ||native.status!=="NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS"||quality.sourceH1LedgerSha256!==evidencePins.native
 ||native.arms.BASE.rawCandidates!==54||native.arms.V8_V64.rawCandidates!==112)throw Error("EVIDENCE_SCOPE");
type Bar={timestampMs:number;open:number;high:number;low:number;close:number;volume:number;trades:number};
const bars=new Map<number,Bar|null>();const files=[];
for(const file of quality.asterM5SourceFiles){
 const path=resolve(archiveRoot,file.folder,file.file),raw=readFileSync(path);
 if(sha(raw)!==file.sha256)throw Error("M5_SHA_MISMATCH:"+file.file);
 let count=0;
 for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
  const a=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume,trades]=a.slice(0,9).map(Number);
  const valid=Number.isSafeInteger(timestampMs)&&timestampMs%M===0&&closeTs===timestampMs+M-1
   &&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)
   &&Math.min(open,low,close)>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)
   &&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
  bars.set(timestampMs,bars.has(timestampMs)||!valid?null:{timestampMs,open,high,low,close,volume,trades});
  count++;
 }
 if(count!==file.rows)throw Error("M5_FILE_COUNT");
 files.push({folder:file.folder,file:file.file,sha256:file.sha256,rows:count});
}
if(bars.size!==quality.archiveClockCoverage.totalM5)throw Error("M5_COVERAGE");
const rawShorts=native.rawSignalEvents.BASE.filter((e:any)=>e.route==="SHORT_V20");
const v8Shorts=native.rawSignalEvents.V8_V64.filter((e:any)=>e.route==="SHORT_V20");
if(rawShorts.length!==41||v8Shorts.length!==41||JSON.stringify(rawShorts)!==JSON.stringify(v8Shorts))throw Error("CROSS_ARM_SHORT_LINEAGE");
const records=[];
for(const event of rawShorts){
 const entryTs=event.entryTs;
 if(!Number.isSafeInteger(entryTs)||entryTs<START||entryTs>=END||event.side!=="SHORT")throw Error("EVENT_CLOCK");
 const confirmation=bars.get(entryTs);
 const confirmed=Boolean(confirmation&&confirmation.volume>0);
 const earliestEntryTs=entryTs+M;
 const executableBar=bars.get(earliestEntryTs);
 const quoteProxy=confirmed&&executableBar&&executableBar.volume>0?executableBar.open:null;
 const observation:any={entryTs,route:"SHORT_V20",side:"SHORT",gross:event.gross,
  firstConfirmedM5PositiveVolume:confirmed,firstConfirmedM5Ts:entryTs+M,
  nextM5OpenPriceProxy:quoteProxy,modelEntryTs:earliestEntryTs,
  modelOrderAuthority:false};
 if(quoteProxy===null){observation.status=confirmed?"FOLLOWING_M5_PRICE_UNEXECUTABLE_OR_UNAVAILABLE":"FIRST_CONFIRMED_M5_NOT_POSITIVE_VOLUME";records.push(observation);continue;}
 const seq=[];
 let coverage=true,zeroVolumeStageBars=0;
 for(let t=earliestEntryTs;t<=earliestEntryTs+8*H+M;t+=M){
  const b=bars.get(t);if(!b){coverage=false;observation.gapAt=t;break;}
  if(b.volume===0)zeroVolumeStageBars++;
  seq.push({timestampMs:b.timestampMs,open:b.open,high:b.high,low:b.low,close:b.close});
 }
 observation.zeroVolumeIn8h=zeroVolumeStageBars;
 if(!coverage||seq.length<8*H/M){observation.status="M5_TIMED_CHECK_HISTORY_MISSING";records.push(observation);continue;}
 // The *actual* pure native timed-stop function only needs stage flags and prices.
 // Other V20 state fields (counterwind, ATR, probation, progression) are unknown,
 // therefore this must NEVER be interpreted as a full initialized native position.
 const stageOnly={timedStop3hChecked:false,timedStop8hChecked:false} as PenguDualLsV2ShortV20State;
 const calculated=advancePenguShortV20TimedStops({position:{entryTs:earliestEntryTs,entryPrice:quoteProxy},state:stageOnly,bars:seq});
 const acted=calculated.action;
 const barTs=acted?acted.referenceTs-M:undefined;
 const exitBar=barTs!==undefined?bars.get(barTs):undefined;
 observation.status=acted?"ISOLATED_NATIVE_TIMED_THRESHOLD_REACHED_NOT_EXECUTION":"ISOLATED_NATIVE_TIMED_THRESHOLDS_NOT_REACHED";
 observation.threshold=acted?{kind:acted.kind,referenceTs:acted.referenceTs,lossPct:acted.lossPct,
    referenceM5PositiveVolume:Boolean(exitBar&&exitBar.volume>0),
    priceProxyFromConfirmedClose:exitBar?.close??null}:null;
 observation.stage3h={checked:calculated.state.timedStop3hChecked===true,checkTs:calculated.state.timedStop3hCheckedAtTs??null,
    triggered:calculated.state.timedStop3hTriggered===true};
 observation.stage8h={checked:calculated.state.timedStop8hChecked===true,checkTs:calculated.state.timedStop8hCheckedAtTs??null,
    triggered:calculated.state.timedStop8hTriggered===true};
 records.push(observation);
}
const summary={
 rawShortV20EachArm:41,uniqueShortV20:records.length,
 firstM5Positive:records.filter(x=>x.firstConfirmedM5PositiveVolume).length,
 priceProxyAfter5m:records.filter(x=>x.nextM5OpenPriceProxy!==null).length,
 nativeTimed3hThreshold:records.filter(x=>x.threshold?.kind==="TIMED_NEGATIVE_3H_EXIT").length,
 nativeTimed8hThreshold:records.filter(x=>x.threshold?.kind==="TIMED_NEGATIVE_8H_EXIT").length,
 notTriggered:records.filter(x=>x.status==="ISOLATED_NATIVE_TIMED_THRESHOLDS_NOT_REACHED").length,
 unknownOrBlocked:records.filter(x=>!x.status.startsWith("ISOLATED_NATIVE_TIMED_")).length,
};
const sourcePaths=["scripts/research/stable4-pengu-v20-native-timed-m5-audit.ts","lib/pengu-short-v20-timed-stop.ts","lib/pengu-dual-ls-v2.ts","lib/pengu-short-v20.ts","config/penguDualLsV2Runtime.ts"];
const result={schema:"stable4-pengu-v20-native-timed-aster-m5-isolated/v1",
 status:"PARTIAL_NATIVE_TIMED_CHECK_AND_CAUSAL_M5_PRICE_PROXY_ONLY",
 inputPins:evidencePins,sourcePins:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(p))])),
 files,periodUtc:[new Date(START).toISOString(),new Date(END).toISOString()],
 separateModes:{BASE:54,V8_V64:112},summary,records,
 orderAuthority:false,fullPenguAnnualTradeReplay:false,fullSevenRunnerWalletReplay:false,
 limitations:[
 "All 41 SHORT_V20 H1 events appear in both arms and are deduplicated; raw entry signals are not trades",
 "First ASTER M5 bar has positive volume only after its close at H1 t+5m; hypothetical entry is the next M5 open (t+5m), never the same unfinished M5 open",
 "Native advancePenguShortV20TimedStops is called with stage-only state; real V20 entry ATR/counterwind/probation/progression, native H1 hard/trailed exits, resident stops and entry fills have NOT been recreated",
 "V20 stage-only check is a conditional sensitivity after a hypothetical price proxy, not validated position or executable order. M5 price and volume are not venue fill confirmations",
 "RECOVERY_V8, LONG, cooldown, fees/funding, shared account MTM, DD and Gross are untested. Do not classify this as complete PENGU lifecycle or release evidence",
 ]};
writeFileSync(outPath,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify(summary));
