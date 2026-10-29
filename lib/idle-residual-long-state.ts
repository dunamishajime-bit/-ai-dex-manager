import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { IDLE_RESIDUAL_LONG_POLICY, type IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";

export const IDLE_RESIDUAL_LONG_STATE_SCHEMA = "disdex-idle-residual-long-state/v1" as const;
/** Residual state must be refreshed at least once per three-hour watchdog window. */
export const IDLE_RESIDUAL_LONG_STATE_MAX_AGE_MS = 3 * 60 * 60_000;
export const IDLE_RESIDUAL_LONG_STATE_CLOCK_SKEW_MS = 60_000;

export type IdleResidualLongPosition = {
  symbol: IdleResidualLongSymbol;
  route: string;
  side: "LONG";
  signalTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  quantity: number;
  gross: 1;
  stopPrice: number;
  takeProfitPrice: number;
  stopClientOrderId: string;
  takeProfitClientOrderId: string;
  protectionVerified: true;
  firstTouchAtTs?: number;
  watchDeadlineTs?: number;
  trailArmed?: boolean;
  bestConfirmed5mClosePct?: number;
  lastConfirmed5mTs?: number;
};

export type IdleResidualLongPending = {
  action: "ENTRY" | "EXIT";
  phase: "planned" | "submitted" | "manual_review";
  symbol: IdleResidualLongSymbol;
  route: string;
  clientOrderId: string;
  idempotencyKey: string;
  reservationId?: string;
  quantity: number;
  expectedPrice: number;
  signalTs: number;
  decisionTs: number;
  createdAt: number;
  updatedAt: number;
  reason: string;
};

export type IdleResidualLongState = {
  schema: typeof IDLE_RESIDUAL_LONG_STATE_SCHEMA;
  runtimeSha: string;
  updatedAt: number;
  position: IdleResidualLongPosition | null;
  pending: IdleResidualLongPending | null;
  manualReview: string | null;
  lastDecision?: { decisionTs: number; symbol?: IdleResidualLongSymbol; route?: string; accepted: boolean; reason: string };
  failures: Array<{ message: string; occurredAt: number }>;
};

function validSha(value: unknown) { return /^[0-9a-f]{40}$/i.test(String(value || "")); }
function validSymbol(value: unknown): value is IdleResidualLongSymbol { return value === "DOGEUSDT" || value === "AVAXUSDT"; }
function positive(value: unknown) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function timestamp(value: unknown, now: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("IDLE_RESIDUAL_STATE_TIMESTAMP_INVALID");
  if (parsed > now + IDLE_RESIDUAL_LONG_STATE_CLOCK_SKEW_MS) throw new Error("IDLE_RESIDUAL_STATE_TIMESTAMP_FUTURE");
  return parsed;
}

export function emptyIdleResidualLongState(runtimeSha: string, now = Date.now()): IdleResidualLongState {
  if (!validSha(runtimeSha)) throw new Error("IDLE_RESIDUAL_STATE_RUNTIME_SHA_INVALID");
  return { schema: IDLE_RESIDUAL_LONG_STATE_SCHEMA, runtimeSha: runtimeSha.toLowerCase(), updatedAt: now, position: null, pending: null, manualReview: null, failures: [] };
}

export function normalizeIdleResidualLongState(raw: unknown, runtimeSha: string, now = Date.now()): IdleResidualLongState {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_RESIDUAL_STATE_MALFORMED");
  const value = raw as Partial<IdleResidualLongState>;
  if (value.schema !== IDLE_RESIDUAL_LONG_STATE_SCHEMA || !validSha(value.runtimeSha) || String(value.runtimeSha).toLowerCase() !== runtimeSha.toLowerCase()) {
    throw new Error("IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH");
  }
  if (value.position != null) {
    const p = value.position;
    const routePolicy = validSymbol(p.symbol) ? IDLE_RESIDUAL_LONG_POLICY.routes[p.symbol] : undefined;
    if (!validSymbol(p.symbol) || p.side !== "LONG" || !positive(p.signalTs) || !positive(p.entryTs) || !positive(p.exitTs) ||
        timestamp(p.signalTs, now) > now || timestamp(p.entryTs, now) > now || p.exitTs <= p.entryTs ||
        !positive(p.entryPrice) || !positive(p.quantity) || p.gross !== 1 || !positive(p.stopPrice) || !positive(p.takeProfitPrice) ||
        !(p.stopPrice < p.entryPrice && p.takeProfitPrice > p.entryPrice) || !p.stopClientOrderId || !p.takeProfitClientOrderId || p.protectionVerified !== true ||
        (routePolicy && p.exitTs > p.entryTs + routePolicy.maxHoldHours * 3_600_000 + IDLE_RESIDUAL_LONG_STATE_CLOCK_SKEW_MS) ||
        (p.firstTouchAtTs !== undefined && (!positive(p.firstTouchAtTs) || timestamp(p.firstTouchAtTs, now) > now)) ||
        (p.watchDeadlineTs !== undefined && (!positive(p.watchDeadlineTs) || p.watchDeadlineTs < (p.firstTouchAtTs || 0))) ||
        (p.trailArmed !== undefined && typeof p.trailArmed !== "boolean") ||
        (p.bestConfirmed5mClosePct !== undefined && !Number.isFinite(p.bestConfirmed5mClosePct)) ||
        (p.lastConfirmed5mTs !== undefined && (!positive(p.lastConfirmed5mTs) || timestamp(p.lastConfirmed5mTs, now) > now))) {
      throw new Error("IDLE_RESIDUAL_STATE_POSITION_INVALID");
    }
  }
  if (value.pending != null) {
    const p = value.pending;
    if (!["ENTRY","EXIT"].includes(p.action) || !["planned","submitted","manual_review"].includes(p.phase) || !validSymbol(p.symbol) ||
        !p.route || !p.clientOrderId || !p.idempotencyKey || !positive(p.quantity) || !positive(p.expectedPrice) ||
        !positive(p.signalTs) || !positive(p.decisionTs) || !positive(p.createdAt) || !positive(p.updatedAt) || !p.reason) {
      throw new Error("IDLE_RESIDUAL_STATE_PENDING_INVALID");
    }
    timestamp(p.signalTs, now); timestamp(p.decisionTs, now); timestamp(p.createdAt, now); timestamp(p.updatedAt, now);
  }
  const updatedAt = timestamp(value.updatedAt, now);
  let lastDecision: IdleResidualLongState["lastDecision"];
  if (value.lastDecision !== undefined) {
    const decision = value.lastDecision;
    if (!decision || typeof decision !== "object" || typeof decision.accepted !== "boolean" || typeof decision.reason !== "string" || !decision.reason.trim()) {
      throw new Error("IDLE_RESIDUAL_STATE_LAST_DECISION_INVALID");
    }
    timestamp(decision.decisionTs, now);
    if (decision.symbol !== undefined && !validSymbol(decision.symbol)) throw new Error("IDLE_RESIDUAL_STATE_LAST_DECISION_INVALID");
    if (decision.route !== undefined && typeof decision.route !== "string") throw new Error("IDLE_RESIDUAL_STATE_LAST_DECISION_INVALID");
    lastDecision = { ...decision, decisionTs: Number(decision.decisionTs) };
  }
  if (value.manualReview !== null && value.manualReview !== undefined && typeof value.manualReview !== "string") {
    throw new Error("IDLE_RESIDUAL_STATE_MANUAL_REVIEW_INVALID");
  }
  if (!Array.isArray(value.failures)) throw new Error("IDLE_RESIDUAL_STATE_FAILURES_INVALID");
  const failures = value.failures.map((failure) => {
    if (!failure || typeof failure.message !== "string" || !failure.message.trim()) throw new Error("IDLE_RESIDUAL_STATE_FAILURES_INVALID");
    timestamp(failure.occurredAt, now);
    return { message: failure.message, occurredAt: Number(failure.occurredAt) };
  }).slice(-100);
  return {
    schema: IDLE_RESIDUAL_LONG_STATE_SCHEMA,
    runtimeSha: runtimeSha.toLowerCase(),
    updatedAt,
    position: value.position ?? null,
    pending: value.pending ?? null,
    manualReview: value.manualReview ?? null,
    lastDecision,
    failures,
  };
}

export function assertIdleResidualLongStateFresh(state: IdleResidualLongState, now = Date.now()): IdleResidualLongState {
  const updatedAt = timestamp(state.updatedAt, now);
  if (now - updatedAt > IDLE_RESIDUAL_LONG_STATE_MAX_AGE_MS) throw new Error("IDLE_RESIDUAL_STATE_STALE");
  return state;
}

export function heartbeatIdleResidualRateBudgetDeferral(state: IdleResidualLongState, reason: string, now = Date.now()): IdleResidualLongState {
  if (state.pending || state.manualReview) return state;
  const protectedPosition = state.position ? "PROTECTED_" : "";
  return {
    ...state,
    updatedAt: now,
    lastDecision: {
      decisionTs: now,
      ...(state.position ? { symbol: state.position.symbol, route: state.position.route } : {}),
      accepted: false,
      reason: `IDLE_RESIDUAL_${protectedPosition}RATE_BUDGET_DEFERRED:${reason}`,
    },
  };
}

async function safe(path: string) {
  try {
    const s = await lstat(path);
    if (s.isSymbolicLink() || !s.isFile()) throw new Error("IDLE_RESIDUAL_STATE_PATH_UNSAFE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function readIdleResidualLongState(path: string, runtimeSha: string) {
  await safe(path);
  try { return assertIdleResidualLongStateFresh(normalizeIdleResidualLongState(JSON.parse(await readFile(path, "utf8")), runtimeSha)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIdleResidualLongState(runtimeSha);
    throw error;
  }
}

export async function writeIdleResidualLongState(path: string, state: IdleResidualLongState) {
  await safe(path);
  const normalized = normalizeIdleResidualLongState({ ...state, updatedAt: Date.now() }, state.runtimeSha);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(normalized, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export class FileIdleResidualLongStateStore {
  constructor(private readonly path: string, private readonly runtimeSha: string) {}
  async load() {
    return assertIdleResidualLongStateFresh(await readIdleResidualLongState(this.path, this.runtimeSha));
  }
  save(state: IdleResidualLongState) { return writeIdleResidualLongState(this.path, state); }
}
