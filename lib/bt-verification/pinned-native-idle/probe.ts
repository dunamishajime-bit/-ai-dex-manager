/**
 * Read-only adapter around frozen native IDLE priority SHORT pure entry code.
 * It verifies each H1 observation already closed at the decision timestamp.
 *
 * Native source SHA256:
 * 76f68ba1ec78f5adb34c68718a28b199f58bd29dd6651a404631326906c2f827
 * Native config SHA256:
 * 4faf0c02fcfad787305da17b75ca4ae8cfc9144681cea631cdfa7b340f8fe760
 *
 * Source is at Git 9118eeaa6 (separate Codex worktree snapshot, read-only).
 * No native runner, lifecycle slot, position, risk, STOP, or quote trading.
 */
import {
 computeIdlePriorityFeatures,evaluateIdleGenericCandidate,evaluateIdlePriorityShort,
 type IdleFeatures,type IdleH1Candle,type IdleSignal
} from "./idle-priority-short-signal";
import type {IdlePrioritySymbol} from "./idlePriorityShortPolicy";
import {SYNTHETIC_FEED_SYMBOLS_V2,type MarketCandle5m,type SyntheticMarket5m} from "../synthetic-market";

const HOUR=3600_000;
export const IDLE_RESEARCH_CANDIDATE_FILTERS=Object.freeze({
 jupRel24Min:-0.04089204262472046,
 jupVolumeRatioMin:1.2568362211142174,
 renderWait:true,
 taoRiskOffHours:12
});
export const IDLE_EVALUATED_SYMBOLS:readonly IdlePrioritySymbol[]=[
 "JUPUSDT","TAOUSDT","DOTUSDT","RENDERUSDT","TIAUSDT"
];
export type IdleNativeShadowStatus=
 "NOT_H1"|"MISSING_SYMBOL"|"HISTORY_INSUFFICIENT"|"INVALID_MARKET_SOURCE"|
 "NATIVE_REJECTED"|"RESEARCH_JUP_CAUSAL_BLOCK"|"RESEARCH_RENDER_WAIT"|
 "TAO_SENSOR_ONLY"|"RESEARCH_PRELIMINARY_PASSED";
export type IdleNativeShadowProbe={
 symbol:IdlePrioritySymbol;asOf:string;status:IdleNativeShadowStatus;
 nativeSignal:IdleSignal|null;
 nativeFeatures:IdleFeatures|null;
 nativeEntryCandidate:boolean;
 researchPreliminaryEligible:boolean;
 noOrdersEver:true;
 explanation:string;
};
function result(symbol:IdlePrioritySymbol,asOf:string,status:IdleNativeShadowStatus,
 explanation:string,nativeSignal:IdleSignal|null=null,nativeFeatures:IdleFeatures|null=null):IdleNativeShadowProbe{
 return {symbol,asOf,status,explanation,nativeSignal,nativeFeatures,
  nativeEntryCandidate:nativeSignal?.accepted??false,
  researchPreliminaryEligible:status==="RESEARCH_PRELIMINARY_PASSED",
  noOrdersEver:true};
}
/**
 * Source H1 ts=opening hour. This is fundamentally different from a future
 * signal; the native function requires decisionTs-H1 and 73 prior candles.
 */
