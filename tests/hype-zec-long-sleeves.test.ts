import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHypeZecProtection,
  calculateHypeZecQuantity,
  evaluateHypeLongSignal,
  evaluateZecLongSignal,
  type HypeZecCandle,
} from "../lib/hype-zec-long-sleeves";

const STEP = 15 * 60_000;

function candles(base: number, closes: number[], start = Date.UTC(2026, 0, 1, 0, 0, 0)) {
  return closes.map((close, index): HypeZecCandle => ({
    ts: start + index * STEP,
    open: index === 0 ? base : closes[index - 1],
    high: Math.max(index === 0 ? base : closes[index - 1], close) * 1.001,
    low: Math.min(index === 0 ? base : closes[index - 1], close) * 0.999,
    close,
    volume: 100 + index,
  }));
}

function oneMinuteBreakout(price: number, ts: number): HypeZecCandle[] {
  return [{
    ts,
    open: price,
    high: price * 1.003,
    low: price * 0.999,
    close: price * 1.002,
    volume: 10_000,
  }];
}

test("HYPE LONG accepts a completed BTC-gated breakout and returns protective levels", () => {
  const hype15m = candles(100, Array.from({ length: 30 }, (_, index) => index < 29 ? 100 : 100.5));
  const btc15m = candles(100, Array.from({ length: 30 }, (_, index) => index < 29 ? 100 : 100.1));
  const now = hype15m.at(-1)!.ts + STEP + 60_000;
  const result = evaluateHypeLongSignal({
    now,
    btc15m,
    symbol15m: hype15m,
    symbol1m: oneMinuteBreakout(100.5, hype15m.at(-1)!.ts + STEP + 60_000),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.strategy, "HYPE_LONG");
  assert.equal(result.side, "LONG");
  assert.ok(result.stopPrice! < result.entryPrice!);
  assert.ok(result.takeProfitPrice! > result.entryPrice!);
});

test("ZEC LONG uses its own completed-bar breakout rules", () => {
  const zec15m = candles(100, Array.from({ length: 30 }, (_, index) => index < 29 ? 100 : 100.8));
  const btc15m = candles(100, Array.from({ length: 30 }, (_, index) => index < 29 ? 100 : 100.08));
  const now = zec15m.at(-1)!.ts + STEP + 60_000;
  const result = evaluateZecLongSignal({
    now,
    btc15m,
    symbol15m: zec15m,
    symbol1m: oneMinuteBreakout(100.8, zec15m.at(-1)!.ts + STEP + 60_000),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.strategy, "ZEC_LONG");
  assert.equal(result.side, "LONG");
});

test("stale or incomplete candles fail closed", () => {
  const result = evaluateHypeLongSignal({
    now: Date.UTC(2026, 0, 1, 1, 0, 0),
    btc15m: [],
    symbol15m: [],
    symbol1m: [],
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /DATA|INSUFFICIENT|STALE/);
});

test("risk-derived quantity is capped by both stop risk and GROSS 1.0x", () => {
  const hype = calculateHypeZecQuantity({
    strategy: "HYPE_LONG",
    equityUsd: 1_000,
    entryPrice: 100,
    stopPrice: 95,
    feeBpsPerSide: 4,
    slippageBps: 5,
    fundingBps: 0,
    stepSize: 0.001,
  });
  const zec = calculateHypeZecQuantity({
    strategy: "ZEC_LONG",
    equityUsd: 1_000,
    entryPrice: 100,
    stopPrice: 95.5,
    feeBpsPerSide: 4,
    slippageBps: 5,
    fundingBps: 0,
    stepSize: 0.001,
  });
  assert.ok(hype.quantity > 0 && hype.quantity < 10);
  assert.ok(zec.quantity > 0 && zec.quantity < 10);
  assert.ok(hype.worstCaseLossUsd <= 50 + 1e-8);
  assert.ok(zec.worstCaseLossUsd <= 45 + 1e-8);
  assert.ok(hype.gross <= 1 + 1e-8);
  assert.ok(zec.gross <= 1 + 1e-8);
});

test("protective levels honor long-side tick rounding", () => {
  const result = buildHypeZecProtection({
    strategy: "HYPE_LONG",
    entryPrice: 100.003,
    tickSize: 0.01,
    quantity: 1.23456,
    stepSize: 0.001,
  });
  assert.equal(result.quantity, 1.234);
  assert.equal(result.stopPrice, 99.55);
  assert.equal(result.takeProfitPrice, 101.81);
  assert.equal(result.reduceOnly, true);
});
