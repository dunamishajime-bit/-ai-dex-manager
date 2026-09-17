import assert from "node:assert/strict";
import test from "node:test";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "../lib/disterminal-live-config";

const releaseSha = "535c15d47c3e2e33ae1828987d219fcae4f2489b";

test("DISTerminal mirrors the current integrated LIVE contract", () => {
  assert.equal(config.approvedReleaseSha, releaseSha);
  assert.deepEqual(config.productionReleaseShas, {
    v12: releaseSha,
    pengu: releaseSha,
    v52: releaseSha,
    quality102: releaseSha,
  });
  assert.equal(config.sharedCryptoDailyLossPct, 7.5);
  assert.equal(config.penguGross, 0.85);
  assert.equal(config.quality102Runtime.expectedReleaseSha, releaseSha);
  assert.equal(config.quality102Runtime.strategyGrossCap, 1.5);
  assert.equal(config.quality102Runtime.cryptoGrossCap, 3);
  assert.equal(config.quality102Runtime.totalGrossCap, 3.5);
  assert.equal(config.quality102Runtime.brkLiveEnabled, true);
  assert.equal(config.sharedCryptoGross, 3);
  assert.equal(config.maximumGross, 3.5);
  assert.equal(config.v52ProductionReleaseSha, releaseSha);
  assert.equal(config.v52Top2Policy.policyId, "V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20");
});
