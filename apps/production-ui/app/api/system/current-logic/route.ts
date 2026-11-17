import { NextRequest, NextResponse } from "next/server";
import { buildLiveLogicSnapshot } from "@/lib/server/current-live-logic-catalog";

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
    const payload = await buildLiveLogicSnapshot();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false, readOnly: true, tradingMutation: 0,
      source: "ROOT_RUNNER_PIN_MANIFEST_AND_SYSTEMD",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "CURRENT_LOGIC_UNAVAILABLE",
    }, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
