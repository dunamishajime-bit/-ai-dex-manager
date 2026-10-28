import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readiness = readFileSync("scripts/ops/root/disdex-v96-v52-release-readiness", "utf8");

test("release readiness reports the current 4.25x portfolio contract separately from legacy 2.5x compatibility", () => {
  assert.match(readiness, /portfolioGrossCap: 4\.25/);
  assert.match(readiness, /combinedPortfolioGross=4\.25/);
  assert.match(readiness, /legacyV96CompatibilityGross=2\.5/);
  assert.doesNotMatch(readiness, /combinedPortfolioGross=2\.5/);
});
