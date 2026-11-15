/**
 * Isolated Q102 S3/S4 *pure candidate generator* on artificial closed H1.
 *
 * This calls the frozen native generator and its frozen native historical
 * S34/feature-quality gates; it does NOT evaluate the S1/S2 HIGH_VOL engine,
 * Online KNN, shadow recovery confidence, opportunity, occupancy, trading,
 * native STOP/TP or shared risk.
 *
 * Original source Git 9118eeaa6c209dc6e37887cf5be139b3baaa005d.
 * The adapter provides only causally available synthetic candles and H1-open
 * modeled quotes. Separate model source hashes are asserted by selftests.
 */
import {
 generateQuality102CausalV4S34ShadowCandidates,
 generateQuality102CausalV4S34Candidates,
 type Quality102CausalV4S34Candidate
} from "./disdex-quality102-causal-v4-s34";
import {QUALITY102_CAUSAL_V4_S34_MODEL} from "./disdexQuality102CausalV4Model";
import type {Quality102Candle} from "./quality102-pipeline-types";
import type {
 SyntheticMarket5m,SyntheticStep,SyntheticSymbol,MarketCandle5m
} from "../synthetic-market";

const HOUR=3_600_000,REQUIRED_H1=336;
export const Q102_NATIVE_S34_SOURCE_PIN=Object.freeze({
 git:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
 candidateSha256:"1a75ba55bd58ddd93f26b3b1d9c58f0a42d7dcfb8f3dbbc57f2f4d555aef8466",
 selectorSha256:"55648be0e88123ee325e240059fc7484d2e23314e2c6b95962e1bdeae3ac3242",
 modelSha256:"d4d69ad4afabdc5d89faa704c25630f36b9f724aa7007f131a18c3fbb52539e8",
 requiredHours:REQUIRED_H1,
 fullQ102Parity:false,
 nativeEntryOnly:true
});
export type Q102NativeS34ShadowStatus =
 "NOT_DECISION_HOUR"|"MISSING_CLOSED_H1"|"INSUFFICIENT_14D"|
 "ASOF_GAP_OR_INVALID"|"EVALUATED_SOURCE_PARTIAL";
