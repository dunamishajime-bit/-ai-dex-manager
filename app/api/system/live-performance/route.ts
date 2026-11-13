import { NextResponse } from "next/server";

import { loadLivePerformanceAnalytics } from "@/lib/server/live-performance-analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analytics = await loadLivePerformanceAnalytics();
    return NextResponse.json({ ok: true, analytics });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "LIVE performance analytics failed" },
      { status: 500 },
    );
  }
}
