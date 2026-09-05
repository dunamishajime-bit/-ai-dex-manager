import assert from "node:assert/strict";
import {
  isPenguV8V64DynamicLongRaw,
  penguV8V64RequestedLongGross,
  type PenguDualLsV2Features,
} from "../lib/pengu-dual-ls-v2";

const f: PenguDualLsV2Features = {
  referenceTs: 1, open: 100, high: 103, low: 99, close: 102, previousLow: 99,
  priorHigh18h: 100, penguReturn24h: 0.12, penguReturn72h: 0.10, btcReturn24h: 0.01,
  relativeReturn24h: 0.12, ema72: 99, ema168: 98, btcEma168Distance: 0.01,
  volumeRatio6OverPrior36: 1.2, atr24Ratio: 0.03, rsi14: 60,
};

// V64 supplement: all long gates except regime72 pass and breakout is >0.51056 ATR.
assert.equal(isPenguV8V64DynamicLongRaw(f), true);
assert.equal(isPenguV8V64DynamicLongRaw({ ...f, close: 100.5 }), false);
assert.equal(isPenguV8V64DynamicLongRaw({ ...f, penguReturn24h: 0.05 }), false);

// Historical raw request was side-aware: up to 0.9375x; V64 low-risk branch is 0.1875x.
assert.equal(penguV8V64RequestedLongGross({ ...f, atr24Ratio: 0.01, penguReturn72h: 0.10 }), 0.9375);
assert.equal(penguV8V64RequestedLongGross({ ...f, atr24Ratio: 0.01, penguReturn72h: 0.13 }), 0.1875);
console.log("PENGU_V8_V64_DYNAMIC_SELFTEST_PASS");
