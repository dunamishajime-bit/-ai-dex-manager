/** Production-only check. Missing current target is a HARD failure, never a candidate fallback.
 * Run: node --import tsx --test tests/fet-vol10-ret15-production-target.check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";

test("Production target and health telemetry expose the same VOL10_RET15 bounds", () => {
  const target = JSON.parse(readFileSync("docs/production/current-live-target.json", "utf8")) as {
    strategy: { fet: { maximumVolumeRatio?: number; maximumReturn72h?: number } };
  };
  const healthSnapshot = readFileSync("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8");

  assert.equal(target.strategy.fet.maximumVolumeRatio, FET_BRK48_RESIDUAL.maximumVolumeRatio);
  assert.equal(target.strategy.fet.maximumVolumeRatio, 10);
  assert.equal(target.strategy.fet.maximumReturn72h, FET_BRK48_RESIDUAL.maximumReturn72h);
  assert.equal(target.strategy.fet.maximumReturn72h, 0.15);
  assert.match(healthSnapshot, /maximumVolumeRatio:10/);
  assert.match(healthSnapshot, /maximumReturn72h:0\.15/);
});
