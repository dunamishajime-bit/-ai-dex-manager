import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TICK_PATH = "/var/lib/disdex/runner-health/ticks/hype-trend-long.json";
const STATE_PATH = "/var/lib/disdex/hype-zec-long/runner.json";
const LEGACY_HEARTBEAT_PATH = "/var/lib/disdex/runner-health/heartbeats/hype-trend-long.json";
const MAX_TICK_AGE_MS = 35 * 60_000; // The runner makes a natural decision every ~15 min.
const FUTURE_SKEW_MS = 60_000;
const SHA = /^[a-f0-9]{40}$/;
const RELEASES = "/home/deploy/disdex-trading/releases/";

type Json = Record<string, unknown>;
type Service = { activeState: string; subState: string; mainPid: number; workingDirectory: string; processCwd: string };
type Observation = {
  runtimeSha?: string;
  expectedSha?: string;
  mode?: string;
  safetyState?: string;
  liveEnabled?: boolean;
  mainPid?: number;
  updatedAt?: number;
  healthReason?: string;
  matchesCurrent: boolean;
  error?: string;
};

function record(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}
function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read-only display classification. The v1 pin/tick records are NEVER an
 * order-enable certificate. In particular, even a valid LIVE-mode process is
 * only "running / order permission unverified" until strict v2 evidence exists.
 */
export function assessPinnedHypeTick(
  expectedSha: string,
  tick: unknown,
  runner: unknown,
  service: Service,
  releaseMarker: string,
  oldHeartbeat: unknown,
  now: number,
): Observation {
  const t = record(tick), state = record(runner), hb = record(oldHeartbeat);
  const unit = "disdex-hype-long@" + expectedSha + ".service";
  const root = RELEASES + expectedSha;
  const tickAt = finiteTimestamp(t?.tickCompletedAt);
  const startAt = finiteTimestamp(t?.tickStartedAt);
  const updatedAt = finiteTimestamp(state?.updatedAt);
  const ageMs = tickAt === null ? null : now - tickAt;
  const observed: Observation = {
    runtimeSha: typeof t?.runtimeSha === "string" ? t.runtimeSha : undefined,
    expectedSha,
    mode: typeof state?.mode === "string" ? state.mode : undefined,
    safetyState: "UNVERIFIED",
    liveEnabled: false,
    mainPid: service.mainPid > 0 ? service.mainPid : undefined,
    updatedAt: tickAt ?? undefined,
    matchesCurrent: false,
  };
  const deny = (code: string): Observation => ({
    ...observed, safetyState: "UNVERIFIED", healthReason: code, error: code,
  });

  if (!SHA.test(expectedSha) || releaseMarker !== expectedSha) return deny("HYPE_PIN_RELEASE_MARKER_MISMATCH");
  if (!t || t.schema !== "disdex-runner-tick/v1") return deny("HYPE_PIN_TICK_UNAVAILABLE");
  if (t.runtimeSha !== expectedSha || t.expectedSha !== expectedSha ||
    t.serviceUnit !== unit || t.workingDirectory !== root || t.runnerId !== "HYPE_TREND_LONG") {
    return deny("HYPE_PIN_TICK_IDENTITY_MISMATCH");
  }
  if (!state || state.schema !== "disdex-hype-zec-long/v1" ||
    state.runtimeCommitSha !== expectedSha) return deny("HYPE_PIN_STATE_IDENTITY_MISMATCH");
  // A pinned service that is cleanly stopped is not "data unavailable".
  // Preserve its exact manual-review reason. Do not claim it is live, even
  // when its last tick and signed release markers match the expected SHA.
  if (service.activeState === "inactive" && service.subState === "dead" &&
    service.mainPid === 0 && service.workingDirectory === root) {
    const manualReview = typeof state.manualReview === "string" ? state.manualReview.trim() : "";
    return {
      ...observed,
      safetyState: "STOPPED",
      liveEnabled: false,
      matchesCurrent: false,
      mainPid: 0,
      healthReason: manualReview
        ? `HYPE Runner停止・手動確認: ${manualReview}。新規発注は未許可。実行SHAはpin/台帳と照合済み。`
        : "HYPE Runner停止中（systemd inactive/dead）。新規発注は未許可。",
      error: manualReview ? "HYPE_PIN_SERVICE_STOPPED_MANUAL_REVIEW" : "HYPE_PIN_SERVICE_STOPPED",
    };
  }
  if (service.activeState !== "active" || service.subState !== "running" ||
    !Number.isSafeInteger(service.mainPid) || service.mainPid <= 0 ||
    service.workingDirectory !== root || service.processCwd !== root ||
    t.mainPid !== service.mainPid) return deny("HYPE_PIN_PROCESS_IDENTITY_MISMATCH");
  if (tickAt === null || startAt === null || tickAt < startAt ||
    updatedAt === null || Math.abs(updatedAt - tickAt) > 120_000 ||
    ageMs === null || ageMs < -FUTURE_SKEW_MS) {
    return deny("HYPE_PIN_TICK_TIMESTAMP_INVALID");
  }
  if (ageMs > MAX_TICK_AGE_MS) {
    return {
      ...observed, safetyState: "STALE", healthReason: "HYPE判定tickが更新遅延しています（発注許可未確認）。",
      error: "HYPE_PIN_TICK_STALE",
    };
  }
  const legacyOtherSha = !!hb && hb.runtimeSha !== expectedSha;
  const currentBlocked = !!hb && hb.runtimeSha === expectedSha && hb.safetyState === "BLOCKED";
  const pending = !!state.pending || (typeof state.manualReview === "string" && state.manualReview.trim().length > 0);
  const note = [
    "新SHAのsystemd/PID/作業ディレクトリ・Runner state・判定tickを照合済み。",
    t.newOrdersAllowed === false ? "tick上の新規発注許可はfalse。" : "tickだけでは新規発注許可を認証できません。",
    legacyOtherSha ? "旧heartbeatは別SHAのため発注認証に利用不可。" : "",
    currentBlocked ? "現行heartbeatにBLOCKEDが記録されています。" : "",
    pending ? "Pending/手動確認が残っています。" : "",
  ].filter(Boolean).join(" ");
  return {
    ...observed,
    runtimeSha: expectedSha,
    mode: typeof state.mode === "string" ? state.mode : undefined,
    safetyState: currentBlocked ? "BLOCKED" : pending ? "REVIEW_REQUIRED" : "UNVERIFIED",
    matchesCurrent: true,
    healthReason: note,
  };
}

