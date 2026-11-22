#!/usr/bin/env node
/* P80 M5 executed-price stress of Binance V20 trigger -> ASTER V20 native exit.
 * Uses source-pinned P14 resident STOP high-touch + native H1 state replay
 * after 0/5/15 minutes delay, all prices from ASTER printed M5 only.
 * No venue signed fills; same-bar M5 entry/exit sequencing ambiguous.
 * Gross 0.25 is NOT allowed. ASTER Native53 and BIN triggerASTER57,
 * 2 gross policies, 3 delay variants, one per pre-entry decision.
 * Original P78 pure H1 source 53 exit parity is required in input manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayP80M5DelaySourceNativeShort} from './prism7_p80_m5_delayed_aster_native_exit_core_20261122.mjs';
const WORK='C:\\Users\\dis\\Documents\\DisDex_Research\\WINRATE_DEEP_20261122';
const ROOT='C:\\tmp\\disdex-bt-20251001-20261001';
const RESULT=path.join(WORK,'results');
const INPUT=path.join(RESULT,'PRISM7_P80_AST_BIN_TRIGGER_ASOF_NO025_M5_DELAY_ENTRY_MANIFEST_20261122.json');
const OUT=path.join(RESULT,'PRISM7_P80_M5_DELAY_0_5_15_REPRICED_AST_BIN_NATIVE_STOP_20261122.json');
const LEDGER=path.join(RESULT,'PRISM7_P80_0_5_15_MIN_DELAY_ALL_ACCEPTED_0P5_0P75_GROSS_M5_PRINT_LEDGER_20261122.jsonl');
const H=3600000,M5=300000;
const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const PERIODS=[
 {name:'PRE_2025_AUG_SEP',end:Date.parse('2025-10-01T00:00:00Z')},
 {name:'BASE_2025_2026',end:Date.parse('2026-10-01T00:00:00Z')},
 {name:'POST_2026_OCT_NOV',end:Date.parse('2026-11-18T00:00:00Z')}
];
function sha(data){return crypto.createHash('sha256').update(data).digest('hex')}
function read(file){
 const data=fs.readFileSync(file);
 return {sourceSha256:sha(data),rows:(file.endsWith('.gz')?zlib.gunzipSync(data):data)
  .toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)};
}
function sourceFiles(sym,p){
 const main=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
  sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
  sym+'-1h-20261001-20261118.jsonl.gz');
 return p==='PRE_2025_AUG_SEP'?[pre,main]:p==='BASE_2025_2026'?[main]:[main,post];
}
function loadH1(sym,p,end){
 const out=[];
 const files={};
 for(const file of sourceFiles(sym,p)){
  const data=read(file);files[path.basename(file)]=data.sourceSha256;
  for(const z of data.rows){
   const t=Number(z[0]);if(t>=end)continue;
   out.push({openTime:t,closeTime:Number(z[6]),open:Number(z[1]),high:Number(z[2]),
    low:Number(z[3]),close:Number(z[4]),volume:Number(z[5])});
  }
 }
 for(let i=1;i<out.length;i++)
  if(out[i].openTime-out[i-1].openTime!==H)
   throw Error('P80_H1_SOURCE_GAP:'+sym+':'+p);
 return {candles:out,files};
}
const M5FILES=[
 path.join(WORK,'prebaseline_public_20250801_20250924','PENGUUSDT-5m-20250801-20250924.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-prefix','PENGUUSDT-5m-20250924-20260803.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-suffix','PENGUUSDT-5m-20260803-20261001.jsonl.gz'),
 path.join(WORK,'forward_public_20261001_20261118','PENGUUSDT-5m-20261001-20261118.jsonl.gz')];
function main(){
 const manifestRaw=fs.readFileSync(INPUT);
 const manifest=JSON.parse(manifestRaw.toString('utf8'));
 if(manifest.pinnedOriginalNativeSourceSHA!==PIN||
   !manifest.sourceAsterH1OpenEntryFromP78NativeParityPass||
   !manifest.gross025Excluded||manifest.all110OriginalSourceMarketEntryDecisions.length!==110)
   throw Error('P80_INPUT_MANIFEST_GROSS_NATIVE_PARITY_FAILED');
 const m5=new Map(),m5files={};
 for(const file of M5FILES){
  const loaded=read(file);
  m5files[path.basename(file)]=loaded.sourceSha256;
  for(const z of loaded.rows){
   const t=Number(z[0]);
   if(m5.has(t))throw Error('P80_M5_SOURCE_DUPLICATE:'+t);
   m5.set(t,z);
  }
 }
 const events=[],statusCounts={},delayResults=[],sourcePeriodHashes={};
 const policies=['GROSS_075','P73_CONDITIONAL_HALF_OR_SKIP'];
 const delays=[0,5,15];
 for(const period of PERIODS){
  const pen=loadH1('PENGUUSDT',period.name,period.end);
  const btc=loadH1('BTCUSDT',period.name,period.end);
  if(pen.candles.length!==btc.candles.length||
    pen.candles.some((z,i)=>z.openTime!==btc.candles[i].openTime))
     throw Error('P80_H1_AST_BTC_NO_ALIGNMENT:'+period.name);
  const evals=buildPenguDualLsV2EvaluationSeries({
    pengu1h:pen.candles,btc1h:btc.candles,penguFunding:[]},period.end);
  const indices=new Map(pen.candles.map((z,i)=>[z.openTime,i]));
  sourcePeriodHashes[period.name]={PENGU:pen.files,BTC:btc.files};
  let n=0;
  for(const src of manifest.all110OriginalSourceMarketEntryDecisions){
   if(src.period!==period.name)continue;
   const idx=indices.get(src.entryTs);
   if(idx===undefined||idx<1||!evals[idx-1]?.features)
    throw Error('P80_MISSING_ASTER_NATIVE_EXIT_ANCHOR:'+src.key);
   if(Math.abs(pen.candles[idx].open-src.sourceEntryPrice)>1e-12)
    throw Error('P80_ENTRY_SOURCE_ASTER_OPEN_NOT_EQUAL:'+src.key);
   for(const policy of policies){
    const requestedGross=src.sizePolicies[policy];
    if(requestedGross===0)continue;
    if(![.5,.75,1.0].includes(requestedGross))throw Error('P80_GROSS025_OR_UNKNOWN');
    for(const delay of delays){
     const r=replayP80M5DelaySourceNativeShort({
      evals,penguH1:pen.candles,m5,entryIndex:idx,sourceEntryTs:src.entryTs,
      sourceEntryPrice:src.sourceEntryPrice,requestedGross,
      sourceNativeExitTs:src.sourceNativeExitTs,maxExitHorizonTs:period.end,delayMinutes:delay
     });
     const closed=r.status==='PRICE_PROXY_CLOSED';
     const samebar=closed && r.observedEntryTs>=r.observedExitBarStartTs;
     if(closed && (r.observedEntryTs<src.entryTs+delay*60_000 ||
       !(r.observedEntryPrice>0) || !(r.observedExitPrice>0)))
      throw Error('P80_REPRICED_ENTRY_EXIT_SOURCE_INVALID:'+src.key);
     const entryTs=closed?r.observedEntryTs:null;
     const exitTs=closed?r.observedExitBarStartTs:null;
     events.push({
      sourceKey:src.key,source:src.source,period:src.period,
      sourceNativeIntentTs:src.entryTs,
      sourceOriginalNativeExitTs:src.sourceNativeExitTs,
      sourceOriginalNativeExitPrice:src.sourceNativeExitPrice,
      sourceOriginalNativeNet30Pct:src.sourceNativeNet30Pct,
      sourceEntryPrice:src.sourceEntryPrice,
      dualMarketMacroBull:src.dualSigned.macroBullBothBTCAndEthereum,
      dualMarketSignedScore:src.dualSigned.grossSignedScore,
      bothMarketNativeOriginalEntrySignal:src.sameHourBothOriginalSignals,
      sizePolicy:policy,gross:requestedGross,
      requestedMinimumDelayMinutes:delay,
      observedEntryDelayMinutes:r.entryDelayMinutes??null,
      status:r.status,
      ambiguousEntryAndExitWithinSameM5:samebar,
      observedEntryTs:entryTs,observedEntryPrice:closed?r.observedEntryPrice:null,
      observedExitTs:exitTs,observedExitPrice:closed?r.observedExitPrice:null,
      observedExitReason:closed?r.observedExitReason:null,
      observedExitType:closed?r.observedExitType:null,
      observedM5PositiveVolumeNativeExitRecalculated:closed,
      observedGrossProfitReturn30Pct:closed?100*(1-r.observedExitPrice/r.observedEntryPrice)-.3:null,
      signedMarketFillProven:false,
      flags:r.flags??null
     });
     const count=period.name+'|'+src.source+'|'+policy+'|'+delay+'|'+r.status;
     statusCounts[count]=(statusCounts[count]??0)+1;
     n++;
    }
   }
  }
  console.log('P80_PROGRESS',JSON.stringify({cohort:period.name,
   H1bars:pen.candles.length,modelledEvents:n,sourceM5Bars:m5.size}));
 }
 for(const src of ['ASTER_NATIVE_SOURCE','BINANCE_NATIVE_SOURCE_EXECUTE_ASTER'])
 for(const policy of policies)for(const delay of delays){
  const z=events.filter(x=>x.source===src&&x.sizePolicy===policy&&x.requestedMinimumDelayMinutes===delay);
  const valid=z.filter(x=>x.status==='PRICE_PROXY_CLOSED'&&!x.ambiguousEntryAndExitWithinSameM5);
  delayResults.push({source:src,policy,delayMinutes:delay,
   modelledEvents:z.length,validClosed:valid.length,
   rawPositiveWins:valid.filter(x=>x.observedGrossProfitReturn30Pct>0).length,
   noFillOrCensored:z.filter(x=>x.status!=='PRICE_PROXY_CLOSED').length,
   intrabarStopUncertain:z.filter(x=>x.ambiguousEntryAndExitWithinSameM5).length,
   noAverageOfMissingCandles:true});
 }
 const report={
  schema:'prism7-p80-source-native-m5-resident-stop-positiveprint-delayed-binance-entry-aster-price/v1',
  status:'RESEARCH_ONLY_M5_POSITIVE_PRINT_PROXY_WITH_DELAY_0_5_15',
  originalPinnedV20SourceSHA:PIN,
  originalASTER53_H1PinnedParityFromP78:'PASS_53_OF_53',
  P14PinnedM5NativeExitWithSameSourceH1Features:true,
  variationFromP14:'first printed ASTER M5 at or after requested delay; input policy gross used for native sizing state; finished M5 bars only for exit decision',
  sourceOriginalASTER53AndBinanceASTExecution57:true,
  sourcePinNativeHardStopPct:0.08,
  sourcePriceAtEntryASTERPositivePrintedM5Open:true,
  noGross0p25:true,
  zeroGrossInputsRejectedUpstream:true,
  delayModelsMinutes:delays,
  researchSourceStopNativeRecomputedPerDelayedEntry:true,
  sameM5EntryAndExitUnverifiableAndExcludedFromEconomics:true,
  resultStatusPerCohortAndPolicy:statusCounts,
  delaySourceCounts:delayResults,
  allModeledGrossAndDelayM5Events:events,
  sourceSHA256:{inputManifest:sha(manifestRaw),sourceM5Files:m5files,
    sourceH1InputsPerCohort:sourcePeriodHashes},
  limitations:[
   'No venue signed fill or exact trades inside M5 candle. First printed M5 OPEN after 0/5/15 minutes models latency but not exchange bid-ask spread, order queue, fill reliability.',
   'Native P14 source pure exit and resident stop M5 high-first-touch model can differ from source original H1 model even delay0, as H1/M5 price/feed mismatches exist.',
   'No confirmed actual protective order placement or cancel-replace atomic lifecycle for STOP. Stop after M5 high touch proxy can have gap/overshoot, actual realized loss may exceed stop.',
   'Ambiguous entry and exit within same M5 bar are not claimed executable; no print entries excluded from execution; results conditional on source availability.',
   'Funding, signed fills, concurrent runners, shared gross, daily loss controls and any live execution not modeled.',
   'Aster and Binance sources same previously inspected historical calendar, not unseen robust OOS.',
   'No changes to production code, Runner, STOP, orders, account, kill switch or GitHub master.'
  ]}
 fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(LEDGER,events.map(z=>JSON.stringify(z)).join('\n')+'\n');
 console.log('P80_AST_BIN_NATIVE_SOURCE_M5_PRINT_STOP_DELAY_0_5_15_REPLAY_COMPLETE',
   JSON.stringify({total:events.length,sourceM5Bars:m5.size,
    originalGrossSourceFilters:delayResults,
    sourceExceptionCounts:Object.entries(statusCounts).filter(([k,v])=>!k.endsWith('PRICE_PROXY_CLOSED'))}));
 console.log('FILES',OUT,LEDGER);
}
main();
