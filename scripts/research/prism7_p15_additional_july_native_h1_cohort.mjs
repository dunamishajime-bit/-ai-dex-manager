/** PRISM7 P15 — native SOURCE pin H1 SHORT V20 study for July26–July31 2025.
 * H1 prices only: not signed fills, not an independent OOS guarantee.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';
const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const H=3600000;
const ROOT=process.env.PRISM_NATIVE_ROOT,WORK=process.env.PRISM_NATIVE_WORK,
 OUT=process.env.PRISM_NATIVE_P15_OUTPUT;
if(!ROOT||!WORK||!OUT)throw Error('P15_ROOT_WORK_OUT_REQUIRED');
const START=Date.parse('2025-07-18T12:00:00Z');
const ENTRY_START=Date.parse('2025-07-26T00:00:00Z');
const ENTRY_END=Date.parse('2025-08-01T00:00:00Z');
const DATA_END=Date.parse('2025-08-08T00:00:00Z');
function source(sym){
 const f=path.join(ROOT,'aster-public-v3-h1-early',
   sym+'-1h-20250301-20250924.jsonl.gz');
 const compressed=fs.readFileSync(f);
 const raw=zlib.gunzipSync(compressed).toString('utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
 if(!raw.length)throw Error('P15_MISSING_H1_SOURCE:'+sym);
 const all=raw.map(a=>({
   openTime:Number(a[0]),closeTime:Number(a[6]),
   open:Number(a[1]),high:Number(a[2]),low:Number(a[3]),
   close:Number(a[4]),volume:Number(a[5])
 }));
 for(let i=1;i<all.length;i++)
  if(all[i].openTime-all[i-1].openTime!==H)
    throw Error('P15_GAPPED_OR_DUPLICATE_H1_'+sym);
 let outOfScopeMalformedCandles=0;
 for(const a of all){
  if(!(a.low>0&&a.low<=Math.min(a.open,a.close)&&
       a.high>=Math.max(a.open,a.close)&&a.volume>=0)){
    if(a.openTime>=DATA_END){outOfScopeMalformedCandles++;continue;}
    throw Error('P15_BAD_H1_WITHIN_FIXED_OBSERVATION_WINDOW_'+sym+':'+a.openTime);
  }
 }
 return {symbol:sym,fullBarCount:all.length,outOfScopeMalformedCandles,
   sourceBegin:new Date(all[0].openTime).toISOString(),
   sourceEnd:new Date(all.at(-1).openTime+H).toISOString(),
   zeroVolumeSourceH1:all.filter(x=>x.volume===0).length,
   sha256:crypto.createHash('sha256').update(compressed).digest('hex'),
   rows:all.filter(x=>x.openTime>=START&&x.openTime<DATA_END),
 };
}
const p=source('PENGUUSDT'),b=source('BTCUSDT');
if(p.rows[0].openTime!==START||p.rows.at(-1).openTime+H!==DATA_END||
   b.rows[0].openTime!==START||b.rows.at(-1).openTime+H!==DATA_END)
   throw Error('P15_SOURCE_EARLY_CALENDAR_ALIGNMENT_FAILED');
for(let i=0;i<p.rows.length;i++)
 if(p.rows[i].openTime!==b.rows[i].openTime)
   throw Error('P15_SOURCE_BTC_PENGU_H1_MISALIGNED');
const evals=buildPenguDualLsV2EvaluationSeries({
  pengu1h:p.rows,btc1h:b.rows,penguFunding:[]
},DATA_END);
if(evals.length!==p.rows.length)throw Error('P15_PIN_EVAL_MISMATCH');
const cases=[],signalRecords=[];
for(let i=0;i<evals.length-1;i++){
 const e=evals[i];
 if(!e.features||!e.shortSignal)continue;
 const intent=e.features.referenceTs+H;
 if(intent<ENTRY_START||intent>=ENTRY_END)continue;
 if(p.rows[i+1].openTime!==intent)throw Error('P15_ENTRY_NOT_NEXT_H1');
 const entryPrice=p.rows[i+1].open;
 const raw=replayPinnedShortExit({
    evals,penguH1:p.rows,entryIndex:i+1,
    entryTs:intent,entryPrice,requestedGross:1,
    exitHorizonTs:DATA_END,
 });
 const signal={
    entryTs:intent,entryPrice,sourceSignalReferenceTs:e.features.referenceTs,
    entryH1PositiveVolume:p.rows[i+1].volume>0,
    sourcePreEntryH1s:i+1,originalPin:PIN,
 };
 signalRecords.push(signal);
 if(raw.status==='NATIVE_EXIT_MODELED'){
   const gross=100*(1-raw.exitPrice/entryPrice);
   cases.push({...signal,...raw,grossReturnPct:gross,
      net10Pct:gross-.1,net30Pct:gross-.3,
      signedVenueFill:false,notM5Verified:true});
 }else{
   cases.push({...signal,...raw,net10Pct:null,net30Pct:null,
      signedVenueFill:false,notM5Verified:true});
 }
}
const closed=cases.filter(x=>x.status==='NATIVE_EXIT_MODELED');
const mt=x=>{
 const y=closed.map(z=>z[x]).filter(z=>z!==null);
 const wins=y.filter(z=>z>0),profit=wins.reduce((a,z)=>a+z,0);
 const loss=-y.filter(z=>z<0).reduce((a,z)=>a+z,0);
 return {sourceNaturalIntentCount:cases.length,completedNativePriceExits:y.length,
         rightCensored:cases.length-y.length,
         modeledWins:wins.length,modeledWinRatePct:y.length?100*wins.length/y.length:null,
         modeledMeanNetPct:y.length?y.reduce((a,z)=>a+z,0)/y.length:null,
         modeledPricePf:loss>0?profit/loss:null};
};
const report={
 schema:'prism7-p15-july26-july31-new-calendar-native-source-H1/v1',
 pinnedSourceSha:PIN,sourceP:(({rows,...s})=>s)(p),
 sourceB:(({rows,...s})=>s)(b),
 studyDataStartUtc:new Date(START).toISOString(),
 entryStartUtc:new Date(ENTRY_START).toISOString(),
 entryEndUtc:new Date(ENTRY_END).toISOString(),
 nativeExitObservationEndUtc:new Date(DATA_END).toISOString(),
 sourceQualityAmendment:'P15A_2025_09_13_BTC_H1_MALFORMED_OUTSIDE_2025_08_08_OBSERVATION_END',
 warmupHoursBeforeEntryStart:(ENTRY_START-START)/H,
 sourceNaturalSignals:cases.length,
 entryHourNoPositiveVolume:cases.filter(x=>!x.entryH1PositiveVolume).length,
 outcomes:{fee10:mt('net10Pct'),fee30:mt('net30Pct')},
 limitations:[
  'H1 public price model only, PENGU M5 July source not archived; signed venue fills not proven.',
  'This archive was collected previously and cannot be certified blind untouched OOS.',
  'Early H1 PENGU starts July18 despite March01 archive filename; long pre-Aug holdout unavailable.',
  'All source natural signal candidates retained even if no completed exit or no entry print.',
  'No cross-runner gross, risk gates, funding, realistic slippage, execution book or account DD.'
 ],
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_CASES.json'),
 JSON.stringify(cases,null,2)+'\n');
console.log('PRISM7_P15_ADDITIONAL_CALENDAR_NATIVE_H1_CHECK_PASS',JSON.stringify({
    naturalSignals:cases.length,entryH1NoPrint:report.entryHourNoPositiveVolume,
    fee10:report.outcomes.fee10,fee30:report.outcomes.fee30,
    srcPenguStart:p.sourceBegin
}));