function closedRows(symbol:string,history:readonly MarketCandle5m[],decisionMs:number):IdleH1Candle[]{
 const s:IdleH1Candle[]=[];
 let previousEnd:number|null=null;
 for(const c of history){
  const ts=Date.parse(c.openTime),end=Date.parse(c.closedAt);
  if(c.symbol!==symbol||c.category!=="crypto"||c.partialSession||
     c.ticks!==12||!Number.isFinite(ts)||ts%HOUR!==0||end!==ts+HOUR||
     end>decisionMs||c.open<=0||c.close<=0||c.high<Math.max(c.open,c.close)||
     c.low>Math.min(c.open,c.close)||!Number.isFinite(c.volume)||c.volume<0)
    throw Error("IDLE_RESEARCH_NATIVE_H1_INVALID");
  if(previousEnd!==null&&ts!==previousEnd)
    throw Error("IDLE_RESEARCH_NATIVE_H1_GAP");
  previousEnd=end;
  s.push({ts,open:c.open,high:c.high,low:c.low,
    close:c.close,quoteVolume:c.volume});
 }
 if(s.length>0&&previousEnd!==decisionMs)
   throw Error("IDLE_RESEARCH_NATIVE_STALE_H1");
 return s;
}
export function inspectNativeIdleAt(
 symbol:IdlePrioritySymbol,asOf:string,
 symbolHistory:readonly MarketCandle5m[],
 btcHistory:readonly MarketCandle5m[]
):IdleNativeShadowProbe{
 if(!IDLE_EVALUATED_SYMBOLS.includes(symbol))
   throw Error("IDLE_RESEARCH_SYMBOL_INVALID");
 const decision=Date.parse(asOf);
 if(!Number.isFinite(decision)||decision%HOUR!==0)
   return result(symbol,asOf,"NOT_H1","確定済み時間足ではない");
 if(!SYNTHETIC_FEED_SYMBOLS_V2.includes(symbol))
   return result(symbol,asOf,"MISSING_SYMBOL","人工市場に当該IDLE銘柄が未登録");
 // Versioned feed v1 deliberately does not emit TIA; distinguish a missing
 // whole input stream from an existing v2 symbol still warming up.
 if(symbolHistory.length===0)
   return result(symbol,asOf,"MISSING_SYMBOL","この人工市場バージョンに該当する銘柄の確定H1がない");
 if(symbolHistory.length<73||btcHistory.length<73)
   return result(symbol,asOf,"HISTORY_INSUFFICIENT","過去73本の正規H1を待機");
 let native:IdleSignal,features:IdleFeatures;
 try {
   const candles=closedRows(symbol,symbolHistory,decision);
   const btc=closedRows("BTCUSDT",btcHistory,decision);
   features=computeIdlePriorityFeatures(decision,candles,btc);
   native=evaluateIdlePriorityShort(symbol,features,evaluateIdleGenericCandidate(features));
 }catch{
   return result(symbol,asOf,"INVALID_MARKET_SOURCE","足欠損・未来足・容量条件を拒否");
 }
 if(!native.accepted)return result(symbol,asOf,"NATIVE_REJECTED",native.reason,native,features);
 if(symbol==="RENDERUSDT"&&IDLE_RESEARCH_CANDIDATE_FILTERS.renderWait)
   return result(symbol,asOf,"RESEARCH_RENDER_WAIT","STABLE4研究版はRENDER入口候補を見送り",native,features);
 if(symbol==="TAOUSDT")
   return result(symbol,asOf,"TAO_SENSOR_ONLY",
     "TAOは12hのリスクオフセンサー候補。Portfolioリスク状態は未統合",native,features);
 if(symbol==="JUPUSDT"&&(
   features.rel24<IDLE_RESEARCH_CANDIDATE_FILTERS.jupRel24Min||
   features.volumeRatio<IDLE_RESEARCH_CANDIDATE_FILTERS.jupVolumeRatioMin
  ))return result(symbol,asOf,"RESEARCH_JUP_CAUSAL_BLOCK",
    "JUP研究用相対24h/出来高Gateが不成立",native,features);
 return result(symbol,asOf,"RESEARCH_PRELIMINARY_PASSED",
   "元IDLE入口と研究フィルターのみPASS。枠・優先順位・建玉・EXITは未判定",native,features);
}
export function probeSyntheticIdleAt(feed:SyntheticMarket5m,asOf:string):IdleNativeShadowProbe[]{
 const btc=feed.historyH1("BTCUSDT",96);
 return IDLE_EVALUATED_SYMBOLS.map(symbol=>{
   const available=feed.description.symbols.includes(symbol);
   const hist=available?feed.historyH1(symbol,96):[];
   return inspectNativeIdleAt(symbol,asOf,hist,btc);
 });
}
