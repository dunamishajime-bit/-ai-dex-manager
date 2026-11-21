/**
 * PRISM VII P14 — real 53 source natural SHORT intents with M5 positive-print
 * event-time entry, resident stops and original pinned H1 pure-state updater.
 * RESEARCH only; no signed venue fills or orderbook, no production writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';
import {replayP14M5SourceNativeShort,PIN_NATIVE_STOP_POLICY}
  from './prism7_p14_m5_causal_native_repriced_stop_core.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496',H=3600000;
const WORK=process.env.PRISM_NATIVE_WORK,ROOT=process.env.PRISM_NATIVE_ROOT;
const OUT=process.env.PRISM_NATIVE_P14_OUTPUT;
if(!WORK||!ROOT||!OUT)throw Error('P14_SOURCE_WORK_ROOT_OUTPUT_REQUIRED');
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
const ENTRY_CUT={...END,PRE_2025_AUG_SEP:Date.parse('2025-09-24T00:00:00Z')};
const EXPECTED={PRE_2025_AUG_SEP:6,BASE_2025_2026:40,POST_2026_OCT_NOV:7};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function load(file,zipped=false){
 const bytes=fs.readFileSync(file);
 const plain=(zipped?zlib.gunzipSync(bytes):bytes).toString('utf8');
 return {rows:plain.split(/\r?\n/).filter(Boolean).map(JSON.parse),
          sha256:sha(bytes)};
}
function sourceFiles(symbol,period){
 const main=path.join(ROOT,'aster-public-v3-h1',symbol+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
   symbol+'-1h-20250801-20250924'+(symbol==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
   symbol+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,main]:
   period==='BASE_2025_2026'?[main]:[main,post];
}
function loadH1(sym,period){
 const arr=[],hashes={};
 for(const f of sourceFiles(sym,period)){
   const {rows,sha256}=load(f,true);
   hashes[path.basename(f)]=sha256;
   for(const a of rows){
     const t=Number(a[0]);
     if(t>=END[period])continue;
     arr.push({
       openTime:t,closeTime:Number(a[6]),open:Number(a[1]),high:Number(a[2]),
       low:Number(a[3]),close:Number(a[4]),volume:Number(a[5])
     });
   }
 }
 if(arr.length<168)throw Error('P14_H1_WARMUP_INCOMPLETE:'+period);
 for(let i=1;i<arr.length;i++){
   if(arr[i].openTime-arr[i-1].openTime!==H)
      throw Error('P14_H1_GAP_OR_DUPLICATE:'+period+':'+sym);
 }
 return {candles:arr,hashes};
}
function rawTape(period){
 const dir=period==='PRE_2025_AUG_SEP'
  ?path.join(WORK,'phase2_results','native_lifecycle_prebaseline','pengu-native-lifecycle-modeled-exits.jsonl')
  :period==='BASE_2025_2026'
  ?path.join(ROOT,'PENGU_NATIVE_LIFECYCLE_EXIT_20261109','pengu-native-lifecycle-modeled-exits.jsonl')
  :path.join(WORK,'phase2_results','native_lifecycle_forward','pengu-native-lifecycle-modeled-exits.jsonl');
 const {rows,sha256}=load(dir);
 return {rows:rows.filter(x=>x.route==='SHORT_V20'),sha256};
}
const M5FILES=[
 path.join(WORK,'prebaseline_public_20250801_20250924','PENGUUSDT-5m-20250801-20250924.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-prefix','PENGUUSDT-5m-20250924-20260803.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-suffix','PENGUUSDT-5m-20260803-20261001.jsonl.gz'),
 path.join(WORK,'forward_public_20261001_20261118','PENGUUSDT-5m-20261001-20261118.jsonl.gz'),
];
const m5=new Map(),m5Hashes={};
for(const f of M5FILES){
 const {rows,sha256}=load(f,true);
 m5Hashes[path.basename(f)]=sha256;
 for(const row of rows){
   const t=Number(row[0]);
   if(m5.has(t))throw Error('P14_DUPLICATE_PUBLIC_M5:'+t);
   m5.set(t,row);
 }
}
const source53=JSON.parse(fs.readFileSync(
 path.join(WORK,'results','PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json'),'utf8'));
if(source53.length!==53||source53.some(x=>x.parity!=='EXACT'))
  throw Error('P14_53_SOURCE_ENTRY_EXIT_PARITY_REQUIRED');
const source53Map=new Map(source53.map(x=>[x.period+'|'+x.id+'|'+x.entryTs,x]));
if(source53Map.size!==53)throw Error('P14_DUPLICATE_REAL_SOURCE53');
const full=[],sources={};
for(const period of Object.keys(END)){
 const pengu=loadH1('PENGUUSDT',period),
       btc=loadH1('BTCUSDT',period);
 if(pengu.candles.length!==btc.candles.length)
   throw Error('P14_SOURCE_H1_PENGU_BTC_LENGTH_MISMATCH');
 const evals=buildPenguDualLsV2EvaluationSeries({
    pengu1h:pengu.candles,btc1h:btc.candles,penguFunding:[]
 },END[period]);
 const tape=rawTape(period);
 if(tape.rows.length!==EXPECTED[period])
  throw Error('P14_EXPECTED_SOURCE53_COHORT_LENGTH_CHANGED:'+period);
 sources[period]={rawNativeTapeSha256:tape.sha256,penguH1:pengu.hashes,btcH1:btc.hashes};
 const byTs=new Map(pengu.candles.map((bar,i)=>[bar.openTime,i]));
 const sourceByEntry=new Map(tape.rows.map(x=>[x.entryTs,x]));
 let signals=0;
 for(const x of evals){
   if(!x.features||!x.shortSignal)continue;
   const entry=x.features.referenceTs+H;
   if(entry>=BEGIN[period]&&entry<ENTRY_CUT[period]){
     if(!sourceByEntry.has(entry))
       throw Error('P14_ADDITIONAL_NATIVE_CANDIDATE_NOT_IN_SOURCE_TAPE:'+period+':'+entry);
     signals++;
   }
 }
 if(signals!==EXPECTED[period])throw Error('P14_NATIVE_SHORT_CANDIDATE_COVERAGE_FAIL');
 for(const raw of tape.rows){
   if(raw.sourceRuntimeSha!==PIN ||
      raw.entryTs<BEGIN[period]||raw.entryTs>=ENTRY_CUT[period])
      throw Error('P14_SOURCE_PIN_OR_ENTRY_WINDOW_INVALID');
   const idx=byTs.get(Number(raw.entryTs));
   if(idx===undefined||idx===0||!evals[idx-1]?.shortSignal)
     throw Error('P14_NATURAL_SHORT_SOURCE_ENTRY_MISSING');
   const key=period+'|'+raw.id+'|'+raw.entryTs,orig=source53Map.get(key);
   if(!orig ||
      Math.abs(orig.entryPrice-raw.entryPrice)>1e-12 ||
      Math.abs(orig.exitPrice-raw.exitPrice)>1e-12 ||
      orig.exitTs!==raw.exitTs||orig.exitReason!==raw.exitReason)
      throw Error('P14_SOURCE_P8_REAL53_CASE_INCONSISTENT');
   const pure=replayPinnedShortExit({
       evals,penguH1:pengu.candles,entryIndex:idx,
       entryTs:raw.entryTs,entryPrice:raw.entryPrice,
       requestedGross:raw.requestedGross,exitHorizonTs:END[period]
   });
   if(pure.status!=='NATIVE_EXIT_MODELED'||
      pure.exitTs!==raw.exitTs||pure.exitReason!==raw.exitReason||
      Math.abs(pure.exitPrice-raw.exitPrice)>1e-10)
       throw Error('P14_PRECONDITION_NATIVE_EXIT_NOT_53_PARITY');
   const sim=replayP14M5SourceNativeShort({
     evals,penguH1:pengu.candles,m5,entryIndex:idx,
     sourceEntryTs:raw.entryTs,sourceEntryPrice:raw.entryPrice,
     requestedGross:raw.requestedGross,sourceNativeExitTs:raw.exitTs,
     maxExitHorizonTs:END[period],
   });
   const o={
     period,id:raw.id,sourcePin:PIN,
     sourceEntryTs:raw.entryTs,sourceEntryPrice:raw.entryPrice,
     sourceExitTs:raw.exitTs,sourceExitPrice:raw.exitPrice,
     sourceExitReason:raw.exitReason,sourceGross:raw.requestedGross,
     sourceNativeNet30Pct:100*(1-raw.exitPrice/raw.entryPrice)-.3,
     sourceNativeWin30:100*(1-raw.exitPrice/raw.entryPrice)-.3>0,
     model:sim,
   };
   full.push(o);
 }
}
if(full.length!==53)throw Error('P14_NATURAL_SOURCE53_INTENTS_LOST');
const cases=[];
for(const x of full){
 const n=x.model;
 for(const feeBps of [10,30])for(const extraExitSlippageBps of [0,10,25]){
  const done=n.status==='PRICE_PROXY_CLOSED';
  const ret=done?100*(1-n.observedExitPrice/n.observedEntryPrice):null;
  cases.push({
    period:x.period,id:x.id,sourceEntryTs:x.sourceEntryTs,
    sourceEntryPrice:x.sourceEntryPrice,sourceExitTs:x.sourceExitTs,
    sourceExitPrice:x.sourceExitPrice,sourceExitReason:x.sourceExitReason,
    sourceNativeNet30Pct:x.sourceNativeNet30Pct,sourceNativeWin30:x.sourceNativeWin30,
    modeledStatus:n.status,entryProxyTs:n.observedEntryTs??null,
    entryProxyPrice:n.observedEntryPrice??null,
    entryDelayMinutes:n.entryDelayMinutes??null,
    exitProxyBarTs:n.observedExitBarStartTs??null,
    exitProxyPrice:n.observedExitPrice??null,
    exitReason:n.observedExitReason??null,
    exitType:n.observedExitType??null,
    exitDelayFromIntentMinutes:n.printExitDelayMinutes??null,
    feeBps,extraExitSlippageBps,
    netPct:done?ret-(feeBps+extraExitSlippageBps)/100:null,
    nativePositionAndStopRecomputedFromM5AfterEntry:done,
    sourcePureH1FunctionsUsed:true,signedVenueFillProven:false,
    hasTimeOfActualMarketTradeWithinM5:false,
  });
 }
}
if(cases.length!==318)throw Error('P14_53_X_2_X_3_SCENARIOS_INCOMPLETE');
const summarize=(rows)=>{
 const valid=rows.filter(x=>x.netPct!==null);
 const wins=valid.filter(x=>x.netPct>0),g=wins.reduce((a,x)=>a+x.netPct,0);
 const loss=-valid.filter(x=>x.netPct<0).reduce((a,x)=>a+x.netPct,0);
 const nativeSubset=valid.map(x=>x.sourceNativeNet30Pct);
 const sourceG=nativeSubset.filter(x=>x>0).reduce((a,x)=>a+x,0);
 const sourceL=-nativeSubset.filter(x=>x<0).reduce((a,x)=>a+x,0);
 return {
   sourceIntentCount:rows.length,
   sourceWinsAllIntents:rows.filter(x=>x.sourceNativeWin30).length,
   modelProxyComplete:valid.length,
   unfilledOrCensored:rows.length-valid.length,
   proxyWinCountConditional:wins.length,
   proxyWinRateConditionalPct:valid.length?100*wins.length/valid.length:null,
   proxyMeanNetConditionalPct:valid.length?valid.reduce((a,x)=>a+x.netPct,0)/valid.length:null,
   proxyPfConditional:loss>0?g/loss:null,
   sameSubsetSourceWinCount:nativeSubset.filter(x=>x>0).length,
   sameSubsetSourceMean30Pct:nativeSubset.length?
       nativeSubset.reduce((a,x)=>a+x,0)/nativeSubset.length:null,
   sameSubsetSourcePf30:sourceL>0?sourceG/sourceL:null,
   newWinnersFromSourceLosers:valid.filter(x=>!x.sourceNativeWin30&&x.netPct>0).length,
   sourceWinnersNowLose:valid.filter(x=>x.sourceNativeWin30&&x.netPct<=0).length,
 };
};
const economic=[];
for(const fee of [10,30])for(const extra of [0,10,25]){
 const slice=cases.filter(x=>x.feeBps===fee&&x.extraExitSlippageBps===extra);
 economic.push({feeBps:fee,extraExitSlippageBps:extra,...summarize(slice)});
}
const groupBy=(select,key)=>{
 const result={};
 for(const name of [...new Set(full.map(x=>select(x)))]){
   result[name]=full.filter(x=>select(x)===name).map(x=>key(x));
 }
 return result;
};
const statusSummary={};
for(const x of full)statusSummary[x.model.status]=(statusSummary[x.model.status]??0)+1;
const reasons={};
for(const x of full){
 const key=x.model.observedExitReason??x.model.status;
 reasons[key]=(reasons[key]??0)+1;
}
const sourceStats=summarize(cases.filter(x=>x.feeBps===30&&x.extraExitSlippageBps===0));
const output={
 schema:'prism7-p14-native-immutable-real53-m5-clock-event-proxy/v1',
 pinnedSourceSha:PIN,nativeEntryAndExitPrecondition:'PASS_53_53',
 sourceOriginalIntents:53,sourceOriginalWins:29,
 sourceOriginalNet30MeanPct:source53.reduce((a,x)=>a+x.net30pct,0)/53,
 sourceNativeStopPolicy:PIN_NATIVE_STOP_POLICY,
 sourceInputs:{originalSourceTapesAndH1:sources,m5GzipSha256:m5Hashes},
 modelStatusCounts:statusSummary,observedProxyReasons:reasons,
 sourceReasonCount:groupBy(x=>x.sourceExitReason,x=>x.id),
 economic,
 byPeriod:Object.fromEntries(Object.keys(EXPECTED).map(period=>
   [period,summarize(cases.filter(x=>x.period===period&&x.feeBps===30&&x.extraExitSlippageBps===0))])),
 limitations:[
   'M5 OHLCV is not source venue signed fills, order queue or executable bid/ask.',
   'Resident STOP M5 high touch is detectable but price and intrabar order are not known.',
   'H1 source features from provider are reused (except high/low since entry); PENGU H1/M5 source mismatch remains.',
   'H1-native V20 economic progression is evaluated after completed H1; no fill at same H1 open on such a decision.',
   'Research entry at first positive-volume M5 open is a proxy, not proof the order queue filled at this price.',
   'Original production concurrent gross, owner admission, funding and shared risk not modeled.',
   'Already seen natural53 is not independent OOS. No compound portfolio risk/DD.',
 ],
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
const eventsFile=OUT.replace('.json','_EVENTS_53.json');
fs.writeFileSync(eventsFile,JSON.stringify(full,null,2)+'\n');
const casesFile=OUT.replace('.json','_SCENARIOS_318.jsonl');
fs.writeFileSync(casesFile,cases.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log('PRISM7_P14_M5_CLOCK_EVENT_NATIVE_REPRICED_COMPLETE',JSON.stringify({
  source53:full.length,sourceParity:'PASS_53_53',statuses:statusSummary,reasons,
  model30bps:economic.find(x=>x.feeBps===30&&x.extraExitSlippageBps===0),
  stressed:economic.find(x=>x.feeBps===30&&x.extraExitSlippageBps===25)
}));
console.log('OUT',OUT);
