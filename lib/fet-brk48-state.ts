import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const FET_BRK48_STATE_SCHEMA = "fet-brk48-residual-state/v1" as const;
export type FetPendingAction = "ENTRY" | "EXIT" | "PREEMPT";

export interface FetBrk48PositionState {
  symbol: "FETUSDT";
  side: 1;
  quantity: number;
  entryPrice: number;
  entryTs: number;
  exitTs: number;
  gross: number;
  hardStop: number;
  stopClientOrderId: string;
}

export interface FetBrk48PendingState {
  action: FetPendingAction;
  idempotencyKey: string;
  clientOrderId: string;
  symbol: "FETUSDT";
  side: "BUY" | "SELL";
  quantity: number;
  referenceTs: number;
  createdAt: number;
  updatedAt: number;
  expectedPrice: number;
  reason: string;
  targetGross?: number;
  entryTs?: number;
  exitTs?: number;
  hardStopPct?: number;
}

export interface FetBrk48State {
  schema: typeof FET_BRK48_STATE_SCHEMA;
  strategyId: "FET_BRK48_RESIDUAL";
  runtimeCommitSha: string;
  updatedAt: number;
  lastReferenceTs?: number;
  position?: FetBrk48PositionState;
  pending?: FetBrk48PendingState;
  lastCompletedIdempotencyKey?: string;
  manualReview?: string;
  lastReconciledAt?: number;
  failures: Array<{ occurredAt: number; message: string }>;
}

function finitePositive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function validPosition(p: any): p is FetBrk48PositionState {
  return p
    && p.symbol === "FETUSDT"
    && p.side === 1
    && finitePositive(p.quantity)
    && finitePositive(p.entryPrice)
    && finitePositive(p.entryTs)
    && Number(p.exitTs) > Number(p.entryTs)
    && finitePositive(p.gross)
    && finitePositive(p.hardStop)
    && typeof p.stopClientOrderId === "string"
    && p.stopClientOrderId.length > 0;
}

function validPending(p: any): p is FetBrk48PendingState {
  if (!p || !["ENTRY", "EXIT", "PREEMPT"].includes(p.action)) return false;
  if (!p.idempotencyKey || !p.clientOrderId || p.symbol !== "FETUSDT") return false;
  if (!["BUY", "SELL"].includes(p.side) || !finitePositive(p.quantity)) return false;
  if (!finitePositive(p.referenceTs) || !finitePositive(p.createdAt) || !finitePositive(p.updatedAt) || !finitePositive(p.expectedPrice)) return false;
  if (typeof p.reason !== "string" || !p.reason) return false;
  if (p.action === "ENTRY") {
    if (!finitePositive(p.targetGross) || !finitePositive(p.entryTs) || !finitePositive(p.exitTs) || Number(p.exitTs) <= Number(p.entryTs)) return false;
    if (!finitePositive(p.hardStopPct) || Number(p.hardStopPct) >= 1) return false;
  }
  return true;
}

export function emptyFetBrk48State(runtimeCommitSha: string, now = Date.now()): FetBrk48State {
  return { schema: FET_BRK48_STATE_SCHEMA, strategyId: "FET_BRK48_RESIDUAL", runtimeCommitSha, updatedAt: now, failures: [] };
}

export async function readFetBrk48State(path: string, runtimeCommitSha?: string): Promise<FetBrk48State> {
  let raw: any;
  try {
    raw = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyFetBrk48State(runtimeCommitSha || "UNKNOWN");
    throw error;
  }
  if (raw?.schema !== FET_BRK48_STATE_SCHEMA) throw new Error("FET_STATE_SCHEMA_INVALID");
  if (raw?.strategyId !== "FET_BRK48_RESIDUAL") throw new Error("FET_STATE_STRATEGY_ID_INVALID");
  if (runtimeCommitSha && raw.runtimeCommitSha !== runtimeCommitSha) {
    throw new Error(`FET_STATE_RUNTIME_SHA_MISMATCH:${raw.runtimeCommitSha}:EXPECTED_${runtimeCommitSha}`);
  }
  if (raw.position && !validPosition(raw.position)) throw new Error("FET_STATE_POSITION_INVALID");
  if (raw.pending && !validPending(raw.pending)) throw new Error("FET_STATE_PENDING_INVALID");
  return {
    ...raw,
    failures: Array.isArray(raw.failures) ? raw.failures : [],
  };
}

export async function writeFetBrk48State(path: string, state: FetBrk48State) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, target);
}
