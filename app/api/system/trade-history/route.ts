import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const localEntries = await loadTradeHistoryEntries();
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  const aster = authenticated
    ? await loadAsterTradeHistory()
    : { entries: [], source: "unavailable" as const, refreshedAt: new Date().toISOString(), error: "Authentication required for Aster account history." };
  // Official Aster fills are authoritative when available. The local ledger is
  // only a fallback, so old local data cannot overwrite or hide official history.
  const entries = aster.source === "aster"
    ? aster.entries
    : localEntries;
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));

  return NextResponse.json({
    ok: true,
    entries,
    sources: { aster: aster.source, localLedgerFallback: aster.source !== "aster" && localEntries.length > 0 },
    officialHistory: aster.source === "aster",
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
  });
}
