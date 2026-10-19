import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoryCoverage,
  paginateAsterUserTrades,
  type SymbolHistoryResult,
} from "../lib/server/live-history-contract";
import { parseFillLineageEvidenceLine } from "../lib/server/fill-lineage-evidence";
import { deriveTradeHistoryAttribution } from "../lib/trade-history-attribution";
import { mergeTradeHistoryEntries } from "../lib/server/trade-history-source";
import type { TradeHistoryEntry } from "../lib/server/trade-history-db";

test("Aster pagination continues beyond twenty full pages", async () => {
  let calls = 0;
  const result = await paginateAsterUserTrades(
    async ({ fromId }) => {
      calls += 1;
      const start = fromId ?? 1;
      if (calls === 21) return [{ id: start, time: start, qty: "1" }];
      return Array.from({ length: 2 }, (_, index) => ({
        id: start + index,
        time: start + index,
        qty: "1",
      }));
    },
    { pageSize: 2, maxPages: 100 },
  );

  assert.equal(result.pages, 21);
  assert.equal(result.rows.length, 41);
  assert.equal(result.truncated, false);
});

test("Aster pagination reports a defensive page ceiling instead of silently dropping fills", async () => {
  const result = await paginateAsterUserTrades(
    async ({ fromId }) => Array.from({ length: 2 }, (_, index) => ({
      id: (fromId ?? 1) + index,
      time: (fromId ?? 1) + index,
      qty: "1",
    })),
    { pageSize: 2, maxPages: 2 },
  );

  assert.equal(result.pages, 2);
  assert.equal(result.truncated, true);
});

test("history coverage exposes complete, partial, and unavailable source states", () => {
  const symbols: SymbolHistoryResult[] = [
    { symbol: "BTCUSDT", status: "COMPLETE", pages: 3, fills: 4 },
    { symbol: "HYPEUSDT", status: "FAILED", pages: 0, fills: 0, error: "timeout" },
  ];
  const partial = buildHistoryCoverage({
    requestedSymbols: ["BTCUSDT", "HYPEUSDT"],
    symbols,
    entries: [],
    source: "ASTER_OFFICIAL",
    refreshedAt: "2026-10-19T00:00:00.000Z",
  });
  assert.equal(partial.status, "PARTIAL");
  assert.deepEqual(partial.completedSymbols, ["BTCUSDT"]);
  assert.deepEqual(partial.failedSymbols, [{ symbol: "HYPEUSDT", reason: "timeout" }]);
  assert.equal(partial.pagesBySymbol.BTCUSDT, 3);

  const empty = buildHistoryCoverage({
    requestedSymbols: ["BTCUSDT"],
    symbols: [{ symbol: "BTCUSDT", status: "FAILED", pages: 0, fills: 0, error: "credentials" }],
    entries: [],
    source: "EMPTY",
    refreshedAt: "2026-10-19T00:00:00.000Z",
  });
  assert.equal(empty.status, "UNAVAILABLE");
});

test("explicit client markers classify HYPE, Idle, and Q102 without symbol-only inference", () => {
  assert.equal(parseFillLineageEvidenceLine(JSON.stringify({ orderId: "1", clientOrderId: "hz-entry-1", symbol: "HYPEUSDT" }))?.strategyId, "HYPE_LONG");
  assert.equal(parseFillLineageEvidenceLine(JSON.stringify({ orderId: "2", clientOrderId: "idle-dot-entry-1", symbol: "DOTUSDT" }))?.strategyId, "IDLE");
  assert.equal(parseFillLineageEvidenceLine(JSON.stringify({ orderId: "3", clientOrderId: "q102v1-entry-1", symbol: "SUIUSDT" }))?.strategyId, "QUALITY102_CAUSAL_V1");
  assert.equal(deriveTradeHistoryAttribution({ source: "official-fill", strategyId: "HYPE_LONG", reason: "hz-entry-1" }).logicLabel, "HYPE");
  assert.equal(deriveTradeHistoryAttribution({ source: "official-fill", strategyId: "IDLE", reason: "idle-dot-entry-1" }).logicLabel, "IDLE");
  assert.equal(deriveTradeHistoryAttribution({ source: "official-fill", reason: "DOTUSDT official fill" }).evidence, "unavailable");
});

test("partial fills with different trade IDs remain separate even when order ID matches", () => {
  const base: TradeHistoryEntry = {
    id: "base",
    executedAt: "2026-10-19T00:00:00.000Z",
    walletId: "asterdex-primary",
    walletAddress: "Aster account",
    chainId: 1666,
    txHash: "order:42",
    provider: "AsterDex",
    action: "SELL",
    sourceSymbol: "BTC",
    destSymbol: "USDT",
    sourceAmount: 0.1,
    destAmount: 100,
    sourceUsdValue: 100,
    destUsdValue: 100,
    reason: "Aster official fill",
    tradeStatus: "closed",
    orderId: "42",
  };
  const merged = mergeTradeHistoryEntries([
    { ...base, id: "official-1", tradeId: "t-1", sourceAmount: 0.04 },
    { ...base, id: "official-2", tradeId: "t-2", sourceAmount: 0.06 },
  ], []);
  assert.equal(merged.length, 2);
});
