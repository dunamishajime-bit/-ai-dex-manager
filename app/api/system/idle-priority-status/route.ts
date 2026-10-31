import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function jsonFile(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}
async function textFile(path: string) {
  try { return (await readFile(path, "utf8")).trim(); }
  catch { return ""; }
}
function authorized(req: NextRequest) {
  return req.cookies.get("disdex_auth")?.value === "1";
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const releaseShaPath = process.env.DISDEX_RELEASE_SHA_PATH || "/home/deploy/disdex-trading/current/.disdex-release-sha";
  const detailsPath = process.env.DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH || "/var/lib/disdex/idle-priority/decision-details.json";
  const statePath = process.env.DISDEX_IDLE_PRIORITY_STATE_PATH || "/var/lib/disdex/idle-priority/state.json";
  const residualStatePath = process.env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH || "/var/lib/disdex/idle-priority/residual-long-state.json";
  const baselinePath = process.env.DISDEX_IDLE_PRIORITY_DECISION_PATH || "/var/lib/disdex/idle-priority/decision.json";
  const v4BaselinePath = process.env.V12_V4_IDLE_BASELINE_SNAPSHOT_PATH || "/var/lib/disdex/v12-v4/idle-baseline-snapshot.json";
  const heartbeatPath = process.env.DISDEX_IDLE_PRIORITY_HEARTBEAT_PATH || "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json";

  const [releaseSha, details, state, residualState, rawBaseline, v4BaselineRaw, heartbeat] = await Promise.all([
    textFile(releaseShaPath),
    jsonFile(detailsPath),
    jsonFile(statePath),
    jsonFile(residualStatePath),
    jsonFile(baselinePath),
    jsonFile(v4BaselinePath),
    jsonFile(heartbeatPath),
  ]);
  const baselineCurrent = rawBaseline?.runtimeSha === releaseSha && rawBaseline?.decisionTs === details?.decisionTs;
  const baseline = baselineCurrent ? rawBaseline : null;
  const v4Baseline = v4BaselineRaw?.runtimeSha === releaseSha ? v4BaselineRaw : null;
  const baselineStatus = baselineCurrent ? "EVALUATED" : details ? "NOT_EVALUATED_THIS_CYCLE" : "UNAVAILABLE";

  return NextResponse.json({
    ok: true,
    status: heartbeat?.status || heartbeat?.safetyState || (heartbeat ? "LIVE" : "UNKNOWN"),
    releaseSha,
    heartbeat,
    baseline,
    baselineStatus,
    baselineStale: rawBaseline !== null && !baselineCurrent,
    baselineObservedRuntimeSha: rawBaseline?.runtimeSha ?? null,
    v4Baseline,
    state,
    residualState,
    details,
    visibleSidecars: ["HYPE"],
    updatedAt: Date.now(),
  });
}
