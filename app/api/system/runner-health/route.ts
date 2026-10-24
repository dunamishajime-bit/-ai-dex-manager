import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execute = promisify(execFile);
const marker = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const runners = [
  { id: "v12-v4", name: "V12 V4", service: "disdex-v12-v4", group: "runner" },
  { id: "pengu", name: "PENGU", service: "disdex-pengu-dual-ls-v2", group: "runner" },
  { id: "q102", name: "Q102", service: "disdex-quality102-causal-v1", group: "runner" },
  { id: "fet", name: "FET", service: "disdex-fet-brk48", group: "runner" },
  { id: "hype", name: "HYPE", service: "disdex-hype-long", group: "runner" },
  { id: "idle", name: "Idle", service: "disdex-idle-priority-short", group: "runner" },
  { id: "v52", name: "V52", service: "disdex-v52-aster-only", group: "runner" },
  { id: "shared-risk", name: "Shared Risk", service: "disdex-shared-crypto-risk", group: "guard" },
  { id: "margin-guard", name: "Margin Guard", service: "disdex-v12-v52-margin-guard", group: "guard" },
] as const;

type RunnerState = "RUNNING" | "FAILED" | "INACTIVE" | "UNKNOWN";
const SHA_RE = /^[a-f0-9]{40}$/i;
const v4Heartbeat = "/var/lib/disdex/v12-v4/heartbeat.json";

async function resolveSha(item: typeof runners[number], commonSha: string): Promise<{ sha: string; shaSource: string }> {
  // Prefer the actually running unit when an individual runner has been promoted independently.
  try {
    const { stdout } = await execute(
      "systemctl",
      ["list-units", "--all", "--plain", "--no-legend", "--full", item.service + "@*.service"],
      { timeout: 5000, maxBuffer: 32768 },
    );
    const active = stdout.split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length >= 4 && fields[2] === "active" && fields[3] === "running")
      .map((fields) => fields[0])
      .filter((name) => name.startsWith(item.service + "@") && name.endsWith(".service"))
      .map((name) => name.slice(item.service.length + 1, -".service".length))
      .filter((sha) => SHA_RE.test(sha));
    if (active.length === 1) return { sha: active[0], shaSource: "ACTIVE_SYSTEMD_UNIT" };
    if (active.length > 1) throw new Error("MULTIPLE_RUNNING_UNITS");
  } catch (err) {
    if (err instanceof Error && err.message === "MULTIPLE_RUNNING_UNITS") throw err;
    // Fall through to pinned runtime evidence.
  }
  if (item.id === "v12-v4") {
    const hb = JSON.parse(await readFile(v4Heartbeat, "utf8")) as Record<string, unknown>;
    const runtimeSha = typeof hb.runtimeSha === "string" ? hb.runtimeSha : "";
    const expectedSha = typeof hb.expectedSha === "string" ? hb.expectedSha : "";
    if (!SHA_RE.test(runtimeSha) || runtimeSha !== expectedSha) throw new Error("V4_PINNED_SHA_UNVERIFIED");
    return { sha: runtimeSha, shaSource: "V4_HEARTBEAT_RELEASE" };
  }
  return { sha: commonSha, shaSource: "COMMON_RUNTIME_RELEASE" };
}

async function inspect(item: typeof runners[number], commonSha: string) {
  let resolved: { sha: string; shaSource: string };
  try {
    resolved = await resolveSha(item, commonSha);
  } catch {
    return {
      id: item.id, name: item.name, group: item.group, state: "UNKNOWN" as RunnerState,
      unit: null, runtimeSha: null, shaSource: "UNVERIFIED",
      activeState: "unknown", subState: "unknown", result: "CURRENT_SHA_UNVERIFIED",
      exitCode: null, pid: null, restarts: 0,
    };
  }
  const { sha, shaSource } = resolved;
  const unit = item.service + "@" + sha + ".service";
  try {
    const { stdout } = await execute(
      "systemctl",
      ["show", unit, "--no-pager", "--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,MainPID,NRestarts"],
      { timeout: 5000, maxBuffer: 32768 },
    );
    const props = Object.fromEntries(
      stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
    );
    const state: RunnerState = props.LoadState !== "loaded"
      ? "UNKNOWN"
      : props.ActiveState === "failed" || (props.Result && !["success", ""].includes(props.Result))
        ? "FAILED"
        : props.ActiveState === "active" && props.SubState === "running"
          ? "RUNNING"
          : props.ActiveState === "inactive" || props.ActiveState === "deactivating"
            ? "INACTIVE"
            : "UNKNOWN";
    return {
      id: item.id, name: item.name, group: item.group, state, unit, runtimeSha: sha, shaSource,
      activeState: props.ActiveState || "unknown",
      subState: props.SubState || "unknown",
      result: props.Result || "unknown",
      exitCode: Number.isFinite(Number(props.ExecMainStatus)) ? Number(props.ExecMainStatus) : null,
      pid: Number(props.MainPID) || null,
      restarts: Number(props.NRestarts) || 0,
    };
  } catch {
    return {
      id: item.id, name: item.name, group: item.group,
      state: "UNKNOWN" as RunnerState, unit, runtimeSha: sha, shaSource, activeState: "unknown", subState: "unknown",
      result: "STATUS_UNAVAILABLE", exitCode: null, pid: null, restarts: 0,
    };
  }
}

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") {
    return NextResponse.json({ ok: false, readOnly: true, error: "Authentication required" }, { status: 401 });
  }
  try {
    const sha = (await readFile(marker, "utf8")).trim();
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("RELEASE_MARKER_INVALID");
    const units = await Promise.all(runners.map((item) => inspect(item, sha)));
    return NextResponse.json(
      { ok: true, readOnly: true, tradingMutation: 0, source: "VPS_CURRENT_SYSTEMD", checkedAt: new Date().toISOString(), releaseSha: sha, units },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, readOnly: true, tradingMutation: 0, source: "VPS_CURRENT_SYSTEMD", error: "現行リリースの稼働状態を取得できません。" },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
