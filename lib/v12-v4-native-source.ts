/** Native source extraction from the deployed generator, using completed H2 only.
 * This supplies causal inputs; it grants no order authority or research parity certificate. */
import {buildV12Signals, type V12Bar} from "./v12-x1-all";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import type {SourceEvidence} from "./v12-v4-production-features";
const H2=7200000;
export function nativeMomentumAgeHours(bars:readonly {close:number}[],index:number,side:"LONG"|"SHORT"){
 const sg=side==="LONG"?1:-1;let age=0;
 for(let j=index;j>=Math.max(45,index-47);j--){
  const current=bars[j]?.close,base=bars[j-45]?.close;
  if(!(current>0&&base>0)||sg*(current/base-1)<.0227)break;
  age+=2;
 }
 return age;
}
function ema(values:number[],n:number){
 let value=values[0];const alpha=2/(n+1);
 for(const x of values.slice(1))value+=alpha*(x-value);
 return value;
}
export function computeNativeV4Sources(universe:Record<string,V12Bar[]>,index:number,decisionTs:number){
 if(!Number.isSafeInteger(index)||index<120||!Number.isFinite(decisionTs))throw Error("NATIVE_H2_WARMUP");
 const reference=universe.BTC?.[index];
 if(!reference)throw Error("NATIVE_H2_WARMUP");
 if(reference.endTs>decisionTs)throw Error("UNCLOSED_NATIVE_H2");
 const closed:Record<string,V12Bar[]>={};
 for(const symbol of V12_X1_ALL.universe){
  const bars=universe[symbol];
  if(!bars?.[index])throw Error("NATIVE_H2_WARMUP:"+symbol);
  for(let j=index-120;j<=index;j++){
   const bar=bars[j];
   if(!bar||bar.endTs!==universe.BTC[j]?.endTs||bar.endTs-bar.ts!==H2||
    bar.ts%H2!==0||j>index-120&&bar.ts!==bars[j-1].endTs)
     throw Error("NATIVE_H2_ALIGNMENT:"+symbol);
   if(bar.endTs>decisionTs)throw Error("UNCLOSED_NATIVE_H2:"+symbol);
   if(![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite)||
     Math.min(bar.open,bar.high,bar.low,bar.close)<=0||bar.volume<0||
     bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))
      throw Error("INVALID_NATIVE_H2:"+symbol);
  }
  // The generator must not inspect an index+1 candle to choose the entry timestamp.
  closed[symbol]=bars.slice(0,index+1);
 }
 return buildV12Signals(closed,index).map(signal=>{
  const bars=closed[signal.symbol],sg=signal.side==="LONG"?1:-1;
  const closes=bars.slice(index-120,index+1).map(b=>b.close);
  const source:SourceEvidence={
   symbol:signal.symbol+"USDT",side:signal.side,
   eligibleSourceEntryTs:signal.entryTs,decisionTs:signal.referenceTs,
   momentumConditionAgeHours:nativeMomentumAgeHours(bars,index,signal.side),
   nativeDiagnosticRet6:sg*(bars[index].close/bars[index-3].close-1),
   nativeDiagnosticEma12Atr:sg*(bars[index].close-ema(closes,12))/signal.atr,
   sourceEngine:"buildV12Signals",sourceParityVerified:false,
  };
  return {source,rank:signal.rank,atr:signal.atr,score:signal.score,
   momentum:signal.momentum,volumeRatio:signal.volumeRatio,
   entryGateReason:signal.entryGateReason,orderEnabled:false as const};
 });
}
