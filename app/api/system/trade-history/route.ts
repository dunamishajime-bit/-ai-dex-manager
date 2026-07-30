import { NextResponse } from "next/server";
import { AsterDexClient, loadAsterDexClientConfig, type AsterDexUserTrade } from "@/lib/server/asterdex/client";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";

export const dynamic = "force-dynamic";

const ASTER_HISTORY_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT",
  "AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT",
] as const;
const STOCK_SYMBOLS = new Set(["AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT"]);

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toAsterHistoryEntry(trade: AsterDexUserTrade, accountAddress: string) {
  const symbol = String(trade.symbol || "").toUpperCase();
  const quantity = numberOrUndefined(trade.qty) ?? 0;
  const price = numberOrUndefined(trade.price);
  const realizedPnlUsd = numberOrUndefined(trade.realizedPnl);
  const commissionUsd = numberOrUndefined(trade.commission);
  const executedAt = new Date(Number(trade.time || 0)).toISOString();
  const grossValue = price !== undefined ? price * quantity : undefined;

  return {
    id: `aster-${symbol}-${String(trade.id ?? `${trade.orderId ?? "order"}-${trade.time ?? "time"}`)}`,
    source: "aster" as const,
    provider: "AsterDEX USER_DATA / userTrades",
    walletAddress: accountAddress,
    symbol,
    sourceSymbol: symbol,
    destSymbol: "USDT",
    action: trade.side === "SELL" ? "SELL" : "BUY",
    side: trade.side,
    positionSide: trade.positionSide,
    quantity,
    executionPrice: price,
    executedAt,
    realizedPnlUsd,
    realizedPnlPct: grossValue && realizedPnlUsd !== undefined
      ? (realizedPnlUsd / grossValue) * 100
      : undefined,
    commissionUsd,
    commissionAsset: trade.commissionAsset,
    fundingUsd: undefined,
    orderId: trade.orderId,
    tradeId: trade.id,
    maker: trade.maker,
    strategy: STOCK_SYMBOLS.has(symbol) ? "V52 Stock" : "V96 Crypto",
    settled: realizedPnlUsd !== undefined && realizedPnlUsd !== 0,
  };
}

async function loadAsterHistory() {
  const config = loadAsterDexClientConfig();
  if (!config) {
    return { entries: [], accountAddress: undefined, error: "Aster API設定がありません。" };
  }

  const client = new AsterDexClient(config);
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  const results = await Promise.allSettled(
    ASTER_HISTORY_SYMBOLS.map((symbol) => client.getUserTrades(symbol, { startTime, endTime, limit: 500 })),
  );
  const entries = results.flatMap((result) => result.status === "fulfilled"
    ? result.value.map((trade) => toAsterHistoryEntry(trade, config.userAddress))
    : []);
  const failures = results.filter((result) => result.status === "rejected");
  return {
    entries,
    accountAddress: config.userAddress,
    error: failures.length === results.length ? "Aster取引履歴を取得できません。" : undefined,
  };
}

export async function GET() {
  const localEntries = await loadTradeHistoryEntries();
  try {
    const aster = await loadAsterHistory();
    const merged = [...aster.entries, ...localEntries];
    const seen = new Set<string>();
    const entries = merged.filter((entry) => {
      const key = entry.id || `${entry.executedAt}-${entry.sourceSymbol}-${entry.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => Date.parse(right.executedAt || "") - Date.parse(left.executedAt || ""));
    return NextResponse.json({
      ok: true,
      entries,
      accountAddress: aster.accountAddress,
      source: { aster: aster.entries.length > 0, local: localEntries.length > 0, window: "直近7日" },
      warning: aster.error,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      ok: true,
      entries: localEntries,
      source: { aster: false, local: localEntries.length > 0 },
      warning: "Aster取引履歴を取得できません。ローカル台帳のみ表示しています。",
      fetchedAt: new Date().toISOString(),
    });
  }
}
