import test from "node:test";
import assert from "node:assert/strict";
import { Quality102CausalV1Runner } from "../lib/disdex-quality102-causal-v1-runner";
import { MemoryQuality102CausalV1StateStore, createQuality102CausalV1State } from "../lib/disdex-quality102-causal-v1-state";
import { MemoryLiveRunnerLock } from "../lib/live-runner-state";
import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";

const NOW=Date.UTC(2026,10,14,12), SHA="1".repeat(40);
function fixture(held:boolean, fail=false, risk=false){
 const state:any={...createQuality102CausalV1State("LIVE",SHA),initialDaemonReconciliation:{runtimeCommitSha:SHA,completedAt:NOW-1000}};
 if(held)state.position={symbol:"UNIUSDT",side:-1,quantity:1,entryPrice:100,entryTs:NOW-3600000,hardStop:.07,bestPrice:100,trailActive:false,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24};
 const counts={observe:0,protect:0,signal:0,orders:0,load:0};
 const runner=new Quality102CausalV1Runner({
  config:{mode:"LIVE",enabled:true,liveTradingEnabled:true,liveExecutionEnabled:true,operatorArmed:true,runtimeCommitSha:SHA,expectedRuntimeCommitSha:SHA,symbols:["UNIUSDT"],maximumGross:QUALITY102_CAUSAL_V1.maximumGross,cryptoGrossCap:3,totalGrossCap:3.5,maximumPositions:1,maxSlippageBps:20,minimumOrderNotionalUsd:5,maximumEntryDelayMs:3600000,maximumDailyLossPct:7.5},
  now:()=>NOW,marketData:{load:async()=>{counts.load++;return{candlesBySymbol:{}};}},
  stateStore:new MemoryQuality102CausalV1StateStore(state,"LIVE",SHA),lock:new MemoryLiveRunnerLock(),
  executor:{getMarketQuote:async()=>({symbol:"UNIUSDT",midPrice:100,bidPrice:99.99,askPrice:100.01,bidQuantity:100,askQuantity:100,spreadBps:2,updatedAt:NOW}),executeMarket:async()=>{counts.orders++;throw Error("unexpected order");}} as any,
  onlineObserver:async()=>{counts.observe++;if(fail)throw Error("SHADOW_LABEL_DATA_MISSING");},
  signalBuilder:()=>{counts.signal++;return{strategyId:"QUALITY102_CAUSAL_V1",side:0,referenceTs:NOW,requestedGross:0,reason:"NO_SIGNAL",dataCutoffTs:NOW-3600000,brkEnabled:true};},
  logger:{info:()=>{},warn:()=>{},error:()=>{}},riskReader:async()=>undefined,
 } as any);
 // Venue and protection boundaries are supplied independently of model observations.
 Object.assign(runner as any,{
  sharedRiskStatus:async()=>risk?{reason:"DAILY_RISK_HOLD",flattenExisting:false}:undefined,
  validateLiveAccount:async()=>({actualQ102:held?{symbol:"UNIUSDT",quantity:-1}:undefined}),
  updateProfitFloorState:async()=>undefined,
  protectPosition:async()=>{counts.protect++;return undefined;},
  updateTrailingState:async()=>undefined,updateAdoptedPolicyState:async()=>undefined,
 });
 return{runner,counts};
}
test("independent online observer records opportunities while Q102 holds a protected position",async()=>{
 const f=fixture(true);const result=await f.runner.tick();
 assert.equal(result.status,"held");assert.equal(f.counts.observe,1);assert.equal(f.counts.protect,1);assert.equal(f.counts.signal,0);assert.equal(f.counts.orders,0);
});
test("risk admission hold still records independent candidate observations",async()=>{
 const f=fixture(false,false,true);const result=await f.runner.tick();
 assert.equal(result.status,"blocked-local");assert.equal(f.counts.observe,1);assert.equal(f.counts.signal,0);
});
test("online observation failure preserves position protection and blocks new entry selection",async()=>{
 const held=fixture(true,true);assert.equal((await held.runner.tick()).status,"held");assert.equal(held.counts.protect,1);
 const flat=fixture(false,true);const result=await flat.runner.tick();
 assert.equal(result.status,"blocked-local");assert.match(result.message,/ONLINE_OBSERVER/);assert.equal(flat.counts.signal,0);assert.equal(flat.counts.orders,0);
});
