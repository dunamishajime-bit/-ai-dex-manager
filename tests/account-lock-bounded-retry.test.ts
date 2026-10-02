import assert from "node:assert/strict";
import test from "node:test";
import { runWithBoundedAccountLockRetry } from "../lib/disdex-account-lock-bounded-retry";

test("transient contention retries before return", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await runWithBoundedAccountLockRetry({
        operation: async () => ({ status: ++calls < 4 ? "locked" : "no-change" }),
        attempts: 8,
        retryMs: 1_000,
        wait: async (ms) => { waits.push(ms); },
    });
    assert.equal(result.status, "no-change");
    assert.equal(calls, 4);
    assert.deepEqual(waits, [1_000, 1_000, 1_000]);
});

test("persistent contention remains bounded", async () => {
    let calls = 0;
    const result = await runWithBoundedAccountLockRetry({
        operation: async () => { calls += 1; return { status: "locked" }; },
        attempts: 3,
        retryMs: 500,
        wait: async () => undefined,
    });
    assert.equal(result.status, "locked");
    assert.equal(calls, 3);
});
