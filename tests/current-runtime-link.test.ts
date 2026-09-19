import assert from "node:assert/strict";
import test from "node:test";

import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "../lib/disterminal-live-config";

const CURRENT_VPS_RELEASE = "6ad0dd458676ae832b514ac58b19d3df46025d08";

test("HP runtime config points at the current VPS release and current logic names", () => {
  assert.equal(liveConfig.productionReleaseShas.v12, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.productionReleaseShas.pengu, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.productionReleaseShas.quality102, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.vpsObservedReleases.v12, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.vpsObservedReleases.pengu, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.vpsObservedReleases.quality102, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.vpsObservedReleases.v52, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.quality102Runtime.expectedReleaseSha, CURRENT_VPS_RELEASE);
  assert.equal(liveConfig.quality102Runtime.selectorMode, "CAUSAL_V4");
});

test("current runtime config keeps the production gross safety contract", () => {
  assert.equal(liveConfig.v12BaseGross, 1.5);
  assert.equal(liveConfig.v12Gross, 2);
  assert.equal(liveConfig.penguGross, 0.85);
  assert.equal(liveConfig.quality102Runtime.strategyGrossCap, 2.5);
  assert.equal(liveConfig.quality102Runtime.familyGross.HIGH_VOL, 1.665);
  assert.equal(liveConfig.quality102Runtime.familyGross.BRK, 2.465);
  assert.equal(liveConfig.v52StockGross, 1.98);
  assert.equal(liveConfig.v52V50Gross, 1.64);
  assert.equal(liveConfig.sharedCryptoGross, 3);
  assert.equal(liveConfig.maximumGross, 3.5);
});
