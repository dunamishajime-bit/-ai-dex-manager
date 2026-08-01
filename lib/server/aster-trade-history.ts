import {
  AsterDexClient,
  loadAsterDexClientConfig,
  type AsterDexUserTrade,
} from "@/lib/server/asterdex/client";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const ASTER_HISTORY_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT",
  "AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT",
] as const;
const CACHE_TTL_MS = 60_000;
let cache: { expiresAt: number; entries: TradeHistoryEntry[]; error?: string } | null = null;

export type AsterTradeHistoryResult = {
  entries: TradeHistoryEntry[];
  source: "aster" | "unavailable";
  refreshedAt: string;
  error?: string;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseSymbol(symbol: string) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function toHistoryEntry(trade: AsterDexUserTrade, symbol: string): TradeHistoryEntry | null {
  const side = trade.side === "SELL" ? "SELL" : trade.side === "BUY" ? "BUY" : null;
  const quantity = finite(trade.qty);
  const price = finite(trade.price);
  const quoteQuantity = finite(trade.quoteQty) || quantity * price;
  const executedAtMs = finite(trade.time);
  if (!side || quantity <= 0 || price <= 0 || executedAtMs <= 0) return null;

  const positionSide = trade.positionSide === "SHORT" ? "SHORT" : trade.positionSide === "LONG" ? "LONG" : "BOTH";
  const isQuoteIn = side === "BUY";
  const tradeId = String(trade.id ?? String(trade.orderId ?? "unknown") + "-" + executedAtMs + "-" + quantity);
  const orderId = trade.orderId === undefined ? undefined : String(trade.orderId);
  const realizedPnlUsd = Number.isFinite(Number(trade.realizedPnl)) ? finite(trade.realizedPnl) : undefined;
  const commission = Number.isFinite(Number(trade.commission)) ? finite(trade.commission) : undefined;
  const base = baseSymbol(symbol);

  return {
    id: "aster:" + symbol + ":" + tradeId,
    executedAt: new Date(executedAtMs).toISOString(),
    walletId: "asterdex-primary",
    walletAddress: "Aster account",
    chainId: 1666,
    txHash: orderId ? "order:" + orderId : "trade:" + tradeId,
    provider: "AsterDex",
    action: side,
    sourceSymbol: isQuoteIn ? "USDT" : base,
    destSymbol: isQuoteIn ? base : "USDT",
    sourceAmount: isQuoteIn ? quoteQuantity : quantity,
    destAmount: isQuoteIn ? quantity : quoteQuantity,
    sourceUsdValue: quoteQuantity,
    destUsdValue: quoteQuantity,
    entryPriceUsd: isQuoteIn ? price : undefined,
    exitPriceUsd: isQuoteIn ? undefined : price,
    realizedPnlUsd,
    reason: "Aster " + positionSide + " " + (side === "BUY" ? "Entry/Short Exit" : "Exit/Short Entry") + (trade.maker ? " / maker" : " / taker"),
    tradeId,
    orderId,
    positionSide,
    commission,
    commissionAsset: trade.commissionAsset,
    maker: trade.maker,
  };
}

async function fetchAsterTrades(): Promise<{ entries: TradeHistoryEntry[]; error?: string }> {
  const config = loadAsterDexClientConfig();
  if (!config) return { entries: [], error: "Aster read-only credentials are not configured." };
  const client = new AsterDexClient(config);
  const entries: TradeHistoryEntry[] = [];
  const errors: string[] = [];

  // Sequential + cached: this read-only page must not create a burst of signed requests.
  for (const symbol of ASTER_HISTORY_SYMBOLS) {
    try {
      const rows = await client.getUserTrades(symbol, { limit: 1000 });
      for (const row of Array.isArray(rows) ? rows : []) {
        const entry = toHistoryEntry(row, symbol);
        if (entry) entries.push(entry);
      }
    } catch (error) {
      errors.push(symbol + ": " + (error instanceof Error ? error.message : "request failed"));
    }
  }

  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));
  return {
    entries,
    error: entries.length === 0 && errors.length > 0 ? errors.slice(0, 2).join("; ") : undefined,
  };
}

export async function loadAsterTradeHistory(): Promise<AsterTradeHistoryResult> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return {
      entries: cache.entries,
      source: cache.entries.length > 0 ? "aster" : "unavailable",
      refreshedAt: new Date(now).toISOString(),
      error: cache.error,
    };
  }

  const result = await fetchAsterTrades();
  cache = { expiresAt: now + CACHE_TTL_MS, entries: result.entries, error: result.error };
  return {
    entries: result.entries,
    source: result.entries.length > 0 ? "aster" : "unavailable",
    refreshedAt: new Date(now).toISOString(),
    error: result.error,
  };
}
