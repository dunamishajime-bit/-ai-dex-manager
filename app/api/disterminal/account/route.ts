import { NextResponse } from "next/server";
import { readDisterminalAccount } from "@/lib/server/disterminal-aster-readonly";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const result = await readDisterminalAccount(force);
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.errorCode === "UNAUTHENTICATED" ? 401 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
