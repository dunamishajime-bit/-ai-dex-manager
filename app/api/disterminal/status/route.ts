import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { DisterminalLiveStatus } from "@/lib/disterminal-account-types";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const statusPath = process.env.DISTERMINAL_LIVE_STATUS_FILE?.trim();
  let result: DisterminalLiveStatus;
  if (!statusPath) {
    result = {
      ok: true,
      state: "UNKNOWN",
      source: "unavailable",
      checkedAt,
      lastRuntimeAt: null,
      reason: "LIVEサービスの読み取り専用状態ソースが未設定です。",
    };
  } else {
    try {
      const parsed = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
      const mainPid = typeof parsed.mainPid === "number" ? parsed.mainPid : Number(parsed.mainPid);
      const state = parsed.state === "ACTIVE" && Number.isFinite(mainPid) && mainPid > 0 ? "ACTIVE" : "INACTIVE";
      result = {
        ok: true,
        state,
        source: "read-only status file",
        checkedAt,
        lastRuntimeAt: typeof parsed.lastRuntimeAt === "string" ? parsed.lastRuntimeAt : null,
        reason: state === "ACTIVE" ? "読み取り専用状態ソースで確認済みです。" : "LIVEサービスは稼働中として確認できません。",
      };
    } catch {
      result = {
        ok: true,
        state: "UNKNOWN",
        source: "unavailable",
        checkedAt,
        lastRuntimeAt: null,
        reason: "LIVEサービス状態を取得できません。",
      };
    }
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
