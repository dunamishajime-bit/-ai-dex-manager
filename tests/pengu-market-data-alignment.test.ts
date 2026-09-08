import assert from "node:assert/strict";
import { test } from "node:test";

import { PenguDualLsV2AsterMarketDataProvider } from "../lib/pengu-dual-ls-v2-market-data-provider";

const HOUR = 3_600_000;
function row(index: number) {
  const openTime = index * HOUR;
  return [openTime, "1", "1.1", "0.9", "1", "100", openTime + HOUR - 1, "100", 1, "1", "1", "0"] as any;
}

function provider(pengu: any[], btc: any[]) {
  const client = { getKlines: async (symbol: string) => symbol === "BTCUSDT" ? btc : pengu } as any;
  return new PenguDualLsV2AsterMarketDataProvider(client, { hourlyLimit: 1000, cacheTtlMs: 30_000, now: () => 5000 * HOUR });
}

test("PENGU tolerates only a leading extra completed H1 candle by aligning common timestamps", async () => {
  const pengu = Array.from({ length: 401 }, (_, i) => row(i + 1));
  const btc = pengu.slice(1);
  const history = await provider(pengu, btc).load();
  assert.equal(history.pengu1h.length, 400);
  assert.equal(history.btc1h.length, 400);
  assert.equal(history.pengu1h[0].openTime, history.btc1h[0].openTime);
  assert.equal(history.pengu1h.at(-1)?.openTime, history.btc1h.at(-1)?.openTime);
});
test("PENGU still fails closed on an internal H1 gap", async () => {
  const rows = Array.from({ length: 401 }, (_, i) => row(i + 1));
  const btc = rows.filter((_, i) => i !== 200);
  await assert.rejects(() => provider(rows, btc).load(), /timestamps are not fully aligned/);
});

test("PENGU still fails closed when the latest completed H1 timestamps differ", async () => {
  const pengu = Array.from({ length: 401 }, (_, i) => row(i + 1));
  const btc = pengu.slice(0, -1);
  await assert.rejects(() => provider(pengu, btc).load(), /latest completed H1 timestamps differ/);
});