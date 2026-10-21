import test from "node:test";
import assert from "node:assert/strict";
import { quality102AdoptedExitReasonForState } from "../lib/disdex-quality102-causal-v1-runner";

const HOUR = 3_600_000;

function position(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "APTUSDT",
    side: 1 as const,
    quantity: 1,
    entryPrice: 100,
    entryTs: 0,
    hardStop: 0.1,
    bestPrice: 100,
    trailActive: false,
    profitFloorArmed: false,
    profitFloorBestGainPct: 0,
    family: "PB" as const,
    ...overrides,
  };
}

test("runner-level adopted policy helper returns PB LONG initial adverse reason", () => {
  const result = quality102AdoptedExitReasonForState(position(), 98.5, 3 * HOUR, [], true);
  assert.equal(result.reason, "Q102_PB_LONG_INITIAL_ADVERSE_1P5");
});

test("runner-level adopted policy helper returns HIGH_VOL LONG H1 reason without prior-profit gate", () => {
  const result = quality102AdoptedExitReasonForState(
    position({ family: "HIGH_VOL", initialAdverseBestGainPct: 0 }),
    96,
    2 * HOUR,
    [
      { timestampMs: 0, open: 100, high: 100, low: 96, close: 97, quoteVolume: 1 },
      { timestampMs: HOUR, open: 97, high: 98, low: 95, close: 96.5, quoteVolume: 1 },
    ],
    true,
  );
  assert.equal(result.reason, "Q102_HIGH_VOL_LONG_H1_TWO_CLOSE_LOSS_3P0");
});

test("runner-level adopted policies are disabled without the explicit flag", () => {
  const result = quality102AdoptedExitReasonForState(position(), 98, 3 * HOUR, [], false);
  assert.equal(result.reason, undefined);
});
