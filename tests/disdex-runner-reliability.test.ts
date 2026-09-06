import assert from "node:assert/strict";
import test from "node:test";

import { boundedLockRetryDelay } from "../lib/disdex-bounded-lock-retry";

test("a locked cycle retries only inside its bounded retry window", () => {
    const policy = { retryMs: 5_000, maxRetryWindowMs: 60_000 };
    assert.equal(boundedLockRetryDelay({ nowMs: 10_000, lockedSinceMs: 10_000, ...policy }), 5_000);
    assert.equal(boundedLockRetryDelay({ nowMs: 64_000, lockedSinceMs: 10_000, ...policy }), 5_000);
    assert.equal(boundedLockRetryDelay({ nowMs: 70_000, lockedSinceMs: 10_000, ...policy }), null);
});

test("a clock that moves backwards never extends the retry window", () => {
    assert.equal(
        boundedLockRetryDelay({ nowMs: 9_000, lockedSinceMs: 10_000, retryMs: 5_000, maxRetryWindowMs: 60_000 }),
        5_000,
    );
});

test("invalid retry policy fails closed", () => {
    assert.throws(
        () => boundedLockRetryDelay({ nowMs: 1, lockedSinceMs: 1, retryMs: 0, maxRetryWindowMs: 60_000 }),
        /LOCK_RETRY_POLICY_INVALID/,
    );
});
