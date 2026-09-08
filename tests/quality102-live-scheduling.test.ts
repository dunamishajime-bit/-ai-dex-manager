import assert from "node:assert/strict";
import { test } from "node:test";

import { QUALITY102_HOUR_MS, nextQuality102DaemonWaitMs } from "../lib/quality102-live-scheduling";

test("Q102 retries a transient account-lock collision instead of skipping the hour", () => {
  const waitMs = nextQuality102DaemonWaitMs("locked", 12_345, 5_000, 5_000);
  assert.equal(waitMs, 5_000);
  assert.ok(waitMs < QUALITY102_HOUR_MS);
});

test("Q102 keeps the hour-boundary schedule after a completed tick", () => {
  const now = 12_345;
  assert.equal(nextQuality102DaemonWaitMs("no-change", now, 5_000, 5_000), QUALITY102_HOUR_MS - now + 5_000);
});