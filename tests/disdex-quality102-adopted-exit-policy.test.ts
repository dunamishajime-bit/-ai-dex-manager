import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceQ102HighVolShortProfitFloor,
  evaluateQ102HighVolLongH1Loss,
  evaluateQ102PbLongInitialAdverse,
  type Q102ProfitFloorStageState,
} from "../lib/disdex-quality102-adopted-exit-policy";

const HOUR = 3_600_000;
const M5 = 300_000;

function bar(timestampMs: number, close: number, open = close, high = Math.max(open, close), low = Math.min(open, close)) {
  return { timestampMs, open, high, low, close, quoteVolume: 1 };
}

test("PB LONG initial adverse exit requires 3h, MFE below 0.5%, and 1.5% adverse mark", () => {
  const base = { family: "PB" as const, side: "LONG" as const, entryPrice: 100, entryTs: 0, now: 3 * HOUR, maxFavorablePct: 0.0049 };
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...base, markPrice: 98.5 }), "Q102_PB_LONG_INITIAL_ADVERSE_1P5");
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...base, now: 3 * HOUR - 1, markPrice: 98.5 }), undefined);
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...base, maxFavorablePct: 0.005, markPrice: 98.5 }), undefined);
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...base, markPrice: 98.5001 }), undefined);
});

test("PB initial adverse policy is isolated from other Q102 families and sides", () => {
  const input = { entryPrice: 100, entryTs: 0, now: 3 * HOUR, maxFavorablePct: 0, markPrice: 98 };
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...input, family: "HIGH_VOL", side: "LONG" }), undefined);
  assert.equal(evaluateQ102PbLongInitialAdverse({ ...input, family: "PB", side: "SHORT" }), undefined);
});

test("HIGH_VOL LONG early loss requires two consecutive completed H1 closes and never reads a future candle", () => {
  const entryTs = 0;
  const candles = [
    { timestampMs: 0, open: 100, high: 100, low: 96, close: 97, quoteVolume: 1 },
    { timestampMs: HOUR, open: 97, high: 98, low: 95, close: 96.5, quoteVolume: 1 },
  ];
  assert.equal(evaluateQ102HighVolLongH1Loss({
    family: "HIGH_VOL", side: "LONG", entryPrice: 100, entryTs, now: 2 * HOUR, candles,
  }).reason, "Q102_HIGH_VOL_LONG_H1_TWO_CLOSE_LOSS_3P0");
  assert.equal(evaluateQ102HighVolLongH1Loss({
    family: "HIGH_VOL", side: "LONG", entryPrice: 100, entryTs, now: 2 * HOUR - 1, candles,
  }).reason, undefined);
  assert.equal(evaluateQ102HighVolLongH1Loss({
    family: "HIGH_VOL", side: "LONG", entryPrice: 100, entryTs, now: 3 * HOUR, candles: [candles[0]],
  }).reason, undefined);
});

test("HIGH_VOL H1 loss policy is isolated from PB and SHORT", () => {
  const candles = [
    { timestampMs: 0, open: 100, high: 100, low: 96, close: 97, quoteVolume: 1 },
    { timestampMs: HOUR, open: 97, high: 98, low: 95, close: 96.5, quoteVolume: 1 },
  ];
  const input = { entryPrice: 100, entryTs: 0, now: 2 * HOUR, candles };
  assert.equal(evaluateQ102HighVolLongH1Loss({ ...input, family: "PB", side: "LONG" }).reason, undefined);
  assert.equal(evaluateQ102HighVolLongH1Loss({ ...input, family: "HIGH_VOL", side: "SHORT" }).reason, undefined);
});

test("HIGH_VOL SHORT floor stages from +2/+0.5 to +3/+1 on confirmed M5 closes and never retreats", () => {
  const first = advanceQ102HighVolShortProfitFloor({
    family: "HIGH_VOL", side: "SHORT", entryPrice: 100, bar: bar(M5, 98),
  });
  assert.equal(first.reason, "ARMED_0P5");
  assert.equal(first.state.stage, 1);
  assert.equal(first.state.stopPrice, 99.5);

  const second = advanceQ102HighVolShortProfitFloor({
    family: "HIGH_VOL", side: "SHORT", entryPrice: 100, state: first.state, bar: bar(2 * M5, 97),
  });
  assert.equal(second.reason, "ARMED_1P0");
  assert.equal(second.state.stage, 2);
  assert.equal(second.state.stopPrice, 99);

  const old = advanceQ102HighVolShortProfitFloor({
    family: "HIGH_VOL", side: "SHORT", entryPrice: 100, state: second.state, bar: bar(M5, 101),
  });
  assert.equal(old.reason, "DUPLICATE_OR_OLD_BAR");
  assert.equal(old.state.stopPrice, 99);

  const hit = advanceQ102HighVolShortProfitFloor({
    family: "HIGH_VOL", side: "SHORT", entryPrice: 100, state: second.state,
    bar: bar(3 * M5, 99.4, 99.2, 99.6, 98.8),
  });
  assert.equal(hit.stopHit, true);
  assert.equal(hit.triggerPrice, 99.2);
});

test("HIGH_VOL short stage transition does not apply to LONG or non-HIGH_VOL", () => {
  const state: Q102ProfitFloorStageState = { armed: false, stage: 0, bestGainPct: 0 };
  const input = { entryPrice: 100, state, bar: bar(M5, 97) };
  assert.equal(advanceQ102HighVolShortProfitFloor({ ...input, family: "PB", side: "SHORT" }).state.stage, 0);
  assert.equal(advanceQ102HighVolShortProfitFloor({ ...input, family: "HIGH_VOL", side: "LONG" }).state.stage, 0);
});
