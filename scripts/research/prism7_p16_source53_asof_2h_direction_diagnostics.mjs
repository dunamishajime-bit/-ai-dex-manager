/** PRISM VII P16 frozen six-feature as-of two-hour direction recheck diagnostic.
 * Preserves exact pinned natural source SHORT53; diagnostic only, NO orders.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496',H=3600000;
const ROOT=process.env.PRISM_NATIVE_ROOT,WORK=process.env.PRISM_NATIVE_WORK,
 OUT=process.env.PRISM_NATIVE_P16_OUTPUT;
if(!ROOT||!WORK||!OUT)throw Error('P16_NEEDS_SOURCE_ROOT_WORK_OUTPUT');
const END={
 PRE_2025_AUG_SEP:Date.parse('2025-10-01T00:00:00Z'),
 BASE_2025_2026:Date.parse('2026-10-01T00:00:00Z'),
 POST_2026_OCT_NOV:Date.parse('2026-11-18T00:00:00Z'),
};
const sh=b=>crypto.createHash('sha256').update(b).digest('hex');
function sourceFile(sym,period){
 const base=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
   sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
   sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,base]:
   period==='BASE_2025_2026'?[base]:[base,post];
}
function loadH1(sym,period){
 const rows=[],hashes={};
 for(const f of sourceFile(sym,period)){
  const raw=fs.readFileSync(f),source=zlib.gunzipSync(raw).toString('utf8')
     .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  hashes[path.basename(f)]=sh(raw);
  for(const a of source){
   const t=Number(a[0]);if(t>=END[period])continue;
   rows.push({
     openTime:t,closeTime:Number(a[6]),open:Number(a[1]),
     high:Number(a[2]),low:Number(a[3]),close:Number(a[4]),
     volume:Number(a[5])
   });
  }
 }
 if(rows.length<182)throw Error('P16_H1_SOURCE_HISTORY_UNDER182:'+sym);
 for(let i=1;i<rows.length;i++)
  if(rows[i].openTime-rows[i-1].openTime!==H)
   throw Error('P16_SOURCE_H1_GAP_OR_DUPLICATE:'+period+':'+sym+':'+i);
 return {rows,hashes};
}
const ORIGINAL=JSON.parse(fs.readFileSync(
 path.join(WORK,'results','PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json'),'utf8'));
if(ORIGINAL.length!==53||ORIGINAL.some(x=>x.parity!=='EXACT'))
 throw Error('P16_ORIGINAL_53_PINNED_NATIVE_NOT_PARITY');
const result=[],srcHashes={};
for(const period of Object.keys(END)){
 const p=loadH1('PENGUUSDT',period),b=loadH1('BTCUSDT',period);
 if(p.rows.length!==b.rows.length)throw Error('P16_SOURCE_H1_LENGTH_MISMATCH');
 const evals=buildPenguDualLsV2EvaluationSeries({
    pengu1h:p.rows,btc1h:b.rows,penguFunding:[]
 },END[period]);
 if(evals.length!==p.rows.length)throw Error('P16_PIN_EVAL_LENGTH_MISMATCH');
 const ids=new Map(p.rows.map((x,i)=>[x.openTime,i]));
 srcHashes[period]={penguH1:p.hashes,btcH1:b.hashes};
 for(const o of ORIGINAL.filter(x=>x.period===period)){
  const j=ids.get(o.entryTs);
  if(j===undefined||j<4||j+1>=evals.length)
    throw Error('P16_SOURCE_NATIVE_ENTRY_NO_TWO_FUTURE_H1');
  const pre=evals[j-1];
  if(!pre?.features||!pre.shortSignal ||
     pre.features.referenceTs!==o.entryTs-H||
     Math.abs(o.entryPrice-p.rows[j].open)>1e-12)
    throw Error('P16_SOURCE_NATIVE_53_SHORT_SIGNAL_PARITY_FAIL');
  const p0=p.rows[j],p1=p.rows[j+1],bt0=b.rows[j],bt1=b.rows[j+1];
  if(p1.openTime!==o.entryTs+H||bt1.openTime!==p1.openTime||
     bt0.openTime!==p0.openTime)
    throw Error('P16_TWO_H1_ASOF_SOURCE_TIME_FAIL');
  const entryAtr=pre.features.atr24Ratio;
  if(!(entryAtr>0&&Number.isFinite(entryAtr)))throw Error('P16_ENTRY_ATR_BAD');
  const pengu2h=p1.close/o.entryPrice-1;
  const btc2h=bt1.close/bt0.open-1;
  const relative2h=pengu2h-btc2h;
  const priorTwoVolume=p.rows[j-1].volume+p.rows[j-2].volume,
        nextTwoVolume=p0.volume+p1.volume;
  const volRatio=priorTwoVolume>0?nextTwoVolume/priorTwoVolume:null;
  const prior3hHigh=Math.max(...p.rows.slice(j-3,j).map(x=>x.high));
  const favorable2h=Math.max(0,1-Math.min(p0.low,p1.low)/o.entryPrice);
  const evidence={
    A_pengu_2h_adverse_above_entry_atr:pengu2h>=entryAtr,
    B_btc_2h_up_025pct:btc2h>=.0025,
    C_relative_strength_2h_ge_1pp:relative2h>=.01,
    D_pengu_2h_volume_ratio_ge_1_5:volRatio===null?null:volRatio>=1.5,
    E_pengu_close_broke_preentry_3h_high:p1.close>prior3hHigh,
    F_short_favorable_2h_le_half_entry_atr:favorable2h<=.5*entryAtr,
  };
  const votes=Object.values(evidence).filter(x=>x===true).length,
        unknown=Object.values(evidence).filter(x=>x===null).length;
  const status=(p0.volume+p1.volume===0)?'NO_POSTENTRY_PENGU_PRICE_PRINT_H1':
    votes>=3?'DIRECTION_RECHECK_REQUIRED':'CONTINUE_NATIVE_SHORT_REVIEW';
  const sourceNativeWin30=o.net30pct>0;
  result.push({
    period,id:o.id,sourcePin:PIN,
    sourceSignalEntryTs:o.entryTs,
    sourceSignalEntryPrice:o.entryPrice,
    sourceNativeNet30Pct:o.net30pct,sourceNativeWin30,
    sourceOriginalExitReason:o.exitReason,
    sourceNativeExitTs:o.exitTs,
    evaluationAtUtc:new Date(o.entryTs+2*H).toISOString(),
    lastFeatureReferenceTs:p1.openTime,
    entryATR24Ratio:entryAtr,penguReturn2h:pengu2h,
    btcReturn2h:btc2h,penguMinusBtcReturn2h:relative2h,
    penguVolume2hOverPrior2h:volRatio,
    prior3hHigh,postentry2hLowFavorableRatio:favorable2h,
    entryH1PositivePrint:p0.volume>0,
    nextH1PositivePrint:p1.volume>0,
    unknownFeatureCount:unknown,
    evidence,score:votes,status,
    diagnosticOnly:true,automaticEntryChange:false,
    futureExitInfoUsedAsFeature:false,
  });
 }
}
if(result.length!==53||
 result.filter(x=>x.sourceNativeWin30).length!==29)
 throw Error('P16_ORIGINAL_NATURAL_SOURCE53_CHANGED');
const groups={};
function aggregate(rows){
 const observed=rows.filter(x=>x.status!=='NO_POSTENTRY_PENGU_PRICE_PRINT_H1');
 const risky=observed.filter(x=>x.status==='DIRECTION_RECHECK_REQUIRED');
 return {
   originalSourceCount:rows.length,sourceWins:rows.filter(x=>x.sourceNativeWin30).length,
   sourceLosses:rows.filter(x=>!x.sourceNativeWin30).length,
   noNewPrintTwoH:rows.length-observed.length,
   validDiagnostic:observed.length,
   flaggedForDirectionRecheck:risky.length,
   flaggedSourceLosers:risky.filter(x=>!x.sourceNativeWin30).length,
   flaggedSourceWinners:risky.filter(x=>x.sourceNativeWin30).length,
   originalSourceLosersNotFlagged:observed.filter(x=>!x.sourceNativeWin30&&x.status!=='DIRECTION_RECHECK_REQUIRED').length,
   originalSourceWinnersNotFlagged:observed.filter(x=>x.sourceNativeWin30&&x.status!=='DIRECTION_RECHECK_REQUIRED').length,
   sourceWinsPreservedInOriginalModel:rows.filter(x=>x.sourceNativeWin30).length,
   strategyPnlUnaffected:true,
 };
}
groups.ALL=aggregate(result);
for(const period of Object.keys(END)){
 groups[period]=aggregate(result.filter(x=>x.period===period));
}
const report={
 schema:'prism7-p16-frozen-six-factor-asof-twoH-short-direction-diagnostic/v1',
 pinnedRuntimeSha:PIN,sourceNaturalIntents:53,
 decisionLagHoursFromSourceIntent:2,
 fixedVotesRequired:3,
 fixedFeatures:[
 'A_PENGU_UP_ATR','B_BTC_UP_025PCT','C_RELATIVE_UP_1PP',
 'D_VOLUME_RATIO_1_5','E_PRIOR3H_HIGH_BREAK','F_NO_FAVORABLE_HALF_ATR'],
 resultGroups:groups,sourceH1Hashes:srcHashes,
 limitations:[
 'Classification is diagnostic only and does not change source ENTRY, EXIT, STOP or cost.',
 'This 53-outcome period was previously observed; all predictive values are in-sample diagnostics.',
 'H1 source candles, not source M5 or executable bid/ask; no signed fill proof.',
 'The next two H1 bars are only available after the source intent; using them at entry would be future leak.',
 'A print volume ratio with zero historical denominator is UNKNOWN and cannot vote true.',
 'No user order modifications, no new LONG trades, no trading winrate improvement can be inferred.',
 ],
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_NATIVE53_DIAGNOSTIC_LEDGER.json'),
 JSON.stringify(result,null,2)+'\n');
console.log('PRISM7_P16_FROZEN_2H_DIRECTION_DIAGNOSTIC_PASS',JSON.stringify(groups));
console.log('OUT',OUT);
