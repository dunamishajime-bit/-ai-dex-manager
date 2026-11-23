import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";

test("direct Aster market fill is queued without sending an order for the test", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-direct-fill-notification-"));
  const previous = {
    enabled: process.env.DISDEX_TRADE_FILL_NOTIFICATION_ENABLED,
    mode: process.env.DISDEX_TRADE_FILL_NOTIFICATION_MODE,
    runner: process.env.DISDEX_RUNNER_ID,
    spool: process.env.DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH,
  };
  process.env.DISDEX_TRADE_FILL_NOTIFICATION_ENABLED = "true";
  process.env.DISDEX_TRADE_FILL_NOTIFICATION_MODE = "live";
  process.env.DISDEX_RUNNER_ID = "PENGU_V8";
  process.env.DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH = join(root, "inbox.jsonl");

  try {
    const client = {
      getBookTickers: async () => [{ symbol: "BTCUSDT", bidPrice: "99", askPrice: "101", bidQty: "10", askQty: "10", time: Date.now() }],
      getExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", status: "TRADING", quantityPrecision: 3, filters: [{ filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "100", stepSize: "0.001" }] }] }),
      placeMarketOrder: async (order: Record<string, unknown>) => ({
        symbol: order.symbol as string,
        side: order.side as "BUY" | "SELL",
        status: "FILLED",
        clientOrderId: order.newClientOrderId as string,
        orderId: 101,
        origQty: order.quantity as string,
        executedQty: order.quantity as string,
        avgPrice: "101",
        cumQuote: "1.01",
        updateTime: Date.now(),
      }),
    } as any;
    const executor = new AsterDirectTradeExecutor(client, { exchangeInfoTtlMs: 60_000 });
    const result = await executor.executeMarket({
      requestId: "request-1",
      clientOrderId: "pengu-fill-test-1",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 0.01,
      expectedPrice: 101,
      maxSlippageBps: 100,
      reason: "PENGU_ENTRY",
    });

    assert.equal(result.status, "FILLED");
    const event = JSON.parse((await readFile(join(root, "inbox.jsonl"), "utf8")).trim());
    assert.equal(event.strategyId, "PENGU_DUAL_LS_V2_FINAL");
    assert.equal(event.eventType, "ENTRY_FILL");
    assert.equal(event.clientOrderId, "pengu-fill-test-1");
  } finally {
    for (const [key, value] of Object.entries({
      DISDEX_TRADE_FILL_NOTIFICATION_ENABLED: previous.enabled,
      DISDEX_TRADE_FILL_NOTIFICATION_MODE: previous.mode,
      DISDEX_RUNNER_ID: previous.runner,
      DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH: previous.spool,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
