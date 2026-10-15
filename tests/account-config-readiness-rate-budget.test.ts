import assert from "node:assert/strict";
import test from "node:test";

import { classifyAccountConfigReadinessRateBudgetDeferral } from "../lib/disdex-account-config-readiness-policy";

test("account config readiness defers only saturated or timed-out shared rate budget", () => {
  assert.deepEqual(
    classifyAccountConfigReadinessRateBudgetDeferral(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:4130")),
    { status: "CONFIG_DEFER_RATE_BUDGET", reason: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:4130" },
  );
  assert.deepEqual(
    classifyAccountConfigReadinessRateBudgetDeferral(new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT")),
    { status: "CONFIG_DEFER_RATE_BUDGET", reason: "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT" },
  );
});

test("account config readiness keeps non-budget failures fail-closed", () => {
  for (const message of [
    "ASTER_GLOBAL_RATE_BUDGET_MALFORMED",
    "ASTER_GLOBAL_RATE_BUDGET_LOCK_RELEASE_FAILED",
    "CONFIG_CREDENTIALS_MISSING",
    "HTTP 429",
    "UNKNOWN",
  ]) {
    assert.equal(classifyAccountConfigReadinessRateBudgetDeferral(new Error(message)), undefined, message);
  }
});
