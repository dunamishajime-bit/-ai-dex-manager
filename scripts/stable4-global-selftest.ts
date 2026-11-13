import assert from "node:assert/strict";
import { DISDEX_STABLE4_OPPORTUNITY, assertStable4GlobalLiveAck, resolveDisDexStable4Mode } from "../config/disdexStable4Opportunity";
import { resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { calculateHypeZecQuantity } from "../lib/hype-zec-long-sleeves";
import { evaluateStable4HypeSignal, stable4HypeFormalPriorityOpen, type Stable4HypeCandle } from "../lib/hype-stable4-opportunity-signal";
import { stable4IdleBlocks, stable4IdleTaoRiskOffUntil } from "../lib/disdex-stable4-idle";
import { stable4PenguShortV20Pass } from "../lib/pengu-stable4-opportunity";

assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.cryptoGrossCap,3.0);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.stockGrossCap,1.5);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap,3.5);

const H=3_600_000;
const entryTs=Date.UTC(2026,0,1,6,0,0);
const start=entryTs-25*H;
const hype:Stable4HypeCandle[]=[];
const btc:Stable4HypeCandle[]=[];
for(let i=0;i<25;i++){
  const ts=start+i*H;
  const hc=i>=12?103:100;
  const bc=100+i/24;
  hype.push({ts,open:hc,high:hc,low:hc,close:hc});
  btc.push({ts,open:bc,high:bc,low:bc,close:bc});
}
const hs=evaluateStable4HypeSignal({now:entryTs+60_000,btc1h:btc,hype1h:hype});
assert.equal(hs.accepted,true);
assert.equal(hs.signalTs,entryTs);
assert.equal(hs.entryPrice,103);
assert.ok(Math.abs((hs.stopPrice||0)-103*.94)<1e-9);
assert.ok(Math.abs((hs.takeProfitPrice||0)-206)<1e-9);
assert.equal(hs.reason,"STABLE4_HYPE_H48R4_WSIG");
assert.ok((hs.diagnostics?.h12||0)<=DISDEX_STABLE4_OPPORTUNITY.hype.h12Max);
assert.ok((hs.diagnostics?.h24||0)>=DISDEX_STABLE4_OPPORTUNITY.hype.h24Min);
assert.ok((hs.diagnostics?.rel24||0)<=DISDEX_STABLE4_OPPORTUNITY.hype.rel24Max);

const badBtc=btc.map((x)=>({...x,close:100,open:100,high:100,low:100}));
assert.equal(evaluateStable4HypeSignal({now:entryTs+60_000,btc1h:badBtc,hype1h:hype}).accepted,false);
assert.equal(evaluateStable4HypeSignal({now:entryTs+25*60_000,btc1h:btc,hype1h:hype}).accepted,false);

const fixed=calculateHypeZecQuantity({strategy:"HYPE_LONG",equityUsd:1000,entryPrice:100,stopPrice:94,feeBpsPerSide:4,slippageBps:20,fundingBps:2,stepSize:.001,maximumGross:1,fixedGross:true});
const legacy=calculateHypeZecQuantity({strategy:"HYPE_LONG",equityUsd:1000,entryPrice:100,stopPrice:94,feeBpsPerSide:4,slippageBps:20,fundingBps:2,stepSize:.001,maximumGross:1});
assert.ok(fixed.gross>.999&&fixed.gross<=1);
assert.ok(legacy.gross<fixed.gross);
assert.equal(fixed.reason,"FIXED_GROSS_CAPPED");

assert.equal(stable4HypeFormalPriorityOpen(["V12"]),true);
assert.equal(stable4HypeFormalPriorityOpen(["QUALITY102_CAUSAL_V1"]),true);
assert.equal(stable4HypeFormalPriorityOpen(["V11_EQ"]),true);
assert.equal(stable4HypeFormalPriorityOpen(["V50_POST_OPEN_BASIS"]),true);
assert.equal(stable4HypeFormalPriorityOpen(["HYPE_LONG"]),false);

const h0=1_800_000_000_000;
assert.equal(stable4IdleTaoRiskOffUntil("OFF",h0,true,0),0);
assert.equal(stable4IdleTaoRiskOffUntil("SHADOW",h0,true,0),h0+12*H);
assert.equal(stable4IdleBlocks("SHADOW","RENDERUSDT",h0,h0+12*H),false);
assert.equal(stable4IdleBlocks("LIVE","RENDERUSDT",h0,0),true);
assert.equal(stable4IdleBlocks("LIVE","JUPUSDT",h0,h0+12*H),true);
assert.equal(stable4IdleBlocks("LIVE","JUPUSDT",h0+12*H,h0+12*H),false);

const p=DISDEX_STABLE4_OPPORTUNITY.pengu;
assert.equal(stable4PenguShortV20Pass("OFF",{btcReturn24h:0,penguReturn72h:0}),true);
assert.equal(stable4PenguShortV20Pass("SHADOW",{btcReturn24h:0,penguReturn72h:0}),true);
assert.equal(stable4PenguShortV20Pass("LIVE",{btcReturn24h:p.shortV20Btc24hMax,penguReturn72h:p.shortV20Pengu72hMax}),true);
assert.equal(stable4PenguShortV20Pass("LIVE",{btcReturn24h:p.shortV20Btc24hMax+1e-8,penguReturn72h:p.shortV20Pengu72hMax}),false);
assert.equal(stable4PenguShortV20Pass("LIVE",{btcReturn24h:p.shortV20Btc24hMax,penguReturn72h:p.shortV20Pengu72hMax+1e-8}),false);

assert.equal(resolveDisDexStable4Mode({}),"OFF");
assert.equal(resolveDisDexStable4Mode({DISDEX_STABLE4_MODE:"shadow"}),"SHADOW");
assert.equal(resolveDisDexStable4Mode({DISDEX_STABLE4_MODE:"LIVE"}),"LIVE");
const sha="a".repeat(40);
assert.doesNotThrow(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:sha}));
assert.throws(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:"b".repeat(40)}),/DISDEX_STABLE4_GLOBAL_LIVE_ACK/);

const hr=resolveHypeZecLongRuntime({DISDEX_HYPE_ZEC_SIGNAL_MODE:"STABLE4"} as NodeJS.ProcessEnv);
assert.deepEqual(hr.symbols,["HYPEUSDT"]);
assert.equal(hr.maximumGross,1);
assert.equal(hr.signalMode,"STABLE4");

assert.equal(hr.cryptoGrossCap,3.0);
assert.equal(hr.totalGrossCap,4.25);

const liveSha="c".repeat(40);
const hrLive=resolveHypeZecLongRuntime({
  DISDEX_HYPE_ZEC_SIGNAL_MODE:"STABLE4",
  DISDEX_STABLE4_MODE:"LIVE",
  DISDEX_STABLE4_GLOBAL_LIVE_ACK:liveSha,
  DISDEX_HYPE_ZEC_RUNTIME_SHA:liveSha,
} as NodeJS.ProcessEnv);
assert.equal(hrLive.cryptoGrossCap,3.0);
assert.equal(hrLive.totalGrossCap,3.5);

console.log("STABLE4_GLOBAL_SELFTEST_PASS");