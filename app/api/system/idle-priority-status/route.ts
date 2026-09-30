import { NextRequest, NextResponse } from "next/server";
import { loadIdlePriorityRuntimeObservability } from "@/lib/server/idle-priority-runtime-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, error: "ログインが必要です。" }, { status: 401 });
  }
  try {
    return NextResponse.json(await loadIdlePriorityRuntimeObservability(), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      readOnly: true,
      tradingMutation: 0,
      error: error instanceof Error ? error.message : "Idle Priority runtimeを取得できません。",
    }, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