export type Q102NativeS34ShadowResult ={
 asOf:string;status:Q102NativeS34ShadowStatus;
 requiredHours:336;
 evaluatedSymbols:readonly string[];
 missingModelSymbols:readonly string[];
 insufficientModelSymbols:readonly string[];
 rawCandidates:readonly Quality102CausalV4S34Candidate[];
 gatedCandidates:readonly Quality102CausalV4S34Candidate[];
 nativeEntryOnly:true;
 fills:0;
 reason:string;
};
const modelSymbols=Object.freeze([...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(m=>m.symbol))]);
const freeze=(asOf:string,status:Q102NativeS34ShadowStatus,reason:string,
  detail?:Partial<Q102NativeS34ShadowResult>):Q102NativeS34ShadowResult=>({
 asOf,status,requiredHours:336,evaluatedSymbols:[],
 missingModelSymbols:[],insufficientModelSymbols:[],rawCandidates:[],
 gatedCandidates:[],nativeEntryOnly:true,fills:0,reason,...detail
});
function closeHistory(
 symbol:string,history:readonly MarketCandle5m[],atMs:number
):Quality102Candle[]{
 if(history.length<REQUIRED_H1)throw Error("Q102_NATIVE_S34_SOURCE_INSUFFICIENT_14D");
 const rows:Quality102Candle[]=[];
 let lastEnd:number|null=null;
 for(const candle of history){
  const opening=Date.parse(candle.openTime),ended=Date.parse(candle.closedAt);
  if(candle.symbol!==symbol||candle.category!=="crypto"||candle.partialSession||
      candle.ticks!==12||!Number.isFinite(opening)||opening%HOUR!==0||
      ended!==opening+HOUR||ended>atMs||
      ![candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite)||
      candle.open<=0||candle.close<=0||candle.volume<0||
      candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)||
      lastEnd!==null&&opening!==lastEnd)
      throw Error("Q102_NATIVE_S34_SOURCE_NONCAUSAL_OR_GAP");
  rows.push({
    timestampMs:opening,open:candle.open,high:candle.high,low:candle.low,
    close:candle.close,quoteVolume:candle.volume,
    // This synthetic v1/v2 source only has fictional quoteVolume. The base
    // quote proxy is therefore generated as quoteVolume / observed H1 close.
    // It does NOT assert exact venue base-volume parity.
    baseVolume:candle.volume/candle.close
  });
  lastEnd=ended;
 }
 if(lastEnd!==atMs)throw Error("Q102_NATIVE_S34_SOURCE_STALE");
 return rows;
}
export function inspectQ102NativeS34Source(
 feed:SyntheticMarket5m,step:SyntheticStep
):Q102NativeS34ShadowResult{
 const now=Date.parse(step.observedAt);
 if(!Number.isFinite(now)||now%HOUR!==0)
   return freeze(step.observedAt,"NOT_DECISION_HOUR","Q102元シグナルはUTC確定H1の時点のみ");
 if(new Date(now).getUTCHours()%4!==1)
   return freeze(step.observedAt,"NOT_DECISION_HOUR","Q102元シグナルはUTC4時間ごとの01時枠のみ");
 if(!step.completedH1.some(c=>c.symbol==="BTCUSDT"&&Date.parse(c.closedAt)===now))
   return freeze(step.observedAt,"MISSING_CLOSED_H1","市場確定足イベント不足");
 const validSymbols=new Set<string>(feed.description.symbols);
 const missingModelSymbols=modelSymbols.filter(symbol=>!validSymbols.has(symbol));
 const evaluatedSymbols:string[]=[],insufficientModelSymbols:string[]=[];
 const rawCandidates:Quality102CausalV4S34Candidate[]=[];
 const gatedCandidates:Quality102CausalV4S34Candidate[]=[];
 for(const symbol of modelSymbols){
  if(!validSymbols.has(symbol))continue;
  const quote=step.quotes.find(x=>x.symbol===symbol);
  if(!quote||!quote.tradable||quote.category!=="crypto"||!Number.isFinite(quote.price)||quote.price<=0)
    return freeze(step.observedAt,"ASOF_GAP_OR_INVALID","現在足始値の代用価格に欠損あり",{
      missingModelSymbols,insufficientModelSymbols,evaluatedSymbols
    });
  const candles=feed.historyH1(symbol as SyntheticSymbol,500);
  if(candles.length<REQUIRED_H1){
    insufficientModelSymbols.push(symbol);continue;
  }
  let rows:Quality102Candle[];
  try{rows=closeHistory(symbol,candles,now)}
  catch{
   return freeze(step.observedAt,"ASOF_GAP_OR_INVALID","未来足・不連続H1・出来高不整合は拒否",{
     missingModelSymbols,insufficientModelSymbols,evaluatedSymbols
   });
  }
  const sourceInput={symbol,rows,entryOpen:{timestampMs:now,open:quote.price}};
  try{
    rawCandidates.push(...generateQuality102CausalV4S34ShadowCandidates(sourceInput));
    gatedCandidates.push(...generateQuality102CausalV4S34Candidates(sourceInput));
    evaluatedSymbols.push(symbol);
  }catch{
    return freeze(step.observedAt,"ASOF_GAP_OR_INVALID","Q102純粋候補計算がソース条件を満たさない",{
      missingModelSymbols,insufficientModelSymbols,evaluatedSymbols
    });
  }
 }
 const incomplete=missingModelSymbols.length>0||insufficientModelSymbols.length>0;
 return freeze(step.observedAt,incomplete?
   (evaluatedSymbols.length>0?"EVALUATED_SOURCE_PARTIAL":"INSUFFICIENT_14D"):
   "EVALUATED_SOURCE_PARTIAL",
  "凍結Q102 S3/S4だけのShadow候補評価。S1/S2・Online・本番総合判定は未接続",
  {missingModelSymbols,insufficientModelSymbols,evaluatedSymbols,
   rawCandidates,gatedCandidates});
}
/** Testing adapter for engineered historical H1, never venue or portfolio. */
export function inspectQ102NativeS34SymbolAt(
 symbol:string,history:readonly MarketCandle5m[],at:string,entryOpen:number
):{raw:readonly Quality102CausalV4S34Candidate[];gated:readonly Quality102CausalV4S34Candidate[]}{
 const now=Date.parse(at);
 if(!Number.isFinite(now)||now%HOUR!==0||new Date(now).getUTCHours()%4!==1)
   throw Error("Q102_SOURCE_TEST_DECISION_TIME_INVALID");
 if(!Number.isFinite(entryOpen)||entryOpen<=0)throw Error("Q102_SOURCE_TEST_ENTRY_OPEN_INVALID");
 if(!modelSymbols.includes(symbol))throw Error("Q102_SOURCE_TEST_SYMBOL_UNKNOWN");
 const rows=closeHistory(symbol,history,now);
 const input={symbol,rows,entryOpen:{timestampMs:now,open:entryOpen}};
 return {raw:generateQuality102CausalV4S34ShadowCandidates(input),
 gated:generateQuality102CausalV4S34Candidates(input)};
}
