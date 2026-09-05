import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

export type TradeHistorySource = "aster" | "local-fallback" | "empty";

function identityKeys(entry: TradeHistoryEntry) {
  const keys: string[] = [];
  if (entry.provider && entry.tradeId) keys.push(`trade:${entry.provider}:${entry.tradeId}`);
  if (entry.provider && entry.orderId) keys.push(`order:${entry.provider}:${entry.orderId}`);
  if (entry.txHash) keys.push(`tx:${entry.provider || "unknown"}:${entry.txHash}`);
  return keys.length ? keys : [`id:${entry.id}`];
}

export function mergeTradeHistoryEntries(
  officialEntries: readonly TradeHistoryEntry[],
  localEntries: readonly TradeHistoryEntry[],
) {
  const merged: TradeHistoryEntry[] = [];
  const seen = new Set<string>();

  for (const entry of [...officialEntries, ...localEntries]) {
    const keys = identityKeys(entry);
    if (keys.some((key) => seen.has(key))) continue;
    merged.push(entry);
    keys.forEach((key) => seen.add(key));
  }

  return merged;
}

export function selectTradeHistorySource(
  officialEntries: readonly TradeHistoryEntry[],
  localEntries: readonly TradeHistoryEntry[],
): { entries: TradeHistoryEntry[]; source: TradeHistorySource } {
  if (officialEntries.length > 0) {
    return { entries: mergeTradeHistoryEntries(officialEntries, localEntries), source: "aster" };
  }
  if (localEntries.length > 0) {
    return { entries: [...localEntries], source: "local-fallback" };
  }
  return { entries: [], source: "empty" };
}
