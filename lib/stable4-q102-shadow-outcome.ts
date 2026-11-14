import type {Quality102Candle} from "./disdex-quality102-causal-pipeline";
import {simulateQuality102HighVolExit} from "./disdex-quality102-causal-pipeline";
import {evaluateQ102HighVolLongH1Loss} from "./disdex-quality102-adopted-exit-policy";

const H=3600000,M=300000;
export interface Stable4ShadowOutcomeInput {
 entryTs:number;entryPrice:number;side:"LONG"|"SHORT";family:string;hardStop:number;maxHoldHours:number;
 exitPolicy:"FIXED_HOLD_STOP"|"HIGH_VOL_TRAIL72"|"STABLE4_STOP5_TP3_H24";now:number;
 dataThrough?:number;
 fiveMinute:readonly (Quality102Candle&{tradeCount?:number})[];hourly:readonly Quality102Candle[];
 boundaryOpen?:{timestampMs:number;open:number};
 funding:{from:number;through:number;capturedAt:number;rows:readonly{fundingTime:number;fundingRate:number}[]};
}
export interface Stable4ShadowOutcome {exitTs:number;exitPrice:number;exitReason:string;rawReturn:number;fundingReturn:number;net30:number;}
function series(rows:readonly Quality102Candle[],interval:number,now:number,label:string){
 const map=new Map<number,Quality102Candle>();
 for(const x of rows){
  if(map.has(x.timestampMs))throw Error("STABLE4_"+label+"_DUPLICATE");
  if(!Number.isSafeInteger(x.timestampMs)||x.timestampMs%interval!==0||![x.open,x.high,x.low,x.close].every(Number.isFinite)||x.open<=0||x.low<=0||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))throw Error("STABLE4_"+label+"_INVALID");
  if(x.timestampMs+interval>now)throw Error("STABLE4_"+label+"_FUTURE");
  map.set(x.timestampMs,x);
 }
 return map;
}
/** Research shadow labels only. This never values or settles actual venue fills. */
export function modelStable4Q102Outcome(x:Stable4ShadowOutcomeInput):Stable4ShadowOutcome|undefined{
 if(!Number.isSafeInteger(x.entryTs)||x.entryTs<=0||x.entryTs%H!==0||!Number.isSafeInteger(x.now)||x.now<x.entryTs||!Number.isFinite(x.entryPrice)||x.entryPrice<=0||!Number.isFinite(x.hardStop)||x.hardStop<=0||x.hardStop>=1||!Number.isFinite(x.maxHoldHours)||x.maxHoldHours<=0||!["LONG","SHORT"].includes(x.side))throw Error("STABLE4_SHADOW_CONTRACT_INVALID");
 const cutoff=x.dataThrough??x.now;
 if(!Number.isSafeInteger(cutoff)||cutoff>x.now||cutoff<x.entryTs)throw Error("STABLE4_SHADOW_DATA_CUTOFF_INVALID");
 const m5=series(x.fiveMinute,M,cutoff,"M5"),h1=series(x.hourly,H,cutoff,"H1");
 const long=x.side==="LONG",deadline=x.entryTs+x.maxHoldHours*H;
 const finish=(exitTs:number,exitPrice:number,exitReason:string):Stable4ShadowOutcome=>{
  const f=x.funding;
  if(![f.from,f.through,f.capturedAt].every(Number.isSafeInteger)||f.from>x.entryTs||f.through<exitTs||f.capturedAt<exitTs||f.capturedAt>x.now)throw Error("STABLE4_FUNDING_COVERAGE_MISSING");
  const times=new Set<number>();let fundingReturn=0;
  for(const row of f.rows){
   if(!Number.isSafeInteger(row.fundingTime)||!Number.isFinite(row.fundingRate)||times.has(row.fundingTime))throw Error("STABLE4_FUNDING_ROW_INVALID");
   times.add(row.fundingTime);
   if(row.fundingTime<=x.entryTs||row.fundingTime>=exitTs)continue;
   const mark=h1.get(Math.floor((row.fundingTime-1)/H)*H)?.close;
   if(!(mark&&Number.isFinite(mark)))throw Error("STABLE4_FUNDING_MARK_MISSING");
   fundingReturn+=(long?-1:1)*row.fundingRate*mark/x.entryPrice;
  }
  // The accepted native research tape uses reciprocal SHORT price return;
  // QAON7 uses linear signed return. Preserve that frozen model convention.
  const rawReturn=long?exitPrice/x.entryPrice-1:x.exitPolicy==="STABLE4_STOP5_TP3_H24"?1-exitPrice/x.entryPrice:x.entryPrice/exitPrice-1;
  return{exitTs,exitPrice,exitReason,rawReturn,fundingReturn,net30:rawReturn+fundingReturn-.003};
 };
 if(x.exitPolicy==="HIGH_VOL_TRAIL72"){
  const bars:Quality102Candle[]=[];
  for(let t=x.entryTs;t<Math.min(deadline,cutoff);t+=H){
   if(t+H>cutoff)break;
   const bar=h1.get(t);if(!bar)throw Error("STABLE4_H1_GAP");bars.push(bar);
   const adopted=evaluateQ102HighVolLongH1Loss({family:"HIGH_VOL",side:x.side,entryTs:x.entryTs,entryPrice:x.entryPrice,now:t+H,candles:bars});
   try{
    const base=simulateQuality102HighVolExit({side:long?1:-1,entryPrice:x.entryPrice,hardStop:x.hardStop,bars});
    const triggerBar=h1.get(base.exitTs)!;
    const exitPrice=base.exitReason==="hard_stop"?(long?Math.min(triggerBar.open,base.exitPrice):Math.max(triggerBar.open,base.exitPrice)):base.exitPrice;
    return finish(base.exitTs+H,exitPrice,base.exitReason);
   }catch(error){if(!(error instanceof Error)||error.message!=="QUALITY102_HV_EXIT_BARS_INSUFFICIENT_FOR_72H")throw error;}
   if(adopted.reason)return finish(t+H,bar.close,adopted.reason);
  }
  return;
 }
 let best=x.entryPrice;
 const stop=x.entryPrice*(long?1-x.hardStop:1+x.hardStop),tp=x.entryPrice*(long?1.03:.97);
 for(let t=x.entryTs;t<=deadline;t+=M){
  if(t>cutoff)return;
  if(t===deadline){
   const open=m5.get(t)?.open??(x.boundaryOpen?.timestampMs===t?x.boundaryOpen.open:undefined);
   if(open===undefined){if(t===cutoff)return;throw Error("STABLE4_M5_GAP");}
   if(!(open>0&&Number.isFinite(open)))throw Error("STABLE4_M5_OPEN_INVALID");
   return finish(t,open,"TIME");
  }
  if(t+M>cutoff)return;
  const b=m5.get(t);if(!b)throw Error("STABLE4_M5_GAP");
  if(t===x.entryTs&&Math.abs(b.open-x.entryPrice)>Math.max(1e-10,x.entryPrice*1e-9))throw Error("STABLE4_M5_ENTRY_OPEN_MISMATCH");
  if(long?b.low<=stop:b.high>=stop)return finish(t+M,long?Math.min(b.open,stop):Math.max(b.open,stop),"HARD_STOP");
  if(x.exitPolicy==="STABLE4_STOP5_TP3_H24"&&(long?b.high>=tp:b.low<=tp))return finish(t+M,long?Math.max(b.open,tp):Math.min(b.open,tp),"TP3");
  best=long?Math.max(best,b.high):Math.min(best,b.low);
  if(x.family==="PB"&&long&&t+M-x.entryTs>=3*H&&best/x.entryPrice-1<.005&&b.close<=x.entryPrice*.985)
   return finish(t+M,b.close,"Q102_PB_LONG_INITIAL_ADVERSE_1P5");
 }
}
