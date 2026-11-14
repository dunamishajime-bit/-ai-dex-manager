import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DISDEX_STABLE4_OPPORTUNITY, assertStable4GlobalLiveAck } from "../config/disdexStable4Opportunity";
import { resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { evaluateStable4HypeSignal, stable4HypeFormalPriorityOpen } from "../lib/hype-stable4-opportunity-signal";

const H=3_600_000;
const candle=(ts:number,close:number)=>({ts,open:close,high:close*1.01,low:close*.99,close});
const hype=Array.from({length:30},(_,i)=>{
  let c=101;
  if(i<=5)c=100;
  else if(i<=17)c=102.5;
  else c=102.8;
  return candle(i*H,c);
});
const btc=Array.from({length:30},(_,i)=>candle(i*H,i<=5?100:101));
const s=evaluateStable4HypeSignal({now:30*H,btc1h:btc,hype1h:hype});
assert.equal(s.accepted,true);
assert.equal(s.signalTs,30*H);
assert.equal(s.side,"LONG");
assert.equal(s.reason,"STABLE4_HYPE_H48R4_WSIG");
assert.ok(s.diagnostics!.h12<=DISDEX_STABLE4_OPPORTUNITY.hype.h12Max);
assert.ok(s.diagnostics!.h24>=DISDEX_STABLE4_OPPORTUNITY.hype.h24Min);
assert.ok(s.diagnostics!.rel24<=DISDEX_STABLE4_OPPORTUNITY.hype.rel24Max);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.hype.gross,1);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.hype.holdHours,48);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.hype.emergencyStopPct,.06);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.cryptoGrossCap,3);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap,3.5);
assert.equal(stable4HypeFormalPriorityOpen(["QUALITY102_CAUSAL_V1"]),true);
assert.equal(stable4HypeFormalPriorityOpen(["IDLE_PRIORITY_SHORT"]),false);

const sha="a".repeat(40);
assert.doesNotThrow(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:sha}));
assert.throws(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:"b".repeat(40)}));
const off=resolveHypeZecLongRuntime({DISDEX_HYPE_ZEC_SIGNAL_MODE:"TREND"} as NodeJS.ProcessEnv);
assert.equal(off.stable4Mode,"OFF");
assert.equal(off.totalGrossCap,4.25);
const live=resolveHypeZecLongRuntime({
  DISDEX_HYPE_ZEC_SIGNAL_MODE:"STABLE4",
  DISDEX_STABLE4_MODE:"LIVE",
  DISDEX_STABLE4_GLOBAL_LIVE_ACK:sha,
  DISDEX_HYPE_ZEC_RUNTIME_SHA:sha,
} as NodeJS.ProcessEnv);
assert.equal(live.maximumGross,1);
assert.equal(live.cryptoGrossCap,3);
assert.equal(live.totalGrossCap,3.5);
const entrypoint=readFileSync(new URL("./disdex-hype-stable4-live-runner.ts",import.meta.url),"utf8");
assert.match(entrypoint,/DISDEX_HYPE_ZEC_SIGNAL_MODE\s*=\s*"STABLE4"/);
assert.match(entrypoint,/DISDEX_HYPE_ZEC_SYMBOLS\s*=\s*"HYPEUSDT"/);
console.log("STABLE4_HYPE_LIVEBASE_SELFTEST_PASS");