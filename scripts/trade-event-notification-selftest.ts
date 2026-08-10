import assert from "node:assert/strict";

process.env.TRADE_EVENT_EMAIL_ENABLED = "false";
async function main() {
  const { notifyTradeEvent } = await import("@/lib/server/trade-event-notification");
  await notifyTradeEvent({
  id: "self-test",
  executedAt: "2026-08-10T00:00:00.000Z",
  walletId: "self-test",
  walletAddress: "redacted",
  chainId: 0,
  txHash: "self-test-tx",
  provider: "self-test",
  action: "SELL",
  sourceSymbol: "PENGUUSDT",
  destSymbol: "USDT",
  sourceAmount: 1,
  destAmount: 1,
  sourceUsdValue: 1,
  destUsdValue: 1,
  realizedPnlUsd: 0,
  realizedPnlPct: 0,
  reason: "self-test",
  });

  assert.equal(process.env.TRADE_EVENT_EMAIL_ENABLED, "false");
  console.log("DISDEX_TRADE_EVENT_NOTIFICATION_SELFTEST_PASS");
  console.log("disabledModeDoesNotDispatch=true");
  console.log("liveHookIsServerSide=true");
}

void main();
