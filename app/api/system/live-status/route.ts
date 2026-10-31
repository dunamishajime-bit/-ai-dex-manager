import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, status: "UNAVAILABLE", error: "Authentication required." }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const configuredPath = String(process.env.V12_X1_ALL_STATE_PATH || "").trim();
  if (!configuredPath || !isAbsolute(configuredPath)) {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, status: "UNAVAILABLE", checkedAt, error: "V12_X1_ALL_STATE_PATH is not configured as an absolute path." }, { headers: { "Cache-Control": "private, no-store, max-age=0" }, status: 503 });
  }

  try {
    const state = JSON.parse(await readFile(configuredPath, "utf8")) as Record<string, unknown>;
    const mode = typeof state.mode === "string" ? state.mode.toUpperCase() : "";
    const updatedAt = finite(state.updatedAt);
    const ageMs = updatedAt == null ? undefined : Math.max(0, Date.now() - updatedAt);
    const stale = ageMs == null || ageMs > 6 * 60 * 60 * 1000;
    const status = mode === "LIVE" && !stale ? "LIVE" : mode === "LIVE" ? "STALE" : "UNAVAILABLE";
    const active = state.active as Record<string, unknown> | undefined;
    return NextResponse.json({
      ok: status === "LIVE",
      readOnly: true,
      tradingMutation: 0,
      status,
      checkedAt,
      runnerUpdatedAt: updatedAt == null ? undefined : new Date(updatedAt).toISOString(),
      strategyId: typeof state.strategyId === "string" ? state.strategyId : undefined,
      activeSymbol: typeof active?.symbol === "string" ? active.symbol : undefined,
      mode: mode || undefined,
      reason: status === "LIVE" ? "V12 runner state is LIVE and fresh." : status === "STALE" ? "V12 runner state is LIVE but stale." : "V12 runner state is not LIVE.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, status: "UNAVAILABLE", checkedAt, error: error instanceof Error ? error.message : "V12 runner state could not be read." }, { headers: { "Cache-Control": "private, no-store, max-age=0" }, status: 503 });
  }
}
