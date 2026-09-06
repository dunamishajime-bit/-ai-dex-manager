import test from "node:test";
import assert from "node:assert/strict";

import { V12AsterMarketDataProvider } from "../lib/v12-aster-market-data-provider";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

function candles(count: number) {
    const start = Math.ceil(1_700_000_000_000 / 3_600_000) * 3_600_000;
    return Array.from({ length: count }, (_, index) => {
        const ts = start + index * 3_600_000;
        return [ts, "100", "101", "99", "100", "10", ts + 3_600_000 - 1] as const;
    });
}

test("retries a transient hourly universe alignment mismatch", async () => {
    let calls = 0;
    const client = {
        getKlines: async (symbol: string) => {
            calls += 1;
            const firstAttempt = calls <= V12_X1_ALL.universe.length;
            const count = firstAttempt && symbol === "ETHUSDT" ? 164 : 162;
            return candles(count);
        },
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 2 });
    const result = await provider.load();
    assert.equal(Object.keys(result).length, V12_X1_ALL.universe.length);
    assert.equal(calls, V12_X1_ALL.universe.length * 2);
});

test("fails closed after alignment retry budget is exhausted", async () => {
    const client = {
        getKlines: async (symbol: string) => candles(symbol === "ETHUSDT" ? 164 : 162),
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 2 });
    await assert.rejects(provider.load(), /V12 universe alignment mismatch: ETH/);
});
