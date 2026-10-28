import assert from "node:assert/strict";
import test from "node:test";
import { nextSharedRiskRefreshRetryMs, runSharedRiskRefreshLoop } from "../lib/disdex-shared-crypto-risk-refresh-loop";

test("global Aster budget saturation honors projected queue without rapid polling", () => {
  assert.equal(nextSharedRiskRefreshRetryMs(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:27000"), 1, 5000, () => 0), 27000);
  assert.equal(nextSharedRiskRefreshRetryMs(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:1000"), 4, 5000, () => 0), 20000);
});
test("global budget retry is bounded and no changes to ordinary failure retry", () => {
  assert.equal(nextSharedRiskRefreshRetryMs(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:120000"), 7, 5000, () => 1), 60000);
  assert.equal(nextSharedRiskRefreshRetryMs(new Error("unexpected venue failure"), 7, 5000, () => 1), 5000);
});
test("risk writer daemon retains the last saved snapshot untouched under shared API congestion", async () => {
  const waits:number[]=[];
  const observed:number[]=[];
  let n=0;
  let stop=false;
  const result=await runSharedRiskRefreshLoop({
    daemon:true,intervalMs:30000,retryMs:5000,
    wait:async ms=>{waits.push(ms);},
    shouldStop:()=>stop,
    refresh:async ()=>{n++;if(n===1)throw new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:26000");return "ok";},
    onFailure:(_err,context)=>{observed.push(context.scheduledRetryMs);},
    onSuccess:()=>{stop=true;},
  });
  assert.equal(result.failures,1);
  assert.equal(result.successes,1);
  assert.deepEqual(waits,[26000]);
  assert.deepEqual(observed,[26000]);
});
test("daemon fails closed without falsely treating a deferred read as success",async()=>{
  let stopped=false;
  const observed:number[]=[];
  const result=await runSharedRiskRefreshLoop({
    daemon:true,intervalMs:30000,retryMs:5000,
    wait:async ()=>undefined,
    shouldStop:()=>stopped,
    refresh:async()=>{throw new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:3500");},
    onFailure:(_err,context)=>{observed.push(context.consecutiveFailures);if(context.consecutiveFailures===3)stopped=true;},
    onSuccess:()=>{throw Error("UNEXPECTED_RISK_SNAPSHOT_SUCCESS");},
  });
  assert.equal(result.successes,0);
  assert.equal(result.failures,3);
  assert.deepEqual(observed,[1,2,3]);
});
