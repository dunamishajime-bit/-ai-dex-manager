import { sendEmail } from "@/lib/mail-service";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const DEFAULT_TRADE_FILL_NOTIFICATION_EMAIL = "dunamis.hajime@gmail.com";
const STABLE_SYMBOLS = new Set(["USDT", "USDC", "BUSD", "USD1", "FDUSD", "USDE"]);

function formatNumber(value: number | undefined, maximumFractionDigits = 8) {
  if (!Number.isFinite(value)) return "未取得";
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits,
  }).format(Number(value));
}

function resolveFillPrice(entry: TradeHistoryEntry) {
  if (
    entry.action === "BUY"
    && STABLE_SYMBOLS.has(entry.sourceSymbol.toUpperCase())
    && entry.destAmount > 0
    && entry.sourceAmount > 0
  ) {
    return entry.sourceAmount / entry.destAmount;
  }
  if (
    entry.action === "SELL"
    && STABLE_SYMBOLS.has(entry.destSymbol.toUpperCase())
    && entry.sourceAmount > 0
    && entry.destAmount > 0
  ) {
    return entry.destAmount / entry.sourceAmount;
  }

  const storedPrice = entry.action === "BUY" ? entry.entryPriceUsd : entry.exitPriceUsd;
  if (Number.isFinite(storedPrice) && Number(storedPrice) > 0) return Number(storedPrice);

  if (entry.action === "BUY" && entry.destAmount > 0 && entry.sourceUsdValue > 0) {
    return entry.sourceUsdValue / entry.destAmount;
  }
  if (entry.action === "SELL" && entry.sourceAmount > 0 && entry.destUsdValue > 0) {
    return entry.destUsdValue / entry.sourceAmount;
  }
  return undefined;
}

function formatExecutedAt(iso: string) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function notifyTradeFill(entry: TradeHistoryEntry): Promise<void> {
  const recipient = process.env.TRADE_FILL_NOTIFICATION_EMAIL?.trim() || DEFAULT_TRADE_FILL_NOTIFICATION_EMAIL;
  const fillPrice = resolveFillPrice(entry);
  const sourceAmount = `${formatNumber(entry.sourceAmount)} ${entry.sourceSymbol}`;
  const destAmount = `${formatNumber(entry.destAmount)} ${entry.destSymbol}`;
  const notionalUsd = entry.action === "BUY" ? entry.sourceUsdValue : entry.destUsdValue;
  const subject = `[DisTERMINAL] 約定通知: ${entry.action} ${entry.sourceSymbol} → ${entry.destSymbol}`;
  const text = [
    "DisTERMINALの注文ロジックで約定しました。",
    "",
    `売買: ${entry.action}`,
    `交換: ${sourceAmount} → ${destAmount}`,
    `約定価格: ${fillPrice != null ? `$${formatNumber(fillPrice, 10)} / ${entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol}` : "未取得"}`,
    `約定金額: $${formatNumber(notionalUsd, 6)}`,
    `約定時刻: ${formatExecutedAt(entry.executedAt)} (JST)`,
    `ウォレット: ${entry.walletAddress}`,
    `チェーン: ${entry.chainId}`,
    `プロバイダー: ${entry.provider || "不明"}`,
    `Tx: ${entry.txHash}`,
    `理由: ${entry.reason}`,
  ].join("\n");

  try {
    const result = await sendEmail(recipient, subject, text);
    if (!result.success) {
      console.warn("[TradeFillNotification] Email delivery failed:", result.error || "unknown_error");
    }
  } catch (error) {
    // Notification failure must never turn a confirmed fill into a trade failure.
    console.warn(
      "[TradeFillNotification] Email delivery threw:",
      error instanceof Error ? error.message : "unknown_error",
    );
  }
}
