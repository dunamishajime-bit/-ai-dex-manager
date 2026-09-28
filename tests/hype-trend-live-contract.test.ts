import test from "node:test";
import assert from "node:assert/strict";

import { HYPE_TREND_LONG_POLICY } from "../config/hypeTrendLongPolicy";
import { buildHypeTrendSignal, type HypeTrendCandle } from "../lib/hype-trend-long-signal";

test("HYPE live policy matches the approved high-win Aster fixed-ledger contract", () => {
  assert.equal(HYPE_TREND_LONG_POLICY.symbol, "HYPEUSDT");
  assert.equal(HYPE_TREND_LONG_POLICY.fastEmaPeriod, 12);
  assert.equal(HYPE_TREND_LONG_POLICY.slowEmaPeriod, 48);
  assert.equal(HYPE_TREND_LONG_POLICY.breakoutLookbackHours, 24);
  assert.equal(HYPE_TREND_LONG_POLICY.minimumBreakoutBps, 30);
  assert.equal(HYPE_TREND_LONG_POLICY.maximumDistanceFromSlowEmaBps, 900);
  assert.equal(HYPE_TREND_LONG_POLICY.regimeEmaPeriod, 240);
  assert.equal(HYPE_TREND_LONG_POLICY.minimumRegimeSlopeBps, 25);
  assert.equal(HYPE_TREND_LONG_POLICY.atrPeriod, 14);
  assert.equal(HYPE_TREND_LONG_POLICY.stopAtrMultiple, 2.5);
  assert.equal(HYPE_TREND_LONG_POLICY.trailingAtrMultiple, 3);
  assert.equal(HYPE_TREND_LONG_POLICY.maximumHoldHours, 168);
  assert.equal(HYPE_TREND_LONG_POLICY.riskPct, 5);
  assert.equal(HYPE_TREND_LONG_POLICY.maximumGross, 1.5);
  assert.equal(HYPE_TREND_LONG_POLICY.leverage, 5);
  assert.equal(HYPE_TREND_LONG_POLICY.marginType, "cross");
});

test("HYPE trend signal never uses an incomplete current candle", () => {
  const candles: HypeTrendCandle[] = Array.from({ length: 320 }, (_, index) => {
    const close = 100 + index * 0.04;
    return { openTime: index * 3_600_000, open: close, high: close + 0.2, low: close - 0.1, close, volume: 1000 };
  });
  const now = candles.at(-1)!.openTime + 1_800_000;
  const result = buildHypeTrendSignal({ btc: candles, hype: candles, now });
  assert.ok(result.signalTsMs === null || result.signalTsMs < now - 1_800_000);
  assert.notEqual(result.reason, "INCOMPLETE_CURRENT_BAR_ACCEPTED");
});
