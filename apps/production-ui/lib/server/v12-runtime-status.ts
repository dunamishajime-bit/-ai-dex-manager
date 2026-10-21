import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isV12V4Heartbeat, loadV12V4LiveSource } from "./v12-v4-live-source";

type Json = Record<string, unknown>;
type RuntimeStatus = "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";
const MAX_BYTES = 256 * 1024;
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // Existing V12 state/watchdog contract.
const MAX_HEARTBEAT_AGE_MS = 3 * 60 * 1000; // Health timer runs every minute plus <=5s jitter.
const SHA = /^[0-9a-f]{40}$/;

export type V12RuntimeBadgeInput = {
  now: number;
  configured: boolean;
  expectedReleaseSha?: string;
  currentReleaseSha?: string;
  state: unknown;
  heartbeat: unknown;
  sharedKill: unknown;
};
function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}
function fresh(value: unknown, now: number, maxAgeMs = MAX_AGE_MS) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && now - value >= 0 && now - value <= maxAgeMs;
}
export function evaluateV12RuntimeBadge(input: V12RuntimeBadgeInput): { status: RuntimeStatus; updatedAt?: number; reason: string } {
  const state = object(input.state), heartbeat = object(input.heartbeat), kill = object(input.sharedKill);
  const updatedAt = typeof state?.updatedAt === "number" ? state.updatedAt : undefined;
  const fail = (status: RuntimeStatus, reason: string) => ({ status, updatedAt, reason });
  if (!input.configured || !state) return fail("UNAVAILABLE", "V12 runner state is unavailable.");
  if (!fresh(updatedAt, input.now)) return fail("STALE", "V12 state timestamp is missing, stale or future-dated.");
  const expected = input.expectedReleaseSha ?? "";
  if (!SHA.test(expected) || input.currentReleaseSha !== expected) return fail("UNCONFIRMED", "Current release marker is unavailable or differs from the runtime contract.");
  if (state.strategyId !== "V12_X1.00_ALL" || state.mode !== "LIVE" || state.runtimeCommitSha !== expected) return fail("UNCONFIRMED", "V12 state mode/strategy/runtime SHA does not match the current release.");
  if (!heartbeat) return fail("UNCONFIRMED", "V12 service heartbeat is unavailable.");
  if (!fresh(heartbeat.heartbeatAt, input.now, MAX_HEARTBEAT_AGE_MS) || !fresh(heartbeat.lastTickAt, input.now)) return fail("STALE", "V12 service heartbeat or last tick is missing, stale or future-dated.");
  if (heartbeat.schema !== "disdex-runner-heartbeat/v1" || heartbeat.runnerId !== "V12_X1_ALL"
    || heartbeat.runtimeSha !== expected || heartbeat.expectedSha !== expected
    || heartbeat.serviceUnit !== "disdex-v12-x1-all@" + expected + ".service") return fail("UNCONFIRMED", "V12 heartbeat service identity does not match the current release.");
  if (heartbeat.mode !== "LIVE" || heartbeat.liveEnabled !== true || heartbeat.safetyState !== "HEALTHY"
    || typeof heartbeat.mainPid !== "number" || !Number.isInteger(heartbeat.mainPid) || heartbeat.mainPid <= 0) return fail("UNCONFIRMED", "V12 service is not verified active and healthy: " + String(heartbeat.healthReason || heartbeat.safetyState || "UNKNOWN"));
  if (state.manualReview || object(state.killSwitch)?.active === true) return fail("UNCONFIRMED", "V12 state has manual review or an active embedded Kill Switch.");
  if (typeof kill?.active !== "boolean") return fail("UNCONFIRMED", "Shared Kill Switch is unavailable or invalid; inactive is not verified.");
  if (kill.active) return fail("UNCONFIRMED", "Shared Kill Switch is active: " + String(kill.action || "BLOCKED"));
  return { status: "LIVE", updatedAt, reason: "Current release, V12 state and healthy service heartbeat match; shared Kill Switch inactive is verified. This badge does not certify V4 order authority." };
}

