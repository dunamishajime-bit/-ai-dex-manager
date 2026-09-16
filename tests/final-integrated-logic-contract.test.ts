import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "../config/integratedProductionRiskPolicy";
import { resolveSharedCryptoDailyLossPct } from "../config/sharedCryptoRiskPolicy";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import v52V50Runtime from "../config/v52V50Runtime.json";

const v52Source = readFileSync(new URL("../scripts/disdex_v52_aster_only_legacy_engine.py", import.meta.url), "utf8");

test("V12 production signal and sizing contract remains unchanged", () => {
  assert.equal(V12_X1_ALL.maximumPositions, 2);
  assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
  assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 1.5);
  assert.equal(V12_X1_ALL.regimeThresholdPct, 0.02);
  assert.equal(V12_X1_ALL.strongRegimeThresholdPct, 0.0359);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumMomentumPct, 0.054);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.neutralScoreThreshold, 1.4649);
});

test("PENGU allocation is the formal 0.85x production contract", () => {
  assert.equal(PENGU_DUAL_LS_V2.maximumGross, 0.85);
  assert.equal(PENGU_DUAL_LS_V2.longGross, 0.85);
  assert.equal(PENGU_DUAL_LS_V2.shortGross, 0.85);
  assert.equal(PENGU_DUAL_LS_V2.hardStopCooldownHours, 24);
});

test("Q102 Causal V4 is one slot at 1.50x and shared caps are 3.0/1.5/3.5", () => {
  assert.equal(STRICT_BT33404708902.quality102CausalV1PositionCap, 1.5);
  assert.equal(STRICT_BT33404708902.cryptoGrossCap, 3);
  assert.equal(STRICT_BT33404708902.stockGrossCap, 1.5);
  assert.equal(STRICT_BT33404708902.totalGrossCap, 3.5);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102MaximumPositions, 1);
});

test("shared crypto daily loss remains the canonical 7.5% contract", () => {
  assert.equal(resolveSharedCryptoDailyLossPct(), 7.5);
  assert.throws(() => resolveSharedCryptoDailyLossPct("5"), /CONTRACT_MISMATCH/);
});

test("V50 uses the selected B60/C20/Stop1.75/Edge7.5 policy", () => {
  assert.equal(v52V50Runtime.minimumEntryBasisBps, 60);
  assert.equal(v52V50Runtime.convergenceBps, 20);
  assert.equal(v52V50Runtime.basisStopMultiple, 1.75);
  assert.equal(v52V50Runtime.minimumNetEdgeBps, 7.5);
  assert.equal(v52V50Runtime.maximumRoundTripCostBps, 60);
  assert.equal(v52V50Runtime.maximumSpreadBps, 20);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.v50.maximumSpreadBps, 20);
});

test("V50 policy preserves V11 identity and operational gates", () => {
  assert.deepEqual(v52V50Runtime.windowsNy, ["11:30", "12:30", "13:30"]);
  assert.equal(v52V50Runtime.maximumHoldingHours, 3);
  assert.match(v52Source, /V50_SLOT\s*=\s*\"V50_POST_OPEN_BASIS\"/);
});
