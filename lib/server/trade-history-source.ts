import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";
import { deriveTradeHistoryAttribution } from "@/lib/trade-history-attribution";

export type TradeHistorySource = "aster" | "local-fallback" | "empty";

function identityKeys(entry: TradeHistoryEntry) {
  const keys: string[] = [];
  if (entry.tradeId) {
    keys.push(`trade:${entry.tradeId}`);
    if (entry.provider) keys.push(`trade:${entry.provider}:${entry.tradeId}`);
  }
  if (entry.orderId) {
    keys.push(`order:${entry.orderId}`);
    if (entry.provider) keys.push(`order:${entry.provider}:${entry.orderId}`);
  }
  if (entry.txHash) {
    keys.push(`tx:${entry.txHash}`);
    keys.push(`tx:${entry.provider || "unknown"}:${entry.txHash}`);
  }
  return keys.length ? keys : [`id:${entry.id}`];
}

function attributionFor(entry: TradeHistoryEntry, source: "official-fill" | "local-ledger") {
  return entry.attribution || deriveTradeHistoryAttribution({
    source,
    strategyId: entry.strategyId,
    reason: entry.reason,
    realizedPnlUsd: entry.realizedPnlUsd,
    netPnlUsd: entry.netPnlUsd,
  });
}

function shouldPreferLocalAttribution(attribution: TradeHistoryEntry["attribution"]) {
  return attribution?.evidence === "explicit"
    || attribution?.evidence === "negative-pnl-no-logic";
}

function enrichOfficialEntry(official: TradeHistoryEntry, local: TradeHistoryEntry) {
  const localAttribution = attributionFor(local, "local-ledger");
  const officialAttribution = attributionFor(official, "official-fill");
  return {
    ...official,
    strategyId: local.strategyId || official.strategyId,
    attribution: shouldPreferLocalAttribution(localAttribution)
      ? localAttribution
      : officialAttribution,
  };
}

export function mergeTradeHistoryEntries(
  officialEntries: readonly TradeHistoryEntry[],
  localEntries: readonly TradeHistoryEntry[],
) {
  const merged: TradeHistoryEntry[] = [];
  const seen = new Set<string>();
  const localByIdentity = new Map<string, TradeHistoryEntry>();

  for (const entry of localEntries) {
    for (const key of identityKeys(entry)) {
      localByIdentity.set(key, entry);
    }
  }

  for (const rawEntry of officialEntries) {
    const localMatch = identityKeys(rawEntry)
      .map((key) => localByIdentity.get(key))
      .find(Boolean);
    const entry = localMatch ? enrichOfficialEntry(rawEntry, localMatch) : rawEntry;
    const keys = identityKeys(entry);
    if (keys.some((key) => seen.has(key))) continue;
    merged.push(entry);
    keys.forEach((key) => seen.add(key));
  }

  for (const rawEntry of localEntries) {
    const keys = identityKeys(rawEntry);
    if (keys.some((key) => seen.has(key))) continue;
    merged.push({
      ...rawEntry,
      attribution: attributionFor(rawEntry, "local-ledger"),
    });
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
    return {
      entries: localEntries.map((entry) => ({
        ...entry,
        attribution: attributionFor(entry, "local-ledger"),
      })),
      source: "local-fallback",
    };
  }
  return { entries: [], source: "empty" };
}
