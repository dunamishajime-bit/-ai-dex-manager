import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
  buildPenguDualLsV2EvaluationSeries,
  isPenguV8V64DynamicLongSignal,
  selectPenguRecoveryV8Entry,
  evaluatePenguDualLsV2PositionBar,
} from './pinned-source/PENGU/lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './pinned-source/PENGU/lib/pengu-short-v20.ts';
import {evaluateRecoveryV8PositionBar} from './pinned-source/PENGU/lib/pengu-recovery-v8.ts';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const INPUT=ROOT+'/native-new-signal-20251001-20261001/native-PENGU-raw-intentions.jsonl';
const OUT=ROOT+'/PENGU_NATIVE_LIFECYCLE_ALL_FLIPPED_20261109';
fs.mkdirSync(OUT,{recursive:true});
const HOUR=3600000, BEGIN=Date.parse('2025-10-01T00:00:00Z'), END=Date.parse('2026-10-01T00:00:00Z');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(c,m)=>{if(!c)throw Error(m)};
function loadH1(sym){
  const p=ROOT+'/aster-public-v3-h1/'+sym+'-1h-20250924-20261001.jsonl.gz';
  const gz=fs.readFileSync(p);
  const raw=zlib.gunzipSync(gz).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const rows=raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}));
  for(let i=1;i<rows.length;i++)assert(rows[i].openTime-rows[i-1].openTime===HOUR,'H1_GAP_'+sym+'_'+i);
  return {rows,path:p,sha256:sha(gz)};
}
const P=loadH1('PENGUUSDT'), B=loadH1('BTCUSDT');
const fundingPath=ROOT+'/aster-public-funding/PENGUUSDT-20251001-20261001.json';
const fundingRaw=fs.readFileSync(fundingPath);
const funding=JSON.parse(fundingRaw.toString('utf8')).map(x=>({fundingTime:+x.fundingTime,fundingRate:+x.fundingRate}));
const history={pengu1h:P.rows,btc1h:B.rows,penguFunding:funding};
const evalRows=buildPenguDualLsV2EvaluationSeries(history,END);
assert(evalRows.length===P.rows.length,'EVAL_LENGTH');
const evalByTs=new Map();
for(let i=0;i<evalRows.length;i++)if(evalRows[i].features)evalByTs.set(evalRows[i].features.referenceTs,{row:evalRows[i],index:i});
const penguByTs=new Map(P.rows.map(x=>[x.openTime,x]));
const candidates=fs.readFileSync(INPUT,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
assert(candidates.length===116,'CANDIDATE_COUNT');

function selectedRouteAt(index){
  const row=evalRows[index], f=row.features;
  if(!f)return 'NONE';
  const v64=isPenguV8V64DynamicLongSignal(evalRows,index);
  if(row.shortSignal)return 'SHORT_V20';
  if(v64)return 'LONG_V64';
  const rr=row.recoveryV8?{...row.recoveryV8,ordinaryLongEligible:v64,baseLongSignal:v64}:undefined;
  const rec=selectPenguRecoveryV8Entry(rr,true);
  return rec?.kind==='RECOVERY_V8'?'RECOVERY_V8':'NONE';
}
function nextOpen(ts){
  const b=penguByTs.get(ts);
  return b?b.open:undefined;
}
function finalModelPrice(reason, exit, observationTs){
  // Resident hard/trailing protections are modeled at their stop price.
  if(exit?.stopPrice!==undefined && (
      reason.includes('HARD_STOP') || reason.includes('TRAILING_STOP'))) {
    return {price:+exit.stopPrice,kind:'RESIDENT_STOP_PRICE_MODEL'};
  }
  // V20's internal historical transform carries an earlier bar-open model price.
  // Preserve it separately, but portfolio replay uses the causal open after the completed decision bar.
  const causal=nextOpen(observationTs+HOUR);
  if(!(causal>0))return undefined;
  return {price:causal,kind:'CAUSAL_NEXT_H1_OPEN'};
}
const modeled=[], unresolved=[], routeCounts={}, reasonCounts={}, sourcePriceDiffs=[];
for(let ci=0;ci<candidates.length;ci++){
  const x=candidates[ci];
  const loc=evalByTs.get(+x.signalTs);
  if(!loc){unresolved.push({...x,id:'PENGU_'+String(ci+1).padStart(5,'0'),unresolvedReason:'SIGNAL_FEATURE_ROW_MISSING'});continue}
  const expected=selectedRouteAt(loc.index);
  if(expected!==x.route){unresolved.push({...x,id:'PENGU_'+String(ci+1).padStart(5,'0'),unresolvedReason:'ENTRY_ROUTE_REPLAY_MISMATCH',expectedRoute:expected});continue}
  const entryBar=penguByTs.get(+x.entryTs);
  if(!entryBar || Math.abs(entryBar.open-(+x.entryReferenceOpenPrice))>1e-12){
    unresolved.push({...x,id:'PENGU_'+String(ci+1).padStart(5,'0'),unresolvedReason:'ENTRY_OPEN_MISMATCH'});continue
  }
  const id='PENGU_'+String(ci+1).padStart(5,'0'), ep=+x.entryReferenceOpenPrice, gross=+x.requestedGross;
  const effectiveRoute=x.route==='SHORT_V20'?'LONG_V64':'SHORT_V20';
  const effectiveSide=effectiveRoute==='SHORT_V20'?'SHORT':'LONG';
  const signalFeatures=loc.row.features;
  let pos={
    side:effectiveSide==='LONG'?1:-1,entryTs:+x.entryTs,entryPrice:ep,quantity:1,gross,
    highWaterMark:ep,lowWaterMark:ep,
    entryVersion:effectiveRoute==='SHORT_V20'?'SHORT_V20':'LONG_V2_FINAL',
  };
  if(effectiveRoute==='SHORT_V20'){
    pos.shortV20=createPenguShortV20State({
      entryPrice:ep,requestedGross:gross,entryAtr24Ratio:signalFeatures.atr24Ratio,
      btcEma168Distance:signalFeatures.btcEma168Distance,btcReturn24h:signalFeatures.btcReturn24h,
    });
  }
  if(effectiveRoute==='RECOVERY_V8'){
    pos.recoveryV8={
      version:'RECOVERY_V8',side:1,entryTs:+x.entryTs,entryPrice:ep,quantity:1,originalQuantity:1,
      originalGross:gross,remainingGross:gross,partialDefenseTriggered:false,highWaterMark:ep,
      logicalEntryPrice:ep,recoveryExecutionPrice:ep,protectionLifecycle:'FULL_HARD_STOP',
    };
  }
  const events=[]; let final=null, failure=null;
  for(let j=loc.index+1;j<evalRows.length;j++){
    const er=evalRows[j], f=er.features;
    if(!f)continue;
    if(f.referenceTs < +x.entryTs)continue;
    if(f.referenceTs+HOUR>END){failure='EXIT_AFTER_PERIOD';break}
    if(effectiveRoute==='RECOVERY_V8'){
      if(!er.recoveryV8){failure='RECOVERY_FEATURE_ROW_MISSING';break}
      const v64=isPenguV8V64DynamicLongSignal(evalRows,j);
      const rr={...er.recoveryV8,ordinaryLongEligible:v64,baseLongSignal:v64};
      const beforeQty=pos.recoveryV8.quantity;
      const r=evaluateRecoveryV8PositionBar(pos.recoveryV8,rr);
      if(r.events?.includes('PARTIAL_DEFENSE')){
        const partialQty=Number(r.partialQuantity??(beforeQty-r.updatedPosition.quantity));
        const ratio=beforeQty>0?partialQty/beforeQty:0;
        const px=+r.triggerPrice;
        if(!(ratio>0&&ratio<=1&&px>0)){failure='RECOVERY_PARTIAL_MODEL_INVALID';break}
        events.push({kind:'PARTIAL_DEFENSE',decisionReferenceTs:f.referenceTs,eventTs:f.referenceTs+HOUR,
          price:px,priceKind:'RESIDENT_PARTIAL_STOP_PRICE_MODEL',closedQuantityFractionOfCurrent:ratio});
      }
      pos={...pos,quantity:r.updatedPosition.quantity,gross:r.updatedPosition.remainingGross,
           recoveryV8:{...pos.recoveryV8,...r.updatedPosition}};
      if(r.kind!=='NONE' && r.kind!=='PARTIAL_DEFENSE'){
        const reason='RECOVERY_V8_'+r.kind;
        let price,priceKind;
        if((r.kind==='HARD_STOP'||r.kind==='TRAILING_STOP') && r.stopPrice!==undefined){
          price=+r.stopPrice;priceKind='RESIDENT_STOP_PRICE_MODEL';
        } else {
          price=nextOpen(f.referenceTs+HOUR);priceKind='CAUSAL_NEXT_H1_OPEN';
        }
        if(!(price>0)){failure='RECOVERY_FINAL_PRICE_MISSING';break}
        final={reason,decisionReferenceTs:f.referenceTs,exitTs:f.referenceTs+HOUR,exitPrice:price,priceKind};
        break;
      }
    }else{
      const r=evaluatePenguDualLsV2PositionBar(pos,f);
      pos=r.updatedPosition;
      if(r.exit){
        const reason=r.exit.reason;
        const fm=finalModelPrice(reason,r.exit,f.referenceTs);
        if(!fm){failure='FINAL_PRICE_MISSING';break}
        const sourceModelPrice=r.exit.stopPrice!==undefined?+r.exit.stopPrice:undefined;
        if((reason==='SHORT_V20_VOL_TARGET_FAILURE_EXIT'||reason==='SHORT_V20_DEADLINE_EXIT') && sourceModelPrice!==undefined){
          sourcePriceDiffs.push({id,reason,decisionReferenceTs:f.referenceTs,sourceModelPrice,causalPrice:fm.price,
            diffFraction:fm.price/sourceModelPrice-1});
        }
        final={reason,decisionReferenceTs:f.referenceTs,exitTs:f.referenceTs+HOUR,exitPrice:fm.price,priceKind:fm.kind,
          sourceModelPrice};
        break;
      }
    }
  }
  if(!final){
    unresolved.push({...x,id,unresolvedReason:failure||'NO_EXIT_BEFORE_PERIOD',events});continue
  }
  const sg=effectiveSide==='LONG'?1:-1;
  const raw=sg*(final.exitPrice/ep-1);
  const out={id,entryTs:+x.entryTs,exitTs:final.exitTs,decisionReferenceTs:final.decisionReferenceTs,
    symbol:'PENGUUSDT',side:effectiveSide,route:x.route,effectiveExitRoute:effectiveRoute,requestedGross:gross,entryPrice:ep,exitPrice:final.exitPrice,
    exitReason:final.reason,exitPriceKind:final.priceKind,sourceModelPrice:final.sourceModelPrice,
    rawReturn:raw,partialEvents:events,remainingQuantityFraction:pos.quantity,
    sourceRuntimeSha:x.source_runtime_sha,nativeLifecycleEvidence:'CURRENT_PIN_PURE_FUNCTION_REPLAY'};
  modeled.push(out);
  routeCounts[x.route]=(routeCounts[x.route]||0)+1;
  reasonCounts[final.reason]=(reasonCounts[final.reason]||0)+1;
}
const body=modeled.map(x=>JSON.stringify(x)).join('\n')+(modeled.length?'\n':'');
fs.writeFileSync(OUT+'/pengu-native-lifecycle-modeled-exits.jsonl',body);
fs.writeFileSync(OUT+'/pengu-native-lifecycle-unresolved.jsonl',unresolved.map(x=>JSON.stringify(x)).join('\n')+(unresolved.length?'\n':''));
fs.writeFileSync(OUT+'/pengu-v20-source-vs-causal-price-audit.json',JSON.stringify(sourcePriceDiffs,null,2)+'\n');
const absDiff=sourcePriceDiffs.map(x=>Math.abs(x.diffFraction));
const summary={
  schema:'disdex-pengu-current-pin-lifecycle-exit-replay/v1',status:'RESEARCH_PRICE_MODEL_NOT_VENUE_FILL',
  sourceCandidates:candidates.length,modeled:modeled.length,unresolved:unresolved.length,
  byRoute:routeCounts,byExitReason:reasonCounts,partialDefenseEvents:modeled.reduce((n,x)=>n+x.partialEvents.length,0),
  v20SourceVsCausalComparisons:sourcePriceDiffs.length,
  v20MeanAbsPriceDiffPct:absDiff.length?100*absDiff.reduce((a,b)=>a+b,0)/absDiff.length:null,
  inputTapeSHA256:sha(fs.readFileSync(INPUT)),outputSHA256:sha(Buffer.from(body)),
  h1Sources:{PENGU:P.sha256,BTC:B.sha256},fundingSourceSHA256:sha(fundingRaw),
  timed3h8hImplementationAudit:'FIELDS_AND_REASON_TYPES_PRESENT_BUT_NO_EXECUTABLE_REFERENCE_IN_CURRENT_PIN',
  limitations:[
    'No historical signed venue market fills; non-resident exits use causal next-H1-open price model',
    'Hard/trailing and Recovery partial protection are modeled at configured resident stop prices, not L2 execution',
    'Recovery partial defense assumes successful protective partial fill and updates remaining quantity/gross',
    'Raw entries are natural candidates before historical owned-position/cooldown/shared-gross admission',
    'No 3h/8h timed-negative rule was added because current pinned executable source does not reference those fields'
  ]
};
fs.writeFileSync(OUT+'/SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
