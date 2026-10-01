import assert from "node:assert/strict";
import test from "node:test";

import { classifyIdleFlatRateBudgetDeferral } from "../lib/idle-priority-short-runner";

const flat = {
  schema: "disdex-idle-priority-state/v2",
  runtimeSha: "a".repeat(40),
  updatedAt: 1,
  positions: [],
  pending: null,
  manualReview: null,
  lastAcceptedBySymbol: {},
  failures: [],
} as any;

test("flat Idle defers exact Aster rate-budget saturation without manual review", () => {
  assert.equal(
    classifyIdleFlatRateBudgetDeferral(flat, new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007")),
    "IDLE_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007",
  );
  assert.equal(classifyIdleFlatRateBudgetDeferral(flat, new Error("other")), undefined);
});

test("rate-budget deferral never masks exposure, pending, or an existing manual review", () => {
  const error = new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007");
  assert.equal(classifyIdleFlatRateBudgetDeferral({ ...flat, positions: [{ symbol: "DOTUSDT" }] }, error), undefined);
  assert.equal(classifyIdleFlatRateBudgetDeferral({ ...flat, pending: { action: "ENTRY" } }, error), undefined);
  assert.equal(classifyIdleFlatRateBudgetDeferral({ ...flat, manualReview: "operator review" }, error), undefined);
});
