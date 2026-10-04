import assert from "node:assert/strict";
import test from "node:test";

import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";
import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import {
  quality102GrossForFamilyAndSide,
  Q102_CAUSAL_V4_SIDE_GROSS_CAP,
} from "../config/integratedProductionRiskPolicy";
import {
  evaluatePenguDualLsV2ShortSignals,
  type PenguDualLsV2Features,
} from "../lib/pengu-dual-ls-v2";

function f(overrides: Partial<PenguDualLsV2Features>): PenguDualLsV2Features {
  return {
    referenceTs: 0,
    open: 100,
    high: 101,
    low: 100,
    close: 100,
    previousLow: 99,
    priorHigh18h: 110,
    penguReturn24h: -0.08,
    penguReturn72h: -0.05,
    btcReturn24h: -0.01,
    relativeReturn24h: -0.03,
    ema72: 110,
    ema168: 120,
    btcEma168Distance: 0.01,
    volumeRatio6OverPrior36: 1,
    atr24Ratio: 0.02,
    rsi14: 40,
    ...overrides,
  };
}

test("DD14 promotion candidate freezes Q102 side-specific gross caps", () => {
  assert.equal(Q102_CAUSAL_V4_SIDE_GROSS_CAP.HIGH_VOL_SHORT, 0.70);
  assert.equal(Q102_CAUSAL_V4_SIDE_GROSS_CAP.REV_SHORT, 1.25);
  assert.equal(Q102_CAUSAL_V4_SIDE_GROSS_CAP.PB_LONG, 2.0);

  assert.equal(quality102GrossForFamilyAndSide("HIGH_VOL", -1), 0.70);
  assert.equal(quality102GrossForFamilyAndSide("HIGH_VOL", 1), 1.661);
  assert.equal(quality102GrossForFamilyAndSide("REV", -1), 1.25);
  assert.equal(quality102GrossForFamilyAndSide("REV", 1), 2.5);
  assert.equal(quality102GrossForFamilyAndSide("PB", 1), 2.0);
  assert.equal(quality102GrossForFamilyAndSide("PB", -1), 2.5);
});

test("DD14 promotion candidate freezes FET and V12 loss controls", () => {
  assert.equal(FET_BRK48_RESIDUAL.minimumReturn72h, 0.02);
  assert.equal(FET_BRK48_RESIDUAL.reentryCooldownHours, 24);
  assert.equal(V12_X1_ALL.sameSideLossCooldownThreshold, 6);
  assert.equal(V12_X1_ALL.sameSideLossCooldownHours, 6);
});

test("PENGU limited structural re-break blocks a 3.3% false re-break but admits <=2%", () => {
  assert.equal(PENGU_DUAL_LS_V2.short.limitedStructuralRebreakPct, 0.02);
  const rows = [
    f({ referenceTs: 1, close: 100, low: 100, previousLow: 99, penguReturn24h: -0.08 }),
    f({ referenceTs: 2, close: 102, low: 100, previousLow: 99, penguReturn24h: -0.05 }),
    f({ referenceTs: 3, close: 103.3, low: 102, previousLow: 104, penguReturn24h: -0.05 }),
    f({ referenceTs: 4, close: 101.5, low: 101, previousLow: 102, penguReturn24h: -0.05 }),
  ];
  const result = evaluatePenguDualLsV2ShortSignals(rows, 0);
  assert.equal(result.signals[2], false);
  assert.equal(result.signals[3], true);
});
