import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { PENGU_DUAL_LS_V2 } from "@/config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8, PENGU_RECOVERY_V8_PROMOTION } from "@/config/penguRecoveryV8";
import { QUALITY102_CAUSAL_V1 } from "@/config/disdexQuality102CausalV1Runtime";

test("current LIVE target preserves the validated V12 signal contract with intentional Top2 sizing", () => {
  assert.equal(V12_X1_ALL.regimeThresholdPct, 0.02);
  assert.equal(V12_X1_ALL.strongRegimeThresholdPct, 0.0359);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumMomentumPct, 0.054);
  assert.equal(V12_X1_ALL.relaxedRegimeMinimumAtrRatio, 0.014);
  assert.equal(V12_X1_ALL.neutralScoreThreshold, 1.4649);
  assert.equal(V12_X1_ALL.maximumPositions, 2);
  assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
  assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 1.5);
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

test("Q102 remains one-slot 1.0x under the shared 2.0x/2.5x contract", () => {
  assert.equal(QUALITY102_CAUSAL_V1.maximumGross, 1);
  assert.equal(QUALITY102_CAUSAL_V1.maximumPositions, 1);
  assert.equal(QUALITY102_CAUSAL_V1.cryptoGrossCap, 2);
  assert.equal(QUALITY102_CAUSAL_V1.totalGrossCap, 2.5);
});

test("V52 preserves the canonical V50 signal thresholds and holding window", async () => {
  const source = await readFile("scripts/disdex_v52_aster_only_legacy_engine.py", "utf8");
  assert.match(source, /V50_WINDOWS = \("11:30", "12:30", "13:30"\)/);
  assert.match(source, /V50_MIN_ENTRY_BASIS_BPS = 75\.0/);
  assert.match(source, /V50_MIN_NET_EDGE_BPS = 10\.0/);
  assert.match(source, /V50_MAX_HOLDING_HOURS = 3/);
});
