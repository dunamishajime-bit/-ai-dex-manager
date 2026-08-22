import { NextRequest, NextResponse } from "next/server";

import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  if (!authenticated) {
    return NextResponse.json(
      { ok: false, readOnly: true, tradingMutation: 0, error: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const snapshot = await loadV12DecisionObservability();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        readOnly: true,
        tradingMutation: 0,
        error: error instanceof Error ? error.message : "V12 decision snapshot failed.",
      },
      { status: 502 },
    );
  }
}
