/**
 * PRISM VII P32 — New S4 H1 structural entry, immutable SOURCE native V20 pure exit state,
 * M5 causal price proxy on observed first positive venue print.
 * This does NOT assert that V20 SOURCE entry strategy generated the S4 signal.
 * Identical source TS economic logic (no changes) via import-only adapter.
 */
import {evaluatePenguDualLsV2PositionBar} from './lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './lib/pengu-short-v20.ts';
import {PENGU_DUAL_LS_V2} from './config/penguDualLsV2Runtime.ts';

export const H=3600000,M5=300000;
const ST=PENGU_DUAL_LS_V2.short;
if(Math.abs(ST.hardStopPct-.08)>1e-12||
   Math.abs(ST.trailingActivationPct-.15)>1e-12||
   Math.abs(ST.trailingRetracePct-.04)>1e-12||
   ST.maxHoldHours!==72)
 throw Error('P32_NATIVE_PIN_SHORT_STOP_CONSTANTS_MISMATCH');

function fullHour(m5,hStart){
 const arr=[];
 for(let n=0;n<12;n++){
  const ts=hStart+n*M5,z=m5.get(ts);
  if(!z||Number(z[0])!==ts)throw Error('P32_PENGU_SOURCE_M5_MISSING:'+ts);
  const open=Number(z[1]),hi=Number(z[2]),lo=Number(z[3]),
        close=Number(z[4]),volume=Number(z[5]);
  if(!(lo>0&&lo<=Math.min(open,close)+1e-12&&hi+1e-12>=Math.max(open,close)&&volume>=0))
   throw Error('P32_PENGU_SOURCE_M5_INVALID_OHLC:'+ts);
  arr.push({ts,open,high:hi,low:lo,close,volume});
 }
 return arr;
}
function firstPositiveAfter(m5,fromTs,studyEnd,maxHours=6){
 for(let k=0;k<maxHours*12;k++){
   const ts=fromTs+k*M5;
   if(ts>=studyEnd)return {status:'DATA_END_BEFORE_PRICE_PRINT',ts};
   const b=m5.get(ts);
   if(!b||Number(b[0])!==ts)throw Error('P32_SOURCE_M5_EXIT_GAP:'+ts);
   if(Number(b[5])>0){
    const px=Number(b[1]);
    if(!(px>0))throw Error('P32_NEGATIVE_M5_PRICE');
    return {status:'POSITIVE_M5_OPEN_PRICE_PROXY',ts,price:px,
            positiveVolume:Number(b[5]),delayMinutes:k*5};
   }
 }
 return {status:'NO_POSITIVE_SOURCE_M5_EXIT_PRINT_WITHIN_6H'};
}
export function replayP32NativeV20AtS4Entry({
   evals,penguH1,m5,entryHourIndex,sourceSignalReferenceTs,
   entryIntentTs,entryActualTs,entryActualPrice,exitHorizonTs,
}){
 if(!(entryActualPrice>0&&entryActualTs>=entryIntentTs&&
      entryActualTs<exitHorizonTs))
  throw Error('P32_INVALID_ASOF_ENTRY_PRICE_TIME');
 const hour=penguH1[entryHourIndex];
 const anchor=evals[entryHourIndex-1]?.features;
 if(!hour||!anchor||
    hour.openTime!==Math.floor(entryActualTs/H)*H||
    anchor.referenceTs!==hour.openTime-H||
    sourceSignalReferenceTs>entryIntentTs ||
    entryActualTs<entryIntentTs)
  throw Error('P32_LATEST_COMPLETED_H1_NATIVE_INITIALIZATION_NOT_ASOF');
 if(!(anchor.atr24Ratio>0&&Number.isFinite(anchor.atr24Ratio)&&
      Number.isFinite(anchor.btcEma168Distance)&&Number.isFinite(anchor.btcReturn24h)))
  throw Error('P32_NATIVE_PIN_ENTRY_SOURCE_FEATURES_INVALID');

 let pos={
   side:-1,entryTs:entryActualTs,entryPrice:entryActualPrice,
   quantity:1,gross:1.0,
   highWaterMark:entryActualPrice,lowWaterMark:entryActualPrice,
   entryVersion:'SHORT_V20',
   shortV20:createPenguShortV20State({
     entryPrice:entryActualPrice,requestedGross:1.0,
     entryAtr24Ratio:anchor.atr24Ratio,
     btcEma168Distance:anchor.btcEma168Distance,
     btcReturn24h:anchor.btcReturn24h,
   }),
 };
 let progressedH1Count=0,zeroPositiveM5Hours=0,sourceHighMismatchCount=0,
     sourceLowMismatchCount=0,sourceNonCausalExitIntentPriceCount=0;
 const log=[];
 for(let j=entryHourIndex;j<evals.length;j++){
  const features=evals[j]?.features;
  const sourceHour=penguH1[j];
  if(!features||!sourceHour||features.referenceTs!==sourceHour.openTime)
   throw Error('P32_SOURCE_PIN_H1_FEATURE_TIME_INCONSISTENT:'+j);
  const hh=features.referenceTs,hhEnd=hh+H;
  if(hhEnd>exitHorizonTs)break;
  const all=fullHour(m5,hh);
  const bars=all.filter(q=>q.ts>=entryActualTs&&q.volume>0);
  if(!bars.length)zeroPositiveM5Hours++;
  if(bars.length){
   if(Math.abs(Math.max(...bars.map(b=>b.high))-sourceHour.high)>1e-9)
    sourceHighMismatchCount++;
   if(Math.abs(Math.min(...bars.map(b=>b.low))-sourceHour.low)>1e-9)
    sourceLowMismatchCount++;
  }
  const hard=pos.entryPrice*(1+ST.hardStopPct);
  const prevBest=Math.min(pos.entryPrice,pos.lowWaterMark??pos.entryPrice);
  const trailingOn=pos.entryPrice/prevBest-1>=ST.trailingActivationPct;
  const trail=prevBest*(1+ST.trailingRetracePct);
  for(const b of bars){
   const hardTouched=b.high+1e-12>=hard;
   const trailingTouched=trailingOn&&b.high+1e-12>=trail;
   if(!hardTouched&&!trailingTouched)continue;
   const hardPriority=hardTouched;
   const nativeStop=hardPriority?hard:trail;
   const price=Math.max(nativeStop,b.open);
   if(b.ts<entryActualTs||!(price>0))throw Error('P32_STOP_BEFORE_ENTRY_OR_BAD_PRICE');
   log.push({
      kind:'PINNED_SHORT_RESIDENT_STOP_FIRST_POSITIVE_M5_TOUCH',
      h1RefTs:hh,observedM5StartTs:b.ts,nativeStopLevel:nativeStop,
      positiveM5Open:b.open,positiveM5High:b.high,
      bothHardAndTrailingTouched:hardTouched&&trailingTouched,
      highLowOrderWithin5mUnknown:true,
   });
   return {
    status:'PRICE_PROXY_CLOSED',
    sourcePinNativeV20StateUsed:true,
    fromNewS4EntryNotPinnedV20Signal:true,
    entryTs:entryActualTs,entryPrice:entryActualPrice,
    exitTs:b.ts,exitPrice:price,
    exitReason:hardPriority?'SHORT_HARD_STOP':'SHORT_TRAILING_STOP',
    sourcePureExitReasonReevaluatedAtCompletedH1:false,
    exitKind:'NATIVE_RESIDENT_STOP_FIRST_POSITIVE_M5_HIGH_TOUCH',
    sourceH1Anchor:anchor.referenceTs,sourceAtr24Entry:anchor.atr24Ratio,
    flags:{progressedH1Count,zeroPositiveM5Hours,sourceHighMismatchCount,
          sourceLowMismatchCount,sourceNonCausalExitIntentPriceCount,
          stopTouchesSameEntry5m:b.ts===entryActualTs,
          stopM5StartNotExactOrderExecutionTime:true},
    eventLog:log,
   };
  }
  const neutral=pos.lowWaterMark??entryActualPrice;
  const aggregatedHigh=bars.length?Math.max(...bars.map(b=>b.high)):
      (j===entryHourIndex?entryActualPrice:neutral);
  const aggregatedLow=bars.length?Math.min(...bars.map(b=>b.low)):
      (j===entryHourIndex?entryActualPrice:neutral);
  const oldPhase=pos.shortV20?.phase??null;
  const out=evaluatePenguDualLsV2PositionBar(pos,{
    ...features,high:aggregatedHigh,low:aggregatedLow
  });
  pos=out.updatedPosition;
  progressedH1Count++;
  log.push({kind:'PINNED_SOURCE_V20_H1_POSITION_PHASE_REVALUED',
            h1RefTs:hh,sourceNativeSourcePureFunction:true,
            phaseBefore:oldPhase,phaseAfter:pos.shortV20?.phase??null,
            priorLowWaterMark:prevBest,updatedLowWaterMark:pos.lowWaterMark,
            observedPositive5mCount:bars.length});
  if(!out.exit)continue;
  const reason=out.exit.reason;
  if(reason==='SHORT_HARD_STOP'||reason==='SHORT_TRAILING_STOP'){
   return {
     status:'NATIVE_H1_STOP_WITHOUT_CORROBORATING_M5_POSITIVE_HIGH',
     sourcePinNativeV20StateUsed:true,
     fromNewS4EntryNotPinnedV20Signal:true,
     entryTs:entryActualTs,entryPrice:entryActualPrice,
     originalNativeH1StopReason:reason,exitTs:null,exitPrice:null,
     sourceH1Anchor:anchor.referenceTs,
     flags:{progressedH1Count,zeroPositiveM5Hours,sourceHighMismatchCount,
       sourceLowMismatchCount,sourceNonCausalExitIntentPriceCount},
     eventLog:log,
   };
  }
  // The pure source function may encode sourceH1.open as an exit price.
  // That price occurred BEFORE this completed H1 close and is NOT a valid causal fill.
  if(out.exit.stopPrice!==undefined)sourceNonCausalExitIntentPriceCount++;
  const r=firstPositiveAfter(m5,hhEnd,exitHorizonTs);
  log.push({kind:'SOURCE_H1_V20_COMPLETED_NON_RESIDENT_EXIT_INTENT',
            h1RefTs:hh,intentNotBeforeTs:hhEnd,
            nativeReason:reason,
            sourceDesiredExitPriceIfAny:out.exit.stopPrice??null,
            actualSourceM5PriceAvailable:r.status==='POSITIVE_M5_OPEN_PRICE_PROXY'});
  if(r.status!=='POSITIVE_M5_OPEN_PRICE_PROXY'){
   return {
    status:'NATIVE_NONSTOP_EXIT_WITHOUT_POSITIVE_M5_PRICE',
    sourcePinNativeV20StateUsed:true,
    fromNewS4EntryNotPinnedV20Signal:true,
    entryTs:entryActualTs,entryPrice:entryActualPrice,
    exitTs:null,exitPrice:null,
    originalNativeH1ExitReason:reason,priceSourceUnobserved:r.status,
    sourceH1Anchor:anchor.referenceTs,
    flags:{progressedH1Count,zeroPositiveM5Hours,sourceHighMismatchCount,
          sourceLowMismatchCount,sourceNonCausalExitIntentPriceCount},
    eventLog:log,
   };
  }
  if(r.ts<hhEnd)throw Error('P32_NONSTOP_EXIT_BEFORE_COMPLETED_NATIVE_DECISION');
  return {
    status:'PRICE_PROXY_CLOSED',
    sourcePinNativeV20StateUsed:true,
    fromNewS4EntryNotPinnedV20Signal:true,
    entryTs:entryActualTs,entryPrice:entryActualPrice,
    exitTs:r.ts,exitPrice:r.price,
    exitReason:reason,exitKind:'PINNED_NATIVE_H1_COMPLETED_NEXT_POSITIVE_M5_OPEN',
    sourcePureExitReasonReevaluatedAtCompletedH1:true,
    sourceH1Anchor:anchor.referenceTs,sourceAtr24Entry:anchor.atr24Ratio,
    flags:{progressedH1Count,zeroPositiveM5Hours,sourceHighMismatchCount,
         sourceLowMismatchCount,sourceNonCausalExitIntentPriceCount,
         nextPositiveM5DelayMinutes:r.delayMinutes},
    eventLog:log,
  };
 }
 return {
  status:'RIGHT_CENSORED_NATIVE_SOURCE_DATA_END',
  sourcePinNativeV20StateUsed:true,
  fromNewS4EntryNotPinnedV20Signal:true,
  entryTs:entryActualTs,entryPrice:entryActualPrice,
  exitTs:null,exitPrice:null,exitReason:null,
  sourceH1Anchor:anchor.referenceTs,
  flags:{progressedH1Count,zeroPositiveM5Hours,sourceHighMismatchCount,
         sourceLowMismatchCount,sourceNonCausalExitIntentPriceCount},
  eventLog:log,
 };
}
