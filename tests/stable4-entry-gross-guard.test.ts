import assert from "node:assert/strict";
import test from "node:test";
import { assertStable4EntryGrossAdmission, Stable4EntryGrossAdmissionError, type Stable4EntryGrossInput } from "../lib/stable4-entry-gross-guard";
import { emptyPendingExposureRegistry, type PendingExposureEntry } from "../lib/disdex-pending-exposure-registry";

const NOW = 1_800_000_000_000;
function input(): Stable4EntryGrossInput {
  return { now: NOW, account: { equityUsd: 100, observedAt: NOW }, positions: [], pending: emptyPendingExposureRegistry(NOW), candidate: { symbol: "BTCUSDT", notionalUsd: 300 } };
}
function pending(overrides: Partial<PendingExposureEntry> = {}): PendingExposureEntry {
  return { reservationId: "own", strategyId: "V12", sleeve: "CRYPTO", symbol: "BTCUSDT", side: "LONG", gross: 99, notionalUsd: 100, status: "PENDING", createdAt: NOW, updatedAt: NOW, ...overrides };
}
function rejects(value: Stable4EntryGrossInput, code: string) {
  assert.throws(() => assertStable4EntryGrossAdmission(value), (error: unknown) => error instanceof Stable4EntryGrossAdmissionError && error.code === code);
}

