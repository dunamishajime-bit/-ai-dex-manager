import assert from "node:assert/strict";
import test from "node:test";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "../lib/disterminal-live-config";

const releaseSha = "4230604a4cff33e5fb93725e36544e180eb0da45";

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
  assert.equal(config.quality102Runtime.strategyGrossCap, 2.5);
  assert.deepEqual(config.quality102Runtime.familyGross, {
    HIGH_VOL: 1.661,
    MR: 1,
    BRK: 2.465,
    REV: 2.5,
    PB: 2.5,
  });
  assert.equal(config.quality102Runtime.cryptoGrossCap, 3);
  assert.equal(config.quality102Runtime.totalGrossCap, 3.5);
  assert.equal(config.quality102Runtime.brkLiveEnabled, true);
  assert.equal(config.v12BaseGross, 1.5);
  assert.equal(config.v12Gross, 2);
  assert.equal(config.sharedCryptoGross, 3);
  assert.equal(config.v52StockGross, 1.98);
  assert.equal(config.v52V50Gross, 1.64);
  assert.equal(config.maximumGross, 3.5);
  assert.equal(config.v52ProductionReleaseSha, releaseSha);
  assert.equal(config.v52Top2Policy.policyId, "V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20");
});
