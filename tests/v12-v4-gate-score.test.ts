import test from "node:test";
import assert from "node:assert/strict";
import {applyV4GateBonusToMarketRows, type V4VerifiedGateTelemetry} from "../lib/v12-v4-gate-score";
import {verifyV4GateTelemetry} from "../lib/v12-v4-gate-telemetry-verify";
import type {RankRow} from "../lib/realtime-ranking";
import type {V12V4HpSnapshot} from "../lib/v12-v4-hp-contract";
const SHA="e8cc2e73f8d3981d708ee52f013241597c038b10",H=3600000;
const NOW=7200000000000,T=NOW-40*60000,FP="a".repeat(64);
function fixture():V4VerifiedGateTelemetry{
 const keys=["VOLUME_RATIO","EDGE_TO_COST","DIRECTIONAL_MOMENTUM","REGIME_ENTRY_QUALITY","WIN_RATE_OVERLAY"];
 return {verified:true,releaseSha:SHA,decisionTs:T,capturedAtMs:T+1000,sourceFingerprint:FP,
  symbols:[{symbol:"ETHUSDT",nativeSide:"LONG",sourceEligible:true,sourceReason:"SIGNAL_ELIGIBLE",
   portfolioRank:1,nativeScore:1.25,
   gates:keys.map((key,i)=>({key,state:i===1?"BLOCK":i===4?"NOT_EVALUATED":"PASS",
    actual:1,required:0.8,reason:"EXACT_PRODUCTION_NATIVE_RULE"})),
   routeGate:{state:"PASS",routes:["REC_G1_MID_REL_LOWVOL"],reason:"V4_ROUTE_CANDIDATE_EMITTED"}}]};
}
function row(symbol:string,score:number):RankRow{
 return {id:"MARKET:"+symbol,symbol,logic:"MARKET",side:"WAIT",score,scoreKind:"MARKET",
  scoreLabel:"Aster Market",gates:[],reason:"MARKET",fresh:true,checkedAt:NOW,
  rankingScope:"MARKET",rankingEligible:true,rankingContractAvailable:true,sourceStatus:"FRESH"};
}
test("V4 reference Gate bonus transparently adds only true PASS and keeps market baseline",()=>{
 const before=[row("ETHUSDT",82),row("DOGEUSDT",70)];
 const out=applyV4GateBonusToMarketRows(before,fixture());
 assert.equal(out[0].score,94);
 assert.equal(out[0].scoreKind,"MARKET_PLUS_V4");
 assert.equal(out[0].v4Reference?.marketBaseScore,82);
 assert.equal(out[0].v4Reference?.v4GateBonus,12);
 assert.equal(out[1].score,70);assert.equal(out[1].v4Reference,undefined);
 assert.equal(before[0].score,82);
});
test("never supplement absent V4 telemetry or unavailable market scores",()=>{
 const rows=[row("ETHUSDT",82)];
 assert.deepEqual(applyV4GateBonusToMarketRows(rows,null),rows);
 rows[0].fresh=false;
 assert.equal(applyV4GateBonusToMarketRows(rows,fixture())[0].score,82);
});
function runtime():V12V4HpSnapshot{
 return {displayStatus:"LIVE_VERIFIED",freshness:{heartbeat:true,decision:false},
  actual:{currentReleaseSha:SHA,activeRunnerSha:SHA,heartbeatSha:SHA,v12PrimaryMode:"V4",
   legacyV12RunnerActive:false}} as V12V4HpSnapshot;
}
function strictFixture(){
 const labels=["VOLUME_RATIO","EDGE_TO_COST","DIRECTIONAL_MOMENTUM","REGIME_ENTRY_QUALITY","WIN_RATE_OVERLAY"];
 const symbols=["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"];
 const gate={schema:"disdex-v12-v4-gate-telemetry/v1",strategyId:"V12_V4",
  source:"RUNNER_SAME_CLOSED_CANDLE_BATCH",releaseSha:SHA,runtimeSha:SHA,
  readOnly:true,orderEnabled:false,tradingMutation:0,
  decisionTs:T,capturedAtMs:T+1000,sourceFingerprint:FP,
  candidateCount:0,filteredCount:0,symbolCount:14,
  symbols:symbols.map(symbol=>({symbol:symbol+"USDT",nativeSide:"LONG",sourceEligible:false,
   sourceReason:"SOURCE_ENTRY_BLOCKED",portfolioRank:null,nativeScore:0,
   gates:labels.map(key=>({key,state:"BLOCK",actual:0.4,required:0.8,reason:"TEST"})),
   routeGate:{state:"NOT_EVALUATED",routes:[],reason:"NONE"}}))};
 const decision={schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",releaseSha:SHA,runtimeSha:SHA,
  orderEnabled:false,tradingMutation:0,realOrderEnabledV4:0,
  source:"RUNNER_SAME_CLOSED_CANDLE_BATCH",sourceFingerprint:FP,
  decisionTs:T,capturedAtMs:T+1000,candidates:[],filtered:[],errors:[]};
 return {gate,decision};
}
test("only source-fingerprint, SHA and fresh Runner signals can affect reference Score",()=>{
 const {gate,decision}=strictFixture();
 assert.equal(verifyV4GateTelemetry(gate,decision,runtime(),NOW)?.symbols.length,14);
 assert.equal(verifyV4GateTelemetry(gate,{...decision,policyId:"INCOMPATIBLE"},runtime(),NOW),null);
 assert.equal(verifyV4GateTelemetry(gate,{...decision,sourceFingerprint:"b".repeat(64)},runtime(),NOW),null);
 assert.equal(verifyV4GateTelemetry({...gate,runtimeSha:"b".repeat(40)},decision,runtime(),NOW),null);
 assert.equal(verifyV4GateTelemetry(gate,decision,runtime(),NOW+3*H),null);
 assert.equal(verifyV4GateTelemetry(gate,decision,{...runtime(),displayStatus:"UNAVAILABLE"},NOW),null);
});
