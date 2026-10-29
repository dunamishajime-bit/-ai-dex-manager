import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SNAPSHOT_SCHEMA = "disdex-runner-health-snapshot/v1";
const EXPECTED_DEPLOYMENT_TARGET = String(process.env.DISDEX_HP_DEPLOYMENT_TARGET || "professional-dismanager.net").trim();
const EXPECTED_OPERATOR_TARGET = String(process.env.DISDEX_HP_OPERATOR_TARGET || "DD1296_FINAL_ALLIN_10BPS").trim();

function authorized(req: NextRequest) {
  return req.cookies.get("disdex_auth")?.value === "1";
}

async function loadSnapshot(path: string) {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (raw.schema !== SNAPSHOT_SCHEMA || raw.authenticatedSourceRequired !== true || raw.readOnly !== true) {
    throw new Error("RUNNER_HEALTH_SNAPSHOT_CONTRACT_INVALID");
  }
  const targetIdentity = raw.targetIdentity as {
    valid?: unknown;
    deploymentTarget?: unknown;
    operatorTarget?: unknown;
  } | null;
  if (!targetIdentity || typeof targetIdentity !== "object" || Array.isArray(targetIdentity)
    || targetIdentity.valid !== true
    || targetIdentity.deploymentTarget !== EXPECTED_DEPLOYMENT_TARGET
    || targetIdentity.operatorTarget !== EXPECTED_OPERATOR_TARGET
    || !EXPECTED_DEPLOYMENT_TARGET
    || !EXPECTED_OPERATOR_TARGET) {
    throw new Error("TARGET_IDENTITY_MISMATCH");
  }
  if (!raw.runners || typeof raw.runners !== "object" || Array.isArray(raw.runners)) {
    throw new Error("RUNNER_HEALTH_SNAPSHOT_RUNNERS_INVALID");
  }
  return raw;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const path = process.env.DISDEX_RUNNER_HEALTH_SNAPSHOT_PATH || "/var/lib/disdex/runner-health/current.json";
  try {
    const snapshot = await loadSnapshot(path);
    return NextResponse.json({ ok: true, snapshot, authenticated: true }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error && ["RUNNER_HEALTH_SNAPSHOT_CONTRACT_INVALID", "TARGET_IDENTITY_MISMATCH"].includes(error.message)
        ? error.message
        : "RUNNER_HEALTH_SNAPSHOT_UNAVAILABLE",
      authenticated: true,
    }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
