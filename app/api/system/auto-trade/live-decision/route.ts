import { NextResponse } from "next/server";

import { readDisTerminalLiveStatus } from "@/lib/disterminal-live-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await readDisTerminalLiveStatus();
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load daemon LIVE status." },
      { status: 500 },
    );
  }
}
