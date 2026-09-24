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

test("V12 Top3 preserves strong-quality signal while Rank3 residual sizing is explicit", () => {
  assert.equal(V12_X1_ALL.maximumPositions, 3);
  assert.equal(V12_X1_ALL.rank3EntryGrossCap, 0.10);
  assert.equal(V12_X1_ALL.rank3MinimumScore, 0.70);
  assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
  assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 2);
  assert.equal(V12_X1_ALL.dynamicResidualAggregateGrossCap, 2);
  assert.equal(V12_X1_ALL.regimeThresholdPct, 0.02);
  assert.equal(V12_X1_ALL.strongRegimeThresholdPct, 0.0359);
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMinimum, 0.15);
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMaximum, 0.70);
  assert.equal(V12_X1_ALL.strongRegimeQualityMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumMomentumPct, 0.054);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.neutralScoreThreshold, 1.4649);
});

test("PENGU allocation is the formal 1.0x COMBINED_FILTERED Q60/DD17/H72 contract", () => {
  assert.equal(PENGU_DUAL_LS_V2.maximumGross, 1.0);
  assert.equal(PENGU_DUAL_LS_V2.longGross, 1.0);
  assert.equal(PENGU_DUAL_LS_V2.shortGross, 1.0);
  assert.equal(PENGU_DUAL_LS_V2.logicProfile, "COMBINED_FILTERED_Q60_DD17_H72");
  assert.equal(PENGU_DUAL_LS_V2.routeHardStopQuarantineHours, 60);
  assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownThresholdPct, 17);
  assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownHoldHours, 72);
  assert.equal(PENGU_DUAL_LS_V2.hardStopCooldownHours, 24);
});

test("LIVE integrated risk contract uses final Q102/FET/stock/shared caps", () => {
  assert.deepEqual(INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross, {
    HIGH_VOL: 1.661,
    MR: 1,
    BRK: 2.465,
    REV: 2.5,
    PB: 2.5,
  });
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross, 3.0);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102MaximumPositions, 1);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.fetResidualMaximumGross, 2.25);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.fetResidualMinimumGross, 0.05);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap, 3);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockGrossCap, 4);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockSlotGrossCap, 2);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap, 4.25);
  assert.equal(STRICT_BT33404708902.quality102CausalV1PositionCap, 1.5);
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
