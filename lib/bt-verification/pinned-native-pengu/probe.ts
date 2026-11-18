/**
 * Native pinned PENGU V2 / Short V20 / Recovery V8 pure signal adapter.
 *
 * No live Runner, wallet, shared Risk, order, STOP or state persistence.
 * This tests the original pure source's decisions only on injected, completed
 * synthetic H1 candles, in a shadow transcript. It must not produce fills.
 *
 * Upstream read-only source checkout Git SHA:
 * 9118eeaa6c209dc6e37887cf5be139b3baaa005d.
 */
import {buildPenguDualLsV2Signal,type PenguDualLsV2Signal}
 from "./pengu-dual-ls-v2";
import type {DisDexV35Candle} from "./disdex-v35-candle-type";
import type {MarketCandle5m,SyntheticMarket5m,SyntheticStep}
 from "../synthetic-market";

const HOUR=3_600_000;
export type NativePenguShadowStatus =
 "NOT_H1"|"INSUFFICIENT_180H"|"SOURCE_INVALID_OR_GAP"|
 "NATIVE_NO_CANDIDATE"|"NATIVE_ENTRY_CANDIDATE";
export type NativePenguShadow={
 status:NativePenguShadowStatus;asOf:string;
 sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d";
 source:"PINNED_PENGU_V2_V20_V8_ENTRY_SHADOW";
 evaluatedBars:number;
 nativeSide:"LONG"|"SHORT"|"NONE";
 nativeEntryVersion:"LONG_V2_FINAL"|"SHORT_V20"|"RECOVERY_V8"|null;
 nativeTargetGross:number;
 nativeReason:string;
 diagnostic:{edgeTriggered:boolean;shortEligible:boolean;longEligible:boolean;
  shortSetupActive:boolean;shortSetupArmed:boolean};
 noOrder:true;noGross:true;noPnL:true;
};
function fail(asOf:string,status:NativePenguShadowStatus,reason:string):NativePenguShadow{
 return {status,asOf,sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
  source:"PINNED_PENGU_V2_V20_V8_ENTRY_SHADOW",evaluatedBars:0,
  nativeSide:"NONE",nativeEntryVersion:null,nativeTargetGross:0,
  nativeReason:reason,
  diagnostic:{edgeTriggered:false,shortEligible:false,longEligible:false,
    shortSetupActive:false,shortSetupArmed:false},
  noOrder:true,noGross:true,noPnL:true};
}
function toNativeCandles(
 symbol:"PENGUUSDT"|"BTCUSDT",rows:readonly MarketCandle5m[],now:number
):DisDexV35Candle[]{
 let end:number|null=null;
 return rows.map(c=>{
   const opening=Date.parse(c.openTime),closing=Date.parse(c.closedAt);
   if(c.symbol!==symbol||c.category!=="crypto"||c.partialSession||c.ticks!==12||
       !Number.isFinite(opening)||opening%HOUR!==0||closing!==opening+HOUR||
       closing>now||end!==null&&opening!==end||
       ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||
       c.open<=0||c.close<=0||c.low<=0||
       c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0)
     throw Error("PENGU_NATIVE_NONCAUSAL_H1_INPUT");
   end=closing;
   return {openTime:opening,closeTime:closing-1,
     open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume};
 }).filter((_,i)=>true);
}
export function inspectNativePenguAt(
 asOf:string,penguH1:readonly MarketCandle5m[],btcH1:readonly MarketCandle5m[]
):NativePenguShadow{
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||now%HOUR!==0)
   return fail(asOf,"NOT_H1","確定H1の終了時刻でのみ元PENGUを判定");
 if(penguH1.length<180||btcH1.length<180)
   return fail(asOf,"INSUFFICIENT_180H","元PENGU V2 RSI/EMA168とShort setupの必要な観測を蓄積中");
 let source:PenguDualLsV2Signal;
 try{
   const pengu=toNativeCandles("PENGUUSDT",penguH1,now);
   const btc=toNativeCandles("BTCUSDT",btcH1,now);
   if(pengu.at(-1)?.closeTime!==now-1||btc.at(-1)?.closeTime!==now-1)
     throw Error("PENGU_NATIVE_STALE_H1");
   source=buildPenguDualLsV2Signal(
     {pengu1h:pengu,btc1h:btc,penguFunding:[]},
     undefined,now,0,
     {recoveryV8Enabled:true,v64DynamicLongEnabled:true}
   );
 }catch{
   return fail(asOf,"SOURCE_INVALID_OR_GAP","未来足・不連続足・不正入力を拒否");
 }
 if(source.referenceTs>now||source.entryTs!==undefined&&source.entryTs>now)
   throw Error("PENGU_NATIVE_SOURCE_RETURNED_FUTURE");
 const active=source.side!==0&&!!source.entryVersion;
 return {status:active?"NATIVE_ENTRY_CANDIDATE":"NATIVE_NO_CANDIDATE",asOf,
   sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
   source:"PINNED_PENGU_V2_V20_V8_ENTRY_SHADOW",
   evaluatedBars:source.diagnostics.evaluatedDecisionBars,
   nativeSide:source.side===1?"LONG":source.side===-1?"SHORT":"NONE",
   nativeEntryVersion:source.entryVersion??null,
   nativeTargetGross:source.targetGross,
   nativeReason:source.reason,
   diagnostic:{
      edgeTriggered:source.diagnostics.edgeTriggered,
      shortEligible:source.diagnostics.shortEligible,
      longEligible:source.diagnostics.longEligible,
      shortSetupActive:source.diagnostics.shortSetupActive,
      shortSetupArmed:source.diagnostics.shortSetupArmed
   },
   noOrder:true,noGross:true,noPnL:true
 };
}
export function probeNativePenguSyntheticAt(
 feed:SyntheticMarket5m,step:SyntheticStep
):NativePenguShadow{
 if(!step.completedH1.some(c=>c.symbol==="PENGUUSDT")||
    !step.completedH1.some(c=>c.symbol==="BTCUSDT"))
    return fail(step.observedAt,"NOT_H1","両通貨の同一H1確定後のみ検証");
 return inspectNativePenguAt(step.observedAt,
   feed.historyH1("PENGUUSDT",6000),
   feed.historyH1("BTCUSDT",6000)
 );
}
