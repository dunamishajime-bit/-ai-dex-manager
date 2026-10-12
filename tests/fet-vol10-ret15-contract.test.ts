import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";

test("FET runtime contract exposes the VOL10_RET15 upper bounds", () => {
  assert.equal(FET_BRK48_RESIDUAL.maximumVolumeRatio, 10);
  assert.equal(FET_BRK48_RESIDUAL.maximumReturn72h, 0.15);
});

test("Production target and health telemetry expose the same VOL10_RET15 bounds", () => {
  const target = JSON.parse(readFileSync("docs/production/current-live-target.json", "utf8")) as {
    strategy: { fet: { maximumVolumeRatio?: number; maximumReturn72h?: number } };
  };
  const healthSnapshot = readFileSync("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8");

  assert.equal(target.strategy.fet.maximumVolumeRatio, 10);
  assert.equal(target.strategy.fet.maximumReturn72h, 0.15);
  assert.match(healthSnapshot, /maximumVolumeRatio:10/);
  assert.match(healthSnapshot, /maximumReturn72h:0\.15/);
});
