const SHA = /^[0-9a-f]{40}$/i;
export const IDLE_RUNTIME_HEALTH_MAX_AGE_MS = 3 * 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

type Json = Record<string, unknown>;
type HealthStatus = "LIVE" | "SHADOW" | "STALE" | "BLOCKED" | "UNAVAILABLE" | "UNCONFIRMED";
type OrderPermission = { allowed: boolean; reason: string };
type Protection = { status: "VERIFIED" | "NONE" | "UNVERIFIED"; stopClientOrderId?: string; takeProfitClientOrderId?: string };

export type IdleRunnerHealth = {
  runner: "IDLE_PRIORITY_SHORT" | "IDLE_RESIDUAL_LONG";
  status: HealthStatus;
  runtimeSha?: string;
  stateSha?: string;
  mode?: string;
  updatedAt?: number;
  lastDecision?: { accepted: boolean; reason: string; at?: number };
  deferralReason?: string;
  pending: boolean;
  position: boolean;
  manualReview?: string;
  protection: Protection;
  orderPermission: OrderPermission;
  reason: string;
};

export type IdleRuntimeHealthEnvelope = {
  readOnly: true;
  tradingMutation: 0;
  status: HealthStatus | "DEGRADED";
  core: IdleRunnerHealth;
  residual: IdleRunnerHealth;
};

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function freshTimestamp(value: unknown, now: number): { ok: true; value: number } | { ok: false; reason: string } {
  const timestamp = number(value);
  if (timestamp === undefined || timestamp <= 0) return { ok: false, reason: "TIMESTAMP_INVALID" };
  if (timestamp > now + CLOCK_SKEW_MS) return { ok: false, reason: "TIMESTAMP_FUTURE" };
  if (now - timestamp > IDLE_RUNTIME_HEALTH_MAX_AGE_MS) return { ok: false, reason: "STATE_STALE" };
  return { ok: true, value: timestamp };
}

function protection(value: Json | null): Protection {
  const position = object(value?.position);
  if (!position) return { status: "NONE" };
  const stop = text(position.stopClientOrderId);
  const takeProfit = text(position.takeProfitClientOrderId);
  return stop && takeProfit
    ? { status: "VERIFIED", stopClientOrderId: stop, takeProfitClientOrderId: takeProfit }
    : { status: "UNVERIFIED" };
}

function decision(value: Json | null) {
  const last = object(value?.lastDecision);
  if (!last || typeof last.accepted !== "boolean" || typeof last.reason !== "string") return undefined;
  return { accepted: last.accepted, reason: last.reason, at: number(last.decisionTs) };
}

function healthFailure(
  runner: IdleRunnerHealth["runner"],
  status: HealthStatus,
  reason: string,
  fields: Partial<IdleRunnerHealth> = {},
): IdleRunnerHealth {
  return {
    runner,
    status,
    pending: false,
    position: false,
    protection: { status: "NONE" },
    orderPermission: { allowed: false, reason: `${runner}_ORDER_PERMISSION_BLOCKED:${reason}` },
    reason,
    ...fields,
  };
}

