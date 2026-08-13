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
const STABLE_ASSETS = new Set(["USDT", "USDC", "USDF", "BUSD", "FDUSD"]);

type Direction = "LONG" | "SHORT";
type Lot = { quantity: number; costUsd: number; openedAt: string };
type Book = { netQuantity: number; lots: Lot[] };

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

function strategyForSymbol(symbol: string): "V96" | "V52" {
  return /^(AMZN|META|MSFT|NVDA|TSLA)/.test(symbol) ? "V52" : "V96";
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
  // realizedPnl is authoritative only when supplied by Aster's official fill.
  // Do not reconstruct a local-ledger estimate when the venue omits it.
  const realizedPnlUsd = close && explicitRealized ? finite(trade.realizedPnl) : undefined;
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
    reason: "Aster official fill / " + strategyForSymbol(symbol) + " / " + direction + " / " + (entry ? "Entry" : "Exit") + (trade.maker ? " / maker" : " / taker"),
    openedAt: entry ? executedAt : matched.openedAt,
    closedAt: close ? executedAt : undefined,
    tradeId,
    orderId,
    positionSide: direction,
    commission,
    commissionAsset: trade.commissionAsset,
    maker: trade.maker,
    tradeStatus: close ? (matched.matchedQuantity > 0 ? "closed" : "unmatched_exit") : "open",
    strategyId: strategyForSymbol(symbol),
    netPnlUsd,
  };
}

async function fetchSymbolTrades(client: AsterDexClient, symbol: string) {
  const rows: AsterDexUserTrade[] = [];
  const seen = new Set<string>();
  let fromId: number | undefined;

  for (let page = 0; page < 20; page += 1) {
    const pageRows = await client.getUserTrades(symbol, { limit: 1000, fromId });
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;
    let newRows = 0;
    for (const row of pageRows) {
      const key = String(row.id ?? String(row.orderId ?? "unknown") + ":" + String(row.time ?? "unknown") + ":" + String(row.qty ?? "unknown"));
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
        newRows += 1;
      }
    }
    if (pageRows.length < 1000 || newRows === 0) break;
    const ids = pageRows.map((row) => Number(row.id)).filter(Number.isFinite);
    const lastId = ids.length ? Math.max(...ids) : undefined;
    if (lastId === undefined || fromId === lastId + 1) break;
    fromId = lastId + 1;
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
      source: cache.error && cache.entries.length === 0 ? "unavailable" : "aster",
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
    source: result.error && result.entries.length === 0 ? "unavailable" : "aster",
    refreshedAt: new Date(now).toISOString(),
    error: result.error,
  };
}
