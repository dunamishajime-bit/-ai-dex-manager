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
  const entries = [...aster.entries, ...localEntries].filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index,
  );
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));

  return NextResponse.json({
    ok: true,
    entries,
    sources: { aster: aster.source, localLedger: localEntries.length > 0 },
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
  });
}
