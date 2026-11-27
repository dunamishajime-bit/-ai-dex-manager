/** Source-faithful, orderless FET BRK48 M5 modeled protection/replay.
 * STOP authority remains with venue; this computes a historical model only.
 */
import {FET_BRK48_RESIDUAL as P} from "../config/fetBrk48Runtime";
import {advanceFetBrk48LongTrailingStop,type FetBrk48TrailingStopState} from "./fet-brk48-trailing-stop";
export const FET_M5_MS=300000,FET_HOUR_MS=3600000;
export type FetModeledBar={ts:number;open:number;high:number;low:number;close:number;volume?:number};
export type FetModeledExit={reason:"FET_PROTECTED_STOP"|"MAX_HOLD";ts:number;price:number;barOpenTs:number;orderAuthority:false};
export function replayFetBrk48ModeledM5(input:{
 entryTs:number;entryPrice:number;barAt:(ts:number)=>FetModeledBar|undefined;
}):FetModeledExit{
 const {entryTs,entryPrice,barAt}=input;
 if(!Number.isSafeInteger(entryTs)||entryTs<=0||entryTs%FET_M5_MS!==0||
 !Number.isFinite(entryPrice)||entryPrice<=0)throw Error("FET_OFFLINE_ENTRY_INVALID");
 let stop=entryPrice*(1-P.hardStopPct),trail:FetBrk48TrailingStopState|undefined;
 const until=entryTs+P.holdHours*FET_HOUR_MS;
 for(let j=entryTs;j<until;j+=FET_M5_MS){
  const b=barAt(j);
  if(!b||b.ts!==j||![b.open,b.high,b.low,b.close].every(Number.isFinite)||
  !(b.low>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)))
   throw Error("FET_OFFLINE_M5_GAP_OR_INVALID:"+j);
  // Existing STOP is checked before this bar's close modifies floor/trail.
  if(b.low<=stop+1e-12){
   return {reason:"FET_PROTECTED_STOP",ts:j+FET_M5_MS,price:Math.min(b.open,stop),barOpenTs:j,orderAuthority:false};
  }
  const advanced=advanceFetBrk48LongTrailingStop({entryPrice,state:trail,bar:{
   timestampMs:j,open:b.open,high:b.high,low:b.low,close:b.close}});
  trail=advanced.state;
  if(b.close>=entryPrice*(1+P.profitFloorTriggerPct)-1e-12)
   stop=Math.max(stop,entryPrice*(1+P.profitFloorStopPct));
  if(trail.stopPrice!==undefined)stop=Math.max(stop,trail.stopPrice);
 }
 const next=barAt(until);
 if(!next||next.ts!==until||!Number.isFinite(next.open)||next.open<=0)
  throw Error("FET_OFFLINE_TIME_EXIT_OPEN_UNAVAILABLE:"+until);
 return {reason:"MAX_HOLD",ts:until,price:next.open,barOpenTs:until,orderAuthority:false};
}
