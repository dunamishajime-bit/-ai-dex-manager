import { NextRequest, NextResponse } from "next/server";

import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";
import type { V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";

type Loader = () => Promise<V12V4HpSnapshot>;
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export function createV12V4HpStatusGet(loader: Loader = loadV12V4HpObservability) {
  return async function GET(req: NextRequest) {
    if (!requestHasSignedOwnerSession(req)) {
      return NextResponse.json({
        ok: false,
        displayStatus: "UNAVAILABLE",
        readOnly: true,
        tradingMutation: 0,
        error: "UNAUTHORIZED",
      }, { status: 401, headers });
    }
    try {
      return NextResponse.json(await loader(), { status: 200, headers });
    } catch {
      return NextResponse.json({
        ok: false,
        displayStatus: "UNAVAILABLE",
        readOnly: true,
        tradingMutation: 0,
        error: "V4_HP_STATUS_UNAVAILABLE",
      }, { status: 503, headers });
    }
  };
}
