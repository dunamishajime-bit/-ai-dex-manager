import assert from "node:assert/strict";

import { loadTradeHistoryEntries, normalizeTradeHistoryEntries } from "../lib/server/trade-history-db";
import { selectTradeHistorySource } from "../lib/server/trade-history-source";

const wallet = {
  walletId: "recovered-wallet",
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 56,
};

const normalized = normalizeTradeHistoryEntries([
  {
    id: "buy-1",
    executedAt: "2026-04-08T04:29:46.000Z",
    ...wallet,
    txHash: "0xbuy",
    provider: "bscscan-recovery",
    action: "BUY",
    sourceSymbol: "USDT",
    destSymbol: "ETH",
    sourceAmount: 139.658976,
    destAmount: 0.062177,
    sourceUsdValue: 139.64,
    destUsdValue: 137.31,
    reason: "recovered:onchain-swap",
  },
  {
    id: "sell-1",
    executedAt: "2026-04-09T00:30:09.000Z",
    ...wallet,
    txHash: "0xsell",
    provider: "bscscan-recovery",
    action: "SELL",
    sourceSymbol: "ETH",
    destSymbol: "USDT",
    sourceAmount: 0.062177,
    destAmount: 135.864662,
    sourceUsdValue: 136.23,
    destUsdValue: 135.86,
    reason: "recovered:onchain-swap",
  },
]);

const closed = normalized.find((entry) => entry.id === "sell-1");
assert.equal(closed?.tradeStatus, "closed");
assert.equal(closed?.openedAt, "2026-04-08T04:29:46.000Z");
assert.equal(closed?.closedAt, "2026-04-09T00:30:09.000Z");
assert.equal(typeof closed?.realizedPnlUsd, "number");
assert.equal(typeof closed?.realizedPnlPct, "number");

const localFallback = selectTradeHistorySource([], normalized);
assert.equal(localFallback.source, "local-fallback");
assert.equal(localFallback.entries.length, 2);

const officialWins = selectTradeHistorySource([normalized[1]], normalized);
assert.equal(officialWins.source, "aster");
assert.equal(officialWins.entries.length, 2);

void loadTradeHistoryEntries().then((persisted) => {
  assert.ok(persisted.length > 0);
  assert.ok(persisted.some((entry) => entry.tradeStatus === "closed" && typeof entry.realizedPnlUsd === "number"));
  console.log("TRADE_HISTORY_SELFTEST_PASS");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
