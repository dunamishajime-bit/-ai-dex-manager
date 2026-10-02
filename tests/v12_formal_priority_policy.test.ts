import assert from "node:assert/strict";
import test from "node:test";

import {
  q102MayPreemptV12,
  setV12SymbolCooldown,
  v12FormalTargetGross,
  v12SymbolCooldownUntil,
  V12_FORMAL_PRIORITY_20261003,
} from "../lib/v12-formal-priority-policy";

test("formal 2026-10-03 V12 gross contract is exact", () => {
  assert.equal(v12FormalTargetGross({ symbol: "ETH", rank: 1 }), 1.0);
  assert.equal(v12FormalTargetGross({ symbol: "SOLUSDT", rank: 2 }), 1.0);
  assert.equal(v12FormalTargetGross({ symbol: "DOGE", rank: 1 }), 0.5);
  assert.equal(v12FormalTargetGross({ symbol: "LTCUSDT", rank: 2 }), 0.5);
  assert.equal(v12FormalTargetGross({ symbol: "ETH", rank: 3 }), 0.5);
  assert.deepEqual(V12_FORMAL_PRIORITY_20261003.q102V12PreemptionRankOrder, [3, 2, 1]);
});

test("only PB REV HIGH_VOL may preempt V12 for Q102", () => {
  for (const family of ["PB", "REV", "HIGH_VOL"]) assert.equal(q102MayPreemptV12(family), true);
  for (const family of ["MR", "BRK", undefined]) assert.equal(q102MayPreemptV12(family), false);
});

test("same-symbol cooldown starts at actual exit timestamp and lasts two hours", () => {
  const state: { cooldownUntilTs?: number; symbolCooldownUntilTs?: Record<string, number> } = {};
  const exitTs = 1_800_000_000_000;
  const until = setV12SymbolCooldown(state, "ethusdt", exitTs);
  assert.equal(until, exitTs + 2 * 3_600_000);
  assert.equal(v12SymbolCooldownUntil(state, "ETHUSDT"), until);
  assert.equal(v12SymbolCooldownUntil(state, "BTCUSDT"), 0);
});
