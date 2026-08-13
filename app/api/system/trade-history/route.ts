Exit code: 0
Wall time: 0.9 seconds
Output:
import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  const aster = await loadAsterTradeHistory();
  return NextResponse.json({
    ok: true,
    entries: aster.entries,
    sources: { aster: aster.source, localLedgerFallback: false },
    officialHistory: aster.source === "asterdex",
    accountAddress: aster.accountAddress,
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
  });
}

