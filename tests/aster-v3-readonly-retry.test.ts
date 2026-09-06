import assert from "node:assert/strict";
import test from "node:test";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";

function response(status: number, body: unknown, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(body), { status, headers });
}

test("read-only GET retries a transient venue response with a bounded policy", async () => {
    let calls = 0;
    const client = new AsterV3Client({
        baseUrl: "https://example.invalid",
        readOnlyRetryAttempts: 2,
        readOnlyRetryBaseDelayMs: 0,
        readOnlyRetryMaxDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            return calls === 1 ? response(429, { msg: "Too many requests" }) : response(200, []);
        },
    });
    assert.deepEqual(await client.getKlines("AAVEUSDT", "1h", 1), []);
    assert.equal(calls, 2);
});

test("order mutations are never retried after an unknown venue response", async () => {
    let calls = 0;
    const client = new AsterV3Client({
        baseUrl: "https://example.invalid",
        userAddress: "0x0000000000000000000000000000000000000001",
        privateKey: `0x${"1".repeat(64)}`,
        readOnlyRetryAttempts: 3,
        readOnlyRetryBaseDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            return response(503, { msg: "temporarily unavailable" });
        },
    });
    await assert.rejects(
        () => client.placeMarketOrder({ symbol: "AAVEUSDT", side: "BUY", quantity: "1", newClientOrderId: "test-no-retry" }),
        (error: unknown) => error instanceof AsterApiError && error.executionUnknown,
    );
    assert.equal(calls, 1);
});
