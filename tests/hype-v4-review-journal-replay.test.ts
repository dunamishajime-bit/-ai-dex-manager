import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProductionEvent,
  createProductionState,
  type Event,
  type Leg,
} from "../lib/v12-v4-production-lifecycle";

const ID = "XRPUSDT:REC_X06_TIME_12H:SHORT:1794038400000";
const REVIEW = "ENTRY_FILL_OVER_RESERVED_NOTIONAL:" + ID;
const EVIDENCE = "a".repeat(64);
const RECORDED_AT = 1794047422983;

function closedReviewState() {
  const state = createProductionState({
    equityUsd: 61.71254857,
    foreign: [],
    holdProtected: false,
  });
  // This is a synthetic *closed* leg. No real orders or venue operations.
  // Fields not accessed during a review-resolution event can be omitted.
  state.legs[ID] = {
    id: ID,
    status: "CLOSED",
    qty: 0,
    entryNotional: 0,
    reservationUsd: 0,
    exitRemainingQty: 0,
  } as Leg;
  state.executionReview = REVIEW;
  return state;
}

function event(): Event {
  return {
    type: "EXECUTION_REVIEW_RESOLVED",
    eventId: "review-resolved-" + RECORDED_AT,
    ts: RECORDED_AT,
    id: ID,
    expectedReview: REVIEW,
    evidenceSha256: EVIDENCE,
  };
}

test("HYPE pinned V4 journal replay recognizes the exact V4 review-resolution event", () => {
  const before = closedReviewState();
  const after = applyProductionEvent(before, event());
  assert.equal(after.executionReview, undefined);
  assert.equal(before.executionReview, REVIEW, "input state is immutable");
  assert.equal(after.journal.length, 1);
  assert.deepEqual(after.journal[0], event());
  assert.equal(after.legs[ID].status, "CLOSED");
  assert.equal(after.legs[ID].qty, 0);
});

test("resolution event refuses wrong evidence hash or review identity", () => {
  for (const override of [
    { evidenceSha256: "not-signed" },
    { expectedReview: "NOT_THE_ACTIVE_REVIEW" },
    { id: "OTHER_LEG" },
  ]) {
    assert.throws(
      () => applyProductionEvent(closedReviewState(), { ...event(), ...override } as Event),
      /V4_EXECUTION_REVIEW_RESOLUTION_INVALID/,
    );
  }
});

test("resolution event refuses open legs, held safeguards or unrelated foreign exposure", () => {
  const cases = [
    (s: ReturnType<typeof closedReviewState>) => { s.legs[ID].status = "OPEN"; },
    (s: ReturnType<typeof closedReviewState>) => { s.legs[ID].qty = 1; },
    (s: ReturnType<typeof closedReviewState>) => { s.initial.holdProtected = true; },
    (s: ReturnType<typeof closedReviewState>) => {
      s.foreign.push({ owner: "QUALITY102", symbol: "BTCUSDT", side: "LONG", qty: 1, gross: 1, crypto: true, pendingGross: 0 });
    },
    (s: ReturnType<typeof closedReviewState>) => { s.executionReview = "DIFFERENT"; },
  ];
  for (const modify of cases) {
    const state = closedReviewState();
    modify(state);
    assert.throws(() => applyProductionEvent(state, event()), /V4_EXECUTION_REVIEW_RESOLUTION_INVALID/);
  }
});

test("unknown future event types still fail closed instead of being ignored", () => {
  assert.throws(
    () => applyProductionEvent(closedReviewState(), {
      type: "UNRECOGNIZED_FUTURE_EVENT",
      eventId: "future-provenance-event",
      ts: RECORDED_AT,
      id: ID,
    } as unknown as Event),
    /UNKNOWN_JOURNAL_EVENT/,
  );
});
