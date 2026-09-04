import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Quality102CausalV1Mode } from "@/config/disdexQuality102CausalV1Runtime";

const STRATEGY_ID = "QUALITY102_CAUSAL_V1" as const;
const STATE_VERSION = 1 as const;

export interface Quality102CausalV1PendingOrder {
  idempotencyKey: string;
  clientOrderId: string;
  phase: "planned" | "submitted" | "manual_review";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  reduceOnly: boolean;
  referenceTs: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface Quality102CausalV1State {
  version: 1;
  strategyId: "QUALITY102_CAUSAL_V1";
  mode: Quality102CausalV1Mode;
  runtimeCommitSha: string;
  updatedAt: number;
  lastProcessedReferenceTs?: number;
  lastCompletedIdempotencyKey?: string;
  position?: {
    symbol: string;
    side: -1 | 1;
    quantity: number;
    entryPrice: number;
    entryTs: number;
  };
  pending?: Quality102CausalV1PendingOrder;
  lastReconciledAt?: number;
  failures: Array<{ occurredAt: number; message: string; idempotencyKey?: string }>;
}

function malformed(field: string): never {
  throw new Error(`QUALITY102_STATE_MALFORMED: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) malformed(field);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) malformed(`${field}.${unknown}`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) malformed(field);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) malformed(field);
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);
  if (number <= 0) malformed(field);
  return number;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return finiteNumber(value, field);
}

function normalizePosition(value: unknown): Quality102CausalV1State["position"] {
  if (value === undefined) return undefined;
  const raw = record(value, "position");
  exactKeys(raw, ["symbol", "side", "quantity", "entryPrice", "entryTs"], "position");
  if (raw.side !== -1 && raw.side !== 1) malformed("position.side");
  return {
    symbol: requiredString(raw.symbol, "position.symbol"),
    side: raw.side,
    quantity: positiveNumber(raw.quantity, "position.quantity"),
    entryPrice: positiveNumber(raw.entryPrice, "position.entryPrice"),
    entryTs: finiteNumber(raw.entryTs, "position.entryTs"),
  };
}

function normalizePending(value: unknown): Quality102CausalV1PendingOrder | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, "pending");
  exactKeys(raw, [
    "idempotencyKey",
    "clientOrderId",
    "phase",
    "symbol",
    "side",
    "quantity",
    "reduceOnly",
    "referenceTs",
    "createdAt",
    "updatedAt",
    "lastError",
  ], "pending");
  if (raw.phase !== "planned" && raw.phase !== "submitted" && raw.phase !== "manual_review") {
    malformed("pending.phase");
  }
  if (raw.side !== "BUY" && raw.side !== "SELL") malformed("pending.side");
  if (typeof raw.reduceOnly !== "boolean") malformed("pending.reduceOnly");
  const lastError = optionalString(raw.lastError, "pending.lastError");
  return {
    idempotencyKey: requiredString(raw.idempotencyKey, "pending.idempotencyKey"),
    clientOrderId: requiredString(raw.clientOrderId, "pending.clientOrderId"),
    phase: raw.phase,
    symbol: requiredString(raw.symbol, "pending.symbol"),
    side: raw.side,
    quantity: positiveNumber(raw.quantity, "pending.quantity"),
    reduceOnly: raw.reduceOnly,
    referenceTs: finiteNumber(raw.referenceTs, "pending.referenceTs"),
    createdAt: finiteNumber(raw.createdAt, "pending.createdAt"),
    updatedAt: finiteNumber(raw.updatedAt, "pending.updatedAt"),
    ...(lastError === undefined ? {} : { lastError }),
  };
}

function normalizeFailures(value: unknown): Quality102CausalV1State["failures"] {
  if (!Array.isArray(value)) malformed("failures");
  return value.map((item, index) => {
    const raw = record(item, `failures[${index}]`);
    exactKeys(raw, ["occurredAt", "message", "idempotencyKey"], `failures[${index}]`);
    const idempotencyKey = optionalString(raw.idempotencyKey, `failures[${index}].idempotencyKey`);
    return {
      occurredAt: finiteNumber(raw.occurredAt, `failures[${index}].occurredAt`),
      message: requiredString(raw.message, `failures[${index}].message`),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
  });
}

function normalizeState(
  value: unknown,
  mode: Quality102CausalV1Mode,
  runtimeCommitSha: string,
): Quality102CausalV1State {
  const raw = record(value, "root");
  exactKeys(raw, [
    "version",
    "strategyId",
    "mode",
    "runtimeCommitSha",
    "updatedAt",
    "lastProcessedReferenceTs",
    "lastCompletedIdempotencyKey",
    "position",
    "pending",
    "lastReconciledAt",
    "failures",
  ], "root");
  if (raw.version !== STATE_VERSION) malformed("version");
  if (raw.strategyId !== STRATEGY_ID) malformed("strategyId");
  if (raw.mode !== mode) malformed("mode");
  if (raw.mode !== "SHADOW" && raw.mode !== "PAPER" && raw.mode !== "LIVE") malformed("mode");

  if (typeof raw.runtimeCommitSha !== "string") malformed("runtimeCommitSha");
  if (mode === "LIVE" && (!runtimeCommitSha || raw.runtimeCommitSha !== runtimeCommitSha)) {
    malformed("runtimeCommitSha");
  }

  const lastProcessedReferenceTs = optionalTimestamp(raw.lastProcessedReferenceTs, "lastProcessedReferenceTs");
  const lastCompletedIdempotencyKey = optionalString(raw.lastCompletedIdempotencyKey, "lastCompletedIdempotencyKey");
  const position = normalizePosition(raw.position);
  const pending = normalizePending(raw.pending);
  const lastReconciledAt = optionalTimestamp(raw.lastReconciledAt, "lastReconciledAt");

  return {
    version: STATE_VERSION,
    strategyId: STRATEGY_ID,
    mode,
    runtimeCommitSha: raw.runtimeCommitSha,
    updatedAt: finiteNumber(raw.updatedAt, "updatedAt"),
    ...(lastProcessedReferenceTs === undefined ? {} : { lastProcessedReferenceTs }),
    ...(lastCompletedIdempotencyKey === undefined ? {} : { lastCompletedIdempotencyKey }),
    ...(position === undefined ? {} : { position }),
    ...(pending === undefined ? {} : { pending }),
    ...(lastReconciledAt === undefined ? {} : { lastReconciledAt }),
    failures: normalizeFailures(raw.failures),
  };
}

function environmentRuntimeCommitSha(): string {
  return String(process.env.DISDEX_RUNTIME_COMMIT_SHA || "").trim();
}

export function createQuality102CausalV1State(
  mode: Quality102CausalV1Mode,
  runtimeCommitSha = environmentRuntimeCommitSha(),
): Quality102CausalV1State {
  if (mode === "LIVE" && !runtimeCommitSha) malformed("runtimeCommitSha");
  return {
    version: STATE_VERSION,
    strategyId: STRATEGY_ID,
    mode,
    runtimeCommitSha,
    updatedAt: Date.now(),
    failures: [],
  };
}

export interface Quality102CausalV1StateStore {
  load(): Promise<Quality102CausalV1State>;
  save(state: Quality102CausalV1State): Promise<void>;
}

export class FileQuality102CausalV1StateStore implements Quality102CausalV1StateStore {
  private readonly path: string;

  constructor(
    path: string,
    private readonly mode: Quality102CausalV1Mode,
    private readonly runtimeCommitSha = environmentRuntimeCommitSha(),
  ) {
    this.path = resolve(path);
  }

  async load(): Promise<Quality102CausalV1State> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code === "ENOENT") return createQuality102CausalV1State(this.mode, this.runtimeCommitSha);
      throw error;
    }

    try {
      return normalizeState(JSON.parse(serialized) as unknown, this.mode, this.runtimeCommitSha);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("QUALITY102_STATE_MALFORMED:")) throw error;
      malformed("invalid JSON");
    }
  }

  async save(state: Quality102CausalV1State): Promise<void> {
    const value = normalizeState(state, this.mode, this.runtimeCommitSha);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

export class MemoryQuality102CausalV1StateStore implements Quality102CausalV1StateStore {
  private state: unknown;

  constructor(
    state: Quality102CausalV1State,
    private readonly mode: Quality102CausalV1Mode = state.mode,
    private readonly runtimeCommitSha = state.runtimeCommitSha,
  ) {
    this.state = structuredClone(state);
  }

  async load(): Promise<Quality102CausalV1State> {
    return structuredClone(normalizeState(this.state, this.mode, this.runtimeCommitSha));
  }

  async save(state: Quality102CausalV1State): Promise<void> {
    this.state = structuredClone(normalizeState(state, this.mode, this.runtimeCommitSha));
  }
}
