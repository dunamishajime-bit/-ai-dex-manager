import test from "node:test";
import assert from "node:assert/strict";
import {RENDER_INDEPENDENT_ROUTE} from "../lib/render-highwr-and-legacy-stop";
import {independentRenderOrderId,independentRenderProtectionPlan,
 independentRenderExitAt,nextRenderIndependentExpiryWakeMs,isIndependentRenderRoute}
 from "../lib/render-independent-execution-contract";
const ts=Date.UTC(2026,9,25,12,0,0);
test("independent is a distinct RENDER route with unique stable ids",()=>{
 assert.equal(isIndependentRenderRoute("RENDERUSDT",RENDER_INDEPENDENT_ROUTE),true);
 assert.equal(isIndependentRenderRoute("RENDERUSDT","IDLE_RENDER_RELATIVE_SHORT"),false);
 assert.notEqual(independentRenderOrderId("STOP",ts),independentRenderOrderId("TP",ts));
 assert.notEqual(independentRenderOrderId("STOP",ts),independentRenderOrderId("ENTRY",ts));
 assert.equal(independentRenderOrderId("STOP",ts),independentRenderOrderId("STOP",ts));
});
test("independent bracket is TP2.5% STOP2% and never inherits legacy 10/25%",()=>{
 const p=independentRenderProtectionPlan({
  symbol:"RENDERUSDT",route:RENDER_INDEPENDENT_ROUTE,signalTs:ts,entryPrice:100,quantity:2});
 assert.equal(p.stopPrice,102);assert.equal(p.takeProfitPrice,97.5);
 assert.equal(p.side,"SHORT");assert.equal(p.quantity,2);
 assert.throws(()=>independentRenderProtectionPlan({...p,route:"IDLE_RENDER_RELATIVE_SHORT",
  signalTs:ts,entryPrice:100}),/INVALID/);
});
test("6-hour hold is bounded using pre-submission durable timestamp",()=>{
 assert.equal(independentRenderExitAt(ts)-ts,21_600_000);
 assert.throws(()=>independentRenderExitAt(NaN),/UNVERIFIED/);
});
test("exit wake is earlier than expiry and never extends ordinary wait",()=>{
 assert.equal(nextRenderIndependentExpiryWakeMs({
  now:ts,normalWaitMs:300_000,exitTimestamps:[]}),300_000);
 assert.equal(nextRenderIndependentExpiryWakeMs({
  now:ts,normalWaitMs:300_000,exitTimestamps:[ts+90_000]}),88_000);
 assert.equal(nextRenderIndependentExpiryWakeMs({
  now:ts,normalWaitMs:300_000,exitTimestamps:[ts+1_000]}),5_000);
});
