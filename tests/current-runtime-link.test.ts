import assert from "node:assert/strict";
import test from "node:test";

import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "../lib/disterminal-live-config";

const CURRENT_VPS_RELEASE = "b8fd5d721a4e898b77e9910cf3cb772d9867e24d";

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
  assert.equal(liveConfig.v12Gross, 1.5);
  assert.equal(liveConfig.penguGross, 0.75);
  assert.equal(liveConfig.quality102Runtime.strategyGrossCap, 0.5);
  assert.equal(liveConfig.sharedCryptoGross, 2);
  assert.equal(liveConfig.maximumGross, 2.5);
});
