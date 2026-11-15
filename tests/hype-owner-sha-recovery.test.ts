import assert from "node:assert/strict";
import test from "node:test";
import {
  requiredRecoveryState,
  assertKnownVenueSnapshot,
  assertRecoveredV4Ledger,
} from "../scripts/disdex-hype-owner-sha-recovery";

const SHA = "d6bcc94512a6416189cd92d7203b9ac3b2c98e70";
const REVIEW = "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT";
const stopId = "v12-v4-231ed20b6835c4148b5314d8da7e";

function state() {
  return {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: SHA,
    mode: "LIVE",
    updatedAt: Date.now() - 4 * 60 * 60_000,
    positions: null,
    pending: null,
    manualReview: REVIEW,
    failures: [],
  };
}
function venue() {
  return {
    serverTime: Date.now(),
    positions: [{ symbol: "XRPUSDT", quantity: -13.3 }],
    orders: [{
      symbol: "XRPUSDT", clientOrderId: stopId, side: "BUY",
      type: "STOP_MARKET", quantity: 13.3, status: "NEW",
      reduceOnly: true,
    }],
  };
}

test("only the exact legacy HYPE unknown journal review is eligible", () => {
  assert.equal(requiredRecoveryState(state()).manualReview, REVIEW);
  for (const modified of [
    { manualReview: null },
    { manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:ORDER_UNKNOWN" },
    { runtimeCommitSha: "b".repeat(40) },
    { mode: "SHADOW" },
    { pending: { action: "ENTRY" } },
    { positions: [{ symbol: "HYPEUSDT", quantity: 1 }] },
    { failures: "not-a-list" },
    { updatedAt: Date.now() + 100_000 },
  ]) assert.throws(() => requiredRecoveryState({ ...state(), ...modified }), /HYPE_/);
});

test("signed venue proof must preserve exact XRP position and reduce-only STOP", () => {
  const v = venue();
  const hash = assertKnownVenueSnapshot(v);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(assertKnownVenueSnapshot(v), hash);
});

test("HYPE/ZEC must remain flat and untracked positions are rejected", () => {
  for (const extra of [
    { symbol: "HYPEUSDT", quantity: 0.1 },
    { symbol: "ZECUSDT", quantity: -0.1 },
    { symbol: "SOLUSDT", quantity: 0.1 },
  ]) assert.throws(() =>
    assertKnownVenueSnapshot({ ...venue(), positions: [...venue().positions, extra] }),
    /HYPE_VENUE_UNEXPECTED_POSITIONS/);
});

test("XRP STOP mismatch is never tolerated", () => {
  for (const change of [
    { quantity: 10 },
    { status: "CANCELED" },
    { reduceOnly: false },
    { side: "SELL" },
    { type: "LIMIT" },
    { clientOrderId: "unknown-stop" },
  ]) assert.throws(() =>
    assertKnownVenueSnapshot({ ...venue(), orders: [{ ...venue().orders[0], ...change }] }),
    /HYPE_VENUE_XRP_STOP_CHANGED/);
});

test("missing or stale venue time cannot authorize migration", () => {
  assert.throws(() => assertKnownVenueSnapshot({ ...venue(), serverTime: Date.now() - 600_000 }), /HYPE_VENUE_TIME_INVALID/);
});

test("malformed V4 replay and missing resolution never resolve HYPE review", () => {
  assert.throws(() => assertRecoveredV4Ledger(null), /HYPE_V4_JOURNAL_MALFORMED/);
  assert.throws(() => assertRecoveredV4Ledger({ state: { journal: [] } }), /HYPE_V4_JOURNAL_INCOMPLETE/);
  assert.throws(() => assertRecoveredV4Ledger({ state: { journal: Array(10_001).fill({ type: "FUNDING" }) } }), /HYPE_V4_RESOLUTION_COUNT_INVALID/);
});
