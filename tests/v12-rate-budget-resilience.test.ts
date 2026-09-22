import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyV12InfrastructureFailure,
  isTransientV12RateBudgetError,
} from "../lib/v12-live-execution-engine";

test("V12 treats bounded global rate-budget saturation as retryable locked state", () => {
  const error = new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:7987");
  assert.equal(isTransientV12RateBudgetError(error), true);
  assert.deepEqual(classifyV12InfrastructureFailure(error), {
    status: "locked",
    reason: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:7987",
  });
});

test("V12 treats global rate-budget lock timeout as retryable locked state", () => {
  const error = new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
  assert.equal(isTransientV12RateBudgetError(error), true);
  assert.equal(classifyV12InfrastructureFailure(error)?.status, "locked");
});

test("V12 keeps malformed and unknown failures fail-closed", () => {
  assert.equal(isTransientV12RateBudgetError(new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED")), false);
  assert.equal(isTransientV12RateBudgetError(new Error("MANUAL_REVIEW_REQUIRED")), false);
  assert.equal(classifyV12InfrastructureFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED")), undefined);
});
