import assert from "node:assert/strict";
import test from "node:test";

import { HypeZecAsterMarketDataProvider } from "../lib/hype-zec-long-market-data";

function rows(now: number, intervalMs: number) {
  return [4, 3, 2].map((back) => [
    now - back * intervalMs,
    "100",
    "101",
    "99",
    "100.5",
    "1000",
    now - back * intervalMs + intervalMs - 1,
    "100000",
    10,
    "500",
    "50000",
    "0",
  ]);
}

test("HYPE-only TREND market data never depends on ZEC or legacy timeframes", async () => {
  const now = Date.UTC(2026, 9, 1, 3, 0, 0);
  const calls: Array<[string, string, number]> = [];
  const client = {
    getKlines: async (symbol: string, interval: string, limit: number) => {
      calls.push([symbol, interval, limit]);
      assert.notEqual(symbol, "ZECUSDT");
      assert.equal(interval, "1h");
      return rows(now, 60 * 60_000);
    },
  };

  const provider = new HypeZecAsterMarketDataProvider(client as never, {
    now: () => now,
    signalMode: "TREND",
    symbols: ["HYPEUSDT"],
    oneHourLimit: 360,
  });
  const data = await provider.load();

  assert.deepEqual(calls.map(([symbol, interval]) => [symbol, interval]), [
    ["BTCUSDT", "1h"],
    ["HYPEUSDT", "1h"],
  ]);
  assert.equal(data.btc1h.length, 3);
  assert.equal(data.hype1h.length, 3);
  assert.equal(data.btc15m.length, 0);
  assert.equal(data.hype15m.length, 0);
  assert.equal(data.hype1m.length, 0);
  assert.equal(data.zec15m.length, 0);
  assert.equal(data.zec1m.length, 0);
});
