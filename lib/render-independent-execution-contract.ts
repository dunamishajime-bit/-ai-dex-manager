/**
 * Pure order preparation only. Exchange adapter owns submission/readback.
 * This module must never send orders or bypass shared risk/owner controls.
 */
import {createHash} from "node:crypto";
import {RENDER_INDEPENDENT_ROUTE, RENDER_ENTRY_POLICY} from "./render-highwr-and-legacy-stop";
import type {IdleProtectionPlan} from "./idle-priority-short-live";

export const RENDER_INDEPENDENT_MAX_HOLD_MS=55*60_000;
export function isIndependentRenderRoute(symbol:string, route:string):boolean {
 return symbol==="RENDERUSDT"&&route===RENDER_INDEPENDENT_ROUTE;
}
export function independentRenderOrderId(action:"ENTRY"|"STOP"|"TP"|"EXIT", signalTs:number):string {
 if(!Number.isSafeInteger(signalTs)||signalTs<=0)throw Error("RENDER_IND_INVALID_SIGNAL_TS");
 return ("ri-"+action.toLowerCase()+"-"+createHash("sha256")
  .update([RENDER_INDEPENDENT_ROUTE,action,signalTs].join("|")).digest("hex").slice(0,22)).slice(0,36);
}
export function independentRenderProtectionPlan(input:{
 symbol:string;route:string;signalTs:number;entryPrice:number;quantity:number;
}):IdleProtectionPlan {
 const {symbol,route,signalTs,entryPrice,quantity}=input;
 if(!isIndependentRenderRoute(symbol,route)||!(entryPrice>0)||!(quantity>0)
  ||!Number.isFinite(entryPrice)||!Number.isFinite(quantity))
   throw Error("RENDER_IND_PROTECTION_INPUT_INVALID");
 return {
  symbol:"RENDERUSDT",side:"SHORT",quantity,
  stopPrice:Number((entryPrice*(1+RENDER_ENTRY_POLICY.shadowStopLossPct/100)).toFixed(12)),
  takeProfitPrice:Number((entryPrice*(1-RENDER_ENTRY_POLICY.shadowTakeProfitPct/100)).toFixed(12)),
  stopClientOrderId:independentRenderOrderId("STOP",signalTs),
  takeProfitClientOrderId:independentRenderOrderId("TP",signalTs),
 };
}
export function independentRenderExitAt(fillTs:number):number {
 if(!Number.isSafeInteger(fillTs)||fillTs<=0)throw Error("RENDER_IND_FILL_TIMESTAMP_UNVERIFIED");
 return fillTs+RENDER_INDEPENDENT_MAX_HOLD_MS;
}

export function nextRenderIndependentExpiryWakeMs(input:{
 normalWaitMs:number;now:number;exitTimestamps:readonly number[]
}):number {
 const {normalWaitMs,now,exitTimestamps}=input;
 if(!Number.isFinite(normalWaitMs)||normalWaitMs<5000||!Number.isFinite(now))
  throw Error("RENDER_INDEPENDENT_WAKE_INVALID");
 const due=exitTimestamps.filter(Number.isFinite).map(t=>t-now);
 if(!due.length)return normalWaitMs;
 return Math.min(normalWaitMs,Math.max(5_000,Math.min(...due)-2_000));
}
