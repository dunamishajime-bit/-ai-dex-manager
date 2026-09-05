import { NextResponse } from "next/server";
import { normalizeRuntimeStatus } from "../../../../lib/disdex-runtime-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await normalizeRuntimeStatus();
  return NextResponse.json({ strategies: status }, { headers: { "Cache-Control": "no-store" } });
}
