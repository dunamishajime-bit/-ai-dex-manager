import { NextRequest, NextResponse } from "next/server";
import { readFile, readlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";
  loadRunnerPinManifest,
  type RunnerPin,
  type RunnerPinId,
} from "@/lib/server/runner-pin-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execute = promisify(execFile);
const runners: Array<{ id: string; name: string; pinId: RunnerPinId; group: "runner" | "guard" }> = [
  { id: "v12-v4", name: "V12 V4", pinId: "V12_V4", group: "runner" },
  { id: "pengu", name: "PENGU", pinId: "PENGU_V8", group: "runner" },
  { id: "q102", name: "Q102", pinId: "QUALITY102_CAUSAL_V1", group: "runner" },
  { id: "fet", name: "FET", pinId: "FET_BRK48_RESIDUAL", group: "runner" },
  { id: "hype", name: "HYPE", pinId: "HYPE_TREND_LONG", group: "runner" },
  { id: "idle", name: "Idle", pinId: "IDLE_PRIORITY_SHORT", group: "runner" },
  { id: "v52", name: "V52", pinId: "V52", group: "runner" },
  { id: "shared-risk", name: "Shared Risk", pinId: "SHARED_CRYPTO_RISK", group: "guard" },
  { id: "margin-guard", name: "Margin Guard", pinId: "MARGIN_GUARD", group: "guard" },
];

type RunnerState = "RUNNING" | "FAILED" | "INACTIVE" | "UNKNOWN";

