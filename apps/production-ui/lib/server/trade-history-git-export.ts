import fs from "fs";
import path from "path";

import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const EXPORT_PATH = path.join(process.cwd(), "data", "trade-history-git.json");

type GitTradeHistoryEntry = Omit<TradeHistoryEntry, "walletId">;

function toGitEntry(entry: TradeHistoryEntry): GitTradeHistoryEntry {
  const { walletId: _walletId, ...publicEntry } = entry;
  return publicEntry;
}

export function writeGitTradeHistorySnapshot(entries: TradeHistoryEntry[]): void {
  try {
    const dataDir = path.dirname(EXPORT_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const snapshot = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: "runtime-trade-ledger",
      entries: entries
        .filter((entry) => entry && entry.txHash && entry.executedAt)
        .sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt))
        .map(toGitEntry),
    };

    fs.writeFileSync(EXPORT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch (error) {
    // Git export is an audit aid; it must never block a confirmed trade ledger write.
    console.warn(
      "[TradeHistoryGitExport] snapshot write failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
