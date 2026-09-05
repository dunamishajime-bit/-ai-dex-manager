import { NextResponse } from "next/server";
import { normalizeRuntimeStatus } from "../../../../lib/disdex-runtime-status";
import { observeRunnerServiceActivity } from "../../../../lib/disdex-service-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await normalizeRuntimeStatus({ serviceActivityObserver: observeRunnerServiceActivity });
  return NextResponse.json({ strategies: status }, { headers: { "Cache-Control": "no-store" } });
}
