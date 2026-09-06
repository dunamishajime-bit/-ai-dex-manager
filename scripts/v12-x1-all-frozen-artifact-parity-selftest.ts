import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { PENGU_DUAL_LS_V2 } from "@/config/penguDualLsV2Runtime";
import { QUALITY102_CAUSAL_V1 } from "@/config/disdexQuality102CausalV1Runtime";
import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";

interface Evidence {
  status: string;
  logic: {
    v12: Record<string, number>;
    pengu: Record<string, number>;
    quality102CausalV1: Record<string, number>;
    portfolio: Record<string, number>;
  };
  results: Record<"NORMAL" | "SEVERE", Record<string, number>>;
  safety: Record<string, boolean | string>;
}

async function main() {
  const artifact = JSON.parse(await readFile(
    "docs/research-results/v12-btc2-q54-atr14-pengu-hard24-q102x1.json",
    "utf8",
  )) as Evidence;
  assert.equal(artifact.status, "PASS_RESEARCH_ONLY");
  assert.equal(artifact.logic.v12.btcRegimeThresholdPct, V12_X1_ALL.regimeThresholdPct);
  assert.equal(artifact.logic.v12.strongRegimeThresholdPct, V12_X1_ALL.strongRegimeThresholdPct);
  assert.equal(artifact.logic.v12.relaxedRegimeMinimumMomentumPct, V12_X1_ALL.relaxedRegimeMinimumMomentumPct);
  assert.equal(artifact.logic.v12.relaxedRegimeMinimumAtrRatio, V12_X1_ALL.relaxedRegimeMinimumAtrRatio);
  assert.equal(artifact.logic.v12.scoreThreshold, V12_X1_ALL.neutralScoreThreshold);
  assert.equal(artifact.logic.pengu.normalCooldownHours, PENGU_DUAL_LS_V2.cooldownHours);
  assert.equal(artifact.logic.pengu.hardStopCooldownHours, PENGU_DUAL_LS_V2.hardStopCooldownHours);
  assert.equal(artifact.logic.quality102CausalV1.maximumGross, QUALITY102_CAUSAL_V1.maximumGross);
  assert.equal(artifact.logic.quality102CausalV1.maximumPositions, QUALITY102_CAUSAL_V1.maximumPositions);
  assert.equal(artifact.logic.portfolio.cryptoGrossCap, STRICT_BT33404708902.cryptoGrossCap);
  assert.equal(artifact.logic.portfolio.totalGrossCap, STRICT_BT33404708902.totalGrossCap);

  assert.ok(Math.abs(artifact.results.NORMAL.endingAssetJpy - 18442769.03585051) < 1e-6);
  assert.ok(Math.abs(artifact.results.NORMAL.PF - 3.57064393) < 1e-8);
  assert.ok(Math.abs(artifact.results.NORMAL.DDPct - (-14.33740242)) < 1e-8);
  assert.equal(artifact.results.NORMAL.grossConflicts, 0);
  assert.ok(Math.abs(artifact.results.SEVERE.endingAssetJpy - 2827282.1410372) < 1e-6);
  assert.ok(Math.abs(artifact.results.SEVERE.PF - 2.41551514) < 1e-8);
  assert.ok(Math.abs(artifact.results.SEVERE.DDPct - (-17.68170098)) < 1e-8);
  assert.equal(artifact.results.SEVERE.grossConflicts, 0);
  assert.equal(artifact.safety.ordersSent, false);
  assert.equal(artifact.safety.liveChanged, false);
  assert.equal(artifact.safety.vpsChanged, false);
  assert.equal(artifact.safety.productionChanged, false);
  console.log("V12_BTC2_Q54_ATR14_PENGU_HARD24_Q102X1_PARITY_SELFTEST_PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