function props(output: string) {
  return Object.fromEntries(output.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

async function releaseMarker(pin: RunnerPin) {
  const value = (await readFile(pin.releaseRoot + "/.disdex-release-sha", "utf8")).trim();
  if (value !== pin.sha) throw new Error("RELEASE_MARKER_MISMATCH");
}

function exactNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function heartbeatEvidence(pin: RunnerPin, mainPid: number, now: number) {
  if (pin.evidenceMode === "legacy") {
    return { mode: "legacy", heartbeatAt: null, lastTickAt: null, status: "LEGACY_MONITORING" };
  }
  let value: any;
  try {
    value = JSON.parse(await readFile(pin.healthPath, "utf8"));
  } catch {
    throw new Error("HEALTH_EVIDENCE_UNAVAILABLE");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HEALTH_EVIDENCE_INVALID");
  const heartbeatAt = exactNumber(value.heartbeatAt);
  const lastTickAt = exactNumber(value.lastTickAt ?? value.tickCompletedAt);
  if (value.runtimeSha !== pin.sha || value.expectedSha !== pin.sha) throw new Error("HEALTH_SHA_MISMATCH");
  if (value.serviceUnit !== pin.serviceUnit) throw new Error("HEALTH_SERVICE_MISMATCH");
  if (value.mainPid !== mainPid) throw new Error("HEALTH_PID_MISMATCH");
  if (value.workingDirectory !== pin.releaseRoot) throw new Error("HEALTH_CWD_MISMATCH");
  if (!heartbeatAt || !lastTickAt) throw new Error("HEALTH_TIMESTAMP_MISSING");
  if (heartbeatAt > now + 10_000 || lastTickAt > now + 10_000) throw new Error("HEALTH_TIMESTAMP_FUTURE");
  if (now - heartbeatAt > 300_000) throw new Error("HEARTBEAT_STALE");
  if (now - lastTickAt > 300_000) throw new Error("TICK_STALE");
  return { mode: pin.evidenceMode, heartbeatAt, lastTickAt, status: "CURRENT" };
}

async function inspect(
  item: typeof runners[number],
  pin: RunnerPin,
  now: number,
) {
  try {
    await releaseMarker(pin);
    const { stdout } = await execute(
      "systemctl",
      ["show", pin.serviceUnit, "--no-pager",
        "--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,MainPID,NRestarts,WorkingDirectory"],
      { timeout: 5000, maxBuffer: 32768 },
    );
    const values = props(stdout);
    const mainPid = Number(values.MainPID || 0);
    const active = values.ActiveState === "active" && values.SubState === "running" && mainPid > 0;
    const inactive = values.ActiveState === "inactive" || values.ActiveState === "deactivating";
    const failed = values.ActiveState === "failed" || Boolean(values.Result && !["success", ""].includes(values.Result));
    let processCwd: string | null = null;
    if (mainPid > 0) {
      processCwd = await readlink(`/proc/${mainPid}/cwd`);
      if (processCwd !== pin.releaseRoot) throw new Error("PROCESS_CWD_MISMATCH");
    }
    if (String(values.WorkingDirectory || "") && values.WorkingDirectory !== pin.releaseRoot) {
      throw new Error("SYSTEMD_CWD_MISMATCH");
    }

    let evidence: Awaited<ReturnType<typeof heartbeatEvidence>> | null = null;
    if (active) evidence = await heartbeatEvidence(pin, mainPid, now);

    const state: RunnerState =
      failed ? "FAILED" :
      active ? "RUNNING" :
      inactive ? "INACTIVE" : "UNKNOWN";

    return {
      id: item.id,
      name: item.name,
      group: item.group,
      state,
      unit: pin.serviceUnit,
      runtimeSha: pin.sha,
      shaSource: "ROOT_OWNED_RUNNER_PIN_MANIFEST",
      releaseRoot: pin.releaseRoot,
      evidenceMode: pin.evidenceMode,
      healthPath: pin.healthPath,
      tickPath: pin.tickPath,
      activeState: values.ActiveState || "unknown",
      subState: values.SubState || "unknown",
      result: values.Result || "unknown",
      exitCode: Number.isFinite(Number(values.ExecMainStatus)) ? Number(values.ExecMainStatus) : null,
      pid: mainPid || null,
      restarts: Number(values.NRestarts) || 0,
      processCwd,
      heartbeatAt: evidence?.heartbeatAt ?? null,
      lastTickAt: evidence?.lastTickAt ?? null,
      evidenceStatus: evidence?.status ?? (state === "RUNNING" ? "UNVERIFIED" : "NOT_RUNNING"),
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      state: "UNKNOWN" as RunnerState,
      unit: pin.serviceUnit,
      runtimeSha: pin.sha,
      shaSource: "ROOT_OWNED_RUNNER_PIN_MANIFEST",
      releaseRoot: pin.releaseRoot,
      evidenceMode: pin.evidenceMode,
      healthPath: pin.healthPath,
      tickPath: pin.tickPath,
      activeState: "unknown",
      subState: "unknown",
      result: error instanceof Error ? error.message : "RUNNER_IDENTITY_UNVERIFIED",
      exitCode: null,
      pid: null,
      restarts: 0,
      processCwd: null,
      heartbeatAt: null,
      lastTickAt: null,
      evidenceStatus: "BLOCKED",
    };
  }
}

export async function GET(req: NextRequest) {
  if (!requestHasSignedOwnerSession(req)) {
    return NextResponse.json({ ok: false, readOnly: true, error: "Authentication required" }, { status: 401 });
  }
  try {
    const manifest = await loadRunnerPinManifest(undefined, { requireRootOwned: true });
    const now = Date.now();
    const units = await Promise.all(runners.map((item) => inspect(item, manifest.runners[item.pinId], now)));
    return NextResponse.json(
      {
        ok: true,
        readOnly: true,
        tradingMutation: 0,
        source: "ROOT_OWNED_RUNNER_PIN_MANIFEST",
        checkedAt: new Date(now).toISOString(),
        operatorTarget: manifest.operatorTarget,
        units,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        readOnly: true,
        tradingMutation: 0,
        source: "ROOT_OWNED_RUNNER_PIN_MANIFEST",
        error: error instanceof Error ? error.message : "runner pin manifest unavailable",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
