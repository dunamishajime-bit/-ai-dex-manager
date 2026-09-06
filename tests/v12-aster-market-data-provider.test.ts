import test from "node:test";
import assert from "node:assert/strict";

import { V12AsterMarketDataProvider } from "../lib/v12-aster-market-data-provider";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

function candles(count: number) {
    const start = Math.ceil(1_700_000_000_000 / 3_600_000) * 3_600_000;
    return candlesFrom(start, count);
}

function candlesFrom(start: number, count: number) {
    return Array.from({ length: count }, (_, index) => {
        const ts = start + index * 3_600_000;
        return [ts, "100", "101", "99", "100", "10", ts + 3_600_000 - 1] as const;
    });
}

function longerHistory(count: number) {
    const extra = count - 162;
    const start = Math.ceil(1_700_000_000_000 / 3_600_000) * 3_600_000 - extra * 3_600_000;
    return candlesFrom(start, count);
}

function shiftedCandles(count: number) {
    return candles(count).map((row) => [row[0] + 3_600_000, row[1], row[2], row[3], row[4], row[5], row[6] + 3_600_000] as const);
}

test("retries a transient hourly universe alignment mismatch", async () => {
    let calls = 0;
    const client = {
        getKlines: async (symbol: string) => {
            calls += 1;
            const firstAttempt = calls <= V12_X1_ALL.universe.length;
            return firstAttempt && symbol === "ETHUSDT" ? shiftedCandles(162) : candles(162);
        },
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 2 });
    const result = await provider.load();
    assert.equal(Object.keys(result).length, V12_X1_ALL.universe.length);
    assert.equal(calls, V12_X1_ALL.universe.length * 2);
});

test("aligns a longer symbol history to the common contiguous H2 suffix", async () => {
    const client = {
        getKlines: async (symbol: string) => symbol === "ETHUSDT" ? longerHistory(164) : candles(162),
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 1 });
    const result = await provider.load();
    const lengths = new Set(Object.values(result).map((bars) => bars.length));
    assert.deepEqual([...lengths], [80]);
    assert.equal(result.ETH[0]?.endTs, result.BTC[0]?.endTs);
});

test("fails closed when the universe latest H2 timestamps remain misaligned", async () => {
    const client = {
        getKlines: async (symbol: string) => symbol === "ETHUSDT" ? shiftedCandles(162) : candles(162),
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 2 });
    await assert.rejects(provider.load(), /V12 universe alignment mismatch: ETH/);
});

test("serializes V12 market-data requests behind the read-only rate gate", async () => {
    let active = 0;
    let maximumActive = 0;
    const client = {
        getKlines: async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return candles(162);
        },
    } as never;
    const provider = new V12AsterMarketDataProvider(client, { alignmentRetryAttempts: 1, requestMinIntervalMs: 0 });
    await provider.load();
    assert.equal(maximumActive, 1);
});
