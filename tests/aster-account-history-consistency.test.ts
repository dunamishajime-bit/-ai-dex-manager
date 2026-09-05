import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAsterAccountMetrics,
  type AsterAccountMetricsInput,
} from "../lib/server/aster-account-metrics";
import {
  mergeTradeHistoryEntries,
  selectTradeHistorySource,
} from "../lib/server/trade-history-source";
import { displayTradePnlUsd } from "../lib/trade-pnl";

const baseEntry = {
  executedAt: "2026-08-22T10:00:08.400Z",
  walletId: "asterdex-primary",
  walletAddress: "Aster account",
  chainId: 1666,
  txHash: "order:1",
  provider: "AsterDex",
  action: "SELL" as const,
  sourceSymbol: "ETH",
  destSymbol: "USDT",
  sourceAmount: 1,
  destAmount: 110,
  sourceUsdValue: 110,
  destUsdValue: 110,
  realizedPnlUsd: 10,
  netPnlUsd: 9.5,
  reason: "Aster official fill",
  tradeStatus: "closed" as const,
};

test("Aster account valuation prefers total margin balance and exposes a fresh snapshot", () => {
  const account: AsterAccountMetricsInput = {
    totalWalletBalance: "60.00",
    totalMarginBalance: "60.2947362",
    availableBalance: "60.28464826",
    totalUnrealizedProfit: "0.2947362",
  };

  assert.deepEqual(deriveAsterAccountMetrics(account, 0), {
    balanceUsd: 60.2947362,
    availableUsd: 60.28464826,
    unrealizedPnlUsd: 0.2947362,
    connected: true,
  });
});

test("Aster account valuation falls back to stable asset balance when account totals are absent", () => {
  assert.equal(
    deriveAsterAccountMetrics({ assets: [] }, 12.5).balanceUsd,
    12.5,
  );
});

test("official and local history are merged without duplicating the same order", () => {
  const local = [{ ...baseEntry, id: "local-1" }];
  const official = [{ ...baseEntry, id: "aster:ETHUSDT:1", tradeId: "1", orderId: "1" }];
  const merged = mergeTradeHistoryEntries(official, local);

  assert.equal(merged.length, 1);
  assert.equal(selectTradeHistorySource(official, local).source, "aster");
});

test("history source keeps local records when official history is partial", () => {
  const local = [
    { ...baseEntry, id: "local-1", txHash: "order:1" },
    { ...baseEntry, id: "local-2", txHash: "order:2", tradeId: "2", orderId: "2" },
  ];
  const official = [{ ...local[0], id: "aster:ETHUSDT:1", tradeId: "1", orderId: "1" }];
  const selected = selectTradeHistorySource(official, local);

  assert.equal(selected.source, "aster");
  assert.equal(selected.entries.length, 2);
});

test("calendar and history use the same net PnL value when commission is available", () => {
  assert.equal(displayTradePnlUsd({ realizedPnlUsd: 10, netPnlUsd: 9.5 }), 9.5);
  assert.equal(displayTradePnlUsd({ realizedPnlUsd: -2 }), -2);
  assert.equal(displayTradePnlUsd({}), undefined);
});