function properties(stdout: string): Record<string, string> {
  return Object.fromEntries(stdout.split(/\r?\n/).filter(line => line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}
async function readObject(path: string, maxBytes: number): Promise<Json> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes ||
    (stat.mode & 0o022) !== 0) throw new Error("HYPE_PIN_EVIDENCE_UNTRUSTED_FILE");
  const parsed = record(JSON.parse(await readFile(path, "utf8")));
  if (!parsed) throw new Error("HYPE_PIN_EVIDENCE_INVALID");
  return parsed;
}

export async function loadPinnedHypeTickObservation(expectedSha: string, now = Date.now()): Promise<Observation> {
  const unit = "disdex-hype-long@" + expectedSha + ".service";
  const releaseRoot = RELEASES + expectedSha;
  const [tick, state, releaseMarker, details, oldHeartbeat] = await Promise.all([
    readObject(TICK_PATH, 64 * 1024),
    readObject(STATE_PATH, 400 * 1024),
    readFile(releaseRoot + "/.disdex-release-sha", "utf8"),
    execFileAsync("systemctl", ["show", unit, "--no-pager",
      "--property=ActiveState,SubState,MainPID,WorkingDirectory"], { timeout: 5000, maxBuffer: 8192 }),
    readObject(LEGACY_HEARTBEAT_PATH, 64 * 1024).catch(() => null),
  ]);
  const p = properties(details.stdout);
  const mainPid = Number(p.MainPID ?? 0);
  const processCwd = Number.isSafeInteger(mainPid) && mainPid > 0
    ? await readlink("/proc/" + mainPid + "/cwd").catch(() => "") : "";
  return assessPinnedHypeTick(expectedSha, tick, state, {
    activeState: p.ActiveState ?? "", subState: p.SubState ?? "",
    mainPid, workingDirectory: p.WorkingDirectory ?? "", processCwd,
  }, releaseMarker.trim(), oldHeartbeat, now);
}
