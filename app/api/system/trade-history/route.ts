import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";
import { selectTradeHistorySource } from "@/lib/server/trade-history-source";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const localEntries = await loadTradeHistoryEntries();
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  const aster = authenticated
    ? await loadAsterTradeHistory()
    : { entries: [], source: "unavailable" as const, refreshedAt: new Date().toISOString(), error: "Authentication required for Aster account history." };
  // Official Aster fills are authoritative when present. If the account has no
  // official fills yet, expose the existing recovered ledger as an explicit,
  // read-only fallback so the calendar is not silently empty.
  const selected = selectTradeHistorySource(aster.source === "aster" ? aster.entries : [], localEntries);
  const entries = selected.entries;
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));
  const officialEntries = aster.source === "aster" ? aster.entries : [];
  const localLedgerMerged = selected.source === "aster" && entries.length > officialEntries.length;

  return NextResponse.json({
    ok: true,
    entries,
    sources: {
      aster: aster.source,
      localLedgerFallback: selected.source === "local-fallback",
      localLedgerMerged,
    },
    officialHistory: selected.source === "aster",
    historySource: selected.source,
    historyNotice: selected.source === "local-fallback"
      ? "Aster公式約定が0件のため、保存済みの取引ledgerを読み取り専用で表示しています。"
      : localLedgerMerged
        ? "Aster公式約定に保存済みledgerの未取得分を重複排除して補完表示しています。"
        : undefined,
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
  });
}
