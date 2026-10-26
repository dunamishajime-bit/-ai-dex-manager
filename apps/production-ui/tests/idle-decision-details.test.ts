import assert from "node:assert/strict";
import test from "node:test";
import { assessIdleDecisionDetails } from "../lib/server/idle-decision-details";

const sha = "a".repeat(40);
const now = 1_000_000;

test("decision details are fresh only when SHA and timestamp match", () => {
  assert.deepEqual(assessIdleDecisionDetails({ runtimeSha: sha, updatedAt: now - 1_000 }, sha, now), {
    fresh: true,
    status: "FRESH",
    updatedAt: now - 1_000,
  });
  assert.equal(assessIdleDecisionDetails({ runtimeSha: "b".repeat(40), updatedAt: now - 1_000 }, sha, now).status, "STALE_OR_SHA_MISMATCH");
  assert.equal(assessIdleDecisionDetails({ runtimeSha: sha, updatedAt: now - 16 * 60_000 }, sha, now).status, "STALE_OR_SHA_MISMATCH");
});

test("missing decision details are unavailable instead of a healthy heartbeat", () => {
  assert.deepEqual(assessIdleDecisionDetails(null, sha, now), {
    fresh: false,
    status: "UNAVAILABLE",
    updatedAt: null,
  });
});
