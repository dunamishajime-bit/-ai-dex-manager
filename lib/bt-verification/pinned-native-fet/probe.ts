/**
 * Read-only FET native entry signal probe.
 *
 * Snapshot source: disdex-stable4-impl-20261114 at
 * 9118eeaa6c209dc6e37887cf5be139b3baaa005d.
 *
 * Pinned upstream FET signal SHA256:
 * ee8213adbb695a387e653d89bb4a494c36640e0845ffcf648ec61927fc47be78
 * Pinned upstream config SHA256:
 * 8a96dc4a7cf224d3012947ab882a88f71b2431f0b5b9df8adde9c7e53dfa06bf
 *
 * The only changed line inside copied native signal is its config import.
 * This probe runs the exact frozen pure entry function (not its runner).
 */
import {buildFetBrk48Signal, type FetBrk48Bar, type FetBrk48Signal} from "./fet-brk48-signal";
import {FET_BRK48_RESIDUAL} from "./fetBrk48Runtime";
import type {MarketCandle5m,SyntheticMarket5m} from "../synthetic-market";

const HOUR=3600000;
export type FrozenFetProbeStatus = "NOT_DECISION_HOUR"|"INSUFFICIENT_HISTORY"|
 "ASOF_GAP_OR_INVALID"|"NATIVE_SIGNAL_REJECTED"|"NATIVE_SIGNAL_PASSED";
export type FrozenFetProbe={
  strategy:"FET_BRK48_RESIDUAL";asOf:string;status:FrozenFetProbeStatus;
  sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d";
  candidate:FetBrk48Signal|null;
  explanation:string;
};
function reject(asOf:string,status:FrozenFetProbeStatus,explanation:string):FrozenFetProbe{
 return {strategy:"FET_BRK48_RESIDUAL",asOf,status,
  sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
  candidate:null,explanation};
}
export function toFrozenFetNativeBars(
 history:readonly MarketCandle5m[],asOfMs:number
):readonly FetBrk48Bar[]{
 let lastEnd=-Infinity;
 const bars:FetBrk48Bar[]=[];
 for(const item of history){
  if(item.symbol!=="FETUSDT"||item.category!=="crypto"||item.partialSession||item.ticks!==12)
    throw Error("FET_NATIVE_SOURCE_H1_BAR_INVALID");
  const started=Date.parse(item.openTime),ended=Date.parse(item.closedAt);
  if(!Number.isFinite(started)||!Number.isFinite(ended)||started%HOUR!==0||
     ended!==started+HOUR||ended>asOfMs||started<=lastEnd-HOUR||
     item.open<=0||item.high<Math.max(item.open,item.close)||item.low>Math.min(item.open,item.close)||
     item.volume<0||!Number.isFinite(item.volume))
    throw Error("FET_NATIVE_SOURCE_H1_BAR_INVALID");
  if(lastEnd!==-Infinity&&started!==lastEnd)
    throw Error("FET_NATIVE_SOURCE_NONCONTIGUOUS");
  // Aster native closes H1 at HH:59:59.999 rather than HH+1:00:00.
  // The very last completed source candle is available exactly at HH+1:00.
  bars.push({openTs:started,closeTs:ended-1,
    open:item.open,high:item.high,low:item.low,close:item.close,volume:item.volume});
  lastEnd=ended;
 }
 return bars;
}
export function runFrozenFetSignalAt(
 history:readonly MarketCandle5m[],asOf:string
):FrozenFetProbe{
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||now%HOUR!==0)
   return reject(asOf,"NOT_DECISION_HOUR","確定時間足ではないため未判定");
 const hour=new Date(now).getUTCHours();
 if(hour%FET_BRK48_RESIDUAL.decisionEntryHourModulo!==
       FET_BRK48_RESIDUAL.decisionEntryHourRemainder)
   return reject(asOf,"NOT_DECISION_HOUR","FET元ロジックのUTC4時間周期外");
 if(history.length<73)
   return reject(asOf,"INSUFFICIENT_HISTORY","確定FET H1を73本以上必要");
 let bars:readonly FetBrk48Bar[];
 try{bars=toFrozenFetNativeBars(history,now)}
 catch{
   return reject(asOf,"ASOF_GAP_OR_INVALID","未来足・欠損足・不正OHLCVはFail Closed");
 }
 // Critical: strict as-of. Native signal cannot read any unclosed future H1.
 if(bars.length<73||bars[bars.length-1].openTs!==now-HOUR)
   return reject(asOf,"ASOF_GAP_OR_INVALID","確定済みの直前H1がない");
 const candidate=buildFetBrk48Signal(bars,now)??null;
 if(!candidate)
   return reject(asOf,"NATIVE_SIGNAL_REJECTED","ピン留めしたFET入口条件が不成立");
 return {strategy:"FET_BRK48_RESIDUAL",asOf,status:"NATIVE_SIGNAL_PASSED",
   sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
   candidate,explanation:"元FET入口関数がPASS。注文・容量・出口判定は未実行"};
}
/** Never imports LIVE runner; accepts only the injected artificial feed. */
export function probeSyntheticFet(feed:SyntheticMarket5m,asOf:string):FrozenFetProbe{
 return runFrozenFetSignalAt(feed.historyH1("FETUSDT",96),asOf);
}
