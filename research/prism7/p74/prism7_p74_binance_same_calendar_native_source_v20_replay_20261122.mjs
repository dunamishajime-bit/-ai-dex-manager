#!/usr/bin/env node
/* P74: SAME CALENDAR BINANCE USD-M independent Native V20 signal/exits for P73 no025 transfer.
 * Do not misrepresent as Aster production native price-source parity.
 * All December 2024-July 2025 Binance Futures USD-M H1 input zipped and SHA256 verified.
 * Native source and stop/exit functions imported UNMODIFIED from P8 harness.
 * Frozen P44 gate defined before reading this earlier external dataset.
 * Research only. No real fill, funding, shared gross/STOP account parity.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';
const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const H=3600000;
const ROOT='C:\\Users\\dis\\Documents\\DisDex_Research\\WINRATE_DEEP_20261122';
const SRC=path.join(ROOT,'p70_binance_same_aster_period_202507_202611','verified_series');
const RESULT=path.join(ROOT,'results');
const INPUT=path.join(RESULT,'PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json');
const ENTRY_START=Date.parse('2025-08-01T00:00:00Z');
const ENTRY_END=Date.parse('2026-11-14T00:00:00Z');
const DATA_END=Date.parse('2026-11-18T00:00:00Z');
const LIMITS=[["ORIGINAL_PINNED_NATIVE_SOURCE_ALL",null,null],["P44_FROZEN_D3_PRIOR48H_ALL3",3,48],["D3_PRIOR24H_ALL3_SENSITIVITY",3,24],["D3_PRIOR72H_ALL3_SENSITIVITY",3,72],["D5_PRIOR48H_ALL3_SENSITIVITY",5,48]];
function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex')}
function v(x,n=6){return Math.round(x*10**n)/10**n}
function load(sym){
 const file=path.join(SRC,sym+'-1h-20250701-20261118-FUTURES_UM_VERIFIED.jsonl.gz');
 const bs=fs.readFileSync(file);
 const rows=zlib.gunzipSync(bs).toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
 if(rows.length!==12120)throw Error('P61_NONCONTIGUOUS_SOURCE:'+sym+':'+rows.length);
 const out=rows.map(x=>({openTime:Number(x[0]),open:Number(x[1]),high:Number(x[2]),
  low:Number(x[3]),close:Number(x[4]),volume:Number(x[5]),closeTime:Number(x[6])}));
 for(let i=1;i<out.length;i++)if(out[i].openTime-out[i-1].openTime!==H)throw Error('P61_H1_TIME_GAP:'+sym);
 for(const x of out)if(!(x.low>0&&x.low<=Math.min(x.open,x.close)&&x.high>=Math.max(x.open,x.close)&&x.volume>=0))throw Error('P61_INVALID_CANDLE:'+sym);
 return {sym,shaGzip:sha(bs),rows:out};
}
function ema(rows,n){
 const alpha=2/(n+1),out=[];let value=null;
 for(const z of rows){value=value===null?z.close:value*(1-alpha)+z.close*alpha;out.push(value)}
 return out;
}
function cross(p,b,pe72,pe168,idx,pct){
 const ret=p[idx].close/p[idx-24].close-1;
 const prev=p[idx-1].close/p[idx-25].close-1;
 if(!(prev>-pct/100&&ret<=-pct/100))return null;
 const k=idx-1;
 const peng24=p[k].close/p[k-24].close-1;
 const btc24=b[k].close/b[k-24].close-1;
 const flags={
  btcBear:btc24<=0,
  relativeWeak:peng24-btc24<=-.01,
  emaBear:pe72[k]<pe168[k]&&p[k].close<pe72[k]
 };
 return {signalH1OpenTs:p[idx].openTime,triggerAvailableAt:p[idx].openTime+H,
  signalPreconditionsReferenceH1OpenTs:p[k].openTime,
  priorBTC24Pct:v(100*btc24),priorPENGUMinusBTC24Pct:v(100*(peng24-btc24)),
  flags:flags,all3:Object.values(flags).every(Boolean),
  futurePriceUsedToChooseFlags:false};
}
function slot(source){
 const sorted=[...source].sort((a,b)=>a.entryTs-b.entryTs);
 let busy=-1;const selected=[];const blocked=[];
 for(const z of sorted){
  if(z.entryTs<busy){blocked.push(z.id);continue}
  if(z.nativeReplay.status!=='NATIVE_EXIT_MODELED')continue;
  selected.push(z);busy=z.nativeReplay.exitTs+300000;
 }
 return {selected,blocked};
}
function payoff(source,slip){
 const all=source.filter(x=>x.net30pct!==null);
 let nav=10000,peak=10000,dd=0,wins=0,gain=0,loss=0;
 for(const x of all.sort((a,b)=>a.entryTs-b.entryTs)){
  const penalty=slip/100;
  const net=100*(1-x.nativeReplay.exitPrice*(1+slip/10000)/x.entryPrice)-.30;
  const ret=.75*net/100;
  nav*=1+ret;
  if(net>0){wins++;gain+=net}else loss+=-net;
  peak=Math.max(peak,nav);dd=Math.max(dd,100*(1-nav/peak));
 }
 return {trades:all.length,wins:wins,winPct:all.length?v(100*wins/all.length):null,
  realizedOnlyDDPct:v(dd),finalNavYen:v(nav,2),profitFactor:loss? v(gain/loss):null,
  notM5HighDDAndNotActualAccount:true};
}
function sourceStats(cases){
 const c=cases.filter(x=>x.nativeReplay.status==='NATIVE_EXIT_MODELED');
 const n=c.length,w=c.filter(x=>x.net30pct>0).length;
 const net=c.reduce((a,x)=>a+x.net30pct,0);
 return {naturalIntents:cases.length,closed:n,wins:w,losses:n-w,
  winPct:n?v(100*w/n):null,sourceNet30NotionalPoints:v(net),
  sumSourceAbsoluteNet30Pct:v(net),rightCensored:cases.length-n};
}
function main(){
 const manifest=JSON.parse(fs.readFileSync(INPUT,'utf8'));
 if(!manifest.checksumsIndividuallyVerified||!manifest.sourceSeriesExactlyTimeAligned||manifest.officialArchiveCount!==165)throw Error('P74_SOURCE_INTEGRITY_NOT_PASS');
 const pengu=load('PENGUUSDT'),btc=load('BTCUSDT');
 if(manifest.sourceSeries['PENGUUSDT|1h'].sha256Gzip!==pengu.shaGzip||
    manifest.sourceSeries['BTCUSDT|1h'].sha256Gzip!==btc.shaGzip)throw Error('P61_MANIFEST_SOURCE_SHA_MISMATCH');
 const p=pengu.rows,b=btc.rows;
 if(p.length!==b.length||p.some((x,i)=>x.openTime!==b[i].openTime))throw Error('P61_SOURCE_H1_ALIGNMENT_FAILED');
 const evals=buildPenguDualLsV2EvaluationSeries({pengu1h:p,btc1h:b,penguFunding:[]},DATA_END);
 if(evals.length!==p.length)throw Error('P74_NATIVE_SOURCE_EVAL_LENGTH_DRIFT');
 const e72=ema(p,72),e168=ema(p,168);
 const d3=[],d5=[];
 for(let i=181;i<p.length-1;i++){
  const a=cross(p,b,e72,e168,i,3);if(a)d3.push(a);
  const c=cross(p,b,e72,e168,i,5);if(c)d5.push(c);
 }
 const signals=[];
 for(let i=180;i<evals.length-1;i++){
  const x=evals[i];
  if(!x.features||!x.shortSignal)continue;
  const intent=x.features.referenceTs+H;
  if(intent<ENTRY_START||intent>=ENTRY_END)continue;
  if(p[i+1].openTime!==intent)throw Error('P61_PINNED_ENTRY_NEXT_H1_SOURCE_MISMATCH');
  const entryPrice=p[i+1].open;
  const replay=replayPinnedShortExit({evals,penguH1:p,entryIndex:i+1,
     entryTs:intent,entryPrice,requestedGross:1,exitHorizonTs:DATA_END});
  const matched={};
  for(const [name,th,window] of LIMITS){
   if(th===null){matched[name]={pass:true,latestCrossing:null};continue}
   const old=(th===3?d3:d5).filter(z=>0<intent-z.triggerAvailableAt&&intent-z.triggerAvailableAt<=window*H);
   const last=old.length?old[old.length-1]:null;
   matched[name]={pass:!!last?.all3,latestCrossing:last};
  }
  if(replay.status==='NATIVE_EXIT_MODELED'){
   if(!(replay.exitPrice>0))throw Error('P61_NATIVE_EXIT_PRICE_INVALID');
  }
  signals.push({
   id:'P74_BINANCE_MKT_'+signals.length.toString().padStart(5,'0'),
   entryTs:intent,entryPrice,entryH1VolumeEXPOST:p[i+1].volume,
   pinnedNativeV20ShortSignal:true,
   featureReferenceTs:x.features.referenceTs,
   nativeReplay:replay,
   net30pct:replay.status==='NATIVE_EXIT_MODELED'?100*(1-replay.exitPrice/entryPrice)-.3:null,
   p44FrozenEarlierCrossing:matched,
   sourceMarket:'BINANCE_FUTURES_UM_NOT_ASTER',
   instrument:'PENGUUSDT',sourceNotVenueSignedFill:true,
  });
 }
 const comparison=[];
 for(const [name,th,window] of LIMITS){
  const eligible=signals.filter(x=>x.p44FrozenEarlierCrossing[name].pass);
  const pos=slot(eligible);
  comparison.push({gate:name,earlierDropPct:th,priorHours:window,
   originalSourceNatural53InputMustNotBeMixed:true,
   sourceNatural:sourceStats(eligible),
   noSlipNaturalSingleSlotPriceProxy:payoff(pos.selected,0),
   extra100bpsCoverSingleSlotPriceProxy:payoff(pos.selected,100),
   sourceSlotOverlapBlocked:pos.blocked.length,
   sourceSelectedIDs:pos.selected.map(x=>x.id),
   sourceBlockedIDs:pos.blocked,
   perMonth:Object.fromEntries([...new Set(eligible.map(x=>new Date(x.entryTs).toISOString().slice(0,7)))].sort().map(m=>{
    const x=eligible.filter(z=>new Date(z.entryTs).toISOString().slice(0,7)===m);
    return [m,sourceStats(x)]
   })),
  });
 }
 const report={
  schema:'prism7-p74-matched-2025aug-2026nov-BINANCE-nativeV20-independent-source-replay/v1',
  status:'EXTERNAL_CROSS_VENUE_HISTORICAL_RESEARCH_NOT_NATIVE_ASTER_EXECUTION_PARITY',
  nativeCodePinnedSourceSHA:PIN,
  unmodifiedNativeSourceH1SignalAndExitReplay:true,
  nativeReplayImplementation:'pengu-dual-ls-v2.ts buildPenguDualLsV2EvaluationSeries / P8 replayPinnedShortExit',
  crossVenueBinanceDifferentFromOriginalAsterMarketSource:true,
  originalAster2025JulyBinanceH1OHLCVMismatchMaterial:true,
  sourceH1OfficialZipChecksumsPass:true,
  official165ZipArchiveManifestSha:sha(fs.readFileSync(INPUT)),
  rawOfficialPublicGzipInputSha:{PENGUUSDT:pengu.shaGzip,BTCUSDT:btc.shaGzip},
  sourceH1Aligned12120:true,
  studyPeriodEntryStartUTC:new Date(ENTRY_START).toISOString(),
  studyPeriodEntryEndExclusiveUTC:new Date(ENTRY_END).toISOString(),
  sourceObservationEndUTC:new Date(DATA_END).toISOString(),
  sourceNativeNaturalCrossVenueCandidates:signals.length,
  sourceNativeNaturalClosed:signals.filter(x=>x.net30pct!==null).length,
  priorD3CrossingCount:d3.length,priorD5CrossingCount:d5.length,
  originalP44RuleFrozenInAdvance:true,
  controlsAndWindows:LIMITS,
  comparison,
  sourceAllNaturalSignalLedger:signals,
  grossResearch:.75,feesBps:30,extraCoverSlipBpsStress:100,
  limitations:[
    'BINANCE FUTURES UM prices and volumes differ from original ASTER historical source; no original Native V20 venue parity. This can only be EXTERNAL market stress test.',
    'Past native source pinned implementation is imported unmodified; data feed and fill assumptions are new. Cross-venue signals are not original 53, and a passing gate would not validate live Aster.',
    'Kline event H1 signal and H1 native EXIT prices are price-only, no signed fill, M5 orderbook, funding, live STOP priority, or true multi-runner gross/DD.',
    'Original Native source code relies on penguFunding empty, identical to P15 previously used; actual exchange funding not replayed.',
    'P44 prior-drop D3 gate was retrospectively chosen from previously inspected 2025Aug-2026Nov. This new Binance Jan-Jul source is separate dataset, but selection is not fully blind across market venues.',
    'Single-slot realized DD under H1 source exits is not M5 mark-to-market DD nor production account DD.',
    'No entry fee/pricing venue-specific spread impact or live operator action; nothing from this report is deployable.'
  ],
  sourceProductionModified:false,runnerLiveModified:false,ordersOrSTOPModified:false
 };
 const dest=path.join(RESULT,'PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.json');
 const ledger=path.join(RESULT,'PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_NATURAL_SIGNAL_LEDGER_20261122.jsonl');
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(ledger,signals.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const md=['# P61 | external exchange stress test of pinned Native V20 and frozen P44 prior-D3 gate',
  '',
  'Source Binance USD-M H1 verified Dec2024-Jul2025 (5424 hourly rows per pair), not Aster. This data DISAGREES with original Aster overlap Jul2025. Results cannot be substituted for Native Aster BT.',
  '',
  '| Frozen gate | Natural source | wins | Single-slot closed | single-slot wins | Realized DD | NAV JPY | +100bps cover DD |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'];
 for(const x of comparison){
  md.push('| '+x.gate+' | '+x.sourceNatural.naturalIntents+' | '+x.sourceNatural.wins+' | '+x.noSlipNaturalSingleSlotPriceProxy.trades+' | '+x.noSlipNaturalSingleSlotPriceProxy.wins+' | '+x.noSlipNaturalSingleSlotPriceProxy.realizedOnlyDDPct+'% | '+x.noSlipNaturalSingleSlotPriceProxy.finalNavYen+' | '+x.extra100bpsCoverSingleSlotPriceProxy.realizedOnlyDDPct+'% |');
 }
 md.push('','**Adoption status: RESEARCH ONLY.** Cross-venue price is NOT original live native source. No original PENGU source orders, stops, positions or master branch changed.');
 const note=path.join(RESULT,'PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.md');
 fs.writeFileSync(note,md.join('\n')+'\n');
 console.log('P74_PINNED_NATIVE_V20_BINANCE_SAME_CALENDAR_SOURCE_REPLAY_PASS',JSON.stringify({
  H1p:p.length,H1b:b.length,natural:signals.length,
  exitClosed:report.sourceNativeNaturalClosed,
  comparators:comparison.map(x=>({gate:x.gate,source:x.sourceNatural.naturalIntents,
   sourceWins:x.sourceNatural.wins,oneSlot:x.noSlipNaturalSingleSlotPriceProxy.trades,
   oneSlotWins:x.noSlipNaturalSingleSlotPriceProxy.wins,
   realizedDD:x.noSlipNaturalSingleSlotPriceProxy.realizedOnlyDDPct,
   NAV:x.noSlipNaturalSingleSlotPriceProxy.finalNavYen,
   byMonth:x.perMonth})),
  rawDataIsAsterOriginal:false
 }));
 console.log('FILES',dest,note,ledger);
}
main();
