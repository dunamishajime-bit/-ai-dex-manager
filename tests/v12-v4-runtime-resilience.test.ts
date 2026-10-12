import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 classifyV4TransientInfrastructureFailure,
 nextV4DaemonWaitMs,
 V4_RATE_BUDGET_DEFERRED_PREFIX,
} from "../lib/v12-v4-runtime-resilience";

test("V4 converts local Aster rate-budget saturation into in-process fail-closed deferral",()=>{
 const at=1_700_000_000_000;
 const d=classifyV4TransientInfrastructureFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4523"),at);
 assert.ok(d);
 assert.equal(d.retryMs,4523);
 assert.equal(d.result.status,"observing");
 assert.equal(d.result.orderEnabled,false);
 assert.equal(d.result.eventTs,at);
 assert.equal(d.result.reason,V4_RATE_BUDGET_DEFERRED_PREFIX+"ASTER_GLOBAL_RATE_BUDGET_SATURATED:4523");
});

test("V4 only defers recognized pre-request rate-budget infrastructure failures",()=>{
 assert.ok(classifyV4TransientInfrastructureFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT")));
 assert.equal(classifyV4TransientInfrastructureFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED")),undefined);
 assert.equal(classifyV4TransientInfrastructureFailure(new Error("HTTP 429")),undefined);
 assert.equal(classifyV4TransientInfrastructureFailure(new Error("ORDER_REJECTED")),undefined);
});

test("V4 daemon uses short rate/lock retries and stable non-round-minute phase",()=>{
 const rate={status:"observing",reason:V4_RATE_BUDGET_DEFERRED_PREFIX+"ASTER_GLOBAL_RATE_BUDGET_SATURATED:5027"};
 assert.equal(nextV4DaemonWaitMs(rate,{now:70_000}),5027);
 assert.equal(nextV4DaemonWaitMs({status:"locked",reason:"ACCOUNT_LOCK_BUSY"},{now:70_000,lockRetryMs:4000}),4000);
 assert.equal(nextV4DaemonWaitMs({status:"observing",reason:"NO_NATIVE_ENTRY_CANDIDATES"},
  {now:80_000,normalIntervalMs:60_000,phaseOffsetMs:17_000}),57_000);
});

test("production runner wires transient deferral and progressive contention backoff",()=>{
 const runner=readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 assert.match(runner,/classifyV4TransientInfrastructureFailure/);
 assert.match(runner,/nextV4DaemonWaitMs/);
 assert.match(runner,/retryMs:attempt=>Math\.min\(2_000,750\+attempt\*250\)/);
 assert.match(runner,/V4_TRANSIENT_INFRASTRUCTURE_DEFERRED/);
});
