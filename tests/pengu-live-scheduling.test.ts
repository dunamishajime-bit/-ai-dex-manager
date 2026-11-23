import assert from "node:assert/strict";
import { test } from "node:test";

import { PENGU_HOUR_MS, nextPenguDaemonWaitMs } from "../lib/pengu-live-scheduling";

test("PENGU retries a transient account-lock collision instead of waiting for the next hour", () => {
  const waitMs = nextPenguDaemonWaitMs("locked", 12_345, 5_000, 5_000);
  assert.equal(waitMs, 5_000);
  assert.ok(waitMs < PENGU_HOUR_MS);
});

test("PENGU keeps the hour-boundary schedule after a completed tick", () => {
  const now = 12_345;
  assert.equal(nextPenguDaemonWaitMs("no-change", now, 5_000, 5_000), PENGU_HOUR_MS - now + 5_000);
});


test("PENGU retries a transient global rate-budget saturation within the bounded retry interval", () => {
  const now = 12_345;
  const waitMs = nextPenguDaemonWaitMs(
    "failed",
    now,
    5_000,
    5_000,
    "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5015",
  );
  assert.equal(waitMs, 5_000);
  assert.ok(waitMs < PENGU_HOUR_MS);
});

test("PENGU does not short-retry an unknown failed tick", () => {
  const now = 12_345;
  assert.equal(
    nextPenguDaemonWaitMs("failed", now, 5_000, 5_000, "MANUAL_REVIEW_REQUIRED"),
    PENGU_HOUR_MS - now + 5_000,
  );
});
