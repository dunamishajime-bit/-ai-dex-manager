import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { PENGU_DUAL_LS_V2 } from "@/config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8, PENGU_RECOVERY_V8_PROMOTION } from "@/config/penguRecoveryV8";
import { QUALITY102_CAUSAL_V1 } from "@/config/disdexQuality102CausalV1Runtime";
import v52V50Runtime from "@/config/v52V50Runtime.json";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";

test("current LIVE target preserves the validated V12 signal contract with Top3 residual sizing", () => {
  assert.equal(V12_X1_ALL.regimeThresholdPct, 0.02);
  assert.equal(V12_X1_ALL.strongRegimeThresholdPct, 0.0359);
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMinimum, 0.15);
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMaximum, 0.70);
  assert.equal(V12_X1_ALL.strongRegimeQualityMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumMomentumPct, 0.054);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.neutralScoreThreshold, 1.4649);
  assert.equal(V12_X1_ALL.maximumPositions, 3);
  assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
  assert.equal(V12_X1_ALL.rank3EntryGrossCap, 0.10);
  assert.equal(V12_X1_ALL.rank3MinimumScore, 0.70);
  assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 1.5);
  assert.equal(V12_X1_ALL.dynamicResidualAggregateGrossCap, 2);
});

test("PENGU V20/V8 implementation target has Recovery V8 live-enabled as supplemental Long", () => {
  assert.equal(PENGU_RECOVERY_V8_PROMOTION.liveEnabled, true);
  assert.equal(PENGU_RECOVERY_V8.rule, "R_BTC3");
  assert.equal(PENGU_RECOVERY_V8.priority, "SHORT_FIRST");
  assert.equal(PENGU_RECOVERY_V8.initialGross, 0.5);
  assert.equal(PENGU_RECOVERY_V8.partial.afterHours, 24);
  assert.equal(PENGU_RECOVERY_V8.partial.stopPct, 0.04);
  assert.equal(PENGU_RECOVERY_V8.partial.gross, 0.25);
  assert.equal(PENGU_RECOVERY_V8.exit.hardStopPct, 0.06);
  assert.equal(PENGU_RECOVERY_V8.exit.trailActivationPct, 0.06);
  assert.equal(PENGU_RECOVERY_V8.exit.trailRetracePct, 0.03);
  assert.equal(PENGU_RECOVERY_V8.exit.maxHoldHours, 72);
  assert.equal(PENGU_DUAL_LS_V2.hardStopCooldownHours, 24);
});

test("Q102 one-slot LIVE target uses DD-governed sizing up to 3.00x under shared 3.0x/3.5x caps", () => {
  assert.equal(QUALITY102_CAUSAL_V1.maximumGross, 3.0);
  assert.equal(QUALITY102_CAUSAL_V1.maximumPositions, 1);
  assert.equal(QUALITY102_CAUSAL_V1.cryptoGrossCap, 3);
  assert.equal(QUALITY102_CAUSAL_V1.totalGrossCap, 3.5);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross.HIGH_VOL, 1.661);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross.BRK, 2.465);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockGrossCap, 1.98);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockSlotGrossCap, 1.64);
});

test("V52 preserves the canonical V50 signal thresholds and holding window", async () => {
  const source = await readFile("scripts/disdex_v52_aster_only_legacy_engine.py", "utf8");
  assert.deepEqual(v52V50Runtime.windowsNy, ["11:30", "12:30", "13:30"]);
  assert.equal(v52V50Runtime.minimumEntryBasisBps, 60);
  assert.equal(v52V50Runtime.convergenceBps, 20);
  assert.equal(v52V50Runtime.basisStopMultiple, 1.75);
  assert.equal(v52V50Runtime.minimumNetEdgeBps, 7.5);
  assert.equal(v52V50Runtime.maximumHoldingHours, 3);
  assert.match(source, /V50_POLICY_ID/);
});
