import { NextResponse } from "next/server";

import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadTradeHistoryEntries();
  return NextResponse.json({ ok: true, entries });
}
