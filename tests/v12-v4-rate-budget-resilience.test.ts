import assert from "node:assert/strict";
import test from "node:test";
import {classifyV4RateBudgetDefer,classifyV4DaemonRateBudgetOutcome,classifyV4DaemonTimeStopApprovalBlock,retryV4FlatBootstrapRateBudget,retryV4StartupExchangeInfo,classifyV4StartupExchangeInfoFailure,classifyV4HealthSafetyState} from "../scripts/v12-v4-production-runner";
import type {V4ExecutionDocument} from "../lib/v12-v4-execution-store";

function doc(overrides:Record<string,unknown>={}):V4ExecutionDocument{
 return {
  schema:2,releaseSha:"a".repeat(40),revision:0,
  state:{legs:{},journal:[],initial:{}} as any,
  intents:{},protections:{},
  ...overrides,
 } as V4ExecutionDocument;
}

test("flat V4 defers local Aster rate-budget saturation without enabling orders",()=>{
 const result=classifyV4RateBudgetDefer(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"),doc());
 assert.ok(result);
 assert.equal(result?.reason,"V4_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005");
 assert.equal(result?.waitMs,5005);
});

test("rate-budget lock timeout is retryable only while the durable store is flat",()=>{
 const result=classifyV4RateBudgetDefer(new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT"),doc());
 assert.ok(result);
 assert.ok((result?.waitMs??0)>=500);
 assert.ok((result?.waitMs??0)<=15000);
});

test("prepared or unknown order state never gets converted to a benign defer",()=>{
 const active=doc({intents:{
  cid:{clientOrderId:"cid",legId:"leg",action:"ENTRY",sequence:0,stage:"PREPARED",createdAt:1,updatedAt:1},
 }});
 assert.equal(classifyV4RateBudgetDefer(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000"),active),undefined);
});

test("owned position or active resident protection keeps fail-closed restart semantics",()=>{
 const activeLeg=doc({state:{legs:{leg:{qty:1,status:"OPEN"}},journal:[],initial:{}} as any});
 assert.equal(classifyV4RateBudgetDefer(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000"),activeLeg),undefined);
 const activeStop=doc({protections:{leg:{legId:"leg",phase:"STOP_CONFIRMED",updatedAt:1,protectedQty:1,stopClientOrderId:"stop"}}});
 assert.equal(classifyV4RateBudgetDefer(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000"),activeStop),undefined);
});

test("unrelated infrastructure errors remain fatal",()=>{
 assert.equal(classifyV4RateBudgetDefer(new Error("ECONNRESET"),doc()),undefined);
});

test("flat bootstrap waits through bounded local budget saturation and then succeeds",async()=>{
 let calls=0; const waits:number[]=[];
 const result=await retryV4FlatBootstrapRateBudget({
  store:{read:()=>doc()} as any,
  attempts:4,
  wait:async(ms)=>{waits.push(ms);},
  operation:async()=>{calls++; if(calls<3)throw new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000"); return "OK";},
 });
 assert.equal(result,"OK");
 assert.equal(calls,3);
 assert.equal(waits.length,2);
 assert.ok(waits.every(ms=>ms>=4000&&ms<=15000));
});

test("initial exchangeInfo retries bounded transient HTTP failures before succeeding",async()=>{
 let calls=0;const waits:number[]=[];
 const result=await retryV4StartupExchangeInfo({
  store:{read:()=>doc()} as any,
  attempts:3,
  wait:async(ms)=>{waits.push(ms);},
  operation:async()=>{calls++;if(calls<3)throw new Error("HTTP 503 /fapi/v3/exchangeInfo");return {symbols:[]};},
 });
 assert.deepEqual(result,{symbols:[]});
 assert.equal(calls,3);
 assert.deepEqual(waits,[15000,15000]);
});

test("exhausted startup exchangeInfo failure becomes an observable blocked result",()=>{
 const result=classifyV4StartupExchangeInfoFailure(
  new Error("V4_STARTUP_EXCHANGE_INFO_UNAVAILABLE:V4_MARKET_DATA_UNAVAILABLE:HTTP 503 /fapi/v3/exchangeInfo"),
  1792859642887,
 );
 assert.deepEqual(result,{
  status:"blocked",
  reason:"V4_MARKET_DATA_UNAVAILABLE:HTTP 503 /fapi/v3/exchangeInfo",
  eventTs:1792859642887,
  candidateCount:0,
  orderEnabled:false,
  retryAfterMs:15000,
 });
 assert.equal(classifyV4HealthSafetyState(result!),"BLOCKED");
});

test("production startup wiring retries exchangeInfo before the daemon loop and publishes bounded failure",()=>{
 const src=require("node:fs").readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 assert.match(src,/retryV4StartupExchangeInfo\(\{operation:\(\)=>client\.getExchangeInfo\(\),store/);
 assert.match(src,/classifyV4StartupExchangeInfoFailure\(error,Date\.now\(\)/);
 assert.match(src,/V4_STARTUP_EXCHANGE_INFO_UNAVAILABLE/);
});

test("bootstrap never waits when durable state requires immediate reconciliation",async()=>{
 let waits=0,calls=0;
 const active=doc({intents:{
  cid:{clientOrderId:"cid",legId:"leg",action:"ENTRY",sequence:0,stage:"SUBMITTING",createdAt:1,updatedAt:1},
 }});
 await assert.rejects(()=>retryV4FlatBootstrapRateBudget({
  store:{read:()=>active} as any,
  attempts:4,
  wait:async()=>{waits++;},
  operation:async()=>{calls++;throw new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000");},
 }),/ASTER_GLOBAL_RATE_BUDGET_SATURATED:4000/);
 assert.equal(calls,1);
 assert.equal(waits,0);
});

test("daemon survives precise budget saturation with a durable open leg but remains BLOCKED",()=>{
 const active=doc({state:{legs:{leg:{qty:1,status:"OPEN"}},journal:[],initial:{}} as any});
 const outcome=classifyV4DaemonRateBudgetOutcome(
  new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4200"),active);
 assert.deepEqual(outcome,{
  status:"blocked",
  reason:"V4_RATE_BUDGET_RECONCILIATION_BLOCKED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:4200",
  waitMs:15000,
 });
 assert.equal(classifyV4RateBudgetDefer(
  new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4200"),active),undefined);
});

test("daemon reports blocked instead of benign observing with unresolved intent or resident STOP",()=>{
 for(const active of [
  doc({intents:{cid:{clientOrderId:"cid",legId:"leg",action:"ENTRY",stage:"SUBMITTING"}}}),
  doc({protections:{leg:{legId:"leg",phase:"STOP_CONFIRMED",protectedQty:1,stopClientOrderId:"stop"}}}),
 ]){
  const outcome=classifyV4DaemonRateBudgetOutcome(
   new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT"),active);
  assert.equal(outcome?.status,"blocked");
  assert.match(outcome?.reason??"",/RECONCILIATION_BLOCKED/);
  assert.ok((outcome?.waitMs??0)>=15000);
 }
});

test("daemon flat budget contention remains observing, non-budget exceptions remain fatal",()=>{
 assert.equal(classifyV4DaemonRateBudgetOutcome(
  new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:6500"),doc())?.status,"observing");
 for(const message of ["HTTP 429","ECONNRESET","V4_PROTECTION_RECOVERY_STOP_INVALID","V4_ACCOUNT_MARK_MISMATCH"]){
  assert.equal(classifyV4DaemonRateBudgetOutcome(new Error(message),doc()),undefined);
 }
});

test("daemon blocked budget branch is wired to status-dependent BLOCKED health, with no order path",()=>{
 const src=require("node:fs").readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 assert.match(src,/classifyV4DaemonRateBudgetOutcome\(error,store\.read\(\)/);
 assert.match(src,/result=\{status:budget\.status,reason:budget\.reason,eventTs:Date\.now\(\),candidateCount:0,orderEnabled:false\}/);
 assert.match(src,/const failed=result\.status==="blocked"\|\|result\.status\.toLowerCase\(\)==="failed"/);
 assert.match(src,/safetyState:failed\?"BLOCKED"/);
});

test("missing or foreign TIME37 SHA leaves flat V4 alive but BLOCKED, never order-enabled",()=>{
 const absent=Object.assign(new Error("ENOENT: no TIME37 approval"),{code:"ENOENT"});
 for(const error of [new Error("V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED"),absent]){
  assert.deepEqual(classifyV4DaemonTimeStopApprovalBlock(error,doc()),{
   status:"blocked",reason:"V4_TIME37_APPROVAL_SHA_MISSING_OR_MISMATCH",waitMs:60000,
  });
 }
});

test("unresolved V4 orders, legs and STOPs must never mask TIME37 approval mismatch",()=>{
 for(const active of [
  doc({intents:{cid:{clientOrderId:"cid",legId:"leg",action:"ENTRY",stage:"SUBMITTING"}}}),
  doc({state:{legs:{leg:{qty:1,status:"OPEN"}},journal:[],initial:{}} as any}),
  doc({protections:{leg:{legId:"leg",phase:"STOP_CONFIRMED",protectedQty:1,stopClientOrderId:"stop"}}}),
 ]){
  assert.equal(classifyV4DaemonTimeStopApprovalBlock(new Error("V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED"),active),undefined);
 }
 for(const message of ["V4_TIME_STOP_APPROVAL_NOT_ROOT_SECURE","V4_PROTECTION_RECOVERY_STOP_INVALID","ECONNRESET"]){
  assert.equal(classifyV4DaemonTimeStopApprovalBlock(new Error(message),doc()),undefined);
 }
});

test("daemon preflights TIME37 approval before flat market preparation or any ENTRY",()=>{
 const src=require("node:fs").readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 const gate=src.indexOf("try{await readV4TimeStopApproval(releaseSha);}");
 const prepare=src.indexOf("prepared=await engine.prepareFlatMarketDecision();");
 assert.ok(gate>0&&prepare>gate);
 assert.ok(src.includes('result={status:"blocked",reason:approvalBlock.reason,eventTs:Date.now(),candidateCount:0,orderEnabled:false}'));
});

test("explicit V4 blocked or degraded reasons never publish HEALTHY safety state",()=>{
 const base={eventTs:1792859642887,candidateCount:0,orderEnabled:false} as const;
 for(const reason of [
  "V4_PREPARE_NOT_AVAILABLE",
  "V4_MARKET_DATA_UNAVAILABLE",
  "V4_MARKET_DATA_UNAVAILABLE:ECONNRESET",
  "V4_EXIT_FEED_GAP_RETRY",
  "V4_EXIT_FEED_GAP_RETRY:V4_EXIT_FEED_M5_GAP:1792689300000",
  "V4_EXIT_FEED_NEXT_OPEN_RETRY:EXIT_NEXT_OPEN_MISSING",
  "V4_STALE_EXIT_REVIEW_REQUIRED:V4_STALE_EXIT_DECISION_REQUIRES_REVIEW:leg",
 ]){
  assert.equal(classifyV4HealthSafetyState({...base,status:"observing",reason}),"BLOCKED",reason);
 }
 assert.equal(classifyV4HealthSafetyState({...base,status:"observing",reason:"V4_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:4200"}),"DEFERRED_FAIL_CLOSED");
 assert.equal(classifyV4HealthSafetyState({...base,status:"observing",reason:"NO_NATIVE_ENTRY_CANDIDATES"}),"HEALTHY");
 assert.equal(classifyV4HealthSafetyState({...base,status:"blocked",reason:"V4_ACCOUNT_LEASE_RENEWAL_FAILED_RETRY"}),"BLOCKED");
});

test("terminal next-open recovery is targeted and remains fail-closed when absent",()=>{
 const src=require("node:fs").readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 assert.match(src,/const exactBoundary=Number\(untilTs\)/);
 assert.match(src,/startTime:exactBoundary,endTime:exactBoundary\+3600000-1/);
 assert.match(src,/V4_EXIT_FEED_NEXT_OPEN_RETRY/);
});
