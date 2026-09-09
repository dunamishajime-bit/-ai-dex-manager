import assert from "node:assert/strict";
import test from "node:test";

import { Quality102CausalV1AsterMarketDataProvider } from "../lib/disdex-quality102-causal-v1-market-data";

const HOUR = 60 * 60 * 1000;

test("Q102 current entry open queries through observed now instead of a 1ms range", async () => {
  const hourStart = Date.UTC(2026, 8, 9, 7, 0, 0);
  const now = hourStart + 5_000;
  const calls: Array<{ startTime?: number; endTime?: number }> = [];
  const row = [hourStart, "123.45", "124", "123", "123.7", "1", hourStart + HOUR - 1, "123.7", 1, "0", "0", "0"];
  const client = {
    getKlines: async (_symbol: string, _interval: string, _limit: number, range: { startTime?: number; endTime?: number }) => {
      calls.push(range);
      return range.endTime === now ? [row] : [];
    },
  };

  const provider = new Quality102CausalV1AsterMarketDataProvider(client as never, {
    symbols: ["AAVEUSDT"],
    historyHours: 181 * 24,
    requestSpacingMs: 0,
    now: () => now,
  });
  const entryOpen = await (provider as unknown as {
    loadEntryOpen(symbol: string, timestamp: number): Promise<{ timestampMs: number; open: number }>;
  }).loadEntryOpen("AAVEUSDT", now);

  assert.deepEqual(entryOpen, { timestampMs: hourStart, open: 123.45 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { startTime: hourStart, endTime: now });
});

test("Q102 retries a transient empty current candle without advancing the observed timestamp", async () => {
  const hourStart = Date.UTC(2026, 8, 9, 7, 0, 0);
  const now = hourStart + 5_000;
  const calls: Array<{ startTime?: number; endTime?: number }> = [];
  const row = [hourStart, "123.45", "124", "123", "123.7", "1", hourStart + HOUR - 1, "123.7", 1, "0", "0", "0"];
  let attempt = 0;
  const client = {
    getKlines: async (_symbol: string, _interval: string, _limit: number, range: { startTime?: number; endTime?: number }) => {
      calls.push(range);
      attempt += 1;
      return attempt === 1 ? [] : [row];
    },
  };

  const provider = new Quality102CausalV1AsterMarketDataProvider(client as never, {
    symbols: ["AAVEUSDT"],
    historyHours: 181 * 24,
    requestSpacingMs: 0,
    now: () => now,
  });
  const entryOpen = await (provider as unknown as {
    loadEntryOpen(symbol: string, timestamp: number): Promise<{ timestampMs: number; open: number }>;
  }).loadEntryOpen("AAVEUSDT", now);

  assert.deepEqual(entryOpen, { timestampMs: hourStart, open: 123.45 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { startTime: hourStart, endTime: now });
  assert.deepEqual(calls[1], { startTime: hourStart, endTime: now });
});

test("Q102 keeps retrying a delayed Aster current candle without widening the observed range", async () => {
  const hourStart = Date.UTC(2026, 8, 9, 7, 0, 0);
  const now = hourStart + 5_000;
  const row = [hourStart, "123.45", "124", "123", "123.7", "1", hourStart + HOUR - 1, "123.7", 1, "0", "0", "0"];
  const calls: Array<{ startTime?: number; endTime?: number }> = [];
  const retryDelays: number[] = [];
  let attempt = 0;
  const client = {
    getKlines: async (_symbol: string, _interval: string, _limit: number, range: { startTime?: number; endTime?: number }) => {
      calls.push(range);
      attempt += 1;
      return attempt === 10 ? [row] : [];
    },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    retryDelays.push(Number(delay));
    callback();
    return 0 as unknown as ReturnType<typeof originalSetTimeout>;
  }) as typeof originalSetTimeout;
  try {
    const provider = new Quality102CausalV1AsterMarketDataProvider(client as never, {
      symbols: ["AAVEUSDT"],
      historyHours: 181 * 24,
      requestSpacingMs: 0,
      now: () => now,
    });
    const entryOpen = await (provider as unknown as {
      loadEntryOpen(symbol: string, timestamp: number): Promise<{ timestampMs: number; open: number }>;
    }).loadEntryOpen("AAVEUSDT", now);

    assert.deepEqual(entryOpen, { timestampMs: hourStart, open: 123.45 });
    assert.deepEqual(retryDelays, [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 180_000]);
    assert.equal(calls.length, 10);
    assert.ok(calls.every((range) => range.startTime === hourStart && range.endTime === now));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
