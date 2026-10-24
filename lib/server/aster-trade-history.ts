import {
  AsterDexClient,
  loadAsterDexClientConfig,
  type AsterDexUserTrade,
} from "@/lib/server/asterdex/client";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";
import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "@/lib/disterminal-live-config";
import { deriveTradeHistoryAttribution } from "@/lib/trade-history-attribution";

const CACHE_TTL_MS = 5 * 60_000;
const HISTORY_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
// Aster rejects a userTrades query whose interval is 7 days or longer.
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 1_000;
const HISTORICAL_SYMBOLS = ["FETUSDT", "HYPEUSDT", "DOTUSDT", "ZECUSDT", "PLUMEUSDT"] as const;

const ASTER_HISTORY_SYMBOLS: readonly string[] = Array.from(new Set([
  ...liveConfig.cryptoSymbols,
  ...liveConfig.stockSymbols,
  ...HISTORICAL_SYMBOLS,
]));
const STABLE_ASSETS = new Set(["USDT", "USDC", "USDF", "BUSD", "FDUSD"]);

type Direction = "LONG" | "SHORT";
type Lot = { quantity: number; costUsd: number; openedAt: string };
type Book = { netQuantity: number; lots: Lot[] };
type LivePosition = { symbol?: string; positionAmt?: string | number; positionSide?: string };

let cache: { expiresAt: number; entries: TradeHistoryEntry[]; error?: string } | null = null;

export type AsterTradeHistoryResult = {
  entries: TradeHistoryEntry[];
  source: "aster" | "unavailable";
  refreshedAt: string;
  error?: string;
};

export type AsterHistoryWindow = { startTime: number; endTime: number };

export function buildAsterHistoryWindows(startTime: number, endTime: number): AsterHistoryWindow[] {
  const start = Math.max(0, Math.floor(startTime));
  const end = Math.max(0, Math.floor(endTime));
  if (start > end) return [];
  const windows: AsterHistoryWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = Math.min(end, cursor + HISTORY_WINDOW_MS);
    windows.push({ startTime: cursor, endTime: windowEnd });
    cursor = windowEnd + 1;
  }
  return windows;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseSymbol(symbol: string) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function strategyForSymbol(symbol: string): "V12" | "V52" | "PENGU" | "QUALITY102" | "FET" | "HYPE" | "UNKNOWN" {
  if (/^(AMZN|META|MSFT|NVDA|TSLA)/.test(symbol)) return "V52";
  if (symbol === liveConfig.penguSymbol) return "PENGU";
  if (symbol === "FETUSDT") return "FET";
  if (symbol === "HYPEUSDT") return "HYPE";
  if (liveConfig.quality102Runtime.symbols.includes(symbol as (typeof liveConfig.quality102Runtime.symbols)[number])) {
    return "QUALITY102";
  }
  if (liveConfig.v12Symbols.includes(symbol as (typeof liveConfig.v12Symbols)[number])) return "V12";
  return "UNKNOWN";
}

function isEntry(direction: Direction, side: "BUY" | "SELL") {
  return direction === "LONG" ? side === "BUY" : side === "SELL";
}

function stableCommissionUsd(commission: number | undefined, asset: string | undefined) {
  return commission !== undefined && STABLE_ASSETS.has(String(asset || "").toUpperCase())
    ? commission
    : undefined;
}

function consumeLots(book: Book, quantity: number) {
  let remaining = quantity;
  let costUsd = 0;
  let openedAt: string | undefined;

  while (remaining > 1e-10 && book.lots.length) {
    const lot = book.lots[0];
    const originalQuantity = lot.quantity;
    const matched = Math.min(remaining, originalQuantity);
    costUsd += lot.costUsd * (matched / originalQuantity);
    openedAt ||= lot.openedAt;
    lot.quantity -= matched;
    lot.costUsd -= lot.costUsd * (matched / originalQuantity);
    remaining -= matched;
    if (lot.quantity <= 1e-10) book.lots.shift();
  }

  return { costUsd, openedAt, matchedQuantity: quantity - remaining };
}

function directionForTrade(trade: AsterDexUserTrade, currentNetQuantity: number): Direction {
  if (trade.positionSide === "LONG") return "LONG";
  if (trade.positionSide === "SHORT") return "SHORT";
  const side = trade.side === "SELL" ? "SELL" : "BUY";
  if (currentNetQuantity > 1e-10) return side === "SELL" ? "LONG" : "SHORT";
  if (currentNetQuantity < -1e-10) return side === "BUY" ? "SHORT" : "LONG";
  return side === "BUY" ? "LONG" : "SHORT";
}

