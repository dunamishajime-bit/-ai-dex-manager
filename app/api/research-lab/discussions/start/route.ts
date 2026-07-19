import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    status: "disabled",
    message: "旧時間駆動の研究議論は停止しています。現行ラボはV35＋PENGU V46の決済完了イベント後に自動分析します。",
  }, { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } });
}
