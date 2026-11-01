import { NextRequest, NextResponse } from "next/server";
import { lstat, readFile, readlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadRunnerPinManifest,
  RUNNER_PIN_MANIFEST,
  type RunnerPin,
  type RunnerPinId,
} from "@/lib/server/runner-pin-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execute = promisify(execFile);
const CURRENT_MARKER = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const SHA_RE = /^[a-f0-9]{40}$/i;
const MAX_LEGACY_STATE_AGE_MS = 15 * 60 * 1000;
const MAX_TICK_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_MS = 10_000;

const display: Record<RunnerPinId, { id: string; name: string; group: "runner" | "guard" }> = {
  V12_V4: { id: "v12-v4", name: "V12 V4", group: "runner" },
  PENGU_V8: { id: "pengu", name: "PENGU", group: "runner" },
  QUALITY102_CAUSAL_V1: { id: "q102", name: "Q102", group: "runner" },
  V52: { id: "v52", name: "V52", group: "runner" },
  FET_BRK48_RESIDUAL: { id: "fet", name: "FET", group: "runner" },
  HYPE_TREND_LONG: { id: "hype", name: "HYPE", group: "runner" },
  IDLE_PRIORITY_SHORT: { id: "idle", name: "Idle", group: "runner" },
  SHARED_CRYPTO_RISK: { id: "shared-risk", name: "Shared Risk", group: "guard" },
  MARGIN_GUARD: { id: "margin-guard", name: "Margin Guard", group: "guard" },
};

type RunnerState = "RUNNING" | "FAILED" | "INACTIVE" | "UNKNOWN";

