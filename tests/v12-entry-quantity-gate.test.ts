import assert from "node:assert/strict";
import test from "node:test";

import { isV12BenignEntryQuantityGateError } from "../lib/v12-live-execution-engine";

test("V12 classifies an Aster minQty rejection as a non-order capacity gate", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Quantity 0.000795 is below Aster minQty 0.001 for BTCUSDT."),
    ),
    true,
  );
});

test("V12 classifies an Aster minNotional rejection as a non-order capacity gate", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Notional 4.8721 is below Aster minimum 5 for ETHUSDT."),
    ),
    true,
  );
});

test("V12 accepts scientific notation in venue-minimum errors", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Quantity 7.95e-4 is below Aster minQty 1e-3 for BTCUSDT."),
    ),
    true,
  );
});

test("V12 does not downgrade unknown venue errors into a no-op", () => {
  assert.equal(isV12BenignEntryQuantityGateError(new Error("Aster exchange info unavailable.")), false);
});

test("V12 does not downgrade unrelated quantity errors", () => {
  assert.equal(isV12BenignEntryQuantityGateError(new Error("Quantity mismatch after fill.")), false);
});
