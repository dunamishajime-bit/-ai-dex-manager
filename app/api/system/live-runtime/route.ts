import { NextRequest, NextResponse } from "next/server";

import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json(
      { ok: false, readOnly: true, tradingMutation: 0, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  try {
    const snapshot = await loadCurrentProductionRuntime();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        readOnly: true,
        tradingMutation: 0,
        source: "VPS_CURRENT_RUNTIME",
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Current production runtime could not be resolved.",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
