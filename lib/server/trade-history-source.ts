import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

export type TradeHistorySource = "aster" | "local-fallback" | "empty";

export function selectTradeHistorySource(
  officialEntries: readonly TradeHistoryEntry[],
  localEntries: readonly TradeHistoryEntry[],
): { entries: TradeHistoryEntry[]; source: TradeHistorySource } {
  if (officialEntries.length > 0) {
    return { entries: [...officialEntries], source: "aster" };
  }
  if (localEntries.length > 0) {
    return { entries: [...localEntries], source: "local-fallback" };
  }
  return { entries: [], source: "empty" };
}
