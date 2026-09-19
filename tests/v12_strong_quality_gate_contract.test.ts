import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { INTEGRATED_PRODUCTION_RISK_POLICY } from "../config/integratedProductionRiskPolicy";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { evaluateV12EntryQuality } from "../lib/v12-x1-all";

test("V12 strong regime uses the validated bounded quality gate", () => {
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMinimum, 0.15);
  assert.equal(V12_X1_ALL.strongRegimeQualityScoreMaximum, 0.70);
  assert.equal(V12_X1_ALL.strongRegimeQualityMinimumAtrRatio, 0.014);

  assert.equal(evaluateV12EntryQuality({ regime: "LONG", strongRegime: true, side: "LONG", momentum: 0.08, atrRatio: 0.014, score: 0.15 }), true);
  assert.equal(evaluateV12EntryQuality({ regime: "LONG", strongRegime: true, side: "LONG", momentum: 0.08, atrRatio: 0.014, score: 0.70 }), true);
  assert.equal(evaluateV12EntryQuality({ regime: "LONG", strongRegime: true, side: "LONG", momentum: 0.08, atrRatio: 0.0139, score: 0.50 }), false);
  assert.equal(evaluateV12EntryQuality({ regime: "LONG", strongRegime: true, side: "LONG", momentum: 0.08, atrRatio: 0.02, score: 0.71 }), false);
  assert.equal(evaluateV12EntryQuality({ regime: "LONG", strongRegime: true, side: "LONG", momentum: 0.03, atrRatio: 0.005, score: 1.4649 }), true);

  assert.equal(evaluateV12EntryQuality({ regime: "SHORT", strongRegime: true, side: "SHORT", momentum: -0.08, atrRatio: 0.014, score: 0.50 }), true);
  assert.equal(evaluateV12EntryQuality({ regime: "SHORT", strongRegime: true, side: "LONG", momentum: 0.08, atrRatio: 0.02, score: 0.50 }), false);
});

test("integrated production risk keeps the DD20 repair at Q102 HIGH_VOL 1.661x", () => {
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross.HIGH_VOL, 1.661);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross.BRK, 2.465);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.v12DynamicAggregateGrossCap, 2);
});

test("committed one-year research artifact matches the production candidate", async () => {
  const artifact = JSON.parse(await readFile("docs/research-results/v12-strong-quality-gate-integrated-20260919.json", "utf8"));
  assert.equal(artifact.status, "PASS_RESEARCH_ONLY");
  assert.equal(artifact.period.calendarDays, 365);
  assert.equal(artifact.capital.totalContributedJpy, 130000);
  assert.equal(artifact.changeUnderTest.v12StrongRegime.strongScoreMinimum, V12_X1_ALL.strongRegimeQualityScoreMinimum);
  assert.equal(artifact.changeUnderTest.v12StrongRegime.strongScoreMaximum, V12_X1_ALL.strongRegimeQualityScoreMaximum);
  assert.equal(artifact.changeUnderTest.v12StrongRegime.strongMinimumAtrRatio, V12_X1_ALL.strongRegimeQualityMinimumAtrRatio);
  assert.equal(artifact.frozenProductionContract.q102FamilyGross.HIGH_VOL, INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross.HIGH_VOL);
  assert.ok(artifact.integratedComparison.CANDIDATE.NORMAL.endingAssetJpy > artifact.integratedComparison.CURRENT.NORMAL.endingAssetJpy);
  assert.ok(artifact.integratedComparison.CANDIDATE.SEVERE.endingAssetJpy > artifact.integratedComparison.CURRENT.SEVERE.endingAssetJpy);
  assert.ok(artifact.integratedComparison.CANDIDATE.SEVERE.maxDrawdownPct > -20);
  assert.equal(artifact.integratedComparison.CANDIDATE.NORMAL.grossConflicts, 0);
  assert.equal(artifact.integratedComparison.CANDIDATE.SEVERE.grossConflicts, 0);
});
