import test from "node:test";
import assert from "node:assert/strict";
import { idleMarginGuardMaxAgeMs } from "../lib/idle-margin-age-policy";

const flat = {
  configuredMaxAgeMs: 90_000,
  accountEquity: 1_000,
  positions: [],
  pendingCryptoGross: 0,
  pendingStockGross: 0,
} as const;

test("healthy margin guard cadence is tolerated only with independently flat account", () => {
  assert.equal(idleMarginGuardMaxAgeMs(flat), 330_000);
});

test("any open position restores strict 90-second age gate", () => {
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, positions: [{ quantity: 0.01 }] }), 90_000);
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, positions: [{ quantity: -2 }] }), 90_000);
});

test("pending reservations restore strict 90-second age gate", () => {
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, pendingCryptoGross: 0.1 }), 90_000);
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, pendingStockGross: 0.1 }), 90_000);
});

test("unknown account/risk inputs fail closed to strict age or zero", () => {
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, accountEquity: Number.NaN }), 90_000);
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, positions: [{ quantity: Number.NaN }] }), 90_000);
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, pendingCryptoGross: Number.NaN }), 90_000);
  assert.equal(idleMarginGuardMaxAgeMs({ ...flat, configuredMaxAgeMs: -1 }), 0);
});
