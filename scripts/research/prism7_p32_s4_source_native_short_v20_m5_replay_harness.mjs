/**
 * PRISM VII P32: New PENGU S4 structural SHORT entries from P22 SOURCE120, now
 * through pinned immutable V20 native exit pure functions with causal M5 price.
 * Outputs every candidate, per-entry (may overlap), original SOURCE 1-slot
 * native exit replay, source QA manifests. No trading / master / VPS changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayP32NativeV20AtS4Entry,H,M5} from './prism7_p32_native_s4_non_source_entry_m5_exit_core.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const WORK=process.env.PRISM_NATIVE_WORK,
 ROOT=process.env.PRISM_NATIVE_ROOT,
 OUT=process.env.PRISM_NATIVE_P32_OUTPUT;
if(!WORK||!ROOT||!OUT)throw Error('P32_NEEDS_NATIVE_WORK_ROOT_OUTPUT');

const PERIODS={
 'PRE_2025_AUG_SEP':{end:Date.parse('2025-10-01T00:00:00Z'),count:9},
 'BASE_2025_2026':{end:Date.parse('2026-10-01T00:00:00Z'),count:85},
 'POST_2026_OCT_NOV':{end:Date.parse('2026-11-18T00:00:00Z'),count:26},
};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const sourceOriginalPath=path.join(WORK,'results','PRISM7_P22_PENGU_S4_FAILED_REBOUND_240_EVENTS_20261122.jsonl');
const s4raw=fs.readFileSync(sourceOriginalPath,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const s4=s4raw.filter(x=>x.group==='S4_ALL_CANDIDATES');
if(s4.length!==120||new Set(s4.map(x=>x.id)).size!==120)
 throw Error('P32_SOURCE_S4_H1_ENTRY_120_NOT_FOUND');
for(const [period,req] of Object.entries(PERIODS)){
 if(s4.filter(x=>x.cohort===period).length!==req.count)
  throw Error('P32_S4_PRECOMMITTED_CALENDAR_CANDIDATE_COUNT_CHANGED');
}
function H1files(sym,period){
 const prefix=path.join(WORK,'prebaseline_public_20250801_20250924',
   sym+'-1h-20250801-20250924'+(sym==='BTCUSDT'?'-RESEARCH_M5QA':'')+'.jsonl.gz');
 const base=path.join(ROOT,'aster-public-v3-h1',
   sym+'-1h-20250924-20261001.jsonl.gz');
 const post=path.join(WORK,'forward_public_20261001_20261118',
   sym+'-1h-20261001-20261118.jsonl.gz');
 return period==='PRE_2025_AUG_SEP'?[prefix,base]:
        period==='BASE_2025_2026'?[base]:[base,post];
}
function loadH1(sym,period){
 const sourceHash={};const rows=[];
 const end=PERIODS[period].end;
 for(const filename of H1files(sym,period)){
  const raw=fs.readFileSync(filename);
  sourceHash[path.basename(filename)]=hash(raw);
  const bytes=zlib.gunzipSync(raw).toString('utf8').split(/\r?\n/).filter(Boolean);
  for(const line of bytes){
   const x=JSON.parse(line),ts=Number(x[0]);
   if(ts>=end)continue;
   rows.push({openTime:ts,closeTime:Number(x[6]),
     open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),
     close:Number(x[4]),volume:Number(x[5])});
  }
 }
 if(rows.length<168)throw Error('P32_H1_SOURCE_WARMUP_INSUFFICIENT');
 for(let i=1;i<rows.length;i++)
  if(rows[i].openTime!==rows[i-1].openTime+H)
   throw Error('P32_H1_SOURCE_GAP_OR_DUPLICATE:'+sym+':'+period+':'+i);
 return {rows,sourceHash};
}
const M5FILES=[
 path.join(WORK,'prebaseline_public_20250801_20250924','PENGUUSDT-5m-20250801-20250924.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-prefix','PENGUUSDT-5m-20250924-20260803.jsonl.gz'),
 path.join(ROOT,'aster-public-v3-5m-suffix','PENGUUSDT-5m-20260803-20261001.jsonl.gz'),
 path.join(WORK,'forward_public_20261001_20261118','PENGUUSDT-5m-20261001-20261118.jsonl.gz'),
];
const m5=new Map(),m5Hash={};
for(const f of M5FILES){
 const raw=fs.readFileSync(f);
 m5Hash[path.basename(f)]=hash(raw);
 for(const line of zlib.gunzipSync(raw).toString('utf8').split(/\r?\n/).filter(Boolean)){
   const x=JSON.parse(line),ts=Number(x[0]);
   const prev=m5.get(ts);
   if(prev && JSON.stringify(prev)!==JSON.stringify(x))
    throw Error('P32_SOURCE_PENGU_M5_DUPLICATE_DIFFERENT:'+ts);
   m5.set(ts,x);
 }
}
const posCandidate=s4.filter(x=>x.entryProxyTs!==null&&x.entryProxyTs!==undefined&&
 (x.status==='PRICE_PROXY_CLOSED'||x.status.startsWith('RIGHT_CENSORED')));
const naturalPositiveEntries=posCandidate.length;
if(naturalPositiveEntries<20||naturalPositiveEntries>100)
 throw Error('P32_NATIVE_PENGU_S4_SUSPICIOUS_SOURCE_ENTRY_COUNTS:'+naturalPositiveEntries);
const byID=new Map(posCandidate.map(x=>[x.id,x]));
if(byID.size!==naturalPositiveEntries)throw Error('P32_DUPLICATED_POSITIVE_MODEL_ENTRY_IDS');

const perPeriod={};const manifest={};
for(const period of Object.keys(PERIODS)){
 const pengu=loadH1('PENGUUSDT',period);
 const btc=loadH1('BTCUSDT',period);
 if(pengu.rows.length!==btc.rows.length ||
    pengu.rows.some((x,i)=>x.openTime!==btc.rows[i].openTime))
  throw Error('P32_PINNED_SOURCE_H1_PENGU_BTC_TIMES_NOT_ALIGNED');
 const evals=buildPenguDualLsV2EvaluationSeries({
     pengu1h:pengu.rows,btc1h:btc.rows,penguFunding:[]
   },PERIODS[period].end);
 if(evals.length!==pengu.rows.length)
  throw Error('P32_PIN_NATIVE_SOURCE_FEATURES_NOT_MATCH_H1');
 const h1idx=new Map(pengu.rows.map((x,i)=>[x.openTime,i]));
 perPeriod[period]={evals,h1idx,pengu1h:pengu.rows};
 manifest[period]={sourcePenguH1Hash:pengu.sourceHash,sourceBTC1hHash:btc.sourceHash,
                    sourceH1Rows:pengu.rows.length};
}
const candidates=[];const allDetails=[];
for(const entry of s4){
 const keep={
   id:entry.id,route:entry.route,cohort:entry.cohort,
   signalReferenceTs:entry.signalReferenceTs,
   intentTs:entry.intentTs,entryProxyTs:entry.entryProxyTs??null,
   entryProxyPrice:entry.entryProxyPrice??null,
   originalReferenceStatus:entry.status,
   originalReferenceExitTs:entry.exitProxyTs??null,
   originalReferenceExitPrice:entry.exitProxyPrice??null,
   originalReferenceExitReason:entry.exitReason??null,
   originalS4SourceRuntimeUntouched:true,
   newS4EntryNotGeneratedByPinnedV20NativeSignal:true,
   useOnlyImmutablePinnedNativeShortExit:true,
 };
 if(!byID.has(entry.id)){
   candidates.push({...keep,status:entry.status,exitProxyTs:null,
                    exitProxyPrice:null,exitReason:null});
   continue;
 }
 const start=Number(entry.entryProxyTs),price=Number(entry.entryProxyPrice);
 const opening=m5.get(start);
 if(!opening||Number(opening[5])<=0||Math.abs(Number(opening[1])-price)>1e-12)
  throw Error('P32_SOURCE_S4_M5_ENTRY_NOT_OBSERVED_SAME_PRICE:'+entry.id);
 const source=perPeriod[entry.cohort];
 const hour=Math.floor(start/H)*H;
 const j=source.h1idx.get(hour);
 if(j===undefined||j<1)throw Error('P32_NO_PREENTRY_COMPLETED_H1:'+entry.id);
 const outcome=replayP32NativeV20AtS4Entry({
    evals:source.evals,penguH1:source.pengu1h,m5,entryHourIndex:j,
    sourceSignalReferenceTs:Number(entry.signalReferenceTs),
    entryIntentTs:Number(entry.intentTs),
    entryActualTs:start,entryActualPrice:price,
    exitHorizonTs:PERIODS[entry.cohort].end,
 });
 const row={
   ...keep,status:outcome.status,
   exitProxyTs:outcome.exitTs??null,
   exitProxyPrice:outcome.exitPrice??null,
   exitReason:outcome.exitReason??outcome.originalNativeH1ExitReason??
              outcome.originalNativeH1StopReason??null,
   sourceV20AsOfPreviousCompletedH1Ts:outcome.sourceH1Anchor,
   nativeReferenceStopH1Count:outcome.flags?.progressedH1Count??0,
   nativeReferenceStopH1NoPrint:outcome.flags?.zeroPositiveM5Hours??0,
   nativeReasonChangedFromP22Reference:outcome.exitReason!==entry.exitReason,
   sourceV20NativeReferenceStateUsed:true,
   noSourceSignedVenueExecutionEvidence:true,
 };
 if(row.status==='PRICE_PROXY_CLOSED' &&
    !(row.exitProxyTs>=row.entryProxyTs&&row.exitProxyPrice>0))
  throw Error('P32_NONCAUSAL_NATIVE_V20_EXIT_PRICE_SOURCE:'+row.id);
 candidates.push(row);
 allDetails.push({
   id:entry.id,route:entry.route,cohort:entry.cohort,
   originalS4Source:{status:entry.status,entryTs:start,entryPrice:price,
      exitTs:entry.exitProxyTs,exitPrice:entry.exitProxyPrice,
      exitReason:entry.exitReason},
   nativePinnedExitSimulatedFromNewS4Entry:outcome,
 });
}
if(candidates.length!==120||allDetails.length!==naturalPositiveEntries)
 throw Error('P32_ALL_SOURCE_S4_NOT_PRESERVED');
function singleSlot(source){
 const sorted=[...source].sort((a,b)=>{
   const ta=a.entryProxyTs??a.intentTs+2*H,
         tb=b.entryProxyTs??b.intentTs+2*H;
   return ta-tb||a.intentTs-b.intentTs||a.id.localeCompare(b.id);
 });
 let busyUntil=-1;
 const events=[];
 for(const x of sorted){
  const y={...x};
  if(y.entryProxyTs!==null&&y.entryProxyTs<busyUntil){
   y.status='OCCUPIED_SLOT';
   y.exitProxyTs=null;y.exitProxyPrice=null;y.exitReason=null;
  }else if(y.entryProxyTs!==null){
   if(y.status==='PRICE_PROXY_CLOSED')busyUntil=y.exitProxyTs+M5;
   else busyUntil=PERIODS[y.cohort].end;
  }
  events.push(y);
 }
 return events.sort((a,b)=>a.intentTs-b.intentTs||a.id.localeCompare(b.id));
}
const chosen=singleSlot(candidates);
const sourceRefSingle=s4raw.filter(x=>x.group==='S4_SINGLE_SLOT');
if(sourceRefSingle.length!==120)throw Error('P32_REFERENCE_ORIGINAL_S4_SLOT_MISSING');
function economic(group,rows,fee){
 const closed=rows.filter(x=>x.status==='PRICE_PROXY_CLOSED');
 const pnl=closed.map(x=>100*(1-x.exitProxyPrice/x.entryProxyPrice)-fee/100);
 const a=pnl.filter(x=>x>0),g=a.reduce((u,x)=>u+x,0),
       losses=-pnl.filter(x=>x<0).reduce((u,x)=>u+x,0);
 return {group,originalSetupCount:rows.length,
   noEntryModel:rows.filter(x=>x.entryProxyTs===null).length,
   slotOccupied:rows.filter(x=>x.status==='OCCUPIED_SLOT').length,
   nativeEndRightCensored:rows.filter(x=>x.status.startsWith('RIGHT_CENSORED')).length,
   failClosedOrMissingExitPrice:rows.filter(x=>
      x.entryProxyTs!==null&&x.status!=='PRICE_PROXY_CLOSED'&&
      x.status!=='OCCUPIED_SLOT'&&!x.status.startsWith('RIGHT_CENSORED')).length,
   priceProxyClosed:closed.length,wins:a.length,
   winratePctConditional:closed.length?100*a.length/closed.length:null,
   meanNetPctConditional:closed.length?pnl.reduce((u,x)=>u+x,0)/closed.length:null,
   sumNetPctPoints:pnl.reduce((u,x)=>u+x,0),
   profitFactorConditional:losses?g/losses:null,
   originalS4StructuralSourceWinsNotEdited:true,
   sourceRiskIsOneAsset1xOnly:true,
   reasons:Object.fromEntries([...new Set(closed.map(x=>x.exitReason))].map(q=>
         [q,closed.filter(x=>x.exitReason===q).length])),
 };
}
const stats=[];
for(const fee of [10,30]){
 for(const [group,records] of [['PINNED_NATIVE_S4_ALL_CANDIDATES',candidates],
                                ['PINNED_NATIVE_S4_SINGLE_SLOT',chosen],
                                ['ORIGINAL_P22_REFERENCE_SINGLE_SLOT',sourceRefSingle]]){
  stats.push({...economic(group,records,fee),feeBps:fee});
 }
}
const sourceOriginal53=JSON.parse(fs.readFileSync(
  path.join(WORK,'results','PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json'),'utf8'));
if(sourceOriginal53.length!==53||sourceOriginal53.some(z=>z.parity!=='EXACT')||
   sourceOriginal53.filter(z=>z.net30pct>0).length!==29)
 throw Error('P32_ORIGINAL_PIN_NATIVE53_29_WIN_NOT_PRESERVED');
const output={
 schema:'prism7-p32-s4-new-structure-native-pinned-v20-exit-asof-entry-source-m5-1slot/v1',
 immutablePinnedV20Sha:PIN,
 sourceNative53OriginalTradeParity:'PASS_53_53',
 nativeSourceOriginal53WinsUnchanged:29,
 nativeSourceOriginal53SourceMeanNet30Pct:sourceOriginal53.reduce((v,x)=>v+x.net30pct,0)/53,
 originalNewS4NaturalH1Setups:120,
 originalS4PositiveM5EntryCandidates:naturalPositiveEntries,
 originalS4ReferenceSingleSlotSourceCount:120,
 originalS4P22ExitSourceCodeNotEdited:true,
 pinnedNativeV20ExitPureSourceUsedForS4NewEntry:true,
 note:'S4 new entry itself is NOT a native V20 source signal. This replays only original pinned V20 exit from the new proxy entry time.',
 sourceH1PerCohortHash:manifest,
 sourceM5AllFourGzipSHA256:m5Hash,
 originalS4P22EventTapeSHA256:hash(fs.readFileSync(sourceOriginalPath)),
 researchNativeCoreFileSHA256:hash(fs.readFileSync(path.resolve('./prism7_p32_native_s4_non_source_entry_m5_exit_core.mjs'))),
 nativeSourceImportFileSHA256:{
  'lib/pengu-dual-ls-v2.ts':hash(fs.readFileSync(path.resolve('./lib/pengu-dual-ls-v2.ts'))),
  'lib/pengu-short-v20.ts':hash(fs.readFileSync(path.resolve('./lib/pengu-short-v20.ts'))),
  'config/penguDualLsV2Runtime.ts':hash(fs.readFileSync(path.resolve('./config/penguDualLsV2Runtime.ts'))),
 },
 allCostAndSourceComparatorStats:stats,
 limitations:[
  'Original pinned V20 SOURCE entry signal is not the new S4 entry, only exit native code reused.',
  'S4 M5-based entry happens within H1; native shortV20 source initial H1 ATR etc are last FULLY completed H1 as-of entry, not future H1.',
  'Source native pure evaluatePositionBar runs after each H1 completes and has research adapted M5-postentry high/low.',
  'STOP event M5 bar high touch is no substitute for signed STOP order and actual exchange matching or book slippage.',
  'Nonstop native EXIT prints first positive M5 OPEN following H1 completion; source H1 OPEN is not retroactively executable.',
  'This is known historical Aster public PENGU/BTC H1 and PENGU M5, no genuine independent OOS.',
  'No funding, shared gross across other runners, daily loss7.5% checks, actual quantity constraints, 20% max portfolio account DD certified.',
 ],
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_NATIVE_ALL120_EVENTS.json'),
             JSON.stringify(candidates,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_NATIVE_ALL120_SINGLE_SLOT.json'),
             JSON.stringify(chosen,null,2)+'\n');
fs.writeFileSync(OUT.replace('.json','_NATIVE_EXIT_31_POSITION_DETAIL.json'),
             JSON.stringify(allDetails,null,2)+'\n');
console.log('PRISM7_P32_NEW_S4_SHORT_PINNED_NATIVE_SOURCE_V20_EXIT_CORE_PASS',
 JSON.stringify({naturalInitial120:120,positivePriceProxyEntry:naturalPositiveEntries,
                 sourceOriginalNative53Wins:29,
                 scenarioStats30Bps:stats.filter(x=>x.sourceRiskIsOneAsset1xOnly && x.group &&
                                     x.group!==''&&stats.indexOf(x)>=3)}));
console.log('OUT',OUT);
