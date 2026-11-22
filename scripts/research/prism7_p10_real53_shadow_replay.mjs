/**
 * PRISM VII P8 immutable source REAL parity before native synthetic study.
 * No orders, no live connection, no source economic-code modifications.
 * Runs original SHA166... PENGU source native pure ENTRY and EXIT.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries,evaluatePenguDualLsV2PositionBar}
  from './lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './lib/pengu-short-v20.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';
import {replayPinnedShortWithP10} from './prism7_p10_native_reversal_sentinel_core.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const H=3600000;
const ROOT=process.env.PRISM_NATIVE_ROOT;
const WORK=process.env.PRISM_NATIVE_WORK;
if(!ROOT||!WORK)throw Error('PRISM_NATIVE_ROOT_AND_WORK_REQUIRED');
const SRC=path.join(WORK,'phase2_results');
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
const expected={PRE_2025_AUG_SEP:6,BASE_2025_2026:40,POST_2026_OCT_NOV:7};
const ENTRY_CUT={...END,PRE_2025_AUG_SEP:Date.parse('2025-09-24T00:00:00Z')};

function loadJsonl(file,gzip=false){
 const bytes=fs.readFileSync(file);
 const txt=(gzip?zlib.gunzipSync(bytes):bytes).toString('utf8');
 const rows=txt.split(/\r?\n/).filter(Boolean).map(JSON.parse);
 return {rows,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function sourceFiles(sym,period){
 const base=path.join(ROOT,'aster-public-v3-h1',sym+'-1h-20250924-20261001.jsonl.gz');
 const pre=path.join(WORK,'prebaseline_public_20250801_20250924',
   sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
   sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[pre,base]:
        period==='BASE_2025_2026'?[base]:
        [base,post];
}
function loadH1(sym,period){
 const files=sourceFiles(sym,period);
 const result=[];
 const hashes={};
 for(const f of files){
  const {rows,sha256}=loadJsonl(f,true);
  hashes[path.basename(f)]=sha256;
  for(const a of rows){
   const t=Number(a[0]);
   if(t>=END[period])continue;
   result.push({
     openTime:t,closeTime:Number(a[6]),
     open:Number(a[1]),high:Number(a[2]),low:Number(a[3]),
     close:Number(a[4]),volume:Number(a[5])
   });
  }
 }
 for(let i=1;i<result.length;i++)
   if(result[i].openTime-result[i-1].openTime!==H)
      throw Error('H1_SOURCE_GAP:'+period+':'+sym+':'+i);
 if(result.length<168)throw Error('H1_WARMUP_UNDER168:'+period+':'+sym);
 return {candles:result,files:hashes};
}
function exitFile(period){
 return period==='PRE_2025_AUG_SEP'
   ?path.join(SRC,'native_lifecycle_prebaseline','pengu-native-lifecycle-modeled-exits.jsonl'):
   period==='BASE_2025_2026'
   ?path.join(ROOT,'PENGU_NATIVE_LIFECYCLE_EXIT_20261109','pengu-native-lifecycle-modeled-exits.jsonl'):
   path.join(SRC,'native_lifecycle_forward','pengu-native-lifecycle-modeled-exits.jsonl');
}
function checkExit(source,entryTs,pengu,index,evals){
 const f=evals[index-1]?.features;
 if(!f||f.referenceTs!==entryTs-H)
   throw Error('ASOF_ENTRY_ANCHOR_MISSING:'+source.id);
 const entryBar=pengu[index];
 if(!entryBar||entryBar.openTime!==entryTs)
    throw Error('ASOF_ENTRY_H1_MISSING:'+source.id);
 if(Math.abs(entryBar.open-source.entryPrice)>1e-12)
   throw Error('ASOF_ENTRY_PRICE_MISMATCH:'+source.id);
 const ep=entryBar.open,gross=source.requestedGross;
 const pos0={
    side:-1,entryTs,entryPrice:ep,quantity:1,gross,
    highWaterMark:ep,lowWaterMark:ep,entryVersion:'SHORT_V20',
    shortV20:createPenguShortV20State({
      entryPrice:ep,requestedGross:gross,
      entryAtr24Ratio:f.atr24Ratio,
      btcEma168Distance:f.btcEma168Distance,
      btcReturn24h:f.btcReturn24h,
    })
 };
 let pos=pos0;let final=null;
 for(let j=index;j<evals.length;j++){
  const e=evals[j],feat=e.features;
  if(!feat||feat.referenceTs<entryTs)continue;
  if(feat.referenceTs+H>END[source._period])break;
  const update=evaluatePenguDualLsV2PositionBar(pos,feat);
  pos=update.updatedPosition;
  if(!update.exit)continue;
  const reason=update.exit.reason;
  let px,kind;
  if(update.exit.stopPrice!==undefined &&
      (reason.includes('HARD_STOP')||reason.includes('TRAILING_STOP'))){
       px=Number(update.exit.stopPrice);kind='RESIDENT_STOP_PRICE_MODEL';
  }else{
   const next=pengu[j+1];
   if(!next||next.openTime!==feat.referenceTs+H)break;
   px=next.open;kind='CAUSAL_NEXT_H1_OPEN';
  }
  if(!(px>0))throw Error('NONPOSITIVE_PRICE');
  final={exitTs:feat.referenceTs+H,exitReason:reason,exitPrice:px,exitPriceKind:kind};
  break;
 }
 return final;
}
const all=[],perPeriod=[],sources={};
for(const period of Object.keys(END)){
 const p=loadH1('PENGUUSDT',period),btc=loadH1('BTCUSDT',period);
 if(p.candles.length!==btc.candles.length)
    throw Error('PENGU_BTC_H1_LENGTH_MISMATCH:'+period);
 const evals=buildPenguDualLsV2EvaluationSeries({
    pengu1h:p.candles,btc1h:btc.candles,penguFunding:[],
 },END[period]);
 if(evals.length!==p.candles.length)throw Error('NATIVE_EVAL_LENGTH_MISMATCH');
 const {rows:sourceRows,sha256}=loadJsonl(exitFile(period));
 const native=sourceRows.filter(x=>x.route==='SHORT_V20');
 if(native.length!==expected[period])throw Error('SOURCE_EXPECTED_SHORT_COUNT_MISMATCH');
 sources[period]={exit_source_sha256:sha256,pengu_h1_sha256:p.files,btc_h1_sha256:btc.files};
 const map=new Map(p.candles.map((bar,i)=>[bar.openTime,i]));
 const byTs=new Map(native.map(x=>[x.entryTs,x]));
 if(byTs.size!==native.length)throw Error('DUPLICATE_NATIVE_SHORT_ENTRY');
 let signalCandidates=0;
 let extraRawSignals=[];
 for(let i=0;i<evals.length;i++){
  const e=evals[i];
  if(!e.features||!e.shortSignal)continue;
  const entry=e.features.referenceTs+H;
  if(entry>=BEGIN[period]&&entry<ENTRY_CUT[period]){signalCandidates++;if(!byTs.has(entry))extraRawSignals.push({entryTs:entry,referenceTs:e.features.referenceTs,price:p.candles[i+1]?.open});}
 }
 let matched=0;
 for(const raw of native){
  if(raw.sourceRuntimeSha!==PIN)throw Error('SOURCE_SHA_CHANGED:'+raw.id);
  if(raw.entryTs<BEGIN[period]||raw.entryTs>=ENTRY_CUT[period])throw Error('PERIOD_EXIT_SOURCE_RANGE');
  const index=map.get(Number(raw.entryTs));
  if(index===undefined||index===0)throw Error('NO_ENTRY_TIME_NATIVE:'+raw.id);
  const signal=evals[index-1];
  if(!signal?.shortSignal)throw Error('PINNED_NATIVE_SHORT_SIGNAL_NOT_REPRODUCED:'+raw.id);
  const final=checkExit({...raw,_period:period},raw.entryTs,p.candles,index,evals);
  const shared=replayPinnedShortExit({
    evals,penguH1:p.candles,entryIndex:index,
    entryTs:raw.entryTs,entryPrice:raw.entryPrice,
    requestedGross:raw.requestedGross,exitHorizonTs:END[period],
  });
  if(shared.status!=='NATIVE_EXIT_MODELED'||!final||
     shared.exitTs!==final.exitTs||
     shared.exitReason!==final.exitReason||
     shared.exitPriceKind!==final.exitPriceKind||
     Math.abs(shared.exitPrice-final.exitPrice)>1e-10)
      throw Error('SHARED_NATIVE_PURE_EXIT_NOT_PARITY:'+period+':'+raw.id);
  if(!final)throw Error('PINNED_NATIVE_EXIT_UNRESOLVED:'+raw.id);
  const parity={
    exitTs:final.exitTs===raw.exitTs,
    reason:final.exitReason===raw.exitReason,
    exitPrice:Math.abs(final.exitPrice-raw.exitPrice)<1e-10,
    exitKind:final.exitPriceKind===raw.exitPriceKind,
  };
  if(!Object.values(parity).every(Boolean)){
    console.error('PARITY_DIFFERENCE',JSON.stringify({period,id:raw.id,parity,expected:raw,modeled:final}));
    throw Error('PIN_NATIVE_EXIT_PARITY_FAIL:'+period+':'+raw.id);
  }
  const shadow=replayPinnedShortWithP10({
     evals,penguH1:p.candles,btcH1:btc.candles,entryIndex:index,
     entryTs:raw.entryTs,entryPrice:raw.entryPrice,requestedGross:raw.requestedGross,
     exitHorizonTs:END[period],
  });
  if(shadow.status!=='NATIVE_EXIT_MODELED' || shadow.exitTs>raw.exitTs)
      throw Error('P10_REAL53_NOT_CAUSAL_OR_NOT_CLOSED:'+period+':'+raw.id);
  if(!shadow.researchP10Triggered &&
      (shadow.exitTs!==raw.exitTs ||
       shadow.exitReason!==raw.exitReason ||
       Math.abs(shadow.exitPrice-raw.exitPrice)>1e-10))
     throw Error('P10_REAL53_NATIVE_PRIORITY_PARITY_FAIL:'+period+':'+raw.id);
  matched++;
  all.push({period,id:raw.id,entryTs:raw.entryTs,exitTs:raw.exitTs,
    entryPrice:raw.entryPrice,exitPrice:raw.exitPrice,exitReason:raw.exitReason,
    requestedGross:raw.requestedGross,native_short_signal:signal.shortSignal,
    net30pct:100*(1-raw.exitPrice/raw.entryPrice)-.3,
    p10_exitTs:shadow.exitTs,p10_exitPrice:shadow.exitPrice,
    p10_exitReason:shadow.exitReason,
    p10_researchTriggered:shadow.researchP10Triggered,
    p10_evidence:shadow.p10Evidence??null,
    p10_net10pct:100*(1-shadow.exitPrice/raw.entryPrice)-.1,
    p10_net30pct:100*(1-shadow.exitPrice/raw.entryPrice)-.3,
    venue_signed_fill:false,
    parity:'EXACT',
  });
 }
 if(signalCandidates!==expected[period]||extraRawSignals.length!==0)
    throw Error('NATIVE_PERIOD_ENTRY_SIGNAL_COVERAGE_FAIL:'+period+':'+signalCandidates);
 perPeriod.push({period,entryCutUtc:new Date(ENTRY_CUT[period]).toISOString(),sourceShortCount:native.length,
   pinnedShortSignalsWithinPeriod:signalCandidates,
   rawShortSignalsAbsentFromSourceExitTape:extraRawSignals,
   pinnedExitParity:matched});
}
if(all.length!==53||all.filter(x=>x.parity!=='EXACT').length>0)
   throw Error('NATIVE_53_EXACT_PARITY_NOT_PROVEN');
const p10old=all.map(x=>x.net30pct),p10new=all.map(x=>x.p10_net30pct);
const stats=x=>{
  const wins=x.filter(z=>z>0),g=wins.reduce((a,z)=>a+z,0),l=-x.filter(z=>z<0).reduce((a,z)=>a+z,0);
  return {n:x.length,wins:wins.length,winRatePct:100*wins.length/x.length,
          meanNet30Pct:x.reduce((a,z)=>a+z,0)/x.length,
          pricePf:l>0?g/l:null};
};
const p10Audit={
   originalNative:stats(p10old),researchP10:stats(p10new),
   earlyExits:all.filter(x=>x.p10_researchTriggered).length,
   nativeWinnerDestroyed:all.filter(x=>x.net30pct>0&&x.p10_net30pct<=0).length,
   nativeLoserConverted:all.filter(x=>x.net30pct<=0&&x.p10_net30pct>0).length,
   nativeOriginalEntryExitParity:'PASS_53_53',
};
const result={
 schema:'prism7-p10-original-real53-frozen-asof-reversal-shadow/v1',
 p10Audit,
 sourcePinnedRuntimeSha:PIN,matchedSourceNativeShortExits:53,
 entryAndExitParity:'PASS_53_53',
 pinnedNativeCandidateCoverage:'PASS_53_53_IN_SOURCE_OWN_ENTRY_PERIOD',
 sharedNativeExitCoreParity:'PASS_53_53',
 perPeriod,sources,
 sourceImplementation:'PINNED_NATIVE_TS_MODULES_IMPORT_PATH_ADAPTER_ONLY',
 limitations:[
 'Native source resident STOP price model, not actual venue order fills.',
 'The same already studied H1 source periods are not independent OOS.',
 'PENGU H1 and M5 provider mismatch remains a separate known source issue.',
 'No owner admission, funding, true gross/shared risk or multiple-runner PnL.',
 ],
};
const output=process.env.PRISM_NATIVE_OUTPUT;
if(!output)throw Error('PRISM_NATIVE_OUTPUT_REQUIRED');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(output.replace('.json','_53_CASES.json'),
  JSON.stringify(all,null,2)+'\n');
console.log('PRISM7_P10_NATIVE_REAL53_SHADOW_PASS',JSON.stringify(perPeriod));
console.log('PINNED_53_MATCHED',all.length);
console.log('REPORT',output);
