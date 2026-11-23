import test from "node:test";
import assert from "node:assert/strict";

import { classifyAsterRateBudgetFailure } from "../lib/disdex-aster-rate-budget-policy";

test("classifies only known pre-request Aster budget failures", () => {
  assert.deepEqual(
    classifyAsterRateBudgetFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005")),
    {
      kind: "RATE_BUDGET_DEFERRED",
      reason: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005",
      waitMs: 5005,
    },
  );
  assert.deepEqual(
    classifyAsterRateBudgetFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT")),
    { kind: "RATE_BUDGET_DEFERRED", reason: "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT" },
  );
  for (const message of ["ASTER_GLOBAL_RATE_BUDGET_MALFORMED", "HTTP 429", "ECONNRESET", "UNKNOWN"]) {
    assert.equal(classifyAsterRateBudgetFailure(new Error(message)), undefined, message);
  }
});
