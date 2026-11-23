import assert from "node:assert/strict";
import test from "node:test";

import { classifyQ102PreflightRateBudgetDeferral } from "../scripts/disdex-quality102-causal-v1-live-runner";

test("Q102 preflight defers only the canonical global rate-budget saturation", () => {
  assert.deepEqual(
    classifyQ102PreflightRateBudgetDeferral(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5247")),
    {
      status: "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_DEFERRED_RATE_BUDGET",
      safetyState: "DEFERRED_FAIL_CLOSED",
      reason: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5247",
      retryAfterMs: 5247,
      ordersSent: 0,
      cancelSent: 0,
      positionChangesSent: 0,
      stateChanged: false,
      syntheticOrders: 0,
      testOrders: 0,
    },
  );
});

test("Q102 preflight does not defer malformed, HTTP, or unknown failures", () => {
  for (const message of [
    "ASTER_GLOBAL_RATE_BUDGET_MALFORMED",
    "HTTP 429",
    "ECONNRESET",
    "QUALITY102_PREFLIGHT_OPEN_ORDER_CONFLICT",
  ]) {
    assert.equal(classifyQ102PreflightRateBudgetDeferral(new Error(message)), undefined, message);
  }
});
