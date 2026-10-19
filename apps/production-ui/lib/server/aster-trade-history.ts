import {
  AsterDexClient,
  loadAsterDexClientConfig,
  type AsterDexUserTrade,
} from "@/lib/server/asterdex/client";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";
import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "@/lib/disterminal-live-config";
import { deriveTradeHistoryAttribution, type TradeHistoryAttribution } from "@/lib/trade-history-attribution";
import { forcedExitCauseFromEvidence, loadFillLineageEvidence, routeFromFillEvidence, type FillLineageEvidence } from "@/lib/server/fill-lineage-evidence";
import {
  buildHistoryCoverage,
  paginateAsterUserTrades,
  type HistoryCoverage,
  type SymbolHistoryResult,
} from "@/lib/server/live-history-contract";
import { createHistoryRequestCoordinator } from "@/lib/server/history-request-coordinator";

const Q102_HISTORY_SYMBOLS = [
  "AAVEUSDT", "APTUSDT", "ARBUSDT", "AVAXUSDT", "DOGEUSDT", "DOTUSDT",
  "ENAUSDT", "FETUSDT", "FILUSDT", "JUPUSDT", "LDOUSDT", "NEARUSDT",
  "ONDOUSDT", "OPUSDT", "RENDERUSDT", "SEIUSDT", "SOLUSDT", "SUIUSDT",
  "TAOUSDT", "TIAUSDT", "TRXUSDT", "UNIUSDT",
] as const;

const ASTER_HISTORY_SYMBOLS: readonly string[] = Array.from(new Set([
  ...liveConfig.cryptoSymbols,
  ...Q102_HISTORY_SYMBOLS,
  "HYPEUSDT",
  "ZECUSDT",
  "PENGUUSDT",
  "RENDERUSDT",
  "TAOUSDT",
  "TIAUSDT",
  ...liveConfig.stockSymbols,
]));
const CACHE_TTL_MS = 60_000;
const STABLE_ASSETS = new Set(["USDT", "USDC", "USDF", "BUSD", "FDUSD"]);

type Direction = "LONG" | "SHORT";
type StrategyId = NonNullable<TradeHistoryEntry["strategyId"]>;
type Lot = {
  quantity: number;
  costUsd: number;
  openedAt: string;
  strategyId: StrategyId;
  attribution: TradeHistoryAttribution;
};
type Book = { netQuantity: number; lots: Lot[] };
type LivePosition = { symbol?: string; positionAmt?: string | number; positionSide?: string };

let cache: { expiresAt: number; entries: TradeHistoryEntry[]; coverage: HistoryCoverage; error?: string } | null = null;
const historyRequest = createHistoryRequestCoordinator<{
  entries: TradeHistoryEntry[];
  coverage: HistoryCoverage;
  error?: string;
}>();

