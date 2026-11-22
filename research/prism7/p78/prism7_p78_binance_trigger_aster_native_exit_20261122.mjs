#!/usr/bin/env node
/* P78 research: BINANCE independent Native V20 ENTRY trigger -> ASTER native V20
 * exit + ASTER entryPrice + ASTER M5 DD. DO NOT use BINANCE exit price.
 * Compare SOURCE Aster Native53 original parity (all 53) via identical P14
 * 3 source cohort H1 evaluation contexts, before any counterfactual economics.
 * Entry trigger from P74 native Binance62 on same clock and pinned source.
 * No native Aster shortSignal required on Binance-only trigger (that's hypothesis).
 * In current research model ASTER source 1H entry OPEN is assumed fill at same
 * instant as Binance native H1 alert; transport/latency/venue orderbook, funding
 * and real Stop execution absent; stress later with +100bps cover and entry lag.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496',H=3600000;
const WORK='C:\\Users\\dis\\Documents\\DisDex_Research\\WINRATE_DEEP_20261122';
const ROOT='C:\\tmp\\disdex-bt-20251001-20261001';
const RESULT=path.join(WORK,'results');
const P74=path.join(RESULT,'PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.json');
const SOURCE=path.join(RESULT,'PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json');
const OUT=path.join(RESULT,'PRISM7_P78_BINANCE_NATIVE_ENTRY_EXECUTE_ASTER_PINNED_NATIVE_EXIT_20261122.json');
const TAPE=path.join(RESULT,'PRISM7_P78_BINANCE_ENTRY_TO_ASTER_SOURCE_NATIVE_EXIT_ALL_SIGNALS_20261122.jsonl');
const PERIODS=[
 {name:'PRE_2025_AUG_SEP',start:Date.parse('2025-08-01T00:00:00Z'),
  entryEnd:Date.parse('2025-10-01T00:00:00Z'),end:Date.parse('2025-10-01T00:00:00Z')},
 {name:'BASE_2025_2026',start:Date.parse('2025-10-01T00:00:00Z'),
  entryEnd:Date.parse('2026-10-01T00:00:00Z'),end:Date.parse('2026-10-01T00:00:00Z')},
 {name:'POST_2026_OCT_NOV',start:Date.parse('2026-10-01T00:00:00Z'),
  entryEnd:Date.parse('2026-11-18T00:00:00Z'),end:Date.parse('2026-11-18T00:00:00Z')}
];
function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex')}
function read(file){const buf=fs.readFileSync(file);
 const plain=(file.endsWith('.gz')?zlib.gunzipSync(buf):buf).toString('utf8');
 return {sha:sha(buf),rows:plain.split(/\r?\n/).filter(Boolean).map(JSON.parse)};
}
function sourceFiles(sym,period){
 const main=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
  sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
  sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,main]:
  period==='BASE_2025_2026'?[main]:[main,post];
}
function loadH1(sym,period,end){
 const rows=[],shaFiles={};
 for(const file of sourceFiles(sym,period)){
  const data=read(file);shaFiles[path.basename(file)]=data.sha;
  for(const z of data.rows){
   const t=Number(z[0]);if(t>=end)continue;
   rows.push({openTime:t,closeTime:Number(z[6]),open:Number(z[1]),
    high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),volume:Number(z[5])});
  }
 }
 for(let i=1;i<rows.length;i++)
  if(rows[i].openTime-rows[i-1].openTime!==H)
   throw Error('P78_ASTER_NATIVE_H1_GAP:'+sym+':'+period+':'+i);
 return {rows,shaFiles};
}
function pkey(z){return z.period+'|'+z.id+'|'+z.entryTs}
function penny(v){return Number(v.toFixed(9))}
function main(){
 const p74raw=fs.readFileSync(P74);
 const p74=JSON.parse(p74raw.toString('utf8'));
 const origraw=fs.readFileSync(SOURCE);
 const orig=JSON.parse(origraw.toString('utf8'));
 if(p74.nativeCodePinnedSourceSHA!==PIN || p74.sourceNativeNaturalCrossVenueCandidates!==62 ||
    !p74.sourceH1Aligned12120 || orig.length!==53 ||orig.some(z=>z.parity!=='EXACT'))
    throw Error('P78_ORIGINAL_SOURCE_OR_NATIVE_PIN_INVALID');
 const entryWindowStart=Math.min(...orig.map(z=>z.entryTs));
 const entryWindowEnd=Math.max(...orig.map(z=>z.entryTs));
 const originalMap=new Map(orig.map(z=>[pkey(z),z]));
 if(originalMap.size!==53)throw Error('P78_SOURCE53_DUPLICATE');
 const binAll=p74.sourceAllNaturalSignalLedger;
 if(binAll.length!==62)throw Error('P78_BINANCE_NATIVE62_COUNT_CHANGED');
 const all=[];
 const perPeriod={},fileSha={};let originalChecked=0,earliestMissing=0,binInputTotal=0,binCensored=0;
 for(const cohort of PERIODS){
  const ap=loadH1('PENGUUSDT',cohort.name,cohort.end);
  const ab=loadH1('BTCUSDT',cohort.name,cohort.end);
  if(ap.rows.length!==ab.rows.length || ap.rows.some((z,i)=>z.openTime!==ab.rows[i].openTime))
    throw Error('P78_ASTER_PIN_H1_NOT_ALIGNED:'+cohort.name);
  const evals=buildPenguDualLsV2EvaluationSeries({
   pengu1h:ap.rows,btc1h:ab.rows,penguFunding:[]
  },cohort.end);
  const indexes=new Map(ap.rows.map((z,i)=>[z.openTime,i]));
  if(evals.length!==ap.rows.length)throw Error('P78_NATURAL_FEATURE_LENGTH');
  const astOriginal=orig.filter(z=>z.period===cohort.name);
  let cohortParity=0;
  for(const z of astOriginal){
   const idx=indexes.get(z.entryTs);
   if(idx===undefined || idx<1 || !evals[idx-1]?.shortSignal ||
      Math.abs(ap.rows[idx].open-z.entryPrice)>1e-12)
    throw Error('P78_ORIGINAL_NATIVE_SIGNAL_PRICE_FAIL:'+pkey(z));
   const replay=replayPinnedShortExit({
    evals,penguH1:ap.rows,entryIndex:idx,entryTs:z.entryTs,
    entryPrice:z.entryPrice,requestedGross:1,exitHorizonTs:cohort.end});
   if(replay.status!=='NATIVE_EXIT_MODELED'||replay.exitTs!==z.exitTs ||
     Math.abs(replay.exitPrice-z.exitPrice)>1e-10||replay.exitReason!==z.exitReason)
    throw Error('P78_ORIGINAL_NATIVE53_EXIT_PARITY_FAILED:'+pkey(z)+
      ':'+JSON.stringify({replay,original:z}));
   cohortParity++;originalChecked++;
  }
  const binEligible=binAll.filter(z=>
    z.entryTs>=cohort.start && z.entryTs<cohort.entryEnd &&
    z.entryTs>=entryWindowStart && z.entryTs<=entryWindowEnd);
  const records=[];
  for(const z of binEligible){
   const idx=indexes.get(z.entryTs);
   if(idx===undefined || idx<1||!evals[idx-1]?.features)
    throw Error('P78_BIN_TRIGGER_ASTER_H1_ENTRY_CONTEXT_NOT_AVAILABLE:'+z.entryTs);
   if(z.nativeReplay.status!=='NATIVE_EXIT_MODELED')
    throw Error('P78_BIN_NATIVE_SOURCE_NOT_EXIT_MODELED:'+z.id);
   // Source H1 Binance native trigger was computed on the preceding complete H1;
   // execute on ASTER same UTC next-H1 OPEN; this is optimistic no-latency fill.
   const price=ap.rows[idx].open;
   const exec=replayPinnedShortExit({
    evals,penguH1:ap.rows,entryIndex:idx,entryTs:z.entryTs,
    entryPrice:price,requestedGross:1,exitHorizonTs:cohort.end});
   const onAster=astOriginal.find(x=>x.entryTs===z.entryTs);
   if(onAster){
    if(exec.status!=='NATIVE_EXIT_MODELED'||exec.exitTs!==onAster.exitTs||
       exec.exitReason!==onAster.exitReason||
       Math.abs(exec.exitPrice-onAster.exitPrice)>1e-10)
      throw Error('P78_BIN_TRIGGER_SHARED_HOUR_ASTER_NATIVE_PARITY_FAILED:'+z.id);
   }
   const closed=exec.status==='NATIVE_EXIT_MODELED';
   if(!closed)binCensored++;
   const aWin=closed?100*(1-exec.exitPrice/price)-.30>0:null;
   const binWin=z.net30pct>0;
   const row={
    binanceNativeSignalID:z.id,binanceEntryTs:z.entryTs,
    sourcePin:PIN,period:cohort.name,
    asterOriginalNativeWouldSignal:!!onAster,
    asterNative53MatchID:onAster?.id??null,
    binanceNativeEntryPrice:z.entryPrice,
    asterHypotheticalEntryPrice:price,
    binanceNativeOriginalExitTs:z.nativeReplay.exitTs,
    binanceNativeOriginalExitPrice:z.nativeReplay.exitPrice,
    binanceNativeOriginalNet30Pct:z.net30pct,
    binanceNativeOriginalWin:binWin,
    asterHypotheticalExitStatus:exec.status,
    asterHypotheticalExitTs:closed?exec.exitTs:null,
    asterHypotheticalExitPrice:closed?exec.exitPrice:null,
    asterHypotheticalNativeExitReason:closed?exec.exitReason:null,
    asterHypotheticalNativeExitPriceKind:closed?exec.exitPriceKind:null,
    asterHypotheticalNet30Pct:closed?penny(100*(1-exec.exitPrice/price)-.3):null,
    asterHypotheticalWin30Pct:aWin,
    originalSourceEntryExecutablePriceAssumedAtSameHourOpen:true,
    marketDataLatencyZeroAssumed:true,
    residentStopNativeH1PureFunctionNotActualSignedFill:true,
    binanceSourceExitPriceNEVERUsedForAsterExit:true
   };
   records.push(row);all.push(row);
  }
  binInputTotal+=binEligible.length;
  perPeriod[cohort.name]={ASTER_original_nativeSourceParityCases:cohortParity,
   binanceNativeTriggersInAsterSourceEntryWindow:binEligible.length,
   ASTER_counterfactualClosed:records.filter(z=>z.asterHypotheticalExitStatus==='NATIVE_EXIT_MODELED').length,
   ASTER_censored:records.filter(z=>z.asterHypotheticalExitStatus!=='NATIVE_EXIT_MODELED').length,
   ASTER_originalNativeOverlap:records.filter(z=>z.asterOriginalNativeWouldSignal).length,
   ASTER_sourceH1Rows:ap.rows.length,
   inputDigest:{PENGU:ap.shaFiles,BTC:ab.shaFiles}};
  fileSha[cohort.name]={PENGU:ap.shaFiles,BTC:ab.shaFiles};
  console.log('P78_PROGRESS',JSON.stringify({period:cohort.name,
    ASTERNative53ExactParity:cohortParity,binanceTriggers:binEligible.length,
    astCounterfactualClosed:perPeriod[cohort.name].ASTER_counterfactualClosed}));
 }
 if(originalChecked!==53)throw Error('P78_ORIGINAL_NATIVE53_SOURCE_PARITY_INCOMPLETE:'+originalChecked);
 if(binInputTotal<35)throw Error('P78_BINANCE_CANDIDATE_SCOPE_LOST:'+binInputTotal);
 const paired=all.filter(z=>z.asterOriginalNativeWouldSignal);
 const onlyBin=all.filter(z=>!z.asterOriginalNativeWouldSignal);
 const scoped={};
 for(const [name,c] of [['ALL',all],['SHARED_HOUR',paired],['BINANCE_ONLY_TRIGGER',onlyBin]]){
  const closed=c.filter(z=>z.asterHypotheticalExitStatus==='NATIVE_EXIT_MODELED');
  scoped[name]={count:c.length,closed:closed.length,censored:c.length-closed.length,
    asterPriceSourceWins:closed.filter(z=>z.asterHypotheticalWin30Pct).length,
    binanceNativeOriginalWins:closed.filter(z=>z.binanceNativeOriginalWin).length,
    asterPctSourceSum30:closed.reduce((s,z)=>s+z.asterHypotheticalNet30Pct,0),
    binancePctSourceSum30:closed.reduce((s,z)=>s+z.binanceNativeOriginalNet30Pct,0),
    casesBothWin:closed.filter(z=>z.asterHypotheticalWin30Pct&&z.binanceNativeOriginalWin).length,
    casesBothLoss:closed.filter(z=>!z.asterHypotheticalWin30Pct&&!z.binanceNativeOriginalWin).length,
    sourceAsterWinBinanceLoss:closed.filter(z=>z.asterHypotheticalWin30Pct&&!z.binanceNativeOriginalWin).length,
    sourceBinanceWinAsterLoss:closed.filter(z=>!z.asterHypotheticalWin30Pct&&z.binanceNativeOriginalWin).length};
 }
 const final={
  schema:'prism7-p78-binance-native-trigger-aster-execution-native-exit-source-parity/v1',
  sourcePin:PIN,originalAsterNative53Parity:'PASS_53_OF_53',
  sourceOriginalBinanceNative62PinnedAndTimeAligned:true,
  sourceCandidateSelectionMinAsterFirstNativeEntryTs:entryWindowStart,
  sourceCandidateSelectionMaxAsterLastNativeEntryTsInclusive:entryWindowEnd,
  AsterNativeExitModelOnBinanceTriggeredEntry:true,
  sourceAsterNativeEntrySignalIsNotRequiredForBinanceOnlyMode:true,
  originalAsterSharedHourExitParity:true,
  sourceBinancePriceIsNeverAsterEntryOrExitFill:true,
  priceModelSameHourASTEROpen_NoLatency:true,
  exitModelSourceH1NativePureOnly_NotSignedSTOP:true,
  sourceSourceEndCensorNotSilentlyDropped:true,
  perPeriod,scopedSignalReplayedWinStats:scoped,
  exactSourcePriceCounterfactualEvents:all,
  sourceSHA256:{P74:sha(p74raw),ASTER_Native53_original:sha(origraw),
   originalAsterH1CohortFiles:fileSha},
  limitations:[
   'Research-only; transport delay, order placement, queue, spread and maker/taker fees missing. Same-hour entry open fill is optimistic.',
   'ASTER pinned EXIT functions require Aster source H1 features. ALT Binance trigger can occur when ASTER native SHORT signal is false, intentionally.',
   'Source original ASTER Native53 pre/base/post cohort replay exact before counterfactuals; not account-level signed fills or true STOP orders.',
   'Signals with no native exit before cohort cut remain right-censored, must be excluded from economy or marked incomplete; never silently classify win/loss.',
   'Portfolio one-slot chronological admission, cross-market dual scoring, 30bps/100bps and M5 max DD are a separate Python P79 research stage.',
   'Previously inspected calendar source; not independent future out-of-sample. Production unchanged.'
  ],
  productionMasterRunnerGrossOrdersStopChanged:false
 };
 fs.writeFileSync(OUT,JSON.stringify(final,null,2)+'\n');
 fs.writeFileSync(TAPE,all.map(z=>JSON.stringify(z)).join('\n')+'\n');
 console.log('P78_BINANCE_ENTRY_ASTER_NATIVE_EXIT_53_ORIGINAL_PIN_SOURCE_PARITY_PASS',
   JSON.stringify({originalASTERParity:originalChecked,
    binanceIndependentSignalsInOriginalASTERRange:all.length,
    originalASTERequivalentNativeEntry:paired.length,
    binanceOnlyAsterNotSignaled:onlyBin.length,
    sourceCases:scoped,sourceCensored:binCensored}));
 console.log('FILES',OUT,TAPE);
}
main();
