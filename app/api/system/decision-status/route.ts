import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") return NextResponse.json({ ok: false, readOnly: true, error: "ログインが必要です。" }, { status: 401 });
  try { return NextResponse.json(await loadDecisionStatus(), { headers: { "Cache-Control": "private, max-age=300", Vary: "Cookie" } }); }
  catch (error) { return NextResponse.json({ ok: false, readOnly: true, error: error instanceof Error ? error.message : "判定データを取得できません。" }, { status: 503 }); }
}
