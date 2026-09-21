import test from "node:test";
import assert from "node:assert/strict";

import {
  assertActiveV12StateForShaMigration,
  buildMigratedV12State,
} from "../scripts/disdex-v12-active-state-sha-migrate";

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

function state(overrides: Record<string, unknown> = {}) {
  const position = {
    symbol: "DOGEUSDT",
    side: "LONG",
    quantity: 529,
    gross: 0.70,
    baseQuantity: 529,
    dynamicQuantity: 0,
    baseGross: 0.70,
    dynamicGross: 0,
    entryRank: 1,
    positionId: "v12-entry-doge",
    entryPrice: 0.09772,
    atrAtEntry: 0.0017,
    entrySignalTs: 1,
    holdingBars: 1,
    peakPrice: 0.1,
    troughPrice: 0.09,
    protection: {
      strategyId: "V12_X1.00_ALL",
      symbol: "DOGEUSDT",
      side: "LONG",
      positionId: "v12-entry-doge",
      quantity: 529,
      entryPrice: 0.09772,
      atrAtEntry: 0.0017,
      initialStop: 0.09,
      lastAckStop: 0.097,
      takeProfit: 0.103,
      peakOrTrough: 0.1,
      stopClientOrderId: "v12-stop-doge",
      takeProfitClientOrderId: "v12-tp-doge",
    },
  };
  return {
    schema: "v12-x1-all-runner-state/v2",
    strategyId: "V12_X1.00_ALL",
    mode: "LIVE",
    updatedAt: 1,
    runtimeCommitSha: FROM,
    activePositions: [position],
    active: position,
    ...overrides,
  };
}

test("active V12 state migration preserves positions and changes only runtime SHA", () => {
  const before = state();
  assert.doesNotThrow(() => assertActiveV12StateForShaMigration(before, FROM, TO));
  const after = buildMigratedV12State(before, TO, 2);
  assert.equal(after.runtimeCommitSha, TO);
  assert.deepEqual(after.activePositions, before.activePositions);
  assert.deepEqual(after.active, before.active);
  assert.equal(after.updatedAt, 2);
});

test("active V12 migration rejects pending or missing protection state", () => {
  assert.throws(() => assertActiveV12StateForShaMigration(state({ pending: { action: "ENTRY" } }), FROM, TO), /PENDING/);
  const broken = state();
  (broken.activePositions[0] as { protection?: unknown }).protection = undefined;
  assert.throws(() => assertActiveV12StateForShaMigration(broken, FROM, TO), /PROTECTION/);
});