export type AsterTradeHistoryResult = {
  entries: TradeHistoryEntry[];
  source: "aster" | "unavailable";
  refreshedAt: string;
  coverage: HistoryCoverage;
  error?: string;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseSymbol(symbol: string) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function strategyForSymbol(symbol: string): StrategyId {
  if (/^(AMZN|META|MSFT|NVDA|TSLA)/.test(symbol)) return "V52";
  if (symbol === liveConfig.penguSymbol) return "PENGU";
  if (symbol === "FETUSDT" || symbol === "HYPEUSDT" || symbol === "ZECUSDT") return "UNKNOWN";
  if ((Q102_HISTORY_SYMBOLS as readonly string[]).includes(symbol)) return "QUALITY102";
  return "V12";
}

function strategyFromEvidence(evidence: FillLineageEvidence | undefined, fallback: StrategyId): StrategyId {
  const value = String(evidence?.strategyId || "").toUpperCase();
  if (value === "HYPE_LONG" || value.includes("HYPE_ZEC_HYPE_LONG")) return "HYPE";
  if (value.includes("QUALITY102") || value === "Q102") return "QUALITY102";
  if (value.includes("PENGU")) return "PENGU";
  if (value.includes("V52") || value.includes("V11EQ") || value.includes("V50")) return "V52";
  if (value.includes("FET")) return "FET";
  if (value.includes("IDLE")) return "IDLE";
  if (value.includes("V96")) return "V96";
  if (value.includes("V12")) return "V12";
  return fallback;
}

function attributionFromEvidence(strategyId: StrategyId, evidence: FillLineageEvidence | undefined, fallbackReason: string) {
  const route = routeFromFillEvidence(evidence);
  const evidenceReason = [
    evidence?.reason,
    evidence?.entryVersion,
    evidence?.family,
    route ? `route: ${route}` : undefined,
  ].filter(Boolean).join(" / ");
  return deriveTradeHistoryAttribution({
    source: "official-fill",
    strategyId,
    reason: evidenceReason || fallbackReason,
  });
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
  let strategyId: StrategyId | undefined;
  let attribution: TradeHistoryAttribution | undefined;

  while (remaining > 1e-10 && book.lots.length) {
    const lot = book.lots[0];
    const originalQuantity = lot.quantity;
    const matched = Math.min(remaining, originalQuantity);
    costUsd += lot.costUsd * (matched / originalQuantity);
    openedAt ||= lot.openedAt;
    strategyId ||= lot.strategyId;
    attribution ||= lot.attribution;
    lot.quantity -= matched;
    lot.costUsd -= lot.costUsd * (matched / originalQuantity);
    remaining -= matched;
    if (lot.quantity <= 1e-10) book.lots.shift();
  }

  return { costUsd, openedAt, matchedQuantity: quantity - remaining, strategyId, attribution };
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
  evidence?: FillLineageEvidence,
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
  const matched = entry
    ? { costUsd: 0, openedAt: undefined, matchedQuantity: 0, strategyId: undefined, attribution: undefined }
    : consumeLots(book, quantity);
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

  const fallbackStrategy = strategyForSymbol(symbol);
  const evidenceStrategy = strategyFromEvidence(evidence, fallbackStrategy);
  const reason = "Aster official fill / " + evidenceStrategy + " / " + direction + " / " + (entry ? "Entry" : "Exit") + (trade.maker ? " / maker" : " / taker");
  const ownAttribution = attributionFromEvidence(evidenceStrategy, evidence, reason);
  const strategyId = close && matched.strategyId ? matched.strategyId : evidenceStrategy;
  const attribution = close && matched.attribution ? matched.attribution : ownAttribution;

  if (entry) {
    book.lots.push({
      quantity,
      costUsd: quoteQuantity,
      openedAt: executedAt,
      strategyId,
      attribution,
    });
  }
  book.netQuantity += side === "BUY" ? quantity : -quantity;

  const forcedCause = close ? forcedExitCauseFromEvidence(evidence) : undefined;
  const protectionExit = close && Boolean(evidence?.reduceOnly) && /PROTECTION|STOP|TAKE_PROFIT/i.test(String(evidence?.reason || evidence?.clientOrderId || ""));

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
    strategyId,
    netPnlUsd,
    attribution,
    ...(close ? {
      exitCause: forcedCause || (protectionExit ? "PROTECTION" : "STRATEGY"),
      exitCauseDetail: evidence?.reason || (protectionExit ? "Protective order fill" : "Strategy exit"),
    } : {}),
  };
}

async function fetchSymbolTrades(client: AsterDexClient, symbol: string) {
  const result = await paginateAsterUserTrades(
    ({ limit, fromId }) => client.getUserTrades(symbol, { limit, fromId }),
    { pageSize: 1000, maxPages: 1000 },
  );
  return {
    ...result,
    rows: result.rows.sort((left, right) => finite(left.time) - finite(right.time)),
  };
}

