import { NextRequest, NextResponse } from "next/server";
import { loadFormalPriorityObservability } from "@/lib/server/formal-priority-observability";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (req.cookies.get("disdex_auth")?.value !== "1") return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0 }, { status: 401, headers });
  try { return NextResponse.json(await loadFormalPriorityObservability(), { headers }); }
  catch (error) { return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0,
    error: error instanceof Error ? error.message : "FORMAL_PRIORITY_UNAVAILABLE" }, { status: 503, headers }); }
}
