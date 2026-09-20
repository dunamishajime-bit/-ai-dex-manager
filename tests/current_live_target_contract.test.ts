import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { INTEGRATED_PRODUCTION_RISK_POLICY, Q102_CAUSAL_V4_FAMILY_GROSS } from "../config/integratedProductionRiskPolicy";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";

const targetPath = "docs/production/current-live-target.json";
const artifactPath = "docs/research-results/top3-fet-q102gov-integrated-20260920.json";

test("current live target is the sole Top3/FET/Q102 governor acceptance anchor", async () => {
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  assert.equal(target.status, "CURRENT_CANONICAL_PRODUCTION_TARGET");
  assert.equal(target.productionBaseSha, "b6b62bbadf1abe25d8ef31f5f133515b52a0df1c");

  assert.equal(target.strategy.v12.maximumPositions, 3);
  assert.equal(target.strategy.v12.baseMaximumPositions, 2);
  assert.equal(target.strategy.v12.rank3GrossCap, 0.10);
  assert.equal(target.strategy.v12.rank3MinimumScore, 0.70);
  assert.equal(target.strategy.v12.additionalRank3BtcDistanceGate, false);
  assert.equal(target.strategy.fet.maximumGross, 1.25);
  assert.equal(target.strategy.q102.portfolioDdGovernorEntryThresholdPct, 0.30);
  assert.equal(target.strategy.q102.boostMaximumGross, 3.0);
  assert.equal(target.strategy.portfolio.cryptoGrossCap, 3.0);
  assert.equal(target.strategy.portfolio.totalGrossCap, 3.5);

  assert.equal(V12_X1_ALL.maximumPositions, target.strategy.v12.maximumPositions);
  assert.equal(V12_X1_ALL.rank3EntryGrossCap, target.strategy.v12.rank3GrossCap);
  assert.equal(V12_X1_ALL.rank3MinimumScore, target.strategy.v12.rank3MinimumScore);
  assert.equal(FET_BRK48_RESIDUAL.maximumGross, target.strategy.fet.maximumGross);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross, target.strategy.q102.boostMaximumGross);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap, target.strategy.portfolio.cryptoGrossCap);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap, target.strategy.portfolio.totalGrossCap);
  assert.deepEqual(Q102_CAUSAL_V4_FAMILY_GROSS, target.strategy.q102.baseFamilyGross);
});

test("selected formal replay is exactly the 740.77M / 65.67M case", async () => {
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  const bytes = await readFile(artifactPath);
  const canonicalText = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const sha = createHash("sha256").update(Buffer.from(canonicalText, "utf8")).digest("hex").toUpperCase();
  assert.equal(sha, target.formalBacktest.sourceArtifactSha256);

  const cases = JSON.parse(canonicalText);
  const selected = cases.find((row: any) => row.case === target.formalBacktest.selectedCase);
  assert.ok(selected, "selected current formal replay case must exist");

  for (const scenario of ["NORMAL", "SEVERE"] as const) {
    const expected = target.formalBacktest[scenario];
    const actual = selected[scenario];
    assert.equal(actual.asset, expected.endingAssetJpy);
    assert.equal(actual.pf, expected.profitFactor);
    assert.equal(actual.dd, expected.maxDrawdownPct);
    assert.equal(actual.trades, expected.trades);
    assert.equal(actual.maxCrypto, expected.maxCryptoGross);
    assert.equal(actual.maxTotal, expected.maxTotalGross);
    assert.equal(actual.maxFet, expected.maxFetGross);
    assert.equal(actual.conflicts, 0);
    assert.ok(actual.dd >= target.acceptance.maximumDrawdownFloorPct);
  }

  assert.equal(target.supersedesForCurrentActivation[0].researchSha, "27f934424b201e4c63986b9b7db64b89ff69b4bb");
  assert.equal(target.supersedesForCurrentActivation[1].implementationSha, "f9b0861816b8a70f6158e98f00893457f83e81bb");
});
