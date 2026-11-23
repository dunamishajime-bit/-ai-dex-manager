import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isIntentionallyDisabledV52State } from "../lib/disdex-health-disabled-peer.mjs";

const flatDisabled = {
  strategyId: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
  mode: "DISABLED",
  status: "intentional-stop",
  ordersAllowed: false,
  newOrdersAllowed: false,
  orderEnabled: false,
  positions: {},
  pending: null,
  manualReview: null,
  disabledReason: "LIMITED_OVERLAY_SCOPE_V52_PEER_DISABLED",
};

test("classifies only the explicit flat V52 limited-overlay state as disabled", () => {
  assert.equal(isIntentionallyDisabledV52State(flatDisabled), true);
  assert.equal(isIntentionallyDisabledV52State({ ...flatDisabled, positions: { BTCUSDT: { quantity: 1 } } }), false);
  assert.equal(isIntentionallyDisabledV52State({ ...flatDisabled, disabledReason: "operator-stop" }), false);
  assert.equal(isIntentionallyDisabledV52State({ ...flatDisabled, ordersAllowed: true }), false);
});

test("health snapshot consumes the explicit V52 disabled classification", () => {
  const source = readFileSync(new URL("../scripts/ops/root/disdex-runner-health-snapshot-current.mjs", import.meta.url), "utf8");
  assert.match(source, /isIntentionallyDisabledV52State/);
  assert.match(source, /safetyState:\s*"DISABLED"/);
  assert.match(source, /DENIED_DISABLED/);
});
