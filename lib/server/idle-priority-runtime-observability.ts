import { lstat, readFile } from "node:fs/promises";

const CURRENT_SHA_PATH = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const HEARTBEAT_PATH = "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json";
const STATE_PATH = "/var/lib/disdex/idle-priority/state.json";
const KILL_SWITCH_PATH = "/var/lib/disdex/shared/kill-switch.json";
const SHA = /^[0-9a-f]{40}$/i;
const MAX_JSON_BYTES = 512 * 1024;
const STALE_AFTER_MS = 20 * 60_000;
type Obj = Record<string, unknown>;

export type IdlePriorityRuntimeStatus = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  status: "LIVE" | "STALE" | "BLOCKED" | "UNAVAILABLE";
  reason: string;
  releaseSha: string;
  heartbeat: {
    available: boolean;
    runtimeSha?: string;
    expectedSha?: string;
    serviceUnit?: string;
    safetyState?: string;
    mode?: string;
    liveEnabled?: boolean;
    heartbeatAt?: number;
    lastTickAt?: number;
    mainPid?: number;
    nRestarts?: number;
    serviceResult?: string;
  };
  state: {
    available: boolean;
    schema?: string;
    runtimeSha?: string;
    updatedAt?: number;
    manualReview?: string | null;
    pending?: {
      action?: string;
      phase?: string;
      symbol?: string;
      route?: string;
      reason?: string;
      updatedAt?: number;
    } | null;
    lastDecision?: {
      decisionTs?: number;
      symbol?: string;
      route?: string;
      accepted?: boolean;
      reason?: string;
    };
    positions: Array<{
      symbol?: string;
      route?: string;
      side?: string;
      entryTs?: number;
      exitTs?: number;
      entryPrice?: number;
      quantity?: number;
      gross?: number;
      holdHours?: number;
      stopPrice?: number;
      takeProfitPrice?: number;
      protectionVerified?: boolean;
    }>;
  };
  sharedKillSwitchActive: boolean | null;
  checks: Array<{ key: string; pass: boolean | null; detail: string }>;
  errors: string[];
};

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
}
function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function bool(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}
async function safeJson(path: string): Promise<Obj | null> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_JSON_BYTES) return null;
    return obj(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

export async function loadIdlePriorityRuntimeObservability(now = Date.now()): Promise<IdlePriorityRuntimeStatus> {
  const capturedAt = new Date(now).toISOString();
  const errors: string[] = [];
  let releaseSha = "";
  try {
    releaseSha = (await readFile(CURRENT_SHA_PATH, "utf8")).trim().toLowerCase();
  } catch {
    errors.push("CURRENT_RELEASE_SHA_UNAVAILABLE");
  }
  if (!SHA.test(releaseSha)) errors.push("CURRENT_RELEASE_SHA_INVALID");

  const [heartbeat, state, kill] = await Promise.all([
    safeJson(HEARTBEAT_PATH),
    safeJson(STATE_PATH),
    safeJson(KILL_SWITCH_PATH),
  ]);

  const hbRuntimeSha = str(heartbeat?.runtimeSha)?.toLowerCase();
  const hbExpectedSha = str(heartbeat?.expectedSha)?.toLowerCase();
  const serviceUnit = str(heartbeat?.serviceUnit);
  const heartbeatAt = num(heartbeat?.heartbeatAt);
  const lastTickAt = num(heartbeat?.lastTickAt);
  const heartbeatFresh = heartbeatAt !== undefined && lastTickAt !== undefined
    && heartbeatAt <= now + 60_000 && lastTickAt <= now + 60_000
    && now - heartbeatAt <= STALE_AFTER_MS && now - lastTickAt <= STALE_AFTER_MS;
  const heartbeatShaOk = Boolean(releaseSha && hbRuntimeSha === releaseSha && hbExpectedSha === releaseSha);
  const serviceUnitOk = Boolean(releaseSha && serviceUnit === `disdex-idle-priority-short@${releaseSha}.service`);
  const heartbeatSafetyOk = heartbeat?.safetyState === "HEALTHY"
    && String(heartbeat?.mode || "").toUpperCase() === "LIVE"
    && heartbeat?.liveEnabled === true;

  const stateRuntimeSha = str(state?.runtimeSha)?.toLowerCase();
  const stateUpdatedAt = num(state?.updatedAt);
  const stateFresh = stateUpdatedAt !== undefined && stateUpdatedAt <= now + 60_000 && now - stateUpdatedAt <= STALE_AFTER_MS;
  const stateIdentityOk = state?.schema === "disdex-idle-priority-state/v2" && Boolean(releaseSha && stateRuntimeSha === releaseSha);
  const manualReview = typeof state?.manualReview === "string" ? state.manualReview : state?.manualReview === null ? null : undefined;
  const pendingObj = obj(state?.pending);
  const positions = Array.isArray(state?.positions) ? state.positions.map(obj).filter((row): row is Obj => row !== null) : [];
  const lastDecision = obj(state?.lastDecision);
  const killActive = bool(kill?.active) ?? null;

  const checks = [
    { key: "release_sha", pass: SHA.test(releaseSha), detail: releaseSha || "未取得" },
    { key: "heartbeat_sha", pass: heartbeat ? heartbeatShaOk : null, detail: heartbeat ? `${hbRuntimeSha || "?"} / expected ${hbExpectedSha || "?"}` : "heartbeat未取得" },
    { key: "service_unit", pass: heartbeat ? serviceUnitOk : null, detail: serviceUnit || "未取得" },
    { key: "heartbeat_fresh", pass: heartbeat ? heartbeatFresh : null, detail: heartbeatAt ? new Date(heartbeatAt).toISOString() : "未取得" },
    { key: "heartbeat_safety", pass: heartbeat ? heartbeatSafetyOk : null, detail: `${heartbeat?.safetyState || "?"} / ${heartbeat?.mode || "?"}` },
    { key: "state_identity", pass: state ? stateIdentityOk : null, detail: `${state?.schema || "?"} / ${stateRuntimeSha || "?"}` },
    { key: "state_fresh", pass: state ? stateFresh : null, detail: stateUpdatedAt ? new Date(stateUpdatedAt).toISOString() : "未取得" },
    { key: "manual_review", pass: state ? manualReview == null : null, detail: manualReview || "なし" },
    { key: "shared_kill", pass: killActive === null ? null : !killActive, detail: killActive === null ? "未取得" : killActive ? "ON" : "OFF" },
  ];

  if (!heartbeat) errors.push("IDLE_HEARTBEAT_UNAVAILABLE");
  if (!state) errors.push("IDLE_STATE_UNAVAILABLE");
  if (heartbeat && !heartbeatShaOk) errors.push("IDLE_HEARTBEAT_SHA_MISMATCH");
  if (heartbeat && !serviceUnitOk) errors.push("IDLE_SERVICE_UNIT_MISMATCH");
  if (heartbeat && !heartbeatFresh) errors.push("IDLE_HEARTBEAT_STALE");
  if (heartbeat && !heartbeatSafetyOk) errors.push("IDLE_HEARTBEAT_NOT_HEALTHY");
  if (state && !stateIdentityOk) errors.push("IDLE_STATE_IDENTITY_MISMATCH");
  if (state && !stateFresh) errors.push("IDLE_STATE_STALE");
  if (manualReview) errors.push("IDLE_MANUAL_REVIEW_ACTIVE");
  if (killActive === true) errors.push("SHARED_KILL_SWITCH_ACTIVE");

  const status: IdlePriorityRuntimeStatus["status"] =
    !heartbeat || !state || !SHA.test(releaseSha) ? "UNAVAILABLE"
      : !heartbeatFresh || !stateFresh ? "STALE"
        : errors.length ? "BLOCKED"
          : "LIVE";

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt,
    status,
    reason: status === "LIVE"
      ? "Idle Priorityのcurrent SHA、heartbeat、state、Kill Switchをread-onlyで照合し、LIVE条件を確認しました。"
      : `Idle PriorityはLIVE確認条件未達です。 ${errors.join(" / ") || "観測不足"}`,
    releaseSha,
    heartbeat: {
      available: Boolean(heartbeat),
      runtimeSha: hbRuntimeSha,
      expectedSha: hbExpectedSha,
      serviceUnit,
      safetyState: str(heartbeat?.safetyState),
      mode: str(heartbeat?.mode),
      liveEnabled: bool(heartbeat?.liveEnabled),
      heartbeatAt,
      lastTickAt,
      mainPid: num(heartbeat?.mainPid),
      nRestarts: num(heartbeat?.nRestarts),
      serviceResult: str(heartbeat?.serviceResult),
    },
    state: {
      available: Boolean(state),
      schema: str(state?.schema),
      runtimeSha: stateRuntimeSha,
      updatedAt: stateUpdatedAt,
      manualReview: manualReview ?? null,
      pending: pendingObj ? {
        action: str(pendingObj.action),
        phase: str(pendingObj.phase),
        symbol: str(pendingObj.symbol),
        route: str(pendingObj.route),
        reason: str(pendingObj.reason),
        updatedAt: num(pendingObj.updatedAt),
      } : null,
      lastDecision: lastDecision ? {
        decisionTs: num(lastDecision.decisionTs),
        symbol: str(lastDecision.symbol),
        route: str(lastDecision.route),
        accepted: bool(lastDecision.accepted),
        reason: str(lastDecision.reason),
      } : undefined,
      positions: positions.map((row) => ({
        symbol: str(row.symbol),
        route: str(row.route),
        side: str(row.side),
        entryTs: num(row.entryTs),
        exitTs: num(row.exitTs),
        entryPrice: num(row.entryPrice),
        quantity: num(row.quantity),
        gross: num(row.gross),
        holdHours: num(row.holdHours),
        stopPrice: num(row.stopPrice),
        takeProfitPrice: num(row.takeProfitPrice),
        protectionVerified: bool(row.protectionVerified),
      })),
    },
    sharedKillSwitchActive: killActive,
    checks,
    errors,
  };
}