async function fetchAsterTrades(): Promise<{
  entries: TradeHistoryEntry[];
  coverage: HistoryCoverage;
  error?: string;
}> {
  const config = loadAsterDexClientConfig();
  const refreshedAt = new Date().toISOString();
  if (!config) {
    return {
      entries: [],
      coverage: buildHistoryCoverage({
        requestedSymbols: ASTER_HISTORY_SYMBOLS,
        symbols: ASTER_HISTORY_SYMBOLS.map((symbol) => ({ symbol, status: "FAILED", pages: 0, fills: 0, error: "Aster official history credentials are not configured." })),
        entries: [],
        source: "EMPTY",
        refreshedAt,
      }),
      error: "Aster official history credentials are not configured.",
    };
  }
  const client = new AsterDexClient(config);
  const entries: TradeHistoryEntry[] = [];
  const errors: string[] = [];
  const symbolResults: SymbolHistoryResult[] = [];
  const fillEvidence = await loadFillLineageEvidence();

  for (const symbol of ASTER_HISTORY_SYMBOLS) {
    try {
      const pageResult = await fetchSymbolTrades(client, symbol);
      const rows = pageResult.rows;
      symbolResults.push({
        symbol,
        status: pageResult.truncated || pageResult.error ? "PARTIAL" : "COMPLETE",
        pages: pageResult.pages,
        fills: rows.length,
        ...(pageResult.error ? { error: pageResult.error } : {}),
      });
      if (pageResult.error) errors.push(symbol + ": " + pageResult.error);
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
        const orderId = row.orderId === undefined ? undefined : String(row.orderId);
        const entry = toHistoryEntry(row, symbol, direction, book, orderId ? fillEvidence.get(orderId) : undefined);
        if (entry) entries.push(entry);
        if (row.positionSide === "BOTH" && row.side) {
          bothNetQuantity += row.side === "BUY" ? finite(row.qty) : -finite(row.qty);
        }
      }
    } catch (error) {
      errors.push(symbol + ": " + (error instanceof Error ? error.message : "Official history request failed."));
      symbolResults.push({
        symbol,
        status: "FAILED",
        pages: 0,
        fills: 0,
        error: error instanceof Error ? error.message : "Official history request failed.",
      });
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
    coverage: buildHistoryCoverage({
      requestedSymbols: ASTER_HISTORY_SYMBOLS,
      symbols: symbolResults,
      entries,
      source: "ASTER_OFFICIAL",
      refreshedAt,
    }),
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
      coverage: cache.coverage,
      error: cache.error,
    };
  }

  const result = await historyRequest.run(async () => {
    const next = await fetchAsterTrades();
    // An empty refresh after a successful history fetch is not allowed to erase
    // the last known official ledger. Keep the prior data and surface the
    // refresh failure as stale/partial instead of rendering an empty page.
    if (cache?.entries.length && next.entries.length === 0) {
      throw new Error(next.error || "Official history refresh returned no fills.");
    }
    return next;
  }).catch((error) => {
    const errorMessage = error instanceof Error ? error.message : "Official history request failed.";
    return {
      entries: [],
      coverage: buildHistoryCoverage({
        requestedSymbols: ASTER_HISTORY_SYMBOLS,
        symbols: ASTER_HISTORY_SYMBOLS.map((symbol) => ({ symbol, status: "FAILED", pages: 0, fills: 0, error: errorMessage })),
        entries: [],
        source: "EMPTY",
        refreshedAt: new Date(now).toISOString(),
      }),
      error: errorMessage,
    };
  });

  const stale = historyRequest.lastRunUsedStale;
  const coverage = stale
    ? {
      ...result.coverage,
      status: result.coverage.status === "COMPLETE" ? "PARTIAL" as const : result.coverage.status,
      failedSymbols: [
        ...result.coverage.failedSymbols,
        { symbol: "ACCOUNT_HISTORY", reason: historyRequest.lastError?.message || "Official history refresh failed; showing last successful data." },
      ],
      refreshedAt: new Date(now).toISOString(),
    }
    : result.coverage;
  const error = stale ? historyRequest.lastError?.message : result.error;
  cache = { expiresAt: now + CACHE_TTL_MS, entries: result.entries, coverage, error };
  return {
    entries: result.entries,
    source: result.entries.length > 0 ? "aster" : "unavailable",
    refreshedAt: new Date(now).toISOString(),
    coverage,
    error,
  };
}
