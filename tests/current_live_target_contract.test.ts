import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { INTEGRATED_PRODUCTION_RISK_POLICY, Q102_CAUSAL_V4_FAMILY_GROSS } from "../config/integratedProductionRiskPolicy";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";

const targetPath = "docs/production/current-live-target.json";
const artifactPath = "docs/research/results/trail020-idle-doge-avax-controlling-20261002/controlling-contract.json";

test("current live target preserves base rules while applying DD1296 sizing", async () => {
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  assert.equal(target.status, "CURRENT_CANONICAL_PRODUCTION_TARGET");
  assert.equal(target.productionBaseSha, "b9a0c86d6cf72b0209e44edc8883e45e6d241c5b");

  assert.equal(target.strategy.v12.maximumPositions, 3);
  assert.equal(target.strategy.v12.baseMaximumPositions, 2);
  assert.equal(target.strategy.v12.rank3GrossCap, 0.10);
  assert.equal(target.strategy.v12.rank3MinimumScore, 0.70);
  assert.equal(target.strategy.v12.additionalRank3BtcDistanceGate, false);
  assert.equal(target.strategy.v12.trailingAtr, 0.20);
  assert.equal(target.strategy.v12.stopAtr, 2.477);
  assert.equal(target.strategy.v12.takeProfitAtr, 3.1995);
  assert.equal(target.strategy.fet.maximumGross, 1);
  assert.equal(target.strategy.q102.portfolioDdGovernorEntryThresholdPct, 0.30);
  assert.equal(target.strategy.q102.boostMaximumGross, 3.0);
  assert.equal(target.strategy.portfolio.cryptoGrossCap, 3.0);
  assert.equal(target.strategy.portfolio.totalGrossCap, 4.25);

  assert.equal(target.strategy.idlePriorityShort.historicalFormal10bpsTrades, 61);
  assert.deepEqual(target.strategy.idleResidualLong.subordinateTo, ["FORMAL_EXISTING","IDLE_PRIORITY_SHORT"]);
  assert.deepEqual(target.strategy.idleResidualLong.priority, ["DOGE_REL_VOL","AVAX_REL_LONG"]);
  assert.equal(target.strategy.idleResidualLong.routes.DOGEUSDT.volumeRatioMin, 1.2);
  assert.equal(target.strategy.idleResidualLong.routes.AVAXUSDT.volumeRatioMin, 0.8);

  assert.equal(V12_X1_ALL.maximumPositions, target.strategy.v12.maximumPositions);
  assert.equal(V12_X1_ALL.rank3EntryGrossCap, target.strategy.v12.rank3GrossCap);
  assert.equal(V12_X1_ALL.rank3MinimumScore, target.strategy.v12.rank3MinimumScore);
  assert.equal(V12_X1_ALL.trailingAtr, target.strategy.v12.trailingAtr);
  assert.equal(FET_BRK48_RESIDUAL.maximumGross, target.strategy.fet.maximumGross);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross, target.strategy.q102.boostMaximumGross);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap, target.strategy.portfolio.cryptoGrossCap);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap, target.strategy.portfolio.totalGrossCap);
  assert.deepEqual(Q102_CAUSAL_V4_FAMILY_GROSS, target.strategy.q102.baseFamilyGross);
});

test("historical controlling ledger and cost stress remain unchanged", async () => {
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  const bytes = await readFile(artifactPath);
  const canonicalText = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const canonicalBytes = Buffer.from(canonicalText, "utf8");
  const sha = createHash("sha256").update(canonicalBytes).digest("hex").toUpperCase();
  assert.equal(sha, target.historicalFormalBacktest.sourceArtifactSha256);
  assert.equal(target.historicalFormalBacktest.selectedCase, "trail020_idle_doge_avax_20261002");

  const contract = JSON.parse(canonicalText);
  assert.deepEqual(target.historicalFormalBacktest.priority, contract.priority);
  for (const [label,bps] of [["NORMAL",10],["COST_8BPS",8],["COST_20BPS",20],["COST_30BPS",30]] as const) {
    const expected = target.historicalFormalBacktest[label];
    const actual = contract.costs[String(bps)];
    assert.equal(expected.roundtripBps, bps);
    assert.equal(expected.endingAssetJpy, actual.finalJpy);
    assert.equal(expected.profitFactor, actual.pf);
    assert.equal(expected.maxDrawdownPct, actual.dd * 100);
    assert.equal(expected.winRatePct, actual.wr * 100);
    assert.equal(expected.trades, actual.trades);
    assert.deepEqual(expected.routing, actual.strategyCounts);
  }

  assert.ok(target.historicalFormalBacktest.NORMAL.maxDrawdownPct >= target.acceptance.maximumDrawdownFloorPct);
  assert.ok(target.historicalFormalBacktest.COST_30BPS.maxDrawdownPct >= target.acceptance.maximumDrawdownFloorPct);
  assert.equal(target.acceptance.requireIdlePriorityShortParity, true);
  assert.equal(target.acceptance.requireTrail020, true);
  assert.equal(target.acceptance.requireResidualExactShaParity, true);
  assert.equal(target.acceptance.requireFormalResidualPreemption, true);
});
