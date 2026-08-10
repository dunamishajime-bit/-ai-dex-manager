import { sendEmail } from "@/lib/mail-service";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const DEFAULT_RECIPIENT = "dunamis.hajime@gmail.com";

function notificationEnabled() {
  if (process.env.TRADE_EVENT_EMAIL_ENABLED === "false") return false;
  return process.env.TRADE_EVENT_EMAIL_ENABLED === "true" || process.env.NODE_ENV === "production";
}

function short(value: string, size = 14) {
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export async function notifyTradeEvent(entry: TradeHistoryEntry) {
  if (!notificationEnabled()) return;

  const isSettlement = entry.action === "SELL";
  const recipient = process.env.TRADE_NOTIFICATION_EMAIL?.trim() || DEFAULT_RECIPIENT;
  const subject = isSettlement
    ? `DISTerminal 決済成立: ${entry.sourceSymbol}`
    : `DISTerminal 注文成立: ${entry.destSymbol}`;
  const lines = [
    "DISTerminal 実取引イベント",
    `種別: ${isSettlement ? "決済" : "注文成立"}`,
    `Action: ${entry.action}`,
    `銘柄: ${entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol}`,
    `数量: ${entry.action === "BUY" ? entry.destAmount : entry.sourceAmount}`,
    `約定価格(USD): ${entry.action === "BUY" ? entry.entryPriceUsd ?? "未取得" : entry.exitPriceUsd ?? "未取得"}`,
    ...(isSettlement ? [`実現損益(USD): ${entry.realizedPnlUsd ?? "未照合"}`, `実現損益(%): ${entry.realizedPnlPct ?? "未照合"}`] : []),
    `戦略: ${entry.strategyId || "実行経路の記録なし"}`,
    `理由: ${entry.reason}`,
    `Tx/Order: ${short(entry.txHash)}`,
    `発生時刻: ${entry.executedAt}`,
  ];

  try {
    const result = await sendEmail(recipient, subject, lines.join("\n"));
    if (!result.success) {
      console.error("[TradeEventNotification] email delivery failed:", result.error instanceof Error ? result.error.message : "unknown error");
    }
  } catch (error) {
    console.error("[TradeEventNotification] email delivery threw:", error instanceof Error ? error.message : "unknown error");
  }
}
