import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recoverIdleProtectedRateBudgetState,
  type IdleProtectedVenueOrder,
  type IdleProtectedVenuePosition,
} from "../scripts/disdex-idle-priority-short-protected-rate-budget-recovery";

const SHA = "a".repeat(40);
const REVIEW = "IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:3098";

function state(manualReview: string | null = REVIEW) {
  return {
    schema: "disdex-idle-priority-state/v2",
    runtimeSha: SHA,
    updatedAt: 1,
    positions: [{
      symbol: "JUPUSDT",
      route: "IDLE_JUP_RELATIVE_SHORT",
      side: "SHORT",
      signalTs: 1,
      entryTs: 2,
      exitTs: 43_200_002,
      entryPrice: 0.3048,
      quantity: 225,
      holdHours: 12,
      gross: 1,
      stopPrice: 0.3353,
      takeProfitPrice: 0.2286,
      stopClientOrderId: "idle-stop-af98ca4a29c5db85186244",
      takeProfitClientOrderId: "idle-tp-69f0923893132bd78182f1",
      protectionVerified: true,
    }],
    manualReview,
    pending: null,
    lastAcceptedBySymbol: {},
    failures: [],
  };
}

const positions: IdleProtectedVenuePosition[] = [{ symbol: "JUPUSDT", quantity: -225, positionSide: "BOTH" }];
const orders: IdleProtectedVenueOrder[] = [
  { symbol: "JUPUSDT", clientOrderId: "idle-stop-af98ca4a29c5db85186244", type: "STOP_MARKET", side: "BUY", status: "NEW", quantity: 225, reduceOnly: true, stopPrice: 0.3353 },
  { symbol: "JUPUSDT", clientOrderId: "idle-tp-69f0923893132bd78182f1", type: "TAKE_PROFIT_MARKET", side: "BUY", status: "NEW", quantity: 225, reduceOnly: true, stopPrice: 0.2286 },
];

test("protected rate-budget recovery clears only after venue position and both protections read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-protected-rate-budget-recovery-"));
  try {
    const statePath = join(root, "state.json");
    const original = state();
    const originalBytes = `${JSON.stringify(original, null, 2)}\n`;
    await writeFile(statePath, originalBytes, { mode: 0o600 });
    const result = await recoverIdleProtectedRateBudgetState({
      statePath,
      expectedSha: SHA,
      venue: {
        async getPositions() { return positions; },
        async getOpenOrders() { return orders; },
      },
      now: () => 100,
    });
    assert.equal(result.status, "IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PASS");
    assert.equal(result.ordersSent, 0);
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.manualReview, null);
    assert.equal(after.lastDecision.reason, "IDLE_PROTECTED_RATE_BUDGET_RECOVERY");
    assert.equal(JSON.stringify(JSON.parse(await readFile(result.backupPath, "utf8"))), JSON.stringify(original));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protected rate-budget recovery refuses missing or mismatched protection and leaves state untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-protected-rate-budget-recovery-refuse-"));
  try {
    const statePath = join(root, "state.json");
    const original = state();
    await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(
      () => recoverIdleProtectedRateBudgetState({
        statePath,
        expectedSha: SHA,
        venue: {
          async getPositions() { return positions; },
          async getOpenOrders() { return orders.slice(0, 1); },
        },
      }),
      /IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PROTECTION_INVALID/,
    );
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
