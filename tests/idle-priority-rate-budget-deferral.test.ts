import assert from "node:assert/strict";
import test from "node:test";

import { classifyIdleFlatRateBudgetDeferral, classifyIdleProtectedPositionRateBudgetDeferral } from "../lib/idle-priority-short-runner";

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

test("protected Idle positions remain held, without manual review, during exact Aster rate-budget saturation", () => {
  const protectedPosition = {
    symbol: "DOTUSDT",
    route: "IDLE_DOT_MOMENTUM_SHORT_BTCREL",
    side: "SHORT",
    signalTs: 3_600_000,
    entryTs: 7_200_000,
    exitTs: 93_600_000,
    entryPrice: 100,
    quantity: 1,
    holdHours: 24,
    gross: 1,
    stopPrice: 110,
    takeProfitPrice: 75,
    stopClientOrderId: "stop",
    takeProfitClientOrderId: "tp",
    protectionVerified: true,
  };
  assert.equal(
    classifyIdleProtectedPositionRateBudgetDeferral(
      { ...flat, positions: [protectedPosition] },
      new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007"),
    ),
    "IDLE_PROTECTED_POSITION_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007",
  );
  assert.equal(
    classifyIdleProtectedPositionRateBudgetDeferral(
      { ...flat, positions: [{ ...protectedPosition, protectionVerified: false }] },
      new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007"),
    ),
    undefined,
  );
});
