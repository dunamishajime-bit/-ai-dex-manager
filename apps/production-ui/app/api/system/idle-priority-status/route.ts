import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { evaluateIdleRuntimeHealth } from "@/lib/server/idle-runtime-observability";
import { assessIdleDecisionDetails } from "@/lib/server/idle-decision-details";

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
  const heartbeatPath = process.env.DISDEX_IDLE_PRIORITY_HEARTBEAT_PATH || "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json";

  const [releaseSha, details, state, residualState, baseline, heartbeat] = await Promise.all([
    textFile(releaseShaPath),
    jsonFile(detailsPath),
    jsonFile(statePath),
    jsonFile(residualStatePath),
    jsonFile(baselinePath),
    jsonFile(heartbeatPath),
  ]);

  const expectedSha = releaseSha.trim().toLowerCase();
  const now = Date.now();
  const detailsAssessment = assessIdleDecisionDetails(details, expectedSha, now);
  const health = evaluateIdleRuntimeHealth({
    now,
    expectedSha,
    heartbeat,
    coreState: state,
    residualState,
  });

  return NextResponse.json({
    ok: true,
    status: health.status,
    releaseSha,
    health,
    orderPermission: {
      core: health.core.orderPermission,
      residual: health.residual.orderPermission,
    },
    heartbeat,
    baseline,
    state,
    residualState,
    // Core and residual are evaluated independently. A stale residual state
    // must not make the core Idle runner (or HYPE) appear stopped.
    details: detailsAssessment.fresh ? details : null,
    detailsFresh: detailsAssessment.fresh,
    detailsStatus: detailsAssessment.status,
    observedDetailsUpdatedAt: detailsAssessment.updatedAt,
    visibleSidecars: ["HYPE"],
    updatedAt: Date.now(),
  });
}
