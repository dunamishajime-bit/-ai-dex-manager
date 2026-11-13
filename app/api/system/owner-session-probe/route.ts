import { NextRequest, NextResponse } from "next/server";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Authentication-only Nginx auth_request target.
 * Never depend on runner health, trading state, network data or venue APIs.
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!requestHasSignedOwnerSession(request)) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, {
      status: 401, headers,
    });
  }
  return new NextResponse(null, { status: 204, headers });
}
