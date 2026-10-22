import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceFetBrk48LongTrailingStop,
  type FetBrk48TrailingStopState,
} from "../lib/fet-brk48-trailing-stop";

function bar(timestampMs: number, close: number, overrides: Partial<{ open: number; high: number; low: number }> = {}) {
  return {
    timestampMs,
    open: overrides.open ?? close,
    high: overrides.high ?? close,
    low: overrides.low ?? close,
    close,
  };
}

test("FET LONG trail arms at a confirmed +8% close and gives back four points", () => {
  const first = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    bar: bar(1_000, 108),
  });
  assert.equal(first.reason, "ARMED");
  assert.equal(first.stopHit, false);
  assert.equal(first.state.armed, true);
  assert.ok(Math.abs(first.state.bestGainPct - 0.08) < 1e-12);
  assert.equal(first.state.stopPrice, 104);

  const updated = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    state: first.state,
    bar: bar(2_000, 110, { low: 105 }),
  });
  assert.equal(updated.reason, "UPDATED");
  assert.ok(Math.abs(updated.state.bestGainPct - 0.1) < 1e-12);
  assert.equal(updated.state.stopPrice, 106);
});

test("FET LONG trail is monotonic and ignores duplicate or old confirmed bars", () => {
  const state: FetBrk48TrailingStopState = {
    armed: true,
    bestGainPct: 0.12,
    stopPrice: 108,
    lastConfirmedBarTs: 3_000,
    armedAt: 2_000,
  };
  const duplicate = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    state,
    bar: bar(3_000, 109),
  });
  assert.equal(duplicate.reason, "DUPLICATE_OR_OLD_BAR");
  assert.deepEqual(duplicate.state, state);

  const lower = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    state: duplicate.state,
    bar: bar(4_000, 109, { low: 108.5 }),
  });
  assert.equal(lower.state.bestGainPct, 0.12);
  assert.equal(lower.state.stopPrice, 108);
  assert.equal(lower.reason, "UPDATED");
});

test("FET LONG trail reports a gap-aware stop trigger before using the current close", () => {
  const result = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    state: { armed: true, bestGainPct: 0.1, stopPrice: 106, lastConfirmedBarTs: 1_000 },
    bar: bar(2_000, 107, { open: 105, high: 108, low: 104 }),
  });
  assert.equal(result.reason, "STOP_HIT");
  assert.equal(result.stopHit, true);
  assert.equal(result.triggerPrice, 105);
  assert.equal(result.state.lastConfirmedBarTs, 2_000);
});

test("FET LONG trail does not arm below +8% and validates malformed bars", () => {
  const result = advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    bar: bar(1_000, 107.99),
  });
  assert.equal(result.reason, "NO_STOP");
  assert.equal(result.state.armed, false);
  assert.equal(result.state.stopPrice, undefined);
  assert.throws(() => advanceFetBrk48LongTrailingStop({
    entryPrice: 100,
    bar: { timestampMs: 2_000, open: 100, high: 99, low: 101, close: 100 },
  }), /FET_M5_OHLC_INVALID/);
});
