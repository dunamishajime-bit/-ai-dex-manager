import { NextRequest, NextResponse } from "next/server";
import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import { loadFetRuntimeObservability } from "@/lib/server/fet-runtime-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read only. Expected FET SHA is derived from the actual approved trading release, never the UI build SHA. */
export async function GET(request: NextRequest) {
  if (request.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,error:"ログインが必要です。"},
      {status:401,headers:{"Cache-Control":"private, no-store, max-age=0"}});
  }
  try {
    const current = await loadCurrentProductionRuntime();
    const fet = await loadFetRuntimeObservability({expectedReleaseSha:current.releaseSha});
    return NextResponse.json({ok:true,readOnly:true,tradingMutation:0,
      expectedRuntimeSha:current.releaseSha,...fet},
      {headers:{"Cache-Control":"private, no-store, max-age=0"}});
  } catch(error) {
    return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,
      error:error instanceof Error?error.message:"FET実Runnerを取得できません。"},
      {status:503,headers:{"Cache-Control":"private, no-store, max-age=0"}});
  }
}
