import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { tradeHistoryDedupKeys } =
  require("../lib/server/trade-history-fill-dedup.ts") as typeof import("../lib/server/trade-history-fill-dedup");

const first = {
  id: "aster:XRPUSDT:9001",
  provider: "AsterDex",
  tradeId: "9001",
  orderId: "765",
  sourceSymbol: "XRP",
  destSymbol: "USDT",
};

test("partial fills of one XRP order must remain different history rows", () => {
  const second = { ...first, id: "aster:XRPUSDT:9002", tradeId: "9002" };
  assert.notDeepEqual(tradeHistoryDedupKeys(first), tradeHistoryDedupKeys(second));
  assert.deepEqual(tradeHistoryDedupKeys(first), ["fill:AsterDex:XRP:USDT:9001"]);
});

test("same exchange fill is stable across source refreshes", () => {
  assert.deepEqual(tradeHistoryDedupKeys(first), tradeHistoryDedupKeys({ ...first }));
});

test("tradeId namespaces across XRP and other symbols", () => {
  const btc = { ...first, id: "aster:BTCUSDT:9001", sourceSymbol: "BTC" };
  assert.notDeepEqual(tradeHistoryDedupKeys(first), tradeHistoryDedupKeys(btc));
});

test("order-only legacy fallback deduplicates by venue/order/symbol", () => {
  const order = { ...first, id: "local:1", tradeId: undefined };
  assert.deepEqual(tradeHistoryDedupKeys(order), ["order:AsterDex:XRP:USDT:765"]);
  assert.deepEqual(tradeHistoryDedupKeys(order), tradeHistoryDedupKeys({ ...order, id: "local:2" }));
});

test("no trade or order ID uses transaction then stable local row ID", () => {
  assert.deepEqual(tradeHistoryDedupKeys({ ...first, tradeId: undefined, orderId: undefined, txHash: "abc" }), ["tx:AsterDex:abc"]);
  assert.deepEqual(tradeHistoryDedupKeys({ ...first, tradeId: undefined, orderId: undefined, txHash: undefined }), ["id:aster:XRPUSDT:9001"]);
});
