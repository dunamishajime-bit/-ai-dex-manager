import test from "node:test";
import assert from "node:assert/strict";

import {
  PENGU_Q60_DD17_H72,
  normalizePenguTrade,
} from "../scripts/research/reconstructed_integrated_bt/ledger.ts";

test("new PENGU contract normalizes only Q60/DD17/H72 flat-1 trades", () => {
  const normalized = normalizePenguTrade({
    variant: "Q60_DD170_H72",
    mode: "NORMAL",
    route: "RECOVERY_V8",
    side: "L",
    signalTs: Date.parse("2025-08-10T01:00:00Z"),
    entryTs: Date.parse("2025-08-10T02:00:00Z"),
    exitTs: Date.parse("2025-08-10T08:00:00Z"),
    entryPrice: 0.01,
    exitPrice: 0.0105,
    requestedGross: 1,
    accountReturn: 0.049,
    rawUnitReturn: 0.05,
    fundingUnitReturn: -0.0001,
    costUnitReturn: -0.0009,
    exitReason: "RECOVERY_V8_MAX_HOLD",
  }, "FORMAL");

  assert.equal(PENGU_Q60_DD17_H72.variant, "Q60_DD170_H72");
  assert.equal(PENGU_Q60_DD17_H72.maxGross, 1);
  assert.equal(PENGU_Q60_DD17_H72.routeQuarantineHours, 60);
  assert.equal(PENGU_Q60_DD17_H72.realizedDdThreshold, -0.17);
  assert.equal(PENGU_Q60_DD17_H72.ddPauseHours, 72);
  assert.equal(normalized.strategy, "PENGU");
  assert.equal(normalized.window, "FORMAL");
  assert.equal(normalized.gross, 1);
  assert.equal(normalized.accepted, true);
  assert.equal(normalized.entryTs, "2025-08-10T02:00:00.000Z");
});

test("new PENGU contract rejects non-flat or non-selected variants", () => {
  assert.throws(() => normalizePenguTrade({
    variant: "Q60_DD170_H72",
    mode: "NORMAL",
    route: "SHORT_V20",
    side: "S",
    signalTs: 1,
    entryTs: 2,
    exitTs: 3,
    entryPrice: 1,
    exitPrice: 1,
    requestedGross: 0.85,
    accountReturn: 0,
    rawUnitReturn: 0,
    fundingUnitReturn: 0,
    costUnitReturn: 0,
    exitReason: "WINDOW_END",
  }, "FORMAL"), /PENGU_GROSS_NOT_FLAT1/);

  assert.throws(() => normalizePenguTrade({
    variant: "BASELINE_FLAT1",
    mode: "NORMAL",
    route: "SHORT_V20",
    side: "S",
    signalTs: 1,
    entryTs: 2,
    exitTs: 3,
    entryPrice: 1,
    exitPrice: 1,
    requestedGross: 1,
    accountReturn: 0,
    rawUnitReturn: 0,
    fundingUnitReturn: 0,
    costUnitReturn: 0,
    exitReason: "WINDOW_END",
  }, "FORMAL"), /PENGU_VARIANT_MISMATCH/);
});
