import assert from "node:assert/strict";
import * as runnerModule from "../lib/pengu-dual-ls-v2-portfolio-runner";
import { planStrictPortfolio } from "../lib/disdex-strict-portfolio-planner";

const build = (runnerModule as Record<string, unknown>).buildPenguV8StrictGrossContract;
assert.equal(typeof build, "function", "runner must preserve requested Gross before planner allocation");
const contract = (build as (requested: number, equity: number, available: number) => {
  requestedGross: number; intentGross: number; intentNotionalUsd: number;
})(0.9375, 1_000, 1_000);
assert.deepEqual(contract, { requestedGross: 0.9375, intentGross: 0.9375, intentNotionalUsd: 937.5 });

const plan = planStrictPortfolio({
  equity: 1_000, now: 1_000, active: [], maxDataAgeMs: 300_000,
  intents: [{ idempotencyKey: "pengu-v8-long", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT",
    side: "LONG", gross: contract.intentGross, notionalUsd: contract.intentNotionalUsd,
    signalTs: 1_000, requestedGross: contract.requestedGross } as any],
});
assert.equal(plan.status, "planned");
assert.equal(plan.accepted[0]?.gross, 0.75);
assert.equal((plan.accepted[0] as any)?.requestedGross, 0.9375);
console.log("PENGU_V8_GROSS_CONTRACT_SELFTEST_PASS");