import test from "node:test";
import assert from "node:assert/strict";
import {Quality102CausalV1Runner} from "../lib/disdex-quality102-causal-v1-runner";
import {MemoryQuality102CausalV1StateStore,createQuality102CausalV1State} from "../lib/disdex-quality102-causal-v1-state";
import {QUALITY102_CAUSAL_V1} from "../config/disdexQuality102CausalV1Runtime";
const NOW=Date.UTC(2026,10,15,12),SHA="1".repeat(40);
const recovered={strategyId:"QUALITY102_CAUSAL_V1",side:-1,symbol:"UNIUSDT",referenceTs:NOW,requestedGross:.75,reason:"STABLE4_Q102_UNI_ONLINE_RECOVERY",dataCutoffTs:NOW-3600000,brkEnabled:false,family:"MR",variant:"MR72_Z1.5_H24",hardStop:.07,maxHoldHours:24,exitPolicy:"FIXED_HOLD_STOP"};
function fixture(options:{hook?:(input:any)=>Promise<any>;signal?:any;held?:boolean;risk?:boolean;pending?:boolean;shadow?:boolean}={}){
 const mode=options.shadow?"SHADOW":"LIVE",events:string[]=[],history={candlesBySymbol:{}},positions:any[]=[];
 const state:any={...createQuality102CausalV1State(mode,SHA),initialDaemonReconciliation:{runtimeCommitSha:SHA,completedAt:NOW-1000}};
 if(options.held)state.position={symbol:"UNIUSDT",side:-1,quantity:1,entryPrice:100,entryTs:NOW-3600000,hardStop:.07,bestPrice:100,trailActive:false,family:"MR",exitPolicy:"FIXED_HOLD_STOP",maxHoldHours:24};
 if(options.pending)state.pending={phase:"planned",idempotencyKey:"pending-id",clientOrderId:"q102-entry-pending",symbol:"UNIUSDT",side:"SELL",quantity:1,reduceOnly:false,referenceTs:NOW,createdAt:NOW,updatedAt:NOW,expectedPrice:100,targetGross:.75,hardStop:.07};
 const store=new MemoryQuality102CausalV1StateStore(state,mode,SHA);
 const lockHandle={release:async()=>{events.push("release");},assertOwned:async()=>{}};
 const runner:any=new Quality102CausalV1Runner({
  config:{mode,enabled:true,liveTradingEnabled:true,liveExecutionEnabled:true,operatorArmed:true,runtimeCommitSha:SHA,expectedRuntimeCommitSha:SHA,symbols:["UNIUSDT","AVAXUSDT"],maximumGross:QUALITY102_CAUSAL_V1.maximumGross,cryptoGrossCap:3,totalGrossCap:3.5,maximumPositions:1,maxSlippageBps:20,minimumOrderNotionalUsd:5,maximumEntryDelayMs:3600000,maximumDailyLossPct:7.5},
  now:()=>NOW,marketData:{load:async()=>history},stateStore:store,
  lock:{acquire:async()=>lockHandle},riskReader:async()=>undefined,
  executor:{getMarketQuote:async()=>{events.push("quote");return{symbol:"UNIUSDT",midPrice:100,bidPrice:99.99,askPrice:100.01,bidQuantity:100,askQuantity:100,spreadBps:2,updatedAt:NOW};},executeMarket:async()=>{events.push("order");throw Error("UNEXPECTED_ORDER");}} as any,
  signalBuilder:()=>options.signal??recovered,
  ...(options.hook?{recoveredEntryAdmission:async(input:any)=>{events.push("admission");return options.hook!(input);}}:{}),
  logger:{info:(message:string)=>{if(message.includes("governor"))events.push("governor");},warn:()=>{},error:()=>{}},
 } as any);
 Object.assign(runner,{
  sharedRiskStatus:async()=>options.risk?{reason:"DAILY_RISK_HOLD",flattenExisting:false}:undefined,
  validateLiveAccount:async()=>({actualQ102:options.held?{symbol:"UNIUSDT",quantity:-1}:undefined,positions,account:{},unmanagedOpenOrders:[]}),
  protectPosition:async()=>{events.push("protect");},updateProfitFloorState:async()=>undefined,updateTrailingState:async()=>{},updateAdoptedPolicyState:async()=>undefined,
  planEntry:async()=>{events.push("plan");return{status:"held",message:"ADMISSION_REACHED_ENTRY_PLANNER",ordersSent:0};},
  reconcilePending:async()=>{events.push("pending");return{status:"held",message:"EXISTING_PENDING",ordersSent:0};},
 });
 return{runner,events,history,positions,lockHandle,store};
}
test("LIVE recovered UNI cannot reach quote, governor or planner without an admission hook",async()=>{
 const f=fixture(),result=await f.runner.tick();
 assert.equal(result.status,"blocked-local");assert.match(result.message,/RECOVERED_ENTRY_ADMISSION_MISSING/);assert.equal(result.ordersSent,0);
 assert.deepEqual(f.events,["release"]);assert.equal((await f.store.load()).pending,undefined);
});
test("denied or throwing admission blocks only the recovered entry before quote and planning",async()=>{
 for(const hook of [async()=>({allowed:false,reason:"ACTIVE_BASELINE_HIGHER"}),async()=>{throw Error("SCORE_BOOK_UNAVAILABLE");},async()=>undefined,async()=>({allowed:"true",reason:"INVALID"})]){
  const f=fixture({hook}),result=await f.runner.tick();assert.equal(result.status,"blocked-local");assert.equal(result.ordersSent,0);assert.match(result.message,/ACTIVE_BASELINE_HIGHER|SCORE_BOOK_UNAVAILABLE|RECOVERED_ENTRY_ADMISSION/);assert.deepEqual(f.events,["admission","release"]);
 }
});
test("approved recovered entry receives current account context under lock before governor and quote",async()=>{
 let input:any;const f=fixture({hook:async(x)=>{input=x;return{allowed:true,reason:"EXCEEDS_ACTIVE_BASELINE"};}});
 const result=await f.runner.tick();assert.equal(result.message,"ADMISSION_REACHED_ENTRY_PLANNER");
 assert.equal(input.signal,recovered);assert.equal(input.history,f.history);assert.equal(input.positions,f.positions);assert.equal(input.decisionTs,NOW);assert.equal(input.lock,f.lockHandle);
 assert.deepEqual(f.events,["admission","governor","quote","plan","release"]);
});
test("ordinary native, independent AVAX and nonrecovered UNI signals do not require the hook",async()=>{
 for(const signal of [{...recovered,reason:"QUALITY102_CAUSAL_V4_NATURAL_SIGNAL"},{...recovered,symbol:"AVAXUSDT"},{...recovered,side:1}]){
  const f=fixture({signal,hook:async()=>{throw Error("UNEXPECTED_ADMISSION");}});const result=await f.runner.tick();assert.equal(result.message,"ADMISSION_REACHED_ENTRY_PLANNER");assert.equal(f.events.includes("admission"),false);
 }
});
test("held protection, shared risk and pending reconciliation retain precedence over recovered admission",async()=>{
 for(const options of [{held:true},{risk:true},{pending:true}]){
  const f=fixture({...options,hook:async()=>{throw Error("UNEXPECTED_ADMISSION");}}),result=await f.runner.tick();
  assert.equal(f.events.includes("admission"),false);assert.equal(f.events.includes("plan"),false);assert.equal(result.ordersSent,0);
  if(options.held){assert.equal(result.status,"held");assert.equal(f.events.includes("protect"),true);}if(options.risk)assert.equal(result.message,"DAILY_RISK_HOLD");if(options.pending)assert.equal(result.message,"EXISTING_PENDING");
 }
});
test("SHADOW signal evaluation requires no recovered admission permission",async()=>{
 const f=fixture({shadow:true,hook:async()=>{throw Error("UNEXPECTED_ADMISSION");}}),result=await f.runner.tick();assert.equal(result.status,"shadow");assert.deepEqual(f.events,["release"]);
});
test("an existing hard-stop exit remains eligible without recovered entry admission",async()=>{
 const f=fixture({held:true,hook:async()=>{throw Error("UNEXPECTED_ADMISSION");}});
 f.runner.dependencies.executor.getMarketQuote=async()=>({symbol:"UNIUSDT",midPrice:108,bidPrice:107.99,askPrice:108.01,bidQuantity:100,askQuantity:100,spreadBps:2,updatedAt:NOW});
 f.runner.planExit=async(_state:any,_actual:any,_quote:any,reason:string)=>{f.events.push("exit:"+reason);return{status:"held",message:"EXISTING_EXIT_REACHED",ordersSent:0};};
 const result=await f.runner.tick();assert.equal(result.message,"EXISTING_EXIT_REACHED");assert.deepEqual(f.events,["protect","exit:hard_stop","release"]);
});
