/** Offline isolated native LONG_V2_FINAL H1 exit branch with ASTER H1 OHLC.
 * Binance source signal timing is pinned, but ASTER H1 bars are proxy marks,
 * not the complete native Binance history or actual venue fills/stops.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {evaluatePenguDualLsV2PositionBar,type PenguDualLsV2Features,type PenguDualLsV2Position} from "../../lib/pengu-dual-ls-v2";
const H=3600000,M=300000,END=Date.UTC(2026,9,1);
const [root,out]=process.argv.slice(2);if(!root||!out)throw Error("REQUIRED_ARGUMENTS");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const lp="docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json";
const qp="docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json";
const ip="docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json";
const pins={ledger:"d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc",
 quality:"f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d"};
const a=readFileSync(lp),b=readFileSync(qp),c=readFileSync(ip);
if(sha(a)!==pins.ledger||sha(b)!==pins.quality)throw Error("SOURCE_EVIDENCE_MISMATCH");
const ledger=JSON.parse(a.toString("utf8")),quality=JSON.parse(b.toString("utf8")),inventory=JSON.parse(c.toString("utf8"));
if(ledger.orderAuthority!==false||quality.orderAuthority!==false||ledger.executionParityProven!==false
||quality.sourceH1LedgerSha256!==pins.ledger)throw Error("SCOPE");
const base=ledger.rawSignalEvents.BASE.filter((e:any)=>e.route==="LONG_V2_FINAL");
const ext=ledger.rawSignalEvents.V8_V64.filter((e:any)=>e.route==="LONG_V2_FINAL");
if(base.length!==13||ext.length!==23||base.some((e:any)=>!ext.some((x:any)=>x.entryTs===e.entryTs&&x.side===e.side)))throw Error("LINEAGE");
const meta=inventory.perTicker?.PENGU?.main;
if(!meta?.file||meta.invalidH1!==0||meta.rows!==8928)throw Error("ASTER_H1_METADATA");
const h1Raw=readFileSync(resolve(root,"aster-public-v3-h1",meta.file));
if(sha(h1Raw)!==meta.sha256)throw Error("H1_SHA_MISMATCH");
type H1={timestampMs:number;open:number;high:number;low:number;close:number;volume:number};
const h1=new Map<number,H1>();
for(const line of gunzipSync(h1Raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
 const r=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume]=r.slice(0,8).map(Number);
 if(!Number.isSafeInteger(timestampMs)||timestampMs%H!==0||closeTs!==timestampMs+H-1
  ||[open,high,low,close,volume,quoteVolume].some(x=>!Number.isFinite(x))
  ||Math.min(open,low,close)<=0||high<Math.max(open,close)||low>Math.min(open,close)
  ||volume<0||quoteVolume<0||h1.has(timestampMs))throw Error("H1_CANDLE_INVALID");
 h1.set(timestampMs,{timestampMs,open,high,low,close,volume});
}
if(h1.size!==8928)throw Error("H1_ROWS");
type M5={timestampMs:number;open:number;high:number;low:number;close:number;volume:number};
const m5=new Map<number,M5|null>(),m5Files=[];
for(const f of quality.asterM5SourceFiles){
 const raw=readFileSync(resolve(root,f.folder,f.file));if(sha(raw)!==f.sha256)throw Error("M5_SHA");
 let n=0;
 for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
  const x=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume,trades]=x.slice(0,9).map(Number);
  const ok=Number.isSafeInteger(timestampMs)&&timestampMs%M===0&&closeTs===timestampMs+M-1
   &&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)
   &&Math.min(open,low,close)>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)
   &&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
  m5.set(timestampMs,m5.has(timestampMs)||!ok?null:{timestampMs,open,high,low,close,volume});n++;
 }
 if(n!==f.rows)throw Error("M5_FILE_ROWS");
 m5Files.push({folder:f.folder,file:f.file,sha256:f.sha256,rows:n});
}
if(m5.size!==quality.archiveClockCoverage.totalM5)throw Error("M5_TOTAL");
const outcomes=[];
for(const e of ext){
 if(e.side!=="LONG"||e.route!=="LONG_V2_FINAL")throw Error("SOURCE_ENTRY_SIDE");
 const first=m5.get(e.entryTs),next=m5.get(e.entryTs+M);
 const item:any={sourceDecisionTs:e.barTs,sourceEntryTs:e.entryTs,
  firstM5ConfirmedPositiveVolume:Boolean(first&&first.volume>0),
  nextM5PositiveVolumeExPost:Boolean(next&&next.volume>0),
  modelEntryTs:e.entryTs+M,orderAuthority:false};
 if(!first||first.volume<=0){item.status="FIRST_M5_CONFIRMATION_UNAVAILABLE";outcomes.push(item);continue;}
 if(!next){item.status="NEXT_M5_OPEN_PRICE_UNAVAILABLE";outcomes.push(item);continue;}
 const price=next.open;
 item.entryPriceProxy=price;
 let pos:PenguDualLsV2Position={side:1,entryTs:e.entryTs+M,entryPrice:price,
  quantity:1,gross:e.gross,highWaterMark:price,lowWaterMark:price,entryVersion:"LONG_V2_FINAL"};
 let exit:any=null,unresolved:string|undefined;
 for(let t=e.entryTs+H;t<=e.entryTs+122*H;t+=H){
  if(t>=END){unresolved="STUDY_END_OPEN_MODEL";break;}
  const bar=h1.get(t);if(!bar){unresolved="H1_EXIT_MARK_UNAVAILABLE";break;}
  // Only these three fields are consumed by LONG_V2_FINAL native EXIT branch.
  // The complete Binance-native feature set is unavailable in this replay.
  const limited={referenceTs:t,high:bar.high,low:bar.low} as PenguDualLsV2Features;
  const action=evaluatePenguDualLsV2PositionBar(pos,limited);
  if(action.exit){
   exit={kind:action.exit.reason,referenceTs:t,observedAfterTs:t+H,
    stopPrice:action.exit.stopPrice??null,
    modeledExitPrice:action.exit.stopPrice??bar.close,
    h1PositiveVolumeExPost:bar.volume>0,venueFillVerified:false};
   break;
  }
  pos=action.updatedPosition;
 }
 item.status=unresolved??(exit?"ISOLATED_NATIVE_LONG_RISK_EXIT_NOT_FILL":"UNRESOLVED_EXIT");
 item.exit=exit;
 outcomes.push(item);
}
const statuses:Record<string,number>={},reasons:Record<string,number>={};
for(const o of outcomes){statuses[o.status]=(statuses[o.status]??0)+1;if(o.exit?.kind)reasons[o.exit.kind]=(reasons[o.exit.kind]??0)+1;}
const sourcePaths=["scripts/research/stable4-pengu-long-native-h1-risk-audit.ts","lib/pengu-dual-ls-v2.ts","config/penguDualLsV2Runtime.ts"];
const report={schema:"stable4-pengu-long-source-native-h1-exit-observations/v1",
 status:"ISOLATED_LONG_H1_NATIVE_EXIT_ONLY_NOT_VENUE_FILL",
 inputPins:{...pins,inventorySha256:sha(c)},sourcePins:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(p))])),
 files:{h1:{folder:"aster-public-v3-h1",file:meta.file,sha256:meta.sha256,rows:h1.size},m5:m5Files},
 summary:{rawLongBase:13,rawLongV8V64:23,modelStatus:statuses,modeledExitReasons:reasons},outcomes,
 orderAuthority:false,fullPenguAnnualTradeReplay:false,fullSevenRunnerWalletReplay:false,
 limitations:[
 "Direct evaluatePenguDualLsV2PositionBar native LONG_V2_FINAL exit branch only, driven by ASTER source-verified H1 OHLC price bars instead of Binance source-native H1 risk features. Not full source feed parity or runner lifecycle",
 "The first M5 confirms after t+5m and next M5 open at t+5m is a hypothetical price. Future next-bar volume is recorded ex-post, not an entry permission condition; actual venue quote/lot/order/fill is missing",
 "No first partial-hour M5-resident STOP lifecycle, intrabar ordering, actual venue STOP, or known-gap execution price, and max-hold uses H1 finished bar close as proxy",
 "No source position priority, interleaved SHORT/RECOVERY, cooldown, funding, account Gross/DD or owner certificate",
 ]};
writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify(report.summary));
