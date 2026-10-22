import assert from "node:assert/strict";
import test from "node:test";

import { HypeZecAsterMarketDataProvider } from "../lib/hype-zec-long-market-data";
import { IdlePriorityAsterMarketDataProvider } from "../lib/idle-priority-short-market-data";

const M5 = 300_000;

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

function m5Rows(decisionTs: number, lookbackBars: number, endClose = 100): Kline[] {
  const latestClosed = decisionTs - M5;
  const first = latestClosed - lookbackBars * M5;
  return Array.from({ length: lookbackBars + 1 }, (_, index) => {
    const openTs = first + index * M5;
    const close = endClose + index * 0.01;
    return [openTs, "100", "101", "99", String(close), "10", openTs + M5 - 1, "100", 1, "1", "1", "0"];
  });
}

test("HYPE adopted M5 history loads exact completed BTC/HYPE windows and caches by boundary", async () => {
  const now = 1_800_000_000_123;
  const decisionTs = Math.floor(now / M5) * M5;
  const calls: Array<[string, string, number]> = [];
  const client = {
    getKlines: async (symbol: string, interval: string, limit: number) => {
      calls.push([symbol, interval, limit]);
      return [...m5Rows(decisionTs, 36), [decisionTs, "100", "101", "99", "101", "10", decisionTs + M5 - 1, "100", 1, "1", "1", "0"] as Kline];
    },
  };
  const provider = new HypeZecAsterMarketDataProvider(client as never, { now: () => now, signalMode: "TREND", symbols: ["HYPEUSDT"] });

  const first = await provider.loadAdoptedHypeFiveMinuteHistory();
  const second = await provider.loadAdoptedHypeFiveMinuteHistory();

  assert.equal(first.decisionTs, decisionTs);
  assert.equal(first.btc.length, 37);
  assert.equal(first.hype.length, 37);
  assert.deepEqual(second, first);
  assert.deepEqual(calls.map(([symbol, interval]) => [symbol, interval]), [["BTCUSDT", "5m"], ["HYPEUSDT", "5m"]]);
  assert.ok(first.btc.every((row) => row.openTs < decisionTs));
});

test("HYPE adopted M5 history fails closed on a missing completed bar", async () => {
  const now = 1_800_000_000_123;
  const decisionTs = Math.floor(now / M5) * M5;
  const rows = m5Rows(decisionTs, 36);
  rows.splice(10, 1);
  const client = { getKlines: async (symbol: string) => symbol === "BTCUSDT" ? rows : m5Rows(decisionTs, 36) };
  const provider = new HypeZecAsterMarketDataProvider(client as never, { now: () => now, signalMode: "TREND", symbols: ["HYPEUSDT"] });
  await assert.rejects(() => provider.loadAdoptedHypeFiveMinuteHistory(), /HYPE_BTC_ADOPTED_M5_DATA_(GAP|INSUFFICIENT)/);
});

test("Idle adopted M5 history keeps TAO and RENDER windows symbol-scoped", async () => {
  const now = 1_800_000_000_123;
  const decisionTs = Math.floor(now / M5) * M5;
  const calls: Array<[string, string, number]> = [];
  const client = {
    getKlines: async (symbol: string, interval: string, limit: number) => {
      calls.push([symbol, interval, limit]);
      return m5Rows(decisionTs, symbol === "BTCUSDT" || symbol === "RENDERUSDT" ? 72 : 12);
    },
  };
  const provider = new IdlePriorityAsterMarketDataProvider(client as never, { now: () => now, requestSpacingMs: 0 });

  const tao = await provider.loadAdoptedFiveMinuteHistory("TAOUSDT");
  const render = await provider.loadAdoptedFiveMinuteHistory("RENDERUSDT");

  assert.equal(tao.decisionTs, decisionTs);
  assert.ok("tao" in tao);
  assert.ok("btc" in render && "render" in render);
  if ("tao" in tao) assert.equal(tao.tao.length, 13);
  if ("btc" in render && "render" in render) {
    assert.equal(render.btc.length, 73);
    assert.equal(render.render.length, 73);
  }
  assert.deepEqual(calls.map(([symbol, interval]) => [symbol, interval]), [
    ["TAOUSDT", "5m"],
    ["BTCUSDT", "5m"],
    ["RENDERUSDT", "5m"],
  ]);
});

test("Idle adopted RENDER history fails closed on a forming or duplicate window", async () => {
  const now = 1_800_000_000_123;
  const decisionTs = Math.floor(now / M5) * M5;
  const rows = m5Rows(decisionTs, 72);
  rows[20] = [decisionTs, "100", "101", "99", "101", "10", decisionTs + M5 - 1, "100", 1, "1", "1", "0"];
  const client = { getKlines: async (symbol: string) => symbol === "BTCUSDT" ? m5Rows(decisionTs, 72) : rows };
  const provider = new IdlePriorityAsterMarketDataProvider(client as never, { now: () => now, requestSpacingMs: 0 });
  await assert.rejects(() => provider.loadAdoptedFiveMinuteHistory("RENDERUSDT"), /RENDER_ADOPTED_M5_DATA_(GAP|INSUFFICIENT)/);
});