export function evaluateV12V4RuntimeBadge(input: {
  now: number;
  expectedReleaseSha?: string;
  heartbeat: unknown;
  decision: unknown;
  sharedKill: unknown;
}): { status: RuntimeStatus; updatedAt?: number; reason: string } {
  const heartbeat = object(input.heartbeat);
  const decision = object(input.decision);
  const kill = object(input.sharedKill);
  const updatedAt = typeof heartbeat?.heartbeatAt === "number" ? heartbeat.heartbeatAt : undefined;
  const fail = (status: RuntimeStatus, reason: string) => ({ status, updatedAt, reason });
  if (!heartbeat || !isV12V4Heartbeat(heartbeat)) return fail("UNAVAILABLE", "V12 V4 heartbeat is unavailable.");
  if (!fresh(updatedAt, input.now, MAX_HEARTBEAT_AGE_MS)) return fail("STALE", "V12 V4 heartbeat is missing, stale or future-dated.");
  const runtimeSha = typeof heartbeat.runtimeSha === "string" ? heartbeat.runtimeSha.trim() : "";
  const declaredSha = typeof heartbeat.expectedSha === "string" ? heartbeat.expectedSha.trim() : runtimeSha;
  const expectedSha = input.expectedReleaseSha || declaredSha;
  if (!SHA.test(runtimeSha) || !SHA.test(declaredSha) || runtimeSha !== declaredSha || (input.expectedReleaseSha && runtimeSha !== input.expectedReleaseSha)) {
    return fail("UNCONFIRMED", "V12 V4 runtime SHA does not match its immutable heartbeat contract.");
  }
  if (heartbeat.mode !== "LIVE" || heartbeat.liveEnabled !== true || heartbeat.safetyState !== "HEALTHY"
    || typeof heartbeat.mainPid !== "number" || !Number.isInteger(heartbeat.mainPid) || heartbeat.mainPid <= 0) {
    return fail("UNCONFIRMED", "V12 V4 service is not verified active and healthy: " + String(heartbeat.healthReason || heartbeat.safetyState || "UNKNOWN"));
  }
  if (decision) {
    const decisionSha = typeof decision.runtimeSha === "string" ? decision.runtimeSha.trim() : runtimeSha;
    const updatedDecisionAt = typeof decision.updatedAt === "number" ? decision.updatedAt : undefined;
    if (decisionSha !== expectedSha || (updatedDecisionAt !== undefined && !fresh(updatedDecisionAt, input.now, MAX_AGE_MS))) {
      return fail("UNCONFIRMED", "V12 V4 realtime decision does not match the healthy runtime SHA or freshness contract.");
    }
    if (decision.tradingMutation !== undefined && Number(decision.tradingMutation) !== 0) {
      return fail("UNCONFIRMED", "V12 V4 realtime decision reports a trading mutation.");
    }
  }
  if (typeof kill?.active !== "boolean") return fail("UNCONFIRMED", "Shared Kill Switch is unavailable or invalid; inactive is not verified.");
  if (kill.active) return fail("UNCONFIRMED", "Shared Kill Switch is active: " + String(kill.action || "BLOCKED"));
  return { status: "LIVE", updatedAt, reason: "V12 V4 heartbeat, realtime decision, immutable runtime SHA and shared Kill Switch are verified. This is read-only HP observability." };
}
async function json(path: string): Promise<unknown> {
  if (!isAbsolute(path)) return null;
  try {
    const value = await readFile(path, "utf8");
    return Buffer.byteLength(value, "utf8") <= MAX_BYTES ? JSON.parse(value) : null;
  } catch { return null; }
}
export async function loadV12RuntimeBadge(options: {
  configured: boolean; state: unknown; expectedReleaseSha?: string; now?: number;
  markerPath?: string; heartbeatPath?: string; killSwitchPath?: string;
}) {
  const markerPath = options.markerPath ?? "/home/deploy/disdex-trading/current/.disdex-release-sha";
  const [currentReleaseSha, heartbeat, sharedKill, v12V4] = await Promise.all([
    isAbsolute(markerPath) ? readFile(markerPath, "utf8").then(value => value.trim()).catch(() => "") : Promise.resolve(""),
    json(options.heartbeatPath ?? "/var/lib/disdex/runner-health/heartbeats/v12-x1-all.json"),
    json(options.killSwitchPath ?? process.env.DISDEX_SHARED_KILL_SWITCH_PATH ?? "/var/lib/disdex/shared/kill-switch.json"),
    loadV12V4LiveSource({ heartbeatPath: options.heartbeatPath }).catch(() => null),
  ]);
  if (v12V4?.heartbeat && isV12V4Heartbeat(v12V4.heartbeat)) {
    return evaluateV12V4RuntimeBadge({
      now: options.now ?? Date.now(),
      expectedReleaseSha: options.expectedReleaseSha || v12V4.expectedSha,
      heartbeat: v12V4.heartbeat,
      decision: v12V4.decision,
      sharedKill,
    });
  }
  return evaluateV12RuntimeBadge({ ...options, now: options.now ?? Date.now(), currentReleaseSha, heartbeat, sharedKill });
}
