import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA_RE = /^[a-f0-9]{40}$/i;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type IdleStatus = "LIVE" | "STALE" | "UNAVAILABLE";
type SystemdObservation = { active: boolean; runtimeSha?: string };
export type IdleRuntimeStatus = { status: IdleStatus; serviceActive: boolean; serviceShaMatchesExpected: boolean; serviceRuntimeSha?: string; stateAvailable: boolean; runtimeSha?: string; expectedReleaseSha: string; updatedAt?: number; reason: string; errors: string[] };
export type IdleRuntimeObservabilityOptions = { now?: number; expectedSha?: string; decisionPath?: string; detailsPath?: string; readSystemd?: () => Promise<boolean | string | SystemdObservation> };

function object(value: unknown): JsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function timestamp(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
async function readJson(path: string) { try { return object(JSON.parse(await readFile(path, "utf8"))); } catch { return null; } }
async function systemdState(expectedSha?: string): Promise<SystemdObservation> {
  try {
    const { stdout } = await execFileAsync("systemctl", ["list-units", "--type=service", "--state=running", "--no-legend", "--no-pager", "disdex-idle-priority-short@*.service"], { timeout: 2500 });
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/disdex-idle-priority-short@([a-f0-9]{40})\.service\s+loaded\s+active\s+running\b/i);
      if (match && (!expectedSha || match[1].toLowerCase() === expectedSha)) return { active: true, runtimeSha: match[1].toLowerCase() };
    }
    return { active: false };
  } catch { return { active: false }; }
}

export async function loadIdleRuntimeObservability(options: IdleRuntimeObservabilityOptions = {}): Promise<IdleRuntimeStatus> {
  const now = options.now ?? Date.now();
  const expected = String(options.expectedSha || "").trim().toLowerCase();
  const expectedReleaseSha = SHA_RE.test(expected) ? expected : "";
  const decision = await readJson(options.decisionPath || process.env.DISDEX_IDLE_PRIORITY_DECISION_PATH || "/var/lib/disdex/idle-priority/decision.json");
  const details = await readJson(options.detailsPath || process.env.DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH || "/var/lib/disdex/idle-priority/decision-details.json");
  const stateAvailable = Boolean(decision || details);
  const rawSha = details?.runtimeSha ?? decision?.runtimeSha;
  const runtimeSha = typeof rawSha === "string" && rawSha.trim() ? rawSha.trim().toLowerCase() : undefined;
  const updatedAt = timestamp(details?.updatedAt ?? decision?.updatedAt);
  const fresh = updatedAt !== undefined && now - updatedAt >= -60_000 && now - updatedAt <= STALE_AFTER_MS;
  const serviceResult = await (options.readSystemd || (() => systemdState(expectedReleaseSha)))();
  const serviceRuntimeSha = typeof serviceResult === "object" && serviceResult !== null ? serviceResult.runtimeSha?.trim().toLowerCase() : undefined;
  const rawServiceActive = serviceResult === true || serviceResult === "active" || (typeof serviceResult === "object" && serviceResult !== null && serviceResult.active === true);
  const serviceShaMatchesExpected = !expectedReleaseSha ? true : serviceRuntimeSha === expectedReleaseSha;
  const serviceActive = rawServiceActive && serviceShaMatchesExpected;
  const errors: string[] = [];
  if (!stateAvailable) errors.push("IDLE_STATE_UNAVAILABLE");
  if (!runtimeSha || !SHA_RE.test(runtimeSha) || (expectedReleaseSha && runtimeSha !== expectedReleaseSha)) errors.push("IDLE_RUNTIME_SHA_MISMATCH");
  if (!fresh) errors.push("IDLE_STATE_STALE");
  if (!rawServiceActive) errors.push("IDLE_SERVICE_INACTIVE");
  else if (!serviceShaMatchesExpected) errors.push("IDLE_SERVICE_SHA_MISMATCH");
  const status: IdleStatus = stateAvailable && serviceActive && fresh && Boolean(runtimeSha) && (!expectedReleaseSha || runtimeSha === expectedReleaseSha) ? "LIVE" : stateAvailable && !fresh ? "STALE" : "UNAVAILABLE";
  return { status, serviceActive, serviceShaMatchesExpected, ...(serviceRuntimeSha ? { serviceRuntimeSha } : {}), stateAvailable, ...(runtimeSha ? { runtimeSha } : {}), expectedReleaseSha, ...(updatedAt === undefined ? {} : { updatedAt }), reason: status === "LIVE" ? "Idle decision state・runtime SHA・鮮度・expected SHAのsystemd activeを確認しました。" : `Idle runnerはLIVE確認条件未達です。${errors.join(" / ")}`, errors };
}