function parseProperties(stdout: string) {
  return Object.fromEntries(stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function timestamp(raw: Record<string, unknown>) {
  for (const key of ["tickCompletedAt", "updatedAt", "lastTickAt", "heartbeatAt", "checkedAt"]) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function runtimeSha(raw: Record<string, unknown>) {
  for (const key of ["runtimeSha", "runtimeCommitSha", "releaseSha", "expectedSha"]) {
    const value = typeof raw[key] === "string" ? String(raw[key]).trim().toLowerCase() : "";
    if (value) return value;
  }
  return undefined;
}

async function exactReleaseMarker(pin: RunnerPin) {
  const marker = pin.releaseRoot + "/.disdex-release-sha";
  const st = await lstat(marker);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("RELEASE_MARKER_UNTRUSTED");
  const value = (await readFile(marker, "utf8")).trim().toLowerCase();
  if (value !== pin.sha) throw new Error("RELEASE_MARKER_SHA_MISMATCH");
}

async function readEvidence(pin: RunnerPin) {
  const path = pin.evidenceMode === "tick-v1" ? pin.tickPath : pin.healthPath;
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("RUNNER_EVIDENCE_UNTRUSTED");
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("RUNNER_EVIDENCE_INVALID");

  const at = timestamp(raw);
  if (!at) throw new Error("RUNNER_EVIDENCE_TIMESTAMP_MISSING");
  const age = Date.now() - at;
  const maxAge = pin.evidenceMode === "tick-v1" ? MAX_TICK_AGE_MS : MAX_LEGACY_STATE_AGE_MS;
  if (age < -MAX_FUTURE_MS || age > maxAge) throw new Error("RUNNER_EVIDENCE_STALE_OR_FUTURE");

  if (pin.evidenceMode === "tick-v1") {
    if (raw.runtimeSha !== pin.sha || raw.expectedSha !== pin.sha || raw.serviceUnit !== pin.serviceUnit) {
      throw new Error("RUNNER_TICK_IDENTITY_MISMATCH");
    }
    if (Number(raw.tickCompletedAt) !== at) throw new Error("RUNNER_TICK_COMPLETION_MISMATCH");
  } else {
    const statedSha = runtimeSha(raw);
    if (statedSha && statedSha !== pin.sha) throw new Error("RUNNER_LEGACY_STATE_SHA_MISMATCH");
  }
  return { path, at, raw };
}

async function inspect(id: RunnerPinId, pin: RunnerPin) {
  const meta = display[id];
  try {
    await exactReleaseMarker(pin);
    const { stdout } = await execute("systemctl", [
      "show", pin.serviceUnit, "--no-pager",
      "--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,MainPID,NRestarts,WorkingDirectory",
    ], { timeout: 5000, maxBuffer: 32768 });
    const props = parseProperties(stdout);
    if (props.LoadState !== "loaded") throw new Error("SERVICE_NOT_LOADED");

    const pid = Number(props.MainPID || 0);
    const active = props.ActiveState === "active" && props.SubState === "running";
    let processCwd: string | null = null;
    if (active) {
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("ACTIVE_SERVICE_PID_INVALID");
      processCwd = await readlink("/proc/" + pid + "/cwd");
      if (processCwd !== pin.releaseRoot) throw new Error("ACTIVE_SERVICE_CWD_MISMATCH");
      if (props.WorkingDirectory && props.WorkingDirectory !== pin.releaseRoot) {
        throw new Error("SERVICE_WORKING_DIRECTORY_MISMATCH");
      }
    }

    let evidence;
    try {
      evidence = await readEvidence(pin);
    } catch (error) {
      evidence = { path: pin.evidenceMode === "tick-v1" ? pin.tickPath : pin.healthPath, at: undefined, raw: undefined, error };
    }

    const state: RunnerState = props.ActiveState === "failed" || (props.Result && !["success", ""].includes(props.Result))
      ? "FAILED"
      : active
        ? evidence.error ? "UNKNOWN" : "RUNNING"
        : props.ActiveState === "inactive" || props.ActiveState === "deactivating"
          ? "INACTIVE"
          : "UNKNOWN";

    return {
      id: meta.id, name: meta.name, group: meta.group, state,
      unit: pin.serviceUnit, runtimeSha: pin.sha, shaSource: "RUNNER_PIN_MANIFEST",
      evidenceMode: pin.evidenceMode, healthPath: pin.healthPath, tickPath: pin.tickPath,
      evidencePath: evidence.path, lastTickAt: evidence.at ?? null,
      evidenceError: evidence.error instanceof Error ? evidence.error.message : evidence.error ? "RUNNER_EVIDENCE_INVALID" : null,
      activeState: props.ActiveState || "unknown", subState: props.SubState || "unknown",
      result: props.Result || "unknown",
      exitCode: Number.isFinite(Number(props.ExecMainStatus)) ? Number(props.ExecMainStatus) : null,
      pid: pid > 0 ? pid : null, processCwd,
      restarts: Number(props.NRestarts) || 0,
    };
  } catch (error) {
    return {
      id: meta.id, name: meta.name, group: meta.group, state: "UNKNOWN" as RunnerState,
      unit: pin.serviceUnit, runtimeSha: pin.sha, shaSource: "RUNNER_PIN_MANIFEST",
      evidenceMode: pin.evidenceMode, healthPath: pin.healthPath, tickPath: pin.tickPath,
      activeState: "unknown", subState: "unknown",
      result: error instanceof Error ? error.message : "RUNNER_IDENTITY_UNAVAILABLE",
      exitCode: null, pid: null, processCwd: null, restarts: 0,
    };
  }
}

export async function GET(req: NextRequest) {
  // Authentication is hardened separately; this route no longer infers runner identity
  // from the common release even when the caller is authenticated.
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, error: "Authentication required" }, { status: 401 });
  }
  try {
    const currentSha = (await readFile(CURRENT_MARKER, "utf8")).trim();
    if (!SHA_RE.test(currentSha)) throw new Error("CURRENT_RELEASE_MARKER_INVALID");
    const manifest = await loadRunnerPinManifest(RUNNER_PIN_MANIFEST);
    const units = await Promise.all(
      (Object.keys(manifest.runners) as RunnerPinId[]).map((id) => inspect(id, manifest.runners[id])),
    );
    return NextResponse.json({
      ok: true, readOnly: true, tradingMutation: 0, source: "VPS_RUNNER_PIN_MANIFEST",
      checkedAt: new Date().toISOString(), releaseSha: currentSha,
      operatorTarget: manifest.operatorTarget, manifestSchema: manifest.schema, units,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      ok: false, readOnly: true, tradingMutation: 0, source: "VPS_RUNNER_PIN_MANIFEST",
      error: error instanceof Error ? error.message : "Runner identity could not be resolved.",
    }, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
