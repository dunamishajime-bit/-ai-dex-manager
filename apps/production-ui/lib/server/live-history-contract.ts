import type { TradeHistoryEntry } from "./trade-history-db";

export type HistoryCoverageStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
export type HistoryCoverageSource = "ASTER_OFFICIAL" | "LOCAL_FALLBACK" | "EMPTY";

export type HistoryCoverage = {
  status: HistoryCoverageStatus;
  source: HistoryCoverageSource;
  requestedSymbols: string[];
  completedSymbols: string[];
  failedSymbols: Array<{ symbol: string; reason: string }>;
  pagesBySymbol: Record<string, number>;
  totalFills: number;
  oldestExecutedAt?: string;
  newestExecutedAt?: string;
  mergedLocalEntries: number;
  refreshedAt: string;
};

export type SymbolHistoryResult = {
  symbol: string;
  status: "COMPLETE" | "PARTIAL" | "FAILED";
  pages: number;
  fills: number;
  error?: string;
};

export type AsterPaginationResult<T> = {
  rows: T[];
  pages: number;
  truncated: boolean;
  error?: string;
};

type TradeCursor = { id?: string | number };

export async function paginateAsterUserTrades<T extends TradeCursor>(
  fetchPage: (input: { limit: number; fromId?: number }) => Promise<readonly T[]>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<AsterPaginationResult<T>> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 1000;
  const rows: T[] = [];
  const seen = new Set<string>();
  let fromId: number | undefined;
  let previousLastId: number | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    let pageRows: readonly T[];
    try {
      pageRows = await fetchPage({ limit: pageSize, fromId });
    } catch (error) {
      return {
        rows,
        pages: page,
        truncated: false,
        error: error instanceof Error ? error.message : "Aster userTrades request failed.",
      };
    }
    if (!Array.isArray(pageRows) || pageRows.length === 0) {
      return { rows, pages: page, truncated: false };
    }

    let newRows = 0;
    for (const row of pageRows) {
      const key = row.id === undefined
        ? JSON.stringify(row)
        : `trade:${String(row.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      newRows += 1;
    }

    const ids = pageRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));
    const lastId = ids.length ? Math.max(...ids) : undefined;
    if (pageRows.length < pageSize || newRows === 0) {
      return { rows, pages: page + 1, truncated: false };
    }
    if (lastId === undefined || (previousLastId !== undefined && lastId <= previousLastId)) {
      return {
        rows,
        pages: page + 1,
        truncated: true,
        error: "Aster userTrades pagination did not advance strictly by trade ID.",
      };
    }
    previousLastId = lastId;
    fromId = lastId + 1;
  }

  return {
    rows,
    pages: maxPages,
    truncated: true,
    error: `Aster userTrades exceeded the defensive ${maxPages}-page limit.`,
  };
}

export function buildHistoryCoverage(input: {
  requestedSymbols: readonly string[];
  symbols: readonly SymbolHistoryResult[];
  entries: readonly TradeHistoryEntry[];
  source: HistoryCoverageSource;
  refreshedAt: string;
  mergedLocalEntries?: number;
}): HistoryCoverage {
  const requestedSymbols = [...input.requestedSymbols];
  const completedSymbols = input.symbols
    .filter((item) => item.status === "COMPLETE")
    .map((item) => item.symbol);
  const failedSymbols = input.symbols
    .filter((item) => item.status !== "COMPLETE")
    .map((item) => ({
      symbol: item.symbol,
      reason: item.error || (item.status === "PARTIAL" ? "History pagination was incomplete." : "History request failed."),
    }));
  const pagesBySymbol = Object.fromEntries(input.symbols.map((item) => [item.symbol, item.pages]));
  const sorted = input.entries
    .map((entry) => entry.executedAt)
    .filter(Boolean)
    .sort();
  const status: HistoryCoverageStatus = input.source === "EMPTY"
    ? "UNAVAILABLE"
    : failedSymbols.length > 0
      ? "PARTIAL"
      : requestedSymbols.length > 0 && completedSymbols.length === requestedSymbols.length
        ? "COMPLETE"
        : "PARTIAL";

  return {
    status,
    source: input.source,
    requestedSymbols,
    completedSymbols,
    failedSymbols,
    pagesBySymbol,
    totalFills: input.entries.length,
    ...(sorted[0] ? { oldestExecutedAt: sorted[0] } : {}),
    ...(sorted.at(-1) ? { newestExecutedAt: sorted.at(-1) } : {}),
    mergedLocalEntries: input.mergedLocalEntries ?? 0,
    refreshedAt: input.refreshedAt,
  };
}

export function buildLocalFallbackCoverage(
  entries: readonly Array<{ executedAt?: string; sourceSymbol?: string; destSymbol?: string }>,
  refreshedAt: string,
  reason = "Aster公式履歴を取得できないため、保存済みledgerを表示しています。",
): HistoryCoverage {
  const symbols = [...new Set(entries.flatMap((entry) => [entry.sourceSymbol, entry.destSymbol]))]
    .filter((symbol) => symbol && !["USDT", "USDC", "BUSD", "FDUSD"].includes(symbol));
  const sorted = entries.map((entry) => entry.executedAt).filter(Boolean).sort();
  return {
    status: entries.length ? "PARTIAL" : "UNAVAILABLE",
    source: entries.length ? "LOCAL_FALLBACK" : "EMPTY",
    requestedSymbols: symbols,
    completedSymbols: [],
    failedSymbols: entries.length ? [{ symbol: "ACCOUNT_HISTORY", reason }] : [],
    pagesBySymbol: {},
    totalFills: entries.length,
    ...(sorted[0] ? { oldestExecutedAt: sorted[0] } : {}),
    ...(sorted.at(-1) ? { newestExecutedAt: sorted.at(-1) } : {}),
    mergedLocalEntries: entries.length,
    refreshedAt,
  };
}

