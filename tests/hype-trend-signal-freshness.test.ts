import test from "node:test";
import assert from "node:assert/strict";

import { buildHypeTrendSignal, type HypeTrendCandle } from "../lib/hype-trend-long-signal";

const HOUR = 3_600_000;
const START = 1_790_000_000_000;
const candles: HypeTrendCandle[] = Array.from({ length: 320 }, (_, index) => {
  const base = 100 * Math.pow(1.001, index);
  const close = index === 319 ? base * 1.015 : base;
  return { openTime: START + index * HOUR, open: close, high: close * 1.0004, low: close * 0.9996, close, volume: 1000 };
});
const lastClose = START + 320 * HOUR;

test("HYPE trend accepts the latest completed H1 bar until the next bar closes", () => {
  for (const now of [lastClose, lastClose + HOUR - 1]) {
    const result = buildHypeTrendSignal({ btc: candles, hype: candles, now });
    assert.equal(result.accepted, true, JSON.stringify(result));
  }
});

for (const [label, now] of [["the next H1 bar is missing", lastClose + HOUR], ["the last completed H1 bar is 25 hours old", lastClose + 25 * HOUR]] as const) {
  test(`HYPE trend rejects aligned data when ${label}`, () => {
    const result = buildHypeTrendSignal({ btc: candles, hype: candles, now });
    assert.equal(result.accepted, false, JSON.stringify(result));
    assert.equal(result.side, "FLAT");
    assert.equal(result.reason, "STALE_COMPLETED_H1_DATA");
  });
}

test("HYPE trend rejects when either market misses its latest completed H1 bar", () => {
  for (const input of [
    { btc: candles.slice(0, -1), hype: candles },
    { btc: candles, hype: candles.slice(0, -1) },
  ]) {
    const result = buildHypeTrendSignal({ ...input, now: lastClose });
    assert.equal(result.accepted, false, JSON.stringify(result));
    assert.equal(result.side, "FLAT");
  }
});
