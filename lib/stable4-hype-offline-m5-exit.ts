/** Pure archived HYPE M5 protection model. No venue orders, fills, certificates. */
export const HYPE_M5_MS=300_000,HYPE_HOUR_MS=3_600_000;
export type HypeM5Bar={ts:number;open:number;high:number;low:number;close:number;volume?:number};
export type HypeM5ModeledExit={ts:number;price:number;reason:"PINNED_HYPE_HARD_STOP"|"PINNED_HYPE_TAKE_PROFIT"|"PINNED_HYPE_MAX_HOLD";barOpenTs:number;stopAndTargetBothTouched:boolean;orderAuthority:false};
export function replayHypeModeledM5Exit(input:{
 entryTs:number;entryPrice:number;stopPrice:number;takeProfitPrice:number;
 maxHoldHours:number;barAt:(ts:number)=>HypeM5Bar|undefined;
}):HypeM5ModeledExit{
 const {entryTs,entryPrice,stopPrice,takeProfitPrice,maxHoldHours,barAt}=input;
 if(!Number.isSafeInteger(entryTs)||entryTs<=0||entryTs%HYPE_M5_MS!==0||
 !Number.isSafeInteger(maxHoldHours)||maxHoldHours<=0||maxHoldHours>168||
 ![entryPrice,stopPrice,takeProfitPrice].every(x=>Number.isFinite(x)&&x>0)||
 !(stopPrice<entryPrice&&takeProfitPrice>entryPrice))throw Error("HYPE_MODELED_EXIT_CONTRACT_INVALID");
 const finish=entryTs+maxHoldHours*HYPE_HOUR_MS;
 for(let t=entryTs;t<finish;t+=HYPE_M5_MS){
  const b=barAt(t);if(!b||b.ts!==t||![b.open,b.high,b.low,b.close].every(Number.isFinite)||
   !(b.low>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)))
   throw Error("HYPE_MODELED_M5_INCOMPLETE_OR_INVALID:"+t);
  const stop=b.low<=stopPrice,tp=b.high>=takeProfitPrice;
  if(stop)return {ts:t+HYPE_M5_MS,price:Math.min(b.open,stopPrice),reason:"PINNED_HYPE_HARD_STOP",
   barOpenTs:t,stopAndTargetBothTouched:tp,orderAuthority:false};
  if(tp)return {ts:t+HYPE_M5_MS,price:Math.max(b.open,takeProfitPrice),reason:"PINNED_HYPE_TAKE_PROFIT",
   barOpenTs:t,stopAndTargetBothTouched:false,orderAuthority:false};
 }
 const b=barAt(finish);
 if(!b||b.ts!==finish||!(b.open>0))throw Error("HYPE_MODELED_TIME_EXIT_PRINT_UNAVAILABLE");
 return {ts:finish,price:b.open,reason:"PINNED_HYPE_MAX_HOLD",barOpenTs:finish,
  stopAndTargetBothTouched:false,orderAuthority:false};
}
