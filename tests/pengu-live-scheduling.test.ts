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
