import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  const aster = authenticated
    ? await loadAsterTradeHistory()
    : { entries: [], source: "unavailable" as const, refreshedAt: new Date().toISOString(), error: "Authentication required for Aster account history." };
  // Aster's signed user-trade endpoint is the sole source of truth for this
  // page. Never replace unavailable official history with local estimates.
  const entries = aster.entries;
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));

  return NextResponse.json({
    ok: true,
    entries,
    sources: { aster: aster.source, localLedgerFallback: false },
    officialHistory: aster.source === "aster",
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
  });
}