export function evaluateIdleRuntimeHealth(input: {
  now: number;
  expectedSha: string;
  heartbeat: unknown;
  coreState: unknown;
  residualState: unknown;
}): IdleRuntimeHealthEnvelope {
  const expectedSha = input.expectedSha.trim().toLowerCase();
  const heartbeat = object(input.heartbeat);
  const coreState = object(input.coreState);
  const residualState = object(input.residualState);
  const heartbeatAt = heartbeat ? freshTimestamp(heartbeat.heartbeatAt ?? heartbeat.updatedAt, input.now) : { ok: false as const, reason: "HEARTBEAT_UNAVAILABLE" };
  const heartbeatSha = text(heartbeat?.runtimeSha)?.toLowerCase();
  const coreSha = text(coreState?.runtimeSha)?.toLowerCase();
  let core: IdleRunnerHealth;
  if (!SHA.test(expectedSha) || !heartbeat || !coreState) {
    core = healthFailure("IDLE_PRIORITY_SHORT", "UNAVAILABLE", "IDLE_PRIORITY_HEALTH_UNAVAILABLE", { runtimeSha: heartbeatSha, stateSha: coreSha });
  } else if (heartbeatSha !== expectedSha || coreSha !== expectedSha || text(heartbeat.expectedSha)?.toLowerCase() !== expectedSha) {
    core = healthFailure("IDLE_PRIORITY_SHORT", "BLOCKED", "IDLE_PRIORITY_RUNTIME_SHA_MISMATCH", { runtimeSha: heartbeatSha, stateSha: coreSha });
  } else if (!heartbeatAt.ok) {
    core = healthFailure("IDLE_PRIORITY_SHORT", heartbeatAt.reason === "STATE_STALE" ? "STALE" : "UNCONFIRMED", `IDLE_PRIORITY_${heartbeatAt.reason}`, { runtimeSha: heartbeatSha, stateSha: coreSha });
  } else if (text(heartbeat.mode)?.toUpperCase() !== "LIVE") {
    core = healthFailure("IDLE_PRIORITY_SHORT", "SHADOW", "IDLE_PRIORITY_MODE_NOT_LIVE", { runtimeSha: heartbeatSha, stateSha: coreSha, mode: text(heartbeat.mode), updatedAt: heartbeatAt.value });
  } else if (heartbeat.safetyState !== undefined && heartbeat.safetyState !== "HEALTHY") {
    core = healthFailure("IDLE_PRIORITY_SHORT", "UNCONFIRMED", `IDLE_PRIORITY_HEALTH_${String(heartbeat.safetyState)}`, { runtimeSha: heartbeatSha, stateSha: coreSha, mode: text(heartbeat.mode), updatedAt: heartbeatAt.value });
  } else {
    const pending = Boolean(coreState.pending);
    const hasPosition = Array.isArray(coreState.positions) && coreState.positions.length > 0;
    const manualReview = text(coreState.manualReview);
    const lastDecision = decision(coreState);
    const reason = manualReview || (pending ? "IDLE_PRIORITY_PENDING" : "IDLE_PRIORITY_HEALTHY");
    core = {
      runner: "IDLE_PRIORITY_SHORT", status: "LIVE", runtimeSha: heartbeatSha, stateSha: coreSha,
      mode: text(heartbeat.mode), updatedAt: heartbeatAt.value, lastDecision, pending, position: hasPosition,
      manualReview, protection: { status: "NONE" },
      orderPermission: { allowed: !pending && !manualReview && !hasPosition, reason: !pending && !manualReview && !hasPosition ? "IDLE_PRIORITY_ORDER_PERMISSION_AVAILABLE" : `IDLE_PRIORITY_ORDER_PERMISSION_BLOCKED:${reason}` },
      reason,
    };
  }

  const residualSha = text(residualState?.runtimeSha)?.toLowerCase();
  const residualUpdated = residualState ? freshTimestamp(residualState.updatedAt, input.now) : { ok: false as const, reason: "STATE_UNAVAILABLE" };
  const residualPending = Boolean(residualState?.pending);
  const residualPosition = Boolean(object(residualState?.position));
  const residualProtection = protection(residualState);
  const residualLastDecision = decision(residualState);
  const residualManualReview = text(residualState?.manualReview);
  let residual: IdleRunnerHealth;
  if (!SHA.test(expectedSha) || !residualState) {
    residual = healthFailure("IDLE_RESIDUAL_LONG", "UNAVAILABLE", "IDLE_RESIDUAL_STATE_UNAVAILABLE", { runtimeSha: residualSha, stateSha: residualSha, pending: residualPending, position: residualPosition, protection: residualProtection });
  } else if (residualSha !== expectedSha) {
    residual = healthFailure("IDLE_RESIDUAL_LONG", "BLOCKED", "IDLE_RESIDUAL_RUNTIME_SHA_MISMATCH", { runtimeSha: residualSha, stateSha: residualSha, updatedAt: number(residualState.updatedAt), lastDecision: residualLastDecision, deferralReason: residualLastDecision?.reason.includes("RATE_BUDGET") ? residualLastDecision.reason : undefined, pending: residualPending, position: residualPosition, manualReview: residualManualReview, protection: residualProtection });
  } else if (!residualUpdated.ok) {
    residual = healthFailure("IDLE_RESIDUAL_LONG", residualUpdated.reason === "STATE_STALE" ? "STALE" : "UNCONFIRMED", `IDLE_RESIDUAL_${residualUpdated.reason}`, { runtimeSha: residualSha, stateSha: residualSha, updatedAt: number(residualState.updatedAt), lastDecision: residualLastDecision, pending: residualPending, position: residualPosition, manualReview: residualManualReview, protection: residualProtection });
  } else {
    const reason = residualManualReview || (residualPending ? "IDLE_RESIDUAL_PENDING" : residualPosition ? "IDLE_RESIDUAL_PROTECTED_POSITION" : "IDLE_RESIDUAL_HEALTHY");
    const allowed = !residualManualReview && !residualPending && !residualPosition;
    residual = {
      runner: "IDLE_RESIDUAL_LONG", status: residualManualReview || residualPending ? "UNCONFIRMED" : "LIVE", runtimeSha: residualSha, stateSha: residualSha,
      updatedAt: residualUpdated.value, lastDecision: residualLastDecision,
      deferralReason: residualLastDecision?.reason.includes("RATE_BUDGET") ? residualLastDecision.reason : undefined,
      pending: residualPending, position: residualPosition, manualReview: residualManualReview, protection: residualProtection,
      orderPermission: { allowed, reason: allowed ? "IDLE_RESIDUAL_ORDER_PERMISSION_AVAILABLE" : `IDLE_RESIDUAL_ORDER_PERMISSION_BLOCKED:${reason}` }, reason,
    };
  }

  const status = core.status === "LIVE" && residual.status === "LIVE" ? "LIVE" : core.status === "LIVE" ? "DEGRADED" : core.status;
  return { readOnly: true, tradingMutation: 0, status, core, residual };
}
