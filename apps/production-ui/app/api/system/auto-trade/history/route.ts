import { NextResponse } from "next/server";

import { loadAutoTradeHistory } from "@/lib/server/auto-trade-history-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadAutoTradeHistory();
  return NextResponse.json({ ok: true, entries });
}