function livePositionSide(position: LivePosition): { side: Direction; quantity: number } | null {
  const amount = finite(position.positionAmt);
  const quantity = Math.abs(amount);
  if (!position.symbol || quantity <= 0.0000001) return null;
  const positionSide = String(position.positionSide || "BOTH").toUpperCase();
  const side = positionSide === "SHORT" || (positionSide !== "LONG" && amount < 0) ? "SHORT" : "LONG";
  return { side, quantity };
}

function reconcileOpenEntries(entries: TradeHistoryEntry[], positions: LivePosition[]) {
  const current = new Map<string, Map<Direction, number>>();
  for (const position of positions) {
    const symbol = String(position.symbol || "").toUpperCase();
    const normalized = livePositionSide(position);
    if (!symbol || !normalized) continue;
    const bySide = current.get(symbol) || new Map<Direction, number>();
    bySide.set(normalized.side, (bySide.get(normalized.side) || 0) + normalized.quantity);
    current.set(symbol, bySide);
  }

  return entries.map((entry) => {
    if (entry.tradeStatus !== "open") return entry;
    const side = entry.positionSide === "SHORT" ? "SHORT" : "LONG";
    const base = side === "SHORT" ? entry.sourceSymbol : entry.destSymbol;
    const symbol = `${base}USDT`.toUpperCase();
    const quantity = current.get(symbol)?.get(side) || 0;
    return { ...entry, positionVerified: quantity > 0.0000001 };
  });
}

function toHistoryEntry(
  trade: AsterDexUserTrade,
  symbol: string,
  direction: Direction,
  book: Book,
): TradeHistoryEntry | null {
  const side = trade.side === "SELL" ? "SELL" : trade.side === "BUY" ? "BUY" : null;
  const quantity = finite(trade.qty);
  const price = finite(trade.price);
  const executedAtMs = finite(trade.time);
  if (!side || quantity <= 0 || price <= 0 || executedAtMs <= 0) return null;

  const quoteQuantity = finite(trade.quoteQty) || quantity * price;
  const executedAt = new Date(executedAtMs).toISOString();
  const base = baseSymbol(symbol);
  const tradeId = String(trade.id ?? String(trade.orderId ?? "unknown") + "-" + executedAtMs + "-" + quantity);
  const orderId = trade.orderId === undefined ? undefined : String(trade.orderId);
  const explicitRealized = Number.isFinite(Number(trade.realizedPnl));
  const commission = Number.isFinite(Number(trade.commission)) ? finite(trade.commission) : undefined;
  const entry = isEntry(direction, side);
  const matched = entry ? { costUsd: 0, openedAt: undefined, matchedQuantity: 0 } : consumeLots(book, quantity);
  const close = !entry;
  const averageEntryPrice = matched.matchedQuantity > 0 ? matched.costUsd / matched.matchedQuantity : undefined;
  const derivedRealized = averageEntryPrice === undefined
    ? undefined
    : direction === "LONG"
      ? (price - averageEntryPrice) * matched.matchedQuantity
      : (averageEntryPrice - price) * matched.matchedQuantity;
  const realizedPnlUsd = close
    ? (explicitRealized ? finite(trade.realizedPnl) : derivedRealized)
    : undefined;
  const costBasisUsd = averageEntryPrice !== undefined ? averageEntryPrice * matched.matchedQuantity : undefined;
  const realizedPnlPct = realizedPnlUsd !== undefined && costBasisUsd && costBasisUsd > 0
    ? (realizedPnlUsd / costBasisUsd) * 100
    : undefined;
  const commissionUsd = stableCommissionUsd(commission, trade.commissionAsset);
  const netPnlUsd = realizedPnlUsd !== undefined && commissionUsd !== undefined
    ? realizedPnlUsd - commissionUsd
    : undefined;

  if (entry) {
    book.lots.push({ quantity, costUsd: quoteQuantity, openedAt: executedAt });
  }
  book.netQuantity += side === "BUY" ? quantity : -quantity;

  const inferredStrategy = strategyForSymbol(symbol);
  const reason = "Aster official fill / " + inferredStrategy + " / " + direction + " / " + (entry ? "Entry" : "Exit") + (trade.maker ? " / maker" : " / taker");

  return {
    id: "aster:" + symbol + ":" + tradeId,
    executedAt,
    walletId: "asterdex-primary",
    walletAddress: "Aster account",
    chainId: 1666,
    txHash: orderId ? "order:" + orderId : "trade:" + tradeId,
    provider: "AsterDex",
    action: side,
    sourceSymbol: side === "BUY" ? "USDT" : base,
    destSymbol: side === "BUY" ? base : "USDT",
    sourceAmount: side === "BUY" ? quoteQuantity : quantity,
    destAmount: side === "BUY" ? quantity : quoteQuantity,
    sourceUsdValue: quoteQuantity,
    destUsdValue: quoteQuantity,
    entryPriceUsd: entry ? price : averageEntryPrice,
    exitPriceUsd: close ? price : undefined,
    realizedPnlUsd,
    realizedPnlPct,
    reason,
    openedAt: entry ? executedAt : matched.openedAt,
    closedAt: close ? executedAt : undefined,
    tradeId,
    orderId,
    positionSide: direction,
    commission,
    commissionAsset: trade.commissionAsset,
    maker: trade.maker,
    tradeStatus: close ? (matched.matchedQuantity > 0 ? "closed" : "unmatched_exit") : "open",
    strategyId: inferredStrategy,
    netPnlUsd,
    attribution: deriveTradeHistoryAttribution({
      source: "official-fill",
      strategyId: inferredStrategy,
      reason,
      realizedPnlUsd,
      netPnlUsd,
    }),
  };
}

