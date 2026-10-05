import { NextResponse } from "next/server";

import { loadQuality102SymbolObservability } from "@/lib/server/quality102-symbol-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadQuality102SymbolObservability(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      readOnly: true,
      tradingMutation: 0,
      error: error instanceof Error ? error.message : "Q102 symbol observability unavailable.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
