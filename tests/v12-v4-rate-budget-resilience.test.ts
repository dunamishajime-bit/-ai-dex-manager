import assert from "node:assert/strict";
import test from "node:test";
import {classifyV4RateBudgetDefer} from "../scripts/v12-v4-production-runner";
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