test("crypto exact cap admits and an additional cent rejects", () => {
  assert.equal(assertStable4EntryGrossAdmission(input()).after.cryptoGross, 3);
  const value = input(); value.candidate.notionalUsd = 300.01;
  rejects(value, "CRYPTO_CAP_EXCEEDED");
});
test("stock and combined caps independently admit exact boundaries", () => {
  const value = input(); value.candidate = { symbol: "NVDAUSDT", notionalUsd: 400 };
  assert.equal(assertStable4EntryGrossAdmission(value).after.stockGross,4);
  value.candidate.notionalUsd=400.01;rejects(value,"STOCK_CAP_EXCEEDED");
  value.candidate.notionalUsd=225;value.positions=[{symbol:"BTCUSDT",quantity:-2,markPrice:100,observedAt:NOW}];
  assert.equal(assertStable4EntryGrossAdmission(value).after.totalGross,4.25);
  value.candidate.notionalUsd=225.01;rejects(value,"TOTAL_CAP_EXCEEDED");
});
test("pending dollars rebase on current equity instead of stored gross", () => {
  const value = input(); value.candidate.notionalUsd = 200; value.pending.entries = [pending()];
  assert.equal(assertStable4EntryGrossAdmission(value).before.cryptoGross, 1);
});
test("only exact own reservation is replaced and foreign same-symbol orders count", () => {
  const value = input(); value.candidate = { symbol: "BTCUSDT", side: "LONG", notionalUsd: 200, ownReservationId: "own" };
  value.pending.entries = [pending(), pending({ reservationId: "foreign" })];
  assert.equal(assertStable4EntryGrossAdmission(value).after.cryptoGross, 3);
  value.pending.entries[1].notionalUsd = 101; rejects(value, "CRYPTO_CAP_EXCEEDED");
});
test("conflicting, missing, released, or side-less own reservation fails closed", () => {
  for (const overrides of [{ symbol: "ETHUSDT" }, { side: "SHORT" as const }, { status: "RELEASED" as const }]) {
    const value = input(); value.candidate.side = "LONG"; value.candidate.ownReservationId = "own"; value.pending.entries = [pending(overrides)];
    rejects(value, "OWN_RESERVATION_CONFLICT");
  }
  const value = input(); value.candidate.ownReservationId = "own";
  rejects(value, "OWN_RESERVATION_CONFLICT");
  value.pending.entries = [pending()]; rejects(value, "OWN_RESERVATION_CONFLICT");
});
test("all active pending statuses count while released does not", () => {
  const value = input(); value.candidate.notionalUsd = 1;
  value.pending.entries = [pending(), pending({ reservationId: "s", status: "SUBMITTED" }), pending({ reservationId: "u", status: "UNKNOWN" }), pending({ reservationId: "r", status: "RELEASED" })];
  rejects(value, "CRYPTO_CAP_EXCEEDED");
});
test("freshness boundary accepts and older or future signed observations reject", () => {
  for (const offset of [-120_001, 1]) {
    const value = input(); value.account.observedAt = NOW + offset; rejects(value, "STALE_ACCOUNT");
    value.account.observedAt = NOW; value.positions = [{ symbol: "BTCUSDT", quantity: 0, markPrice: 1, observedAt: NOW + offset }]; rejects(value, "STALE_POSITION");
    value.positions = []; value.pending.updatedAt = NOW + offset; rejects(value, "STALE_REGISTRY");
    value.pending.updatedAt = NOW; value.pending.entries = [pending({ createdAt: NOW - 130_000, updatedAt: NOW + offset })]; rejects(value, "STALE_PENDING");
  }
  const value = input(); value.account.observedAt = NOW - 120_000;
  assert.equal(assertStable4EntryGrossAdmission(value).after.totalGross, 3);
});
test("malformed registry, duplicate IDs, sleeve conflicts and unknown symbols reject", () => {
  const value = input(); value.pending.entries = [pending(), pending()]; rejects(value, "INVALID_REGISTRY");
  value.pending.entries = [pending({ sleeve: "STOCK" })]; rejects(value, "INVALID_REGISTRY");
  value.pending.entries = [pending({ symbol: "NEVERKNOWNUSDT" })]; rejects(value, "UNKNOWN_SYMBOL");
  value.pending.entries = []; value.candidate.symbol = "NEVERKNOWNUSDT"; rejects(value, "UNKNOWN_SYMBOL");
  value.candidate.symbol = "BTCUSDT"; value.positions = [{ symbol: "NEVERKNOWNUSDT", quantity: 0, markPrice: 1, observedAt: NOW }]; rejects(value, "UNKNOWN_SYMBOL");
});
test("strict numeric validation rejects strings, NaN, negatives and arithmetic overflow", () => {
  for (const invalid of ["100", NaN, Infinity, -1, null]) {
    const value = input(); value.account.equityUsd = invalid as number; rejects(value, "INVALID_ACCOUNT");
    value.account.equityUsd = 100; value.candidate.notionalUsd = invalid as number; rejects(value, "INVALID_CANDIDATE");
    value.candidate.notionalUsd = 1; value.pending.entries = [pending({ notionalUsd: invalid as number })]; rejects(value, "INVALID_REGISTRY");
  }
  const value = input(); value.positions = [{ symbol: "BTCUSDT", quantity: 1e308, markPrice: 1e308, observedAt: NOW }]; rejects(value, "INVALID_POSITION");
  value.positions = []; value.account.equityUsd = 0; rejects(value, "INVALID_ACCOUNT");
});
test("admission is pure and returns separate position and pending diagnostics", () => {
  const value = input(); value.candidate.notionalUsd = 100;
  value.positions = [{ symbol: "BTCUSDT", quantity: -1, markPrice: 100, observedAt: NOW }]; value.pending.entries = [pending({ notionalUsd: 50 })];
  const snapshot = JSON.stringify(value); const result = assertStable4EntryGrossAdmission(value);
  assert.equal(result.positions.cryptoNotionalUsd, 100); assert.equal(result.pending.cryptoNotionalUsd, 50); assert.equal(result.after.totalGross, 2.5);
  assert.equal(JSON.stringify(value), snapshot);
});
test("approved Quality102 high-vol and S34 symbols count as crypto without broad unknown fallback", () => {
  for (const symbol of ["UNIUSDT", "SUIUSDT", "SEIUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "ENAUSDT", "ONDOUSDT", "FILUSDT", "TRXUSDT"]) {
    const value = input(); value.candidate = { symbol, notionalUsd: 200 };
    value.positions = [{ symbol, quantity: 1, markPrice: 100, observedAt: NOW }];
    assert.equal(assertStable4EntryGrossAdmission(value).after.cryptoGross, 3);
    value.candidate.notionalUsd = 201; rejects(value, "CRYPTO_CAP_EXCEEDED");
  }
  const value = input(); value.candidate.symbol = "NOTAPPROVEDUSDT"; rejects(value, "UNKNOWN_SYMBOL");
});
