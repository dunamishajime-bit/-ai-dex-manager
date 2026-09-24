import { NextRequest, NextResponse } from "next/server";

import { loadFetRuntimeObservability } from "@/lib/server/fet-runtime-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json(
      { ok: false, readOnly: true, tradingMutation: 0, error: "ログインが必要です。" },
      { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
  const snapshot = await loadFetRuntimeObservability();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
