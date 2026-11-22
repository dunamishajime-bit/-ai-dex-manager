/** P80: native SHORT V20 pure EXIT + M5 positive-volume event-time proxy after delay.
 * NO signed venue fills; all source/strategy economic functions imported unchanged.
 * Avoid reusing pre-entry OHLC as STOP/high-low watermark in first entry H1.
 */
import {evaluatePenguDualLsV2PositionBar} from './lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './lib/pengu-short-v20.ts';
import {PENGU_DUAL_LS_V2} from './config/penguDualLsV2Runtime.ts';
const H=3600000,M5=300000;
export const PIN_NATIVE_STOP_POLICY={
 hardStopPct:PENGU_DUAL_LS_V2.short.hardStopPct,
 trailingActivationPct:PENGU_DUAL_LS_V2.short.trailingActivationPct,
 trailingRetracePct:PENGU_DUAL_LS_V2.short.trailingRetracePct,
 maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours,
};
if(Math.abs(PIN_NATIVE_STOP_POLICY.hardStopPct-.08)>1e-12||
 Math.abs(PIN_NATIVE_STOP_POLICY.trailingActivationPct-.15)>1e-12||
 Math.abs(PIN_NATIVE_STOP_POLICY.trailingRetracePct-.04)>1e-12||
 PIN_NATIVE_STOP_POLICY.maxHoldHours!==72)
 throw Error('SOURCE_PIN_STOP_POLICY_CHANGED_P14_FAIL_CLOSED');

