/**
 * Shadow-only public/native HYPE75 M5 input collector.
 * Must NOT be called in LIVE order paths without signed version approval.
 * No credentials, mutation, polling loops or hidden fallback prices.
 */
import { evaluateHypeAdoptedM5Entry, type CompletedHypeM5 } from "./hype-trend-adopted-overlay";

export interface HypeNativeM5ReadOnly {
  getKlines(symbol:"BTCUSDT"|"HYPEUSDT",interval:"5m",limit:number):Promise<readonly (readonly unknown[])[]>;
}
function decode(rows:readonly (readonly unknown[])[]):CompletedHypeM5[]{
 return rows.map(row=>{
  const [openTime,open,high,low,close]=row.map(Number);
  if(!Number.isFinite(openTime)||!Number.isFinite(open)||!Number.isFinite(high)
   ||!Number.isFinite(low)||!Number.isFinite(close))
    throw new Error("HYPE_M5_VENUE_ROW_INVALID");
  return {openTime,open,high,low,close};
 });
}
export async function readOnlyHypeAdoptedM5Snapshot(input:{
 provider:HypeNativeM5ReadOnly;
 decisionTs:number;
}){
 const startedAt=input.decisionTs;
 if(!Number.isFinite(startedAt)||startedAt<=0)
  return {status:"BLOCKED",reason:"INVALID_DECISION_TS",ordersSent:0,cancelsSent:0} as const;
 try{
  // Two native public reads only when explicitly invoked by a research caller.
  // Do not retry on API budget pressure: protecting actual positions takes priority.
  const [btc,hype]=await Promise.all([
   input.provider.getKlines("BTCUSDT","5m",72),
   input.provider.getKlines("HYPEUSDT","5m",72),
  ]);
  const result=evaluateHypeAdoptedM5Entry({
   btc:decode(btc),hype:decode(hype),decisionTs:startedAt
  });
  return {status:result.accepted?"RESEARCH_SIGNAL_ACCEPTED":"RESEARCH_SIGNAL_BLOCKED",
   reason:result.reason,barsReturned:{btc:btc.length,hype:hype.length},
   btc3hPct:"btc3hPct" in result?result.btc3hPct:null,
   hype3hPct:"hype3hPct" in result?result.hype3hPct:null,
   relative3hPp:"relative3hPp" in result?result.relative3hPp:null,
   ordersSent:0,cancelsSent:0,liveActivationAllowed:false} as const;
 }catch{
  return {status:"BLOCKED",reason:"HYPE_NATIVE_M5_UNAVAILABLE_OR_RATE_LIMITED",
   ordersSent:0,cancelsSent:0,liveActivationAllowed:false} as const;
 }
}
