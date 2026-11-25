import { loadPinnedDisplayObservation } from "@/lib/server/pinned-runtime-display";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";
import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";

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
  return requestHasSignedOwnerSession(req);
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

  const currentRuntime = await loadCurrentProductionRuntime().catch(() => null);
  const observation=await loadPinnedDisplayObservation("IDLE_PRIORITY_SHORT").catch(()=>null);
  if (observation?.monitorOnly) {
    const releaseSha=observation.expectedSha;
    const root="/var/lib/disdex/stable4-dd30-monitor/"+releaseSha+"/idle";
    const raw=observation.matchesCurrent ? await jsonFile(root+"/decision-details.json") : null;
    const details=raw?.runtimeSha===releaseSha && Number.isFinite(Number(raw.updatedAt)) &&
      Date.now()-Number(raw.updatedAt)<=300000 && Number(raw.updatedAt)<=Date.now()+10000 ? raw : null;
    const state=observation.matchesCurrent ? observation.monitorState : null;
    return NextResponse.json({ok:true,status:observation.matchesCurrent?"MONITOR_ONLY":"UNKNOWN",
      releaseSha,v4ReleaseSha:currentRuntime?.productionReleaseShas.v12 || null,
      heartbeat:{runtimeSha:observation.runtimeSha,expectedSha:releaseSha,
        heartbeatAt:observation.updatedAt,mainPid:observation.mainPid,
        mode:"MONITOR_ONLY",liveEnabled:false,newOrdersAllowed:false,healthReason:observation.healthReason},
      baseline:null,baselineStatus:"NOT_EVALUATED_THIS_CYCLE",baselineStale:false,
      baselineObservedRuntimeSha:null,v4Baseline:null,state,residualState:null,details,
      visibleSidecars:["HYPE"],updatedAt:Date.now()}, {headers:{"Cache-Control":"private, no-store"}});
  }
  const [fallbackReleaseSha, details, state, residualState, rawBaseline, v4BaselineRaw, heartbeat] = await Promise.all([
    textFile(releaseShaPath),
    jsonFile(detailsPath),
    jsonFile(statePath),
    jsonFile(residualStatePath),
    jsonFile(baselinePath),
    jsonFile(v4BaselinePath),
    jsonFile(heartbeatPath),
  ]);
  const releaseSha = currentRuntime?.productionReleaseShas.idle || fallbackReleaseSha;
  const v4ReleaseSha = currentRuntime?.productionReleaseShas.v12 || fallbackReleaseSha;
  const baselineCurrent = rawBaseline?.runtimeSha === releaseSha && rawBaseline?.decisionTs === details?.decisionTs;
  const baseline = baselineCurrent ? rawBaseline : null;
  const v4Baseline = v4BaselineRaw?.runtimeSha === v4ReleaseSha ? v4BaselineRaw : null;
  const baselineStatus = baselineCurrent ? "EVALUATED" : details ? "NOT_EVALUATED_THIS_CYCLE" : "UNAVAILABLE";

  return NextResponse.json({
    ok: true,
    status: heartbeat?.status || heartbeat?.safetyState || (heartbeat ? "LIVE" : "UNKNOWN"),
    releaseSha,
    v4ReleaseSha,
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