async function fetchTimeRangeTrades(client: AsterDexClient, symbol: string, startTime: number, endTime: number, depth = 0): Promise<AsterDexUserTrade[]> {
  const rows = await client.getUserTrades(symbol, { limit: 1000, startTime, endTime });
  if (rows.length < 1000 || depth >= 6 || endTime - startTime < 60 * 60 * 1000) return rows;
  const midpoint = Math.floor((startTime + endTime) / 2);
  const [left, right] = await Promise.all([
    fetchTimeRangeTrades(client, symbol, startTime, midpoint, depth + 1),
    fetchTimeRangeTrades(client, symbol, midpoint + 1, endTime, depth + 1),
  ]);
  return [...left, ...right];
}

async function fetchSymbolTrades(client: AsterDexClient, symbol: string) {
  const rows: AsterDexUserTrade[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const window of buildAsterHistoryWindows(now - HISTORY_LOOKBACK_MS, now)) {
    const pageRows = await fetchTimeRangeTrades(client, symbol, window.startTime, window.endTime);
    if (!Array.isArray(pageRows)) continue;
    for (const row of pageRows) {
      const key = String(row.id ?? String(row.orderId ?? "unknown") + ":" + String(row.time ?? "unknown") + ":" + String(row.qty ?? "unknown"));
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
  }

  return rows.sort((left, right) => finite(left.time) - finite(right.time));
}

async function fetchAsterTrades(): Promise<{ entries: TradeHistoryEntry[]; error?: string }> {
  const config = loadAsterDexClientConfig();
  if (!config) return { entries: [], error: "Aster official history credentials are not configured." };
  const client = new AsterDexClient(config);
  const entries: TradeHistoryEntry[] = [];
  const errors: string[] = [];

  for (const symbol of ASTER_HISTORY_SYMBOLS) {
    try {
      const rows = await fetchSymbolTrades(client, symbol);
      const books = new Map<Direction, Book>([
        ["LONG", { netQuantity: 0, lots: [] }],
        ["SHORT", { netQuantity: 0, lots: [] }],
      ]);
      let bothNetQuantity = 0;
      for (const row of rows) {
        const currentNet = row.positionSide === "LONG"
          ? books.get("LONG")!.netQuantity
          : row.positionSide === "SHORT"
            ? books.get("SHORT")!.netQuantity
            : bothNetQuantity;
        const direction = directionForTrade(row, currentNet);
        const book = books.get(direction)!;
        const entry = toHistoryEntry(row, symbol, direction, book);
        if (entry) entries.push(entry);
        if (row.positionSide === "BOTH" && row.side) {
          bothNetQuantity += row.side === "BUY" ? finite(row.qty) : -finite(row.qty);
        }
      }
    } catch (error) {
      errors.push(symbol + ": " + (error instanceof Error ? error.message : "Official history request failed."));
    }
  }

  // The fill ledger is historical evidence; it is not authoritative for the
  // current position. Reconcile open-looking fills against positionRisk so a
  // closed SOLUSDT position cannot remain displayed as a live holding.
  try {
    const positions = await client.getPositionRisk();
    entries.splice(0, entries.length, ...reconcileOpenEntries(entries, positions));
  } catch (error) {
    errors.push("position reconciliation: " + (error instanceof Error ? error.message : "Position snapshot unavailable"));
  }
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));
  return {
    entries,
    error: errors.length ? errors.slice(0, 2).join("; ") : undefined,
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

  let result: { entries: TradeHistoryEntry[]; error?: string };
  try {
    result = await fetchAsterTrades();
  } catch (error) {
    result = { entries: [], error: error instanceof Error ? error.message : "Official history request failed." };
  }
  cache = { expiresAt: now + CACHE_TTL_MS, entries: result.entries, error: result.error };
  return {
    entries: result.entries,
    source: result.entries.length > 0 ? "aster" : "unavailable",
    refreshedAt: new Date(now).toISOString(),
    error: result.error,
  };
}
