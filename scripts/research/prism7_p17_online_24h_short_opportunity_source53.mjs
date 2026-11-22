/**
 * P17 frozen online PENGU H1 24h SHORT opportunity probability.
 * No native trade labels used for training; fully matured earlier H1 only.
 * Research diagnostic, not LIVE signal or signed execution model.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496',H=3600000,LAG=24;
const LR=.03,L2=.001;
const WORK=process.env.PRISM_NATIVE_WORK,ROOT=process.env.PRISM_NATIVE_ROOT,
 OUT=process.env.PRISM_NATIVE_P17_OUTPUT;
if(!WORK||!ROOT||!OUT)throw Error('P17_WORK_ROOT_OUT_REQUIRED');
const BEGIN={
 PRE_2025_AUG_SEP:Date.parse('2025-08-01T00:00:00Z'),
 BASE_2025_2026:Date.parse('2025-10-01T00:00:00Z'),
 POST_2026_OCT_NOV:Date.parse('2026-10-01T00:00:00Z'),
};
const END={
 PRE_2025_AUG_SEP:Date.parse('2025-10-01T00:00:00Z'),
 BASE_2025_2026:Date.parse('2026-10-01T00:00:00Z'),
 POST_2026_OCT_NOV:Date.parse('2026-11-18T00:00:00Z'),
};
const CUT={...END,PRE_2025_AUG_SEP:Date.parse('2025-09-24T00:00:00Z')};
const COUNT={PRE_2025_AUG_SEP:6,BASE_2025_2026:40,POST_2026_OCT_NOV:7};
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
function files(sym,period){
 const main=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
   sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
   sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,main]:
   period==='BASE_2025_2026'?[main]:[main,post];
}
function load(sym,period){
 const rows=[],hashes={};
 for(const file of files(sym,period)){
  const buffer=fs.readFileSync(file);
  hashes[path.basename(file)]=SHA(buffer);
  const data=zlib.gunzipSync(buffer).toString('utf8').split(/\r?\n/).filter(Boolean);
  for(const line of data){
    const a=JSON.parse(line),t=Number(a[0]);
    if(t>=END[period])continue;
    rows.push({
      openTime:t,closeTime:Number(a[6]),open:Number(a[1]),
      high:Number(a[2]),low:Number(a[3]),close:Number(a[4]),volume:Number(a[5]),
    });
  }
 }
 for(let i=1;i<rows.length;i++)
  if(rows[i].openTime-rows[i-1].openTime!==H)
   throw Error('P17_SOURCE_H1_GAP_OR_DUPLICATE:'+period+':'+sym);
 return {rows,hashes};
}
const clamp=x=>Math.max(-3,Math.min(3,x));
function xvec(f){
 if(!f || !(f.ema72>0) || !(f.close>0))return null;
 const raw=[
  f.penguReturn24h/.10,f.penguReturn72h/.25,
  f.btcReturn24h/.06,f.relativeReturn24h/.10,
  (f.close/f.ema72-1)/.12,f.btcEma168Distance/.08,
  (f.volumeRatio6OverPrior36-1)/2,(f.atr24Ratio-.025)/.025,
  (f.rsi14-50)/25,
 ];
 if(raw.some(x=>!Number.isFinite(x)))return null;
 return [1,...raw.map(clamp)];
}
function prob(w,x){
 if(!x)throw Error('P17_PREDICT_WITHOUT_SOURCE_FEATURE');
 const z=w.reduce((a,v,i)=>a+v*x[i],0);
 return 1/(1+Math.exp(-Math.max(-40,Math.min(40,z))));
}
function update(w,x,y){
 const pred=prob(w,x);
 for(let k=0;k<w.length;k++)
  w[k]+=LR*((y-pred)*x[k] - (k===0?0:L2*w[k]));
}
function auc(rows,target,probKey){
 const pos=rows.filter(x=>x[target]===true).map(x=>x[probKey]);
 const neg=rows.filter(x=>x[target]===false).map(x=>x[probKey]);
 if(!pos.length||!neg.length)return null;
 let v=0;
 for(const a of pos)for(const b of neg)
  v+=a>b?1:a===b?.5:0;
 return v/(pos.length*neg.length);
}
function evaluate(rows){
 const eval24=rows.filter(x=>x.future24hShortWin30Proxy!==null);
 const brier=(arr,name)=>arr.length?
   arr.reduce((s,x)=>s+(x[name]-(x.future24hShortWin30Proxy?1:0))**2,0)/arr.length:null;
 return {
   sourceNaturalIntentCount:rows.length,
   sourceNativeWins:rows.filter(x=>x.sourceNativeWin30).length,
   modelPredictedIntentCount:rows.filter(x=>x.probShort24h>0).length,
   nativeOutcomeAuc:auc(rows,'sourceNativeWin30','probShort24h'),
   nativeWinProbAboveHalf:rows.filter(x=>x.sourceNativeWin30&&x.probShort24h>=.5).length,
   nativeWinProbBelowHalf:rows.filter(x=>x.sourceNativeWin30&&x.probShort24h<.5).length,
   nativeLossProbAboveHalf:rows.filter(x=>!x.sourceNativeWin30&&x.probShort24h>=.5).length,
   nativeLossProbBelowHalf:rows.filter(x=>!x.sourceNativeWin30&&x.probShort24h<.5).length,
   future24hProxyOutcomeAvailable:eval24.length,
   future24hProxyWinCount:eval24.filter(x=>x.future24hShortWin30Proxy===true).length,
   future24hProxyAuc:auc(eval24,'future24hShortWin30Proxy','probShort24h'),
   forecast24hBrier:brier(eval24,'probShort24h'),
   onlineBaseRateBrier:brier(eval24,'onlineBaseRateBeforeThisCandidate'),
 };
}
const original=JSON.parse(fs.readFileSync(
 path.join(WORK,'results','PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json'),'utf8'));
if(original.length!==53||original.some(x=>x.parity!=='EXACT'))
 throw Error('P17_ORIGINAL_53_NATIVE_SOURCE_PARITY_MISSING');
const mapped=new Map(original.map(x=>[x.period+'|'+x.entryTs,x]));
if(mapped.size!==53)throw Error('P17_SOURCE_ENTRY_DUPLICATE');
const all=[],audit={};
for(const period of Object.keys(COUNT)){
 const p=load('PENGUUSDT',period),btc=load('BTCUSDT',period);
 if(p.rows.length!==btc.rows.length)throw Error('P17_SOURCE_BTC_PENGU_COUNT_MISMATCH');
 const ev=buildPenguDualLsV2EvaluationSeries({
   pengu1h:p.rows,btc1h:btc.rows,penguFunding:[],
 },END[period]);
 if(ev.length!==p.rows.length)throw Error('P17_PIN_NATIVE_FEATURE_COUNT_MISMATCH');
 const w=Array(10).fill(0);
 let matured=0,maturedWins=0,maturedLastRefTs=null,updateSkipped=0,
     withinPeriodShortIntentCount=0,prefixChecks=0;
 for(let i=0;i<ev.length;i++){
    const e=ev[i];
    if(!e.features)continue;
    // t H1 has CLOSED. Train the example that entered fully 24 hours before.
    // Never access a label whose completion time is after decision time t.
    const k=i-LAG,earlier=k>=0?ev[k]:null;
    if(earlier?.features&&p.rows[k].volume>0&&p.rows[i].volume>0){
       const x=xvec(earlier.features);
       if(x){
         if(e.features.referenceTs-earlier.features.referenceTs!==LAG*H)
            throw Error('P17_TRAIN_FUTURE_LEAK_OR_H1_GAP');
         const y=1-p.rows[i].close/p.rows[k].close-.003>0?1:0;
         update(w,x,y);
         matured++;maturedWins+=y;
         maturedLastRefTs=e.features.referenceTs;
       }else updateSkipped++;
    }
    if(!e.shortSignal)continue;
    const entry=e.features.referenceTs+H;
    if(entry<BEGIN[period]||entry>=CUT[period])continue;
    const refKey=period+'|'+entry,orig=mapped.get(refKey);
    if(!orig)throw Error('P17_NATIVE_SHORT_ENTRY_NOT_IN_ORIGINAL53:'+refKey);
    const entryRow=p.rows[i+1];
    if(!entryRow || entryRow.openTime!==entry ||
      Math.abs(entryRow.open-orig.entryPrice)>1e-12)
      throw Error('P17_PIN_NATIVE_SHORT_ENTRY_PRICE_NOT_PARITY');
    const x=xvec(e.features);
    if(!x)throw Error('P17_SOURCE_SIGNAL_HAS_NONFINITE_PREDICTOR');
    if(maturedLastRefTs!==null&&maturedLastRefTs>e.features.referenceTs)
       throw Error('P17_TRAIN_INCLUDES_FUTURE_SAMPLE');
    const forecast=prob(w,x),base=matured>0?maturedWins/matured:.5;
    const next24=ev[i+LAG]?.features;
    const future24=next24?
       (1-p.rows[i+LAG].close/p.rows[i].close-.003>0):null;
    const record={
      period,id:orig.id,sourcePin:PIN,
      shortSignalReferenceTs:e.features.referenceTs,
      sourceNaturalEntryTs:entry,sourceNativeEntryPrice:orig.entryPrice,
      sourceNativeExitTs:orig.exitTs,sourceNativeExitPrice:orig.exitPrice,
      sourceNativeExitReason:orig.exitReason,
      sourceNativeWin30:orig.net30pct>0,sourceNativeNet30Pct:orig.net30pct,
      probShort24h:forecast,onlineBaseRateBeforeThisCandidate:base,
      fixedGradientLr:LR,fixedL2:L2,fixedFutureLabelMaturityHours:LAG,
      trainedPriorH1Examples:matured,
      lastMaturedTrainingLabelReferenceTs:maturedLastRefTs,
      nativeOutcomeUsedInOnlineTraining:false,
      future24hShortWin30Proxy:future24,
      future24hEvaluatedAsOfReferenceTs:next24?.referenceTs??null,
      newRuntimeEntryOrExitChanged:false,
      inputNormalizedFeatureVectorAtPrediction:x,
      weightsAtPrediction:w.slice(),
    };
    all.push(record);
    withinPeriodShortIntentCount++;
    if(prefixChecks<3){
       const prefix=buildPenguDualLsV2EvaluationSeries({
          pengu1h:p.rows.slice(0,i+1),
          btc1h:btc.rows.slice(0,i+1),penguFunding:[]
       },e.features.referenceTs+H);
       const e2=prefix[i];
       if(!e2?.shortSignal||!e2.features||
          e2.features.referenceTs!==e.features.referenceTs||
          Math.abs(e2.features.atr24Ratio-e.features.atr24Ratio)>1e-10)
          throw Error('P17_PREFIX_NO_FUTURE_PINNED_SIGNAL_INVARIANCE_FAIL:'+period);
       prefixChecks++;
    }
 }
 if(withinPeriodShortIntentCount!==COUNT[period])
   throw Error('P17_NATIVE_SIGNAL53_PERIOD_COVERAGE_FAIL:'+period+':'+withinPeriodShortIntentCount);
 audit[period]={
   sourceRecords:p.rows.length,maturedTrainingExamples:matured,
   maturedTrainingWins:maturedWins,skippedMaturedSamplesBadFeatures:updateSkipped,
   nativeShortSignals:withinPeriodShortIntentCount,
   pinnedPrefixInvarianceChecks:prefixChecks,
   mktSourceHashes:{PENGU:p.hashes,BTC:btc.hashes},
 };
}
if(all.length!==53||all.filter(x=>x.sourceNativeWin30).length!==29)
 throw Error('P17_SOURCE53_CASE_COUNT_OR_29_WINS_CHANGED');
for(const x of all){
 if(x.lastMaturedTrainingLabelReferenceTs!==null&&
 x.lastMaturedTrainingLabelReferenceTs>x.shortSignalReferenceTs)
  throw Error('P17_VIOLATED_CAUSAL_TRAINING_TIME_BOUND');
}
const metrics={ALL:evaluate(all)};
for(const period of Object.keys(COUNT))metrics[period]=evaluate(all.filter(x=>x.period===period));
const out={
 schema:'prism7-p17-source53-online-prequential-H1-24h-direction-logistic/v1',
 pinnedRuntimeSha:PIN,
 naturalSourceTradeIntentsUnchanged:53,nativeOriginalWinsUnchanged:29,
 fixedLearningRate:LR,fixedL2:L2,fixedTargetMaturityHours:LAG,
 fixedFeatureCount:9,
 fixedFeatureNormalization:[
  'PENGU_RET24H/.10','PENGU_RET72H/.25','BTC_RET24H/.06',
  'REL_RET24H/.10','PENGU_CLOSE_OVER_EMA72/.12',
  'BTC_EMA168_DISTANCE/.08','VOLUME_RATIO_MINUS1/2',
  'ATR_RATIO_MINUS_0.025/.025','RSI_MINUS50/25'],
 targetLabel:'FUTURE_24H_PENGU_H1_SHORT_NET_OF_30BPS_POSITIVE_NOT_NATIVE_STOP_PNL',
 cohortAudit:audit,metrics,
 limitations:[
  'All SOURCE native original53 outcomes are historically observed; 24h online prequential is not a fresh blind unseen-market OOS.',
  '24h future-H1 label is a market-price direction proxy; original SOURCE SHORT V20 has dynamic 72h STOP and funding.',
  'Algorithm never observes native trade winner/loser labels during training. No native STOP/ENTRY changes.',
  'H1 source price is not a signed venue fill; low liquidity and provider H1/M5 mismatch remain unresolved.',
  'Threshold .5 is a diagnostic, not an executable gate. All 53 original SOURCE candidates are included.',
  'No live orders, no shared Gross, no portfolio DD, no production deployment authorized.',
 ],
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_NATIVE53_PREDICTIONS.json'),
 JSON.stringify(all,null,2)+'\n');
console.log('PRISM7_P17_CAUSAL_ONLINE24H_SOURCE53_PASS',JSON.stringify(metrics));
console.log('OUT',OUT);
