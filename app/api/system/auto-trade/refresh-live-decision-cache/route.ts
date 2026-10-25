import { NextResponse } from "next/server";

import { refreshActiveLiveDecisionCache } from "@/lib/server/auto-trade-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const payload = await refreshActiveLiveDecisionCache();
    return NextResponse.json({ ...payload, stale: false });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to refresh live decision cache.",
      },
      { status: 500 },
    );
  }
}
