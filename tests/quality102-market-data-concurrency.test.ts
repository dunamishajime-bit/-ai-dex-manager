import assert from "node:assert/strict";
import test from "node:test";

import type { AsterKline, AsterV3Client } from "../lib/aster-v3-client";
import {
    Quality102CausalV1AsterMarketDataProvider,
} from "../lib/disdex-quality102-causal-v1-market-data";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const HOUR = 3_600_000;

test("Q102 market history uses bounded symbol concurrency and retries a transient current-open miss", async () => {
    let active = 0;
    let maximumActive = 0;
    const currentOpenCalls = new Map<string, number>();
    const client = {
        async getKlines(symbol: string, _interval: string, limit: number, range: { startTime?: number; endTime?: number } = {}): Promise<AsterKline[]> {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            if (limit === 1) {
                const calls = (currentOpenCalls.get(symbol) || 0) + 1;
                currentOpenCalls.set(symbol, calls);
                if (calls === 1) return [];
                const timestamp = Math.floor(NOW / HOUR) * HOUR;
                return [[timestamp, "100", "101", "99", "100", "10", timestamp + HOUR - 1, "1000", 1, "0", "0", "0"]];
            }
            const start = Number(range.startTime);
            const end = Number(range.endTime);
            const rows: AsterKline[] = [];
            for (let timestamp = start; timestamp <= end && rows.length < limit; timestamp += HOUR) {
                rows.push([timestamp, "100", "101", "99", "100", "10", timestamp + HOUR - 1, "1000", 1, "0", "0", "0"]);
            }
            return rows;
        },
    } as unknown as AsterV3Client;

    const provider = new Quality102CausalV1AsterMarketDataProvider(client, {
        symbols: ["SUIUSDT", "OPUSDT", "SEIUSDT"],
        historyHours: 181 * 24,
        pageLimit: 500,
        maxConcurrentSymbols: 2,
        currentOpenRetryAttempts: 2,
        currentOpenRetryDelayMs: 0,
        now: () => NOW,
    });
    const history = await provider.load();
    assert.ok(Object.keys(history.candlesBySymbol).length >= 4);
    assert.equal(maximumActive <= 2, true);
    for (const count of currentOpenCalls.values()) assert.equal(count, 2);
});

test("Q102 serializes kline GETs behind the request-rate gate", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const client = {
        async getKlines(symbol: string, _interval: string, limit: number, range: { startTime?: number; endTime?: number } = {}): Promise<AsterKline[]> {
            void symbol;
            activeRequests += 1;
            maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
            await new Promise((resolve) => setTimeout(resolve, 2));
            activeRequests -= 1;
            if (limit === 1) {
                const timestamp = Math.floor(NOW / HOUR) * HOUR;
                return [[timestamp, "100", "101", "99", "100", "10", timestamp + HOUR - 1, "1000", 1, "0", "0", "0"]];
            }
            const start = Number(range.startTime);
            const end = Number(range.endTime);
            const rows: AsterKline[] = [];
            for (let timestamp = start; timestamp <= end && rows.length < limit; timestamp += HOUR) {
                rows.push([timestamp, "100", "101", "99", "100", "10", timestamp + HOUR - 1, "1000", 1, "0", "0", "0"]);
            }
            return rows;
        },
    } as unknown as AsterV3Client;

    const provider = new Quality102CausalV1AsterMarketDataProvider(client, {
        symbols: ["SUIUSDT", "OPUSDT"],
        historyHours: 181 * 24,
        pageLimit: 500,
        maxConcurrentSymbols: 2,
        requestMinIntervalMs: 0,
        currentOpenRetryAttempts: 1,
        currentOpenRetryDelayMs: 0,
        now: () => NOW,
    });
    await provider.load();
    assert.equal(maximumActiveRequests, 1);
});
