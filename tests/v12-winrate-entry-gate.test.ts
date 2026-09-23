import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateV12WinRateGateFromFeatures,
  v12EntryGrossCapForSignal,
  v12EntryGrossMultiplierForSignal,
  type V12WinRateGateFeatures,
} from "../lib/v12-x1-all";

function f(overrides: Partial<V12WinRateGateFeatures> = {}): V12WinRateGateFeatures {
  return {
    ret6h: 0.005,
    ret24h: 0.010,
    btc12h: 0.005,
    btc24h: 0.010,
    btcEr12: 0.30,
    btcEr24: 0.35,
    rel24h: 0.005,
    previousVolumeRatio: 1.0,
    ...overrides,
  };
}

test("HC175 remains exempt and receives 1.75 gross multiplier", () => {
  const decision = evaluateV12WinRateGateFromFeatures(f({
    ret6h: 0.03,
    ret24h: 0.025,
    btc12h: -0.01,
    btc24h: 0.025,
    btcEr12: 0.60,
    btcEr24: 0.10,
    rel24h: 0,
    previousVolumeRatio: 0.70,
  }), 1);
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "ALLOW_HC175");
  assert.equal(decision.highConfidence, true);
  assert.equal(decision.entryGrossMultiplier, 1.75);
  assert.equal(v12EntryGrossMultiplierForSignal({ rank: 1, entryGrossMultiplier: decision.entryGrossMultiplier }), 1.75);
  assert.equal(v12EntryGrossCapForSignal({ rank: 1, entryGrossMultiplier: decision.entryGrossMultiplier }), 1.75);
  assert.equal(v12EntryGrossCapForSignal({ rank: 3, entryGrossMultiplier: decision.entryGrossMultiplier }), 0.10);
});

test("Sep23 XRP04 false burst is blocked", () => {
  const decision = evaluateV12WinRateGateFromFeatures(f({
    ret6h: 0.0221138211,
    ret24h: 0.050,
    btc12h: 0.0134590448,
    btc24h: 0.0068,
    btcEr12: 0.649739878,
    btcEr24: 0.174614725,
    rel24h: 0.043203266,
    previousVolumeRatio: 1.0,
  }), 1);
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "BLOCK_FALSE_BURST80");
});

test("Sep23 INJ Rank1 fast mismatch is blocked", () => {
  const decision = evaluateV12WinRateGateFromFeatures(f({
    ret6h: 0.0098394614,
    ret24h: 0.004119,
    btc12h: -0.0007853318,
    btc24h: -0.004559,
    btcEr12: 0.055224733,
    btcEr24: 0.111318039,
    rel24h: 0.0086784505,
    previousVolumeRatio: 1.0,
  }), 1);
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "BLOCK_RANK1_FAST_E085_REL10");
});

test("same fast mismatch does not blanket-block Rank2 XRP", () => {
  const decision = evaluateV12WinRateGateFromFeatures(f({
    ret6h: -0.0022267464,
    ret24h: 0.012263603,
    btc12h: -0.0007853318,
    btc24h: -0.004558986,
    btcEr12: 0.055224733,
    btcEr24: 0.111318039,
    rel24h: 0.016822589,
    previousVolumeRatio: 1.0,
  }), 2);
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "ALLOW_STANDARD");
});

test("Sep23 SOL Rank1 is blocked while LTC and NEAR pass", () => {
  const sol = evaluateV12WinRateGateFromFeatures(f({
    ret6h: -0.0010125728,
    btc12h: -0.0007986676,
    btcEr12: 0.061746046,
    btcEr24: 0.373991342,
    rel24h: 0.0010501752,
  }), 1);
  assert.equal(sol.reason, "BLOCK_RANK1_FAST_E085_REL10");

  const ltc = evaluateV12WinRateGateFromFeatures(f({
    ret6h: 0.0151660281,
    btc12h: 0.0036247871,
    btcEr12: 0.291054491,
    btcEr24: 0.346661688,
    rel24h: 0.031731376,
  }), 1);
  assert.equal(ltc.allow, true);

  const near = evaluateV12WinRateGateFromFeatures(f({
    ret6h: 0.0168435625,
    btc12h: -0.0006720961,
    btcEr12: 0.052261034,
    btcEr24: 0.238689937,
    rel24h: 0.0004309923,
  }), 2);
  assert.equal(near.allow, true);
});

test("E085 is strict and invalid features fail closed", () => {
  const boundary = evaluateV12WinRateGateFromFeatures(f({
    btc12h: -0.001,
    btcEr12: 0.085,
    rel24h: 0,
  }), 1);
  assert.equal(boundary.allow, true);

  const invalid = evaluateV12WinRateGateFromFeatures(f({ btcEr12: Number.NaN }), 1);
  assert.equal(invalid.allow, false);
  assert.equal(invalid.reason, "BLOCK_FEATURES_INVALID");
});
