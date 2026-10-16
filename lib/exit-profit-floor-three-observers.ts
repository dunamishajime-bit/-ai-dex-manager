import {
 THREE_EXIT_FLOOR_POLICY_ID,EXIT_FLOOR_HOUR_MS,observeThreeExitFloorH1,
 selectThreeExitFloorPolicy,type ExitFloorH1State,type ExitFloorIdentity,
} from "./exit-profit-floor-three";

/**
 * Strictly read-only closed-H1 adapter for Q102 MR and V12 V4 G5/X05.
 * Never places, amends, cancels or authorizes a venue order.
 * Position state may persist the result as SHADOW metadata only.
 */
export type ProfitFloorClosedCandle=Readonly<{
 timestampMs:number;open:number;high:number;low:number;close:number;
}>;

export function observeThreeFloorH1History(input:{
 identity:ExitFloorIdentity;
 closedCandles:readonly ProfitFloorClosedCandle[];
 observedAt:number;
 previous?:ExitFloorH1State;
}):{state?:ExitFloorH1State;newBars:number;armedOnThisCall:boolean}{
 const {identity,closedCandles,observedAt}=input;
 if(!selectThreeExitFloorPolicy(identity))
  return{state:input.previous,newBars:0,armedOnThisCall:false};
 if(!Number.isFinite(observedAt)||!Array.isArray(closedCandles))
  throw Error("THREE_EXIT_SHADOW_INVALID_HISTORY");
 const firstFullH1=Math.ceil(identity.entryTs/EXIT_FLOOR_HOUR_MS)*EXIT_FLOOR_HOUR_MS;
 let prev=input.previous,n=0,armed=false,priorOpen=-1;
 for(const candle of closedCandles){
  if(!Number.isFinite(candle.timestampMs) || candle.timestampMs%EXIT_FLOOR_HOUR_MS!==0||
      candle.timestampMs<=priorOpen)
   throw Error("THREE_EXIT_SHADOW_HISTORY_UNSORTED");
  priorOpen=candle.timestampMs;
  if(candle.timestampMs<firstFullH1)continue;
  if(prev&&candle.timestampMs<=prev.lastClosedH1OpenTs)continue;
  if(candle.timestampMs+EXIT_FLOOR_HOUR_MS>observedAt)
   throw Error("THREE_EXIT_SHADOW_FUTURE_H1");
  const result=observeThreeExitFloorH1(identity,{
   openTs:candle.timestampMs,open:candle.open,high:candle.high,
   low:candle.low,close:candle.close,
  },observedAt,prev);
  if(!result.state)throw Error("THREE_EXIT_SHADOW_NO_NEW_STATE");
  armed ||=result.kind==="ARMED";
  prev=result.state;n++;
 }
 return{state:prev,newBars:n,armedOnThisCall:armed};
}

/** Strict enough to prevent a mismatched restart from trusting a stale profit floor. */
export function validateThreeExitFloorShadowState(value:unknown):ExitFloorH1State{
 if(!value||typeof value!=="object"||Array.isArray(value))
  throw Error("THREE_EXIT_SHADOW_STATE_INVALID");
 const x=value as Record<string,unknown>;
 const allowed=new Set(["policyId","owner","symbol","legId","side","entryTs",
   "entryPrice","lastClosedH1OpenTs","highWaterCloseReturn","armed",
   "securedReturn","floorStopPrice","effectiveFromTs"]);
 if(Object.keys(x).some(k=>!allowed.has(k))||
   x.policyId!==THREE_EXIT_FLOOR_POLICY_ID||
   !["Q102","V12_V4"].includes(String(x.owner))||
   !["LONG","SHORT"].includes(String(x.side))||
   typeof x.symbol!=="string"||!x.symbol||
   typeof x.legId!=="string"||!x.legId||
   typeof x.entryPrice!=="number"||!Number.isFinite(x.entryPrice)||x.entryPrice<=0||
   typeof x.entryTs!=="number"||!Number.isFinite(x.entryTs)||x.entryTs<=0||
   typeof x.lastClosedH1OpenTs!=="number"||
   x.lastClosedH1OpenTs%EXIT_FLOOR_HOUR_MS!==0||
   x.lastClosedH1OpenTs<x.entryTs||
   typeof x.highWaterCloseReturn!=="number"||
   !Number.isFinite(x.highWaterCloseReturn)||x.highWaterCloseReturn<0||
   typeof x.armed!=="boolean"||
   typeof x.securedReturn!=="number"||
   !Number.isFinite(x.securedReturn)||x.securedReturn<=0)
  throw Error("THREE_EXIT_SHADOW_STATE_MALFORMED");
 const expectedReturn=x.owner==="Q102"?.01:
     String(x.legId).includes("REC_G5_SLOW_TREND")?.005:.01;
 if(Math.abs((x.securedReturn as number)-expectedReturn)>1e-12)
  throw Error("THREE_EXIT_SHADOW_POLICY_LINEAGE_MISMATCH");
 if(x.armed){
  if(typeof x.floorStopPrice!=="number"||!Number.isFinite(x.floorStopPrice)||
    typeof x.effectiveFromTs!=="number"||
    !Number.isFinite(x.effectiveFromTs)||
    x.effectiveFromTs>x.lastClosedH1OpenTs+EXIT_FLOOR_HOUR_MS||
    x.effectiveFromTs<x.entryTs ||
    (x.side==="LONG"?x.floorStopPrice<=x.entryPrice:x.floorStopPrice>=x.entryPrice))
   throw Error("THREE_EXIT_SHADOW_ARMED_STATE_INVALID");
 }else if(x.floorStopPrice!==undefined||x.effectiveFromTs!==undefined)
  throw Error("THREE_EXIT_SHADOW_UNARMED_CANNOT_HAVE_STOP");
 return x as ExitFloorH1State;
}
