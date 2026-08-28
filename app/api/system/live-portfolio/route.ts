import { NextResponse } from "next/server";
import { loadLivePortfolioSnapshot } from "@/lib/server/live-portfolio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadLivePortfolioSnapshot());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to read Aster live portfolio." },
      { status: 502 },
    );
  }
}