function getFullHour(m5,t){
 const bars=[];
 for(let n=0;n<12;n++){
  const ts=t+n*M5;
  const a=m5.get(ts);
  if(!a||Number(a[0])!==ts)throw Error('P14_M5_SOURCE_MISSING:'+ts);
  const o=Number(a[1]),hi=Number(a[2]),lo=Number(a[3]),
        c=Number(a[4]),vol=Number(a[5]);
  if(!(lo>0&&lo<=Math.min(o,c)+1e-12&&hi+1e-12>=Math.max(o,c)&&vol>=0))
    throw Error('P14_M5_SOURCE_OHLC_BAD:'+ts);
  bars.push({ts,open:o,high:hi,low:lo,close:c,volume:vol});
 }
 return bars;
}
function nextPrinted(m5,fromTs,maxH=6){
 for(let k=0;k<maxH*12;k++){
  const ts=fromTs+k*M5,a=m5.get(ts);
  if(!a||Number(a[0])!==ts)
      return {status:'EXIT_SOURCE_M5_BOUNDARY',ts};
  const o=Number(a[1]),v=Number(a[5]);
  if(v>0){
   if(!(o>0))throw Error('P14_NEXTPRINT_INVALID_PRICE');
   return {status:'OBSERVED_PRICE_PROXY',timeBarStartTs:ts,price:o,
     volume:v,latencyFromIntentMinutes:k*5};
  }
 }
 return {status:'EXIT_NO_POSITIVE_M5_PRINT_WITHIN_6H'};
}
export function replayP80M5DelaySourceNativeShort({
  evals,penguH1,m5,entryIndex,sourceEntryTs,sourceEntryPrice,
  requestedGross,sourceNativeExitTs,maxExitHorizonTs,delayMinutes=0,
}){
 const anchor=evals[entryIndex-1]?.features;
 const sourceEntry=penguH1[entryIndex];
 if(!anchor||anchor.referenceTs!==sourceEntryTs-H||
    !sourceEntry||sourceEntry.openTime!==sourceEntryTs||
    Math.abs(sourceEntry.open-sourceEntryPrice)>1e-12)
    throw Error('P14_ENTRY_SOURCE_ASOF_NOT_PARITY');
 if(!(requestedGross>0))throw Error('P14_GROSS_BAD');
 if(![0,5,15].includes(delayMinutes))throw Error('P80_UNSUPPORTED_DELAY_MINUTES');
 const entryHour=getFullHour(m5,sourceEntryTs);
 const first=entryHour.find(b=>b.volume>0 && b.ts>=sourceEntryTs+delayMinutes*60000);
 if(!first)return {
    status:'NO_ENTRY_POSITIVE_PRINT_IN_H1',
    entryIntentTs:sourceEntryTs,observedEntryTs:null,
    sourceExitTs:sourceNativeExitTs,
    sourceEconomicOutcomeUnchanged:true,syntheticVenueFillProven:false,
 };
 const entryProxy=first.open;
 const actualProxyTs=first.ts;
 let position={
  side:-1,entryTs:actualProxyTs,entryPrice:entryProxy,
  quantity:1,gross:requestedGross,highWaterMark:entryProxy,lowWaterMark:entryProxy,
  entryVersion:'SHORT_V20',
  shortV20:createPenguShortV20State({
    entryPrice:entryProxy,requestedGross,
    entryAtr24Ratio:anchor.atr24Ratio,
    btcEma168Distance:anchor.btcEma168Distance,
    btcReturn24h:anchor.btcReturn24h,
  }),
 };
 const eventLog=[];
 let mismatchedHourHigh=0,mismatchedHourLow=0,mismatchedHourOpen=0,
     zeroPrintHours=0,progressionH1Updates=0,simultaneousStopAmbiguity=0,
     sourceDerivedNonCausalBarOpen=0;
 for(let j=entryIndex;j<evals.length;j++){
  const f=evals[j]?.features;
  const h=penguH1[j];
  if(!f||!h||h.openTime!==f.referenceTs)throw Error('P14_SOURCE_H1_TIME_MISMATCH');
  const hStart=f.referenceTs,hEnd=hStart+H;
  if(hStart<sourceEntryTs)continue;
  if(hEnd>maxExitHorizonTs)break;
  const all=getFullHour(m5,hStart);
  const bars=all.filter(b=>b.ts>=actualProxyTs&&b.volume>0);
  if(!bars.length)zeroPrintHours++;
  if(bars.length){
   if(Math.abs(Math.max(...bars.map(b=>b.high))-h.high)>1e-9)mismatchedHourHigh++;
   if(Math.abs(Math.min(...bars.map(b=>b.low))-h.low)>1e-9)mismatchedHourLow++;
   if(Math.abs(bars[0].open-h.open)>1e-9)mismatchedHourOpen++;
  }
  const hard=position.entryPrice*(1+PENGU_DUAL_LS_V2.short.hardStopPct);
  const previousBest=Math.min(position.entryPrice,position.lowWaterMark??position.entryPrice);
  const trailingOn=position.entryPrice/previousBest-1>=
     PENGU_DUAL_LS_V2.short.trailingActivationPct;
  const trail=previousBest*(1+PENGU_DUAL_LS_V2.short.trailingRetracePct);
  for(const b of bars){
    const hardTouch=b.high+1e-12>=hard;
    const trailTouch=trailingOn&&b.high+1e-12>=trail;
    if(!hardTouch&&!trailTouch)continue;
    if(hardTouch&&trailTouch)simultaneousStopAmbiguity++;
    const isHard=hardTouch; // SOURCE native H1 priority: HARD before TRAILING.
    const stop=isHard?hard:trail;
    const price=Math.max(stop,b.open);
    if(!(price>0)||b.ts<actualProxyTs)
       throw Error('P14_STOP_EXECUTION_BEFORE_ENTRY_OR_BAD_PRICE');
    eventLog.push({type:'STOP_TOUCH_RESEARCH',nativeStopReason:isHard?
        'SHORT_HARD_STOP':'SHORT_TRAILING_STOP',
       source_h1_reference_ts:hStart,first_positive_m5_ts:b.ts,
       stopLevel:stop,tradeBarOpen:b.open,tradeBarHigh:b.high,
       hardAndTrailingBothTouchedInSameM5:hardTouch&&trailTouch});
    return {
     status:'PRICE_PROXY_CLOSED',
     entryIntentTs:sourceEntryTs,observedEntryTs:actualProxyTs,
     observedEntryPrice:entryProxy,entryDelayMinutes:(actualProxyTs-sourceEntryTs)/60000,
     sourceExitTs:sourceNativeExitTs,
     observedExitBarStartTs:b.ts,observedExitPrice:price,
     observedExitReason:isHard?'SHORT_HARD_STOP':'SHORT_TRAILING_STOP',
     observedExitType:'RESIDENT_STOP_M5_HIGH_FIRST_TOUCH_PROXY',
     exitIntentTs:b.ts,exitIntentPriceProxy:stop,
     printExitDelayMinutes:0,syntheticVenueFillProven:false,
     flags:{mismatchedHourHigh,mismatchedHourLow,mismatchedHourOpen,
        zeroPrintHours,progressionH1Updates,simultaneousStopAmbiguity,
        sourceDerivedNonCausalBarOpen,stopInsideFirstPositiveM5:b.ts===actualProxyTs,
        sourceDecisionH1ReferenceTs:hStart,
        stopTouchM5StartNotExactTradeTimestamp:true},
     eventLog,
    };
  }
  // H1 closes BEFORE source pinned native progression/exit is observed.
  const hi=bars.length?Math.max(...bars.map(b=>b.high)):
      (j===entryIndex?entryProxy:(position.lowWaterMark??entryProxy));
  const lo=bars.length?Math.min(...bars.map(b=>b.low)):
      (j===entryIndex?entryProxy:(position.lowWaterMark??entryProxy));
  const native=evaluatePenguDualLsV2PositionBar(position,{
    ...f,high:hi,low:lo,
  });
  position=native.updatedPosition;
  progressionH1Updates++;
  if(!native.exit){
     eventLog.push({type:'H1_NATIVE_STATE_UPDATE',h1ReferenceTs:hStart,
       newNativeShortV20Phase:position.shortV20?.phase??null,
       newLowWaterMark:position.lowWaterMark});
     continue;
  }
  const reason=native.exit.reason;
  if(reason==='SHORT_HARD_STOP'||reason==='SHORT_TRAILING_STOP'){
    // H1 SOURCE high can diverge from M5 and cannot force-fill without a
    // positive traded M5 high touch. Record broken evidence instead.
    return {
      status:'SOURCE_NATIVE_STOP_WITHOUT_M5_EVENT_TOUCH',
      entryIntentTs:sourceEntryTs,observedEntryTs:actualProxyTs,
      observedEntryPrice:entryProxy,entryDelayMinutes:(actualProxyTs-sourceEntryTs)/60000,
      sourceExitTs:sourceNativeExitTs,sourceH1ExitReason:reason,
      exitIntentTs:hEnd,syntheticVenueFillProven:false,
      flags:{mismatchedHourHigh,mismatchedHourLow,mismatchedHourOpen,
          zeroPrintHours,progressionH1Updates,simultaneousStopAmbiguity,
          sourceDerivedNonCausalBarOpen},
      eventLog,
    };
  }
  // Source functions may encode features.open at this H1 as "exitPrice":
  // that H1 open occurred BEFORE the completed-H1 progression judgement.
  if(native.exit.stopPrice!==undefined){
    sourceDerivedNonCausalBarOpen++;
  }
  const exitProxy=nextPrinted(m5,hEnd,6);
  eventLog.push({type:'NATIVE_H1_COMPLETED_EXIT_INTENT',
     sourceH1ReferenceTs:hStart,intentNotBeforeTs:hEnd,
     reason,sourceNativeDesiredPrice:native.exit.stopPrice??null,
     actualPrintStatus:exitProxy.status});
  if(exitProxy.status!=='OBSERVED_PRICE_PROXY'){
   return {
      status:'EXIT_PRINT_UNAVAILABLE',sourceExitTs:sourceNativeExitTs,
      entryIntentTs:sourceEntryTs,observedEntryTs:actualProxyTs,
      observedEntryPrice:entryProxy,entryDelayMinutes:(actualProxyTs-sourceEntryTs)/60000,
      observedExitReason:reason,exitIntentTs:hEnd,
      actualPrintStatus:exitProxy.status,syntheticVenueFillProven:false,
      flags:{mismatchedHourHigh,mismatchedHourLow,mismatchedHourOpen,
        zeroPrintHours,progressionH1Updates,simultaneousStopAmbiguity,
        sourceDerivedNonCausalBarOpen},
      eventLog,
   };
  }
  if(exitProxy.timeBarStartTs<hEnd)throw Error('P14_EXIT_FILL_BEFORE_DECISION');
  return {
     status:'PRICE_PROXY_CLOSED',
     entryIntentTs:sourceEntryTs,observedEntryTs:actualProxyTs,
     observedEntryPrice:entryProxy,entryDelayMinutes:(actualProxyTs-sourceEntryTs)/60000,
     sourceExitTs:sourceNativeExitTs,observedExitBarStartTs:exitProxy.timeBarStartTs,
     observedExitPrice:exitProxy.price,observedExitReason:reason,
     observedExitType:'NATIVE_H1_CLOSE_INTENT_NEXT_POSITIVE_M5_OPEN_PROXY',
     exitIntentTs:hEnd,exitIntentPriceProxy:native.exit.stopPrice??null,
     printExitDelayMinutes:exitProxy.latencyFromIntentMinutes,
     syntheticVenueFillProven:false,
     flags:{mismatchedHourHigh,mismatchedHourLow,mismatchedHourOpen,
       zeroPrintHours,progressionH1Updates,simultaneousStopAmbiguity,
       sourceDerivedNonCausalBarOpen},
     eventLog,
  };
 }
 return {
   status:'RIGHT_CENSORED_SOURCE_DATA_END',
   entryIntentTs:sourceEntryTs,observedEntryTs:actualProxyTs,
   observedEntryPrice:entryProxy,entryDelayMinutes:(actualProxyTs-sourceEntryTs)/60000,
   sourceExitTs:sourceNativeExitTs,syntheticVenueFillProven:false,
   flags:{mismatchedHourHigh,mismatchedHourLow,mismatchedHourOpen,
       zeroPrintHours,progressionH1Updates,simultaneousStopAmbiguity,
       sourceDerivedNonCausalBarOpen},eventLog,
 };
}
