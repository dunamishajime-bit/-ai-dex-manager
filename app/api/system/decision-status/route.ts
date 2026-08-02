import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, error: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002" }, { status: 401 });
  }
  try {
    return NextResponse.json(await loadDecisionStatus(), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return NextResponse.json({ ok: false, readOnly: true, error: error instanceof Error ? error.message : "\u5224\u5b9a\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3002" }, { status: 503 });
  }
}
