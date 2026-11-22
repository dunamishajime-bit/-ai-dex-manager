import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {normalizeFetH1,buildFetBrk48Signal} from "./fet-idle-pin-source-7688ed7c/lib/fet-brk48-signal";
import {FET_BRK48_RESIDUAL} from "./fet-idle-pin-source-7688ed7c/config/fetBrk48Runtime";
const root=process.argv[2],oldPath=process.argv[3],dest=process.argv[4],H=3600000;
if(!root||!oldPath||!dest)throw Error("ARG_REQUIRED");
const marketDir=path.join(root,"binance_fet_1h_fill_20261123"),name="FETUSDT_BINANCE_WARMUP_ASTERV3_ENTRY_1H_MIXED_PROVENANCE_20261123.jsonl.gz";
if(!name)throw Error("MISSING_FET_MARKET_FILE");
const buf=fs.readFileSync(path.join(marketDir,name));
const bars=gunzipSync(buf).toString("utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x));
const tsToIdx=new Map<number,number>(bars.map((x,i)=>[Number(x[0]),i]));
const start=Date.parse("2025-10-01T00:00:00Z"),end=Date.parse("2026-10-01T00:00:00Z");
const old=fs.readFileSync(oldPath,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x));
const firstAsterTs=Date.parse("2026-01-09T18:00:00Z");
const newEvents:any[]=[],rejects:any={},seen:any[]=[];
for(let now=start;now<end;now+=H){
 if(new Date(now).getUTCHours()%FET_BRK48_RESIDUAL.decisionEntryHourModulo!==FET_BRK48_RESIDUAL.decisionEntryHourRemainder)continue;
 const idx=tsToIdx.get(now-H);
 if(idx===undefined||idx<73){rejects.NOT_AVAILABLE=(rejects.NOT_AVAILABLE||0)+1;continue;}
 const subset=bars.slice(Math.max(0,idx-200),idx+1);
 const norm=normalizeFetH1(subset,now);
 const sig=buildFetBrk48Signal(norm,now);
 if(!sig){rejects.SOURCE_NO_SIGNAL=(rejects.SOURCE_NO_SIGNAL||0)+1;continue;}
 const entry=bars[idx+1];
 if(!entry||Number(entry[0])!==now)throw Error("ENTRY_H1_NOT_FOUND");
 newEvents.push({signalTs:sig.referenceTs,entryTs:sig.entryTs,symbol:sig.symbol,side:sig.side,route:FET_BRK48_RESIDUAL.strategyId,
  referenceClose:sig.entryPrice,entryReferenceOpenPrice:Number(entry[1]),prior48hHigh:sig.prior48hHigh,volumeRatio:sig.volumeRatio,return72h:sig.return72h,
  requestedGross:FET_BRK48_RESIDUAL.maximumGross,
   marketFeedAtEntry:now<firstAsterTs?"BINANCE_FET_PRIOR_TO_FIRST_ASTER_BAR":"ASTER_PUBLIC_H1",
   priorHistoryIncludesBinance:now<firstAsterTs+201*H,
   historicalAsterExecutable:now>=firstAsterTs,
   modeledAsterFillVerified:false});
}
const key=(x:any)=>[x.signalTs,x.entryTs,x.symbol,x.side,x.route].join("|");
const oa=new Map(old.map((x:any)=>[key(x),x]));
const na=new Map(newEvents.map((x:any)=>[key(x),x]));
const missing=old.filter(x=>!na.has(key(x))),extra=newEvents.filter(x=>!oa.has(key(x)));
const deltas:any[]=[];
for(const e of newEvents){
 const o=oa.get(key(e));if(!o)continue;
 for(const col of ["referenceClose","entryReferenceOpenPrice","prior48hHigh","volumeRatio","return72h"]){
  if(Math.abs(Number(o[col])-Number(e[col]))>1e-10)deltas.push({key:key(e),col,old:o[col],new:e[col]});
 }
}
const output={schema:"p107-fet-mixed-binance-indicator-aster-venue-native-source-entry-scan/v1",pinnedSHA:"7688ed7c93a1918d8b44837339b7da5584a868f5",
 period:[start,end],originalKlineFile:name,originalKlineSha256:createHash("sha256").update(buf).digest("hex"),rawBars:bars.length,
   sourceProvenance:"BINANCE_UM_PUBLIC_ARCHIVE_BEFORE_20260109_18UTC_THEN_ASTER_PUBLIC_H1",
   firstAsterFETPublicKlineTimestamp:firstAsterTs,binanceOnlyBeforeFirstAsterSignals:newEvents.filter(x=>!x.historicalAsterExecutable).length,
   mixedWarmupAsterVenueCandidateSignals:newEvents.filter(x=>x.historicalAsterExecutable&&x.priorHistoryIncludesBinance).length,
   pureAsterVenueCandidateSignals:newEvents.filter(x=>x.historicalAsterExecutable&&!x.priorHistoryIncludesBinance).length,
   modelEntryPricesDoNotImplyAsterFills:true,
  oldCount:old.length,newNativeCount:newEvents.length,oldOnly:missing.length,newOnly:extra.length,featuresPriceMismatches:deltas.length,
  oldOnlyExamples:missing.slice(0,6),newOnlyExamples:extra.slice(0,6),featureMismatches:deltas.slice(0,6),rejects,events:newEvents,
  simulatedVenueOrders:0,actualFillEvidence:false,portfolioAdmittanceProven:false,fullP107STABLE4Parity:false};
fs.writeFileSync(dest,JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({old:old.length,native:newEvents.length,oldOnly:missing.length,newOnly:extra.length,featureDifferences:deltas.length,rejects,binanceOnly:newEvents.filter(x=>!x.historicalAsterExecutable).length,mixedWarmupAster:newEvents.filter(x=>x.historicalAsterExecutable&&x.priorHistoryIncludesBinance).length,pureAster:newEvents.filter(x=>x.historicalAsterExecutable&&!x.priorHistoryIncludesBinance).length}));
