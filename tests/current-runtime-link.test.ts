import assert from "node:assert/strict";
import test from "node:test";

import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "../lib/disterminal-live-config";

const CURRENT_VPS_RELEASE = "ff01259a6f27307af6ee47befc55ea9b00de0f6c";

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
  assert.equal(liveConfig.penguGross, 0.85);
  assert.equal(liveConfig.quality102Runtime.strategyGrossCap, 1.5);
  assert.equal(liveConfig.sharedCryptoGross, 3);
  assert.equal(liveConfig.maximumGross, 3.5);
});
