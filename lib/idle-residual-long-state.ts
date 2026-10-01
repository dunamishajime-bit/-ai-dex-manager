import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";

export const IDLE_RESIDUAL_LONG_STATE_SCHEMA = "disdex-idle-residual-long-state/v1" as const;

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

export function emptyIdleResidualLongState(runtimeSha: string, now = Date.now()): IdleResidualLongState {
  if (!validSha(runtimeSha)) throw new Error("IDLE_RESIDUAL_STATE_RUNTIME_SHA_INVALID");
  return { schema: IDLE_RESIDUAL_LONG_STATE_SCHEMA, runtimeSha: runtimeSha.toLowerCase(), updatedAt: now, position: null, pending: null, manualReview: null, failures: [] };
}

export function normalizeIdleResidualLongState(raw: unknown, runtimeSha: string): IdleResidualLongState {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_RESIDUAL_STATE_MALFORMED");
  const value = raw as Partial<IdleResidualLongState>;
  if (value.schema !== IDLE_RESIDUAL_LONG_STATE_SCHEMA || !validSha(value.runtimeSha) || String(value.runtimeSha).toLowerCase() !== runtimeSha.toLowerCase()) {
    throw new Error("IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH");
  }
  if (value.position != null) {
    const p = value.position;
    if (!validSymbol(p.symbol) || p.side !== "LONG" || !positive(p.signalTs) || !positive(p.entryTs) || !positive(p.exitTs) || p.exitTs <= p.entryTs ||
        !positive(p.entryPrice) || !positive(p.quantity) || p.gross !== 1 || !positive(p.stopPrice) || !positive(p.takeProfitPrice) ||
        !(p.stopPrice < p.entryPrice && p.takeProfitPrice > p.entryPrice) || !p.stopClientOrderId || !p.takeProfitClientOrderId || p.protectionVerified !== true) {
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
  }
  return {
    schema: IDLE_RESIDUAL_LONG_STATE_SCHEMA,
    runtimeSha: runtimeSha.toLowerCase(),
    updatedAt: Number(value.updatedAt || Date.now()),
    position: value.position ?? null,
    pending: value.pending ?? null,
    manualReview: value.manualReview ?? null,
    lastDecision: value.lastDecision,
    failures: Array.isArray(value.failures) ? value.failures.slice(-100) : [],
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
  try { return normalizeIdleResidualLongState(JSON.parse(await readFile(path, "utf8")), runtimeSha); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIdleResidualLongState(runtimeSha);
    throw error;
  }
}

export async function writeIdleResidualLongState(path: string, state: IdleResidualLongState) {
  await safe(path);
  const normalized = normalizeIdleResidualLongState({ ...state, updatedAt: Date.now() }, state.runtimeSha);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(normalized, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export class FileIdleResidualLongStateStore {
  constructor(private readonly path: string, private readonly runtimeSha: string) {}
  load() { return readIdleResidualLongState(this.path, this.runtimeSha); }
  save(state: IdleResidualLongState) { return writeIdleResidualLongState(this.path, state); }
}
