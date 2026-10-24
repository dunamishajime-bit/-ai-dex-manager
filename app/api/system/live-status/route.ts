import { NextRequest, NextResponse } from "next/server";
import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, status: "UNAVAILABLE", error: "Authentication required." }, { status: 401, headers });
  }

  const checkedAt = new Date().toISOString();
  try {
    const v4 = await loadV12V4HpObservability();
    const status = v4.displayStatus === "LIVE_VERIFIED" ? "LIVE" : v4.displayStatus === "STALE" ? "STALE" : "UNAVAILABLE";
    const updatedAt = v4.timestamps.heartbeatUpdatedAt;
    return NextResponse.json({
      ok: status === "LIVE",
      readOnly: true,
      tradingMutation: 0,
      status,
      checkedAt,
      runnerUpdatedAt: updatedAt == null ? undefined : new Date(updatedAt).toISOString(),
      strategyId: "V12_V4",
      activeSymbol: v4.candidates[0]?.symbol,
      mode: v4.actual.v4RunnerMode,
      releaseSha: v4.actual.v4ReleaseSha || v4.actual.currentReleaseSha,
      primaryMode: v4.actual.v12PrimaryMode,
      orderEnabled: v4.actual.orderEnabled,
      reason: v4.errors.length ? v4.errors.join(" / ") : status === "LIVE" ? "V12 V4 heartbeat・decision source・primary modeを確認しました。" : status === "STALE" ? "V12 V4 state/decision sourceがSTALEです。" : "V12 V4 runner stateはLIVE確認条件未達です。",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, status: "UNAVAILABLE", checkedAt, error: error instanceof Error ? error.message : "V12 runner state could not be read." }, { headers: { "Cache-Control": "private, no-store, max-age=0" }, status: 503 });
  }
}
