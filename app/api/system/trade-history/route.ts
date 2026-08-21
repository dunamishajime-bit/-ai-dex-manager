import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const localEntries = await loadTradeHistoryEntries();
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  const aster = authenticated
    ? await loadAsterTradeHistory()
    : { entries: [], source: "unavailable" as const, refreshedAt: new Date().toISOString(), error: "ログインが必要です。" };
  const entries = aster.source === "aster" ? aster.entries : localEntries;
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = entries.filter((entry) => Date.parse(entry.executedAt) >= cutoff);
  const byStrategy = {
    V12: recent.filter((entry) => entry.strategyId === "V12").length,
    PENGU: recent.filter((entry) => entry.strategyId === "PENGU").length,
    V52: recent.filter((entry) => entry.strategyId === "V52").length,
  };

  return NextResponse.json({
    ok: true,
    entries,
    sources: { aster: aster.source, localLedgerFallback: aster.source !== "aster" && localEntries.length > 0 },
    officialHistory: aster.source === "aster",
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
    recent24h: { total: recent.length, byStrategy },
  });
}
