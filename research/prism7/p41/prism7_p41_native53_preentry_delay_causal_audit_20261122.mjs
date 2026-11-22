/**
 * P41: Original PENGU SHORT V20 Native53 pre-entry "missed decline" audit.
 * Source native H1 engine (no parameter changes). Separate:
 * - prior realized declines (hindsight; never a trade)
 * - causal completed-H1 setup/armed/short signals (can be known in real time)
 * - hypothetical earlier entry economics (NOT fill, STOP, or independent trade proof).
 * Retain all 53; specialize reporting on original 24 losses.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
const H=3_600_000, PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const ROOT=process.env.PRISM_NATIVE_ROOT, WORK=process.env.PRISM_NATIVE_WORK;
if(!ROOT||!WORK)throw Error('P41_REQUIRES_PRISM_NATIVE_ROOT_WORK');
const RESULT=path.join(WORK,'results');
const SOURCE=path.join(RESULT,'PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json');
const P40=path.join(RESULT,'PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_LEDGER_20261122.jsonl');
const OUT=path.join(RESULT,'PRISM7_P41_NATIVE53_PREENTRY_MISSED_MOVE_CAUSAL_20261122.json');
const LEDGER=path.join(RESULT,'PRISM7_P41_NATIVE53_PREENTRY_MISSED_MOVE_CAUSAL_20261122.jsonl');
const MD=path.join(RESULT,'PRISM7_P41_NATIVE53_PREENTRY_MISSED_MOVE_CAUSAL_20261122.md');
const END={
 PRE_2025_AUG_SEP:Date.parse('2025-10-01T00:00:00Z'),
 BASE_2025_2026:Date.parse('2026-10-01T00:00:00Z'),
 POST_2026_OCT_NOV:Date.parse('2026-11-18T00:00:00Z')
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rnd=(v,n=4)=>v==null?null:Number(v.toFixed(n));
const iso=t=>t==null?null:new Date(t).toISOString();
function sourceFile(sym,period) {
 const mid=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
  sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
  sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,mid]:
       period==='BASE_2025_2026'?[mid]:[mid,post];
}
function loadH1(sym,period) {
 const out=[],hashes={};
 for(const p of sourceFile(sym,period)) {
  const raw=fs.readFileSync(p); hashes[path.basename(p)]=sha(raw);
  for(const line of zlib.gunzipSync(raw).toString('utf8').split(/\r?\n/).filter(Boolean)) {
   const x=JSON.parse(line);let t=Number(x[0]);
   if(t>=END[period])continue;
   const o={openTime:t,closeTime:Number(x[6]),open:Number(x[1]),high:Number(x[2]),
     low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])};
   if(!(o.open>0&&o.high>=Math.max(o.open,o.close,o.low)&&o.low<=Math.min(o.open,o.close)&&o.volume>=0))
    throw Error('P41_INVALID_H1:'+sym+':'+t);
   out.push(o);
  }
 }
 if(out.length<250)throw Error('P41_NOT_ENOUGH_H1:'+sym+period);
 for(let i=1;i<out.length;i++)if(out[i].openTime-out[i-1].openTime!==H)
    throw Error('P41_H1_DISCONTINUITY:'+sym+period+':'+i);
 return {rows:out,hashes};
}
function sliceState(rows,i,hrs) {
 // Pre-entry H1 bars strictly end by entry time, no partial bar inclusion.
 const s=rows.slice(i-hrs,i);
 if(s.length!==hrs)throw Error('P41_SHORT_HISTORY');
 let peak=s[0].close,peakTime=s[0].openTime+H,maximumCloseDecline=0,
 maxPeakTs=null,maxTroughTs=null;
 let maxSeparateHighDecline=0,hiTs=null,loTs=null;
 // High of a prior completed H1 and LOW of a later complete H1, never same bar.
 let priorHigh=null,priorHighTs=null;
 for(const b of s){
  const t=b.openTime+H;
  if(peak>0){
   const down=100*(peak-b.close)/peak;
   if(down>maximumCloseDecline){
    maximumCloseDecline=down;maxPeakTs=peakTime;maxTroughTs=t;
   }
  }
  if(b.close>peak){peak=b.close;peakTime=t;}
  if(priorHigh!==null){
   const d=100*(priorHigh-b.low)/priorHigh;
   if(d>maxSeparateHighDecline){
    maxSeparateHighDecline=d;hiTs=priorHighTs;loTs=t;
   }
  }
  if(priorHigh===null||b.high>priorHigh){priorHigh=b.high;priorHighTs=t;}
 }
 const entry=rows[i].open;
 return {
  hours:hrs,sourcePrestartOpenTs:s[0].openTime,
  firstOpen:s[0].open,lastCompletedClose:s.at(-1).close,
  preEntryReturnOpenToEntryPct:rnd(100*(entry/s[0].open-1)),
  preEntryDeclineFromStartToEntryPct:rnd(100*(1-entry/s[0].open)),
  preEntryH1LastCloseToEntryGapPct:rnd(100*(entry/s.at(-1).close-1)),
  preEntryMaxClosePeakToLaterCloseTroughPct:rnd(maximumCloseDecline),
  preEntryMaxHighToLaterLowPct:rnd(maxSeparateHighDecline),
  preEntryLowMin:Math.min(...s.map(b=>b.low)),
  preEntryHighestHigh:Math.max(...s.map(b=>b.high)),
  maxClosePeakTs:maxPeakTs,maxCloseTroughTs:maxTroughTs,
  maxHighTs:hiTs,maxLaterLowTs:loTs,
  netShortIfEnteredAtStartAndClosedAtOriginalEntryPct:rnd(100*(1-entry/s[0].open)-.30),
  highLowMovementIsHindsight:true,
  sourceH1RowsCompleteAtNativeEntry:true
 };
}
function priorSignals(rows,evals,j,startHour,nativeInputs) {
 const events=[];
 for(let i=Math.max(0,j-startHour);i<j-1;i++) {
  const e=evals[i];if(!e.shortSignal)continue;
  const fillTs=rows[i+1].openTime;
  const fillPrice=rows[i+1].open;
  if(fillTs>=rows[j].openTime)throw Error('P41_EARLIER_CANDIDATE_NOT_EARLY');
  const s=rows.slice(i+1,j);
  const worstAdverse=Math.max(...s.map(b=>b.high))/fillPrice-1;
  const bestFavorable=1-Math.min(...s.map(b=>b.low))/fillPrice;
  const interimReturn=1-rows[j].open/fillPrice;
  // Old native 53 are NATURAL overlapping ENTRY signals, not real booked slot positions.
  const matches=nativeInputs.filter(x=>Number(x.entryTs)===fillTs);
  const occupiedInNativeSource=nativeInputs.filter(x=>
      Number(x.entryTs)<=fillTs&&Number(x.exitTs)>fillTs);
  events.push({
   sourceSignalReferenceH1Ts:e.candle.openTime,
   sourceSignalKnownAtTs:fillTs,sourceSignalKnownAtUtc:iso(fillTs),
   signalAtr24:e.features?.atr24Ratio,
   firstNextH1OpenFillProxy:fillPrice,
   sourceEarlierMatchingNaturalEntryCount:matches.length,
   native53OverlappingPositionCountAtHypotheticalEntry:occupiedInNativeSource.length,
   preOriginalEntryH1BestFavorablePct:rnd(100*bestFavorable),
   preOriginalEntryH1WorstAdversePct:rnd(100*worstAdverse),
   profitToOriginalEntryPctOnNotionalAfter30bps:rnd(100*interimReturn-.3),
   preOriginalEntryFavorableAtLeastOnePct:bestFavorable>=.01,
   preOriginalEntryHoldingToCurrentEntryProfitable30bps:interimReturn>.003,
   preOriginalEntryHardStop8PctTouched:worstAdverse>=.08,
   notAReconstructedV20NativeTradeExit:true
  });
 }
 return events;
}

function asofPrototypeMarker(rows,evals,j,i,name) {
 if(i==null || i>=j-1 || i<0)return null;
 const fillTs=rows[i+1].openTime,fillPx=rows[i+1].open;
 const entryPx=rows[j].open;
 if(fillTs>=rows[j].openTime)throw Error('P41_BAD_EARLY_ASOF_MARKER');
 const bars=rows.slice(i+1,j);
 if(!bars.length)throw Error('P41_NO_H1_BEFORE_NATIVE_ENTRY');
 const maxHigh=Math.max(...bars.map(z=>z.high)),minLow=Math.min(...bars.map(z=>z.low));
 return {
    marker:name,
    prerequisiteH1ReferenceTs:evals[i].features?.referenceTs,
    observableAfterH1CloseTs:fillTs,
    hoursEarlierThanNativeEntry:(rows[j].openTime-fillTs)/H,
    hypotheticalNextH1OpenPrice:fillPx,
    originalNativeEntryOpenPrice:entryPx,
    hypotheticalGrossShortReturnToNativeEntryPct:rnd(100*(1-entryPx/fillPx)),
    hypotheticalNetShortReturnToNativeEntryAfter30bpsPct:rnd(100*(1-entryPx/fillPx)-.30),
    bestH1LowShortFavorableBeforeNativeEntryPct:rnd(100*(1-minLow/fillPx)),
    worstH1HighShortAdverseBeforeNativeEntryPct:rnd(100*(maxHigh/fillPx-1)),
    hypothetical8PctStopTouchedByH1HighBeforeNativeEntry:maxHigh>=fillPx*1.08,
    isUnapprovedAlternativeEntryWithoutOriginalSignal:true,
    noPriceActionBeyondOriginalNativeEntryUsed:true
 };
}

const original=JSON.parse(fs.readFileSync(SOURCE,'utf8'));
const catRows=fs.readFileSync(P40,'utf8').trim().split(/\r?\n/).map(JSON.parse);
const catMap=new Map(catRows.map(x=>[x.key,x]));
if(original.length!==53||catMap.size!==53||original.filter(x=>x.net30pct>0).length!==29)
 throw Error('P41_P35_53_29_P40_SOURCE_NOT_EXACT');
const periods=Object.keys(END);
const all=[],srcHashes={};
for(const period of periods){
 const p=loadH1('PENGUUSDT',period),b=loadH1('BTCUSDT',period);
 srcHashes[period]={penguH1:p.hashes,btcH1:b.hashes};
 if(p.rows.length!==b.rows.length)throw Error('P41_H1_PENGU_BTC_NOT_ALIGNED');
 const evals=buildPenguDualLsV2EvaluationSeries({pengu1h:p.rows,btc1h:b.rows,penguFunding:[]},END[period]);
 const idx=new Map(p.rows.map((x,i)=>[x.openTime,i]));
 const nativeInputs=original.filter(x=>x.period===period);
 for(const x of nativeInputs) {
  const j=idx.get(x.entryTs);
  if(!(j>=228))throw Error('P41_WARMUP_228_MISSING:'+x.id);
  const origin=evals[j-1];
  if(!origin.shortSignal || origin.features?.referenceTs!==x.entryTs-H ||
      Math.abs(p.rows[j].open-x.entryPrice)>1e-12)
   throw Error('P41_PINNED_SHORT_SOURCE_SIGNAL_PARITY_FAIL:'+period+':'+x.id);
  const k=period+'|'+x.id+'|'+x.entryTs;
  const c=catMap.get(k);
  if(!c||Math.abs(c.nativeNet30Pct-x.net30pct)>1e-6)
   throw Error('P41_P40_ORIGINAL_TRADE_JOIN_MISMATCH:'+k);
  const windows={};
  for(const h of [3,6,12,24,48])windows[h]=sliceState(p.rows,j,h);
  const prev48=evals.slice(j-48,j-1);
  const pre48ShortArmed=prev48.filter(e=>e.shortSetupArmed);
  const pre48Active=prev48.filter(e=>e.shortSetupActive);
  const impulseHours=prev48.filter(e=>e.features?.penguReturn24h<=-.07);
  const prior=priorSignals(p.rows,evals,j,48,nativeInputs);
  const earlierImpulseIndex=evals.findIndex((e,i)=>
      i>=j-48 && i<j-1 && e.features?.penguReturn24h<=-.07);
  const closestArmedIndex=(()=>{for(let i=j-2;i>=j-48;i--){
      if(evals[i].shortSignal)break;
      if(evals[i].shortSetupArmed)return i;
    }return -1;})();
  let firstTrailingArmedIndex=closestArmedIndex;
  if(firstTrailingArmedIndex>=0)while(firstTrailingArmedIndex>j-48 &&
      evals[firstTrailingArmedIndex-1].shortSetupArmed &&
      !evals[firstTrailingArmedIndex-1].shortSignal)firstTrailingArmedIndex--;
  const asofFirstImpulse=asofPrototypeMarker(p.rows,evals,j,
      earlierImpulseIndex>=0?earlierImpulseIndex:null,'FIRST_COMPLETED_H1_24H_IMPULSE_LE_MINUS7');
  const asofFirstArmed=asofPrototypeMarker(p.rows,evals,j,
      firstTrailingArmedIndex>=0?firstTrailingArmedIndex:null,'FIRST_ARMED_IN_LAST_UNBROKEN_SETUP');
  
  const earlierQualified=prior.filter(e=>e.preOriginalEntryFavorableAtLeastOnePct);
  const earlierNet=prior.filter(e=>e.preOriginalEntryHoldingToCurrentEntryProfitable30bps);
  const f=origin.features;
  all.push({
   period,id:x.id,key:k,sourceNativeEntryTs:x.entryTs,sourceNativeEntryUtc:iso(x.entryTs),
   originalNativeEntryPrice:x.entryPrice,
   sourceNativeExitTs:x.exitTs,sourceNativeNet30Pct:rnd(x.net30pct,6),
   sourceNativeExitReason:x.exitReason,
   sourceNativeWin:x.net30pct>0,
   p40PostEntryLossCategory:c.postEntryLossCategory,
   p40PostEntryAdverseFirst:c.firstFavorableVsAdverse1Pct,
   fullNativeShortEntrySourceSignalParity:true,
   nativeSignalKnownOnlyAfterPreviousH1Close:true,
   entrySignalReferenceTs:origin.features.referenceTs,
   entryFeatureAtSignal:{
     impulse24Pct:rnd(100*f.penguReturn24h),
     downRegime72Pct:rnd(100*f.penguReturn72h),
     btc24Pct:rnd(100*f.btcReturn24h),
     relative24Pct:rnd(100*f.relativeReturn24h),
     volumeRatio6OverPrior36:rnd(f.volumeRatio6OverPrior36),
     rsi14:rnd(f.rsi14),
     atr24Pct:rnd(100*f.atr24Ratio),
     ema72:f.ema72,ema168:f.ema168,
     requiresBounceThenRebreak:true
   },
   windows,
   pre48SetupActiveH1Count:pre48Active.length,
   pre48SetupArmedH1Count:pre48ShortArmed.length,
   pre48Impulse24BelowMinus7H1Count:impulseHours.length,
   pre48FirstImpulseReferenceTs:impulseHours[0]?.features.referenceTs??null,
   pre48LastArmedReferenceTs:pre48ShortArmed.at(-1)?.features.referenceTs??null,
   pre48LastActiveReferenceTs:pre48Active.at(-1)?.features.referenceTs??null,
   pre48EarlierFullSourceNativeSignalCount:prior.length,
   pre48FirstCausalImpulseEarlyShadow:asofFirstImpulse,
   pre48FirstCausalArmedEarlyShadow:asofFirstArmed,
   pre48EarlierFullSourceNativeSignals:prior,
   pre48EarlierSourceNativeSignalThenFavorableH1AtLeast1PctCount:earlierQualified.length,
   pre48EarlierSourceNativeSignalThenNetProfitToThisEntryCount:earlierNet.length,
   noFutureInPreEntryPriceFeatures:true,
   priorHighLowBestMoveIsRetrospectiveNotTradable:true,
   allCounterfactualEntriesWouldRequireOriginalStopRecomputation:true,
   productionCertified:false
  });
 }
}
if(all.length!==53||all.filter(x=>!x.sourceNativeWin).length!==24)
 throw Error('P41_SOURCE53_SUM_ERROR');
const losers=all.filter(x=>!x.sourceNativeWin);
const winners=all.filter(x=>x.sourceNativeWin);
function summarize(rows){
 const n=rows.length;if(!n)return {n:0};
 const sorted=(f)=>rows.map(f).sort((a,b)=>a-b);
 const med=f=>{const z=sorted(f);return rnd(z.length%2?z[(z.length-1)/2]:(z[z.length/2-1]+z[z.length/2])/2)};
 let allH1Qual=rows.filter(x=>x.pre48EarlierFullSourceNativeSignalCount>0);
 let earlyProf=rows.filter(x=>x.pre48EarlierSourceNativeSignalThenNetProfitToThisEntryCount>0);
 return {
 n,medianPrior24hStartToEntryDeclinePct:med(x=>x.windows[24].preEntryDeclineFromStartToEntryPct),
 medianPrior24hMaxCloseDrawdownPct:med(x=>x.windows[24].preEntryMaxClosePeakToLaterCloseTroughPct),
 medianPrior48hMaxCloseDrawdownPct:med(x=>x.windows[48].preEntryMaxClosePeakToLaterCloseTroughPct),
 prior24StartToEntryDeclineAtLeast1Pct:rows.filter(x=>x.windows[24].preEntryDeclineFromStartToEntryPct>=1).length,
 prior24StartToEntryDeclineAtLeast3Pct:rows.filter(x=>x.windows[24].preEntryDeclineFromStartToEntryPct>=3).length,
 prior24StartToEntryDeclineAtLeast7Pct:rows.filter(x=>x.windows[24].preEntryDeclineFromStartToEntryPct>=7).length,
 prior24H1MaxClosePeakToLaterTroughAtLeast1Pct:rows.filter(x=>x.windows[24].preEntryMaxClosePeakToLaterCloseTroughPct>=1).length,
 prior24H1MaxClosePeakToLaterTroughAtLeast3Pct:rows.filter(x=>x.windows[24].preEntryMaxClosePeakToLaterCloseTroughPct>=3).length,
 prior24H1MaxClosePeakToLaterTroughAtLeast7Pct:rows.filter(x=>x.windows[24].preEntryMaxClosePeakToLaterCloseTroughPct>=7).length,
 prior24hOpenToEntryShortNetAfter30bpsAtLeast1Pct:rows.filter(x=>x.windows[24].netShortIfEnteredAtStartAndClosedAtOriginalEntryPct>=1).length,
 anyEarlierFullNativeSourceSignal48h:allH1Qual.length,
 anyEarlierNativeSignalPlusAtLeast1PctH1FavorableBeforeActualEntry:rows.filter(x=>x.pre48EarlierSourceNativeSignalThenFavorableH1AtLeast1PctCount>0).length,
 anyEarlierNativeSignalPlusNetPositiveByActualEntry:earlyProf.length,
 anyPre48NativeSetupArmed:rows.filter(x=>x.pre48SetupArmedH1Count>0).length,
 firstImpulseEarlierThanNativeEntryWithNextH1Proxy:rows.filter(x=>x.pre48FirstCausalImpulseEarlyShadow!==null).length,
 firstImpulseShadowNetToOriginalEntryGe1Pct:rows.filter(x=>x.pre48FirstCausalImpulseEarlyShadow?.hypotheticalNetShortReturnToNativeEntryAfter30bpsPct>=1).length,
 firstImpulseShadowNetGe1PctWithoutH1HardStopTouch:rows.filter(x=>x.pre48FirstCausalImpulseEarlyShadow?.hypotheticalNetShortReturnToNativeEntryAfter30bpsPct>=1 && !x.pre48FirstCausalImpulseEarlyShadow?.hypothetical8PctStopTouchedByH1HighBeforeNativeEntry).length,
 lastSetupArmedEarlierThanNativeEntryWithNextH1Proxy:rows.filter(x=>x.pre48FirstCausalArmedEarlyShadow!==null).length,
 firstArmedShadowNetToOriginalEntryGe1Pct:rows.filter(x=>x.pre48FirstCausalArmedEarlyShadow?.hypotheticalNetShortReturnToNativeEntryAfter30bpsPct>=1).length,
 firstArmedShadowNetGe1PctWithoutH1HardStopTouch:rows.filter(x=>x.pre48FirstCausalArmedEarlyShadow?.hypotheticalNetShortReturnToNativeEntryAfter30bpsPct>=1 && !x.pre48FirstCausalArmedEarlyShadow?.hypothetical8PctStopTouchedByH1HighBeforeNativeEntry).length,
 anyPre48NativeImpulse24BelowMinus7:rows.filter(x=>x.pre48Impulse24BelowMinus7H1Count>0).length,
 nativeSignalRetrospectiveIndependenceCaveat:true
 };
}
const lostGrp={};
for(const kind of new Set(losers.map(x=>x.p40PostEntryLossCategory)))
 lostGrp[kind]=summarize(losers.filter(x=>x.p40PostEntryLossCategory===kind));
const result={
 schema:'prism7-p41-native53-preentry-missed-downleg-source-engine-parity/v1',
 pinnedSHA:PIN,nativeH1SourceSignalParity53Of53:true,
 sourceNative53:53,sourceWins:29,sourceLosses:24,
 sourceP35Sha256:sha(fs.readFileSync(SOURCE)),
 sourceP40Sha256:sha(fs.readFileSync(P40)),
 sourceH1SHA256:srcHashes,
 timeWindowHours:[3,6,12,24,48],
 originalNativeShortSignalPreconditions:{
  pengu24ImpulseMaximum:-.07,
  bounceMinimum:.0125,
  bounceInvalidationAbove:.06,
  requireLastCompletedH1CloseBelowPreviousLow:true,
  requireEMA72BelowEMA168:true,
  otherNativeRsiVolumeBtcRelativeFiltersRemain:true
 },
 all53:summarize(all),losers24:summarize(losers),winners29:summarize(winners),
 lossFamilies:lostGrp,
 perCohort:Object.fromEntries(periods.map(c=>[c,summarize(losers.filter(x=>x.period===c))])),
 detailed24Losses:losers,
 full53Rows:all.length,
 allThreePeriodsAlreadyViewedBefore:true,
 promotion:'DIAGNOSTIC_ONLY__NO_EARLIER_NATIVE_ENTRY_PROVEN_WITHOUT_ACTUAL_SOURCE_SIGNAL_AND_STOP_REPLAY',
 limitations:[
  'All H1 bars used to calculate pre-entry source features complete before source actual native entry open; no future H1 in signal.',
  'Max peak-to-trough decline is selected using knowledge of the entire previous window; an earlier real-time trader could not pick the winning high/low ex ante.',
  'Actual native Short V20 requires 24h impulse, a bounce, rebreak and other filters; preceding price decline without earlier shortSignal is NOT a late executable native entry.',
  'Any earlier source Short signal in 48 hours can represent another independent natural native setup; cannot assume same position or available gross slot.',
  'Impulse-only and armed-only proxy entries are not native Short V20 source signals. Their earlier price arithmetic is a retrospective feasibility screen, NOT a replayed trading strategy.',
  'Earlier-source H1 open entry is a shadow price proxy, no signed fill or orderbook, must recompute full native exit/STOP before claiming improved economic PnL.',
  'Same H1 bar HIGH/LOW ordering cannot prove intrabar stop/profit ordering; shock gap slippage not modelled.',
  'PENGU/BTC source H1 may differ from separate public M5 candles; cross-source QA required for executable M5 claims.',
  '53 natural source cases overlap. Counts and % are not an actual portfolio DD, net capital, or isolated 24 live losing fills.',
  'All pre, base and post cohorts have been viewed repeatedly in past research; no blind OOS.',
  'No LIVE, code deployment, existing orders, STOP, Runner, Kill Switch or production operation changes.'
 ]
};
fs.writeFileSync(OUT,JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(LEDGER,all.map(x=>JSON.stringify(x)).join('\n')+'\n');
const g=result.losers24,c=lostGrp.LOSS_NEVER_CONFIRMED_1PCT;
const md=[
 '# P41 | Native SHORT V20 24 losers: was the short entry late?',
 '',
 '**Source-native H1 engine signal parity: 53/53**; 24 losers and 29 winners are frozen. 0.75x accounting only, no trading actions.',
 '',
 '24h realized decline BEFORE the native entry is a descriptive metric, NOT proof an earlier actual short could have fired.',
 '',
 '| 24 original losers | Count |',
 '|---|---:|',
 '| Prior 24h open-to-native-entry short move >=1% | '+g.prior24StartToEntryDeclineAtLeast1Pct+' |',
 '| Prior 24h open-to-native-entry short move >=3% | '+g.prior24StartToEntryDeclineAtLeast3Pct+' |',
 '| Prior 24h peak-to-later-close trough >=3% | '+g.prior24H1MaxClosePeakToLaterTroughAtLeast3Pct+' |',
 '| Prior 48h earlier **full native short signal** existed | '+g.anyEarlierFullNativeSourceSignal48h+' |',
 '| Earlier first impulse (>=7% prior24h decline) + hypothetical net >=1% to native entry | '+g.firstImpulseShadowNetToOriginalEntryGe1Pct+' |',
 '| Earlier armed-setup + hypothetical net >=1% to native entry | '+g.firstArmedShadowNetToOriginalEntryGe1Pct+' |',
 '| Prior 48h earlier full native short signal + >=1% favorable H1 low | '+g.anyEarlierNativeSignalPlusAtLeast1PctH1FavorableBeforeActualEntry+' |',
 '| Prior 48h earlier full native short signal + net at actual entry >0 with 30bps | '+g.anyEarlierNativeSignalPlusNetPositiveByActualEntry+' |',
 '',
 '## The 12 losses that never secured a 1% favorable M5 close',
 '',
 '| Sub-question | Count |','|---|---:|',
 '| Earlier prior24h open-to-entry price decline >=1% | '+c.prior24StartToEntryDeclineAtLeast1Pct+' |',
 '| Prior24h peak-to-later-trough down >=3% | '+c.prior24H1MaxClosePeakToLaterTroughAtLeast3Pct+' |',
 '| Earlier full source-native SHORT signal within 48h | '+c.anyEarlierFullNativeSourceSignal48h+' |',
 '| Earlier first impulse -> hypothetical net >=1% until native entry | '+c.firstImpulseShadowNetToOriginalEntryGe1Pct+' |',
 '| Earlier armed setup -> hypothetical net >=1% until native entry | '+c.firstArmedShadowNetToOriginalEntryGe1Pct+' |',
 '| Earlier full source-native SHORT signal then price fell >=1% before actual entry | '+c.anyEarlierNativeSignalPlusAtLeast1PctH1FavorableBeforeActualEntry+' |',
 '',
 '## Breakdown by original native loss family',
 ...Object.entries(lostGrp).map(([k,x])=>'- '+k+': '+x.n+' loss(es); prior24 >=3% decline='+x.prior24StartToEntryDeclineAtLeast3Pct+'; earlier native signal in 48h='+x.anyEarlierFullNativeSourceSignal48h),
 '',
 'Interpretation: prior declines without an earlier complete native signal show delayed structural entry **by design**, not a missed executable native entry. Earlier full native signal alone is insufficient without single-slot occupancy and native STOP/exit replay.',
 '',
 'Input source SHA and all 53 per-entry ledgers are in the JSON output. Production untouched.'
];
fs.writeFileSync(MD,md.join('\n')+'\n');
console.log('PRISM7_P41_NATIVE53_24LOSSES_PREENTRY_CAUSAL_H1_ENGINE_PARITY_PASS',
 JSON.stringify({losers24:result.losers24,winners29:result.winners29,
   lossFamilies:result.lossFamilies,perCohort:result.perCohort},null,2));
console.log('OUT',OUT,LEDGER,MD);
