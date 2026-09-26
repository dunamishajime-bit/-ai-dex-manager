import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const HYPE_ZEC_LONG_STATE_SCHEMA = "disdex-hype-zec-long/v1" as const;
export type HypeZecLongStateMode = "LIVE" | "SHADOW" | "PAPER";
export type HypeZecLongPendingPhase = "planned" | "submitted" | "manual_review";

export interface HypeZecLongPositionState {
  strategy: "HYPE_LONG" | "ZEC_LONG";
  symbol: "HYPEUSDT" | "ZECUSDT";
  side: "LONG";
  positionId: string;
  quantity: number;
  entryPrice: number;
  entryTs: number;
  signalTs: number;
  stopPrice: number;
  takeProfitPrice: number;
  peakPrice: number;
  updatedAt: number;
}

export interface HypeZecLongPending {
  idempotencyKey: string;
  clientOrderId: string;
  action: "ENTRY" | "EXIT";
  strategy: "HYPE_LONG" | "ZEC_LONG";
  symbol: "HYPEUSDT" | "ZECUSDT";
  side: "BUY" | "SELL";
  quantity: number;
  expectedPrice: number;
  phase: HypeZecLongPendingPhase;
  createdAt: number;
  updatedAt: number;
  reason: string;
}

export interface HypeZecLongRunnerState {
  schema: typeof HYPE_ZEC_LONG_STATE_SCHEMA;
  runtimeCommitSha: string;
  mode: HypeZecLongStateMode;
  updatedAt: number;
  lastDecisionTs?: number;
  lastDecision?: { strategy: "HYPE_LONG" | "ZEC_LONG"; signalTs: number | null; accepted: boolean; reason: string };
  positions?: HypeZecLongPositionState[];
  pending?: HypeZecLongPending;
  manualReview?: string;
  failures: Array<{ message: string; occurredAt: number }>;
}

function normalizedState(value: unknown, expectedRuntimeSha?: string, expectedMode?: HypeZecLongStateMode): HypeZecLongRunnerState {
  if (!value || typeof value !== "object") throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
  const raw = value as Partial<HypeZecLongRunnerState>;
  if (raw.schema !== HYPE_ZEC_LONG_STATE_SCHEMA || typeof raw.runtimeCommitSha !== "string" || !raw.runtimeCommitSha.trim()) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
  if (expectedRuntimeSha && raw.runtimeCommitSha.toLowerCase() !== expectedRuntimeSha.toLowerCase()) throw new Error(`HYPE_ZEC_LONG_STATE_RUNTIME_SHA_MISMATCH:${raw.runtimeCommitSha}:${expectedRuntimeSha}`);
  if (expectedMode && raw.mode !== expectedMode) throw new Error(`HYPE_ZEC_LONG_STATE_MODE_MISMATCH:${raw.mode}:${expectedMode}`);
  return {
    schema: HYPE_ZEC_LONG_STATE_SCHEMA,
    runtimeCommitSha: raw.runtimeCommitSha,
    mode: raw.mode === "LIVE" || raw.mode === "PAPER" ? raw.mode : "SHADOW",
    updatedAt: Number(raw.updatedAt),
    lastDecisionTs: raw.lastDecisionTs,
    lastDecision: raw.lastDecision,
    positions: Array.isArray(raw.positions) ? raw.positions.map((position) => ({ ...position })) : undefined,
    pending: raw.pending,
    manualReview: raw.manualReview,
    failures: Array.isArray(raw.failures) ? raw.failures.slice(-100) : [],
  };
}

export class FileHypeZecLongRunnerStateStore {
  private readonly path: string;
  constructor(path = process.env.DISDEX_HYPE_ZEC_STATE_PATH || "/var/lib/disdex/hype-zec-long/runner.json", private readonly runtimeCommitSha = process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "", private readonly mode: HypeZecLongStateMode = "SHADOW") {
    this.path = resolve(path);
  }

  async load(): Promise<HypeZecLongRunnerState> {
    try {
      return normalizedState(JSON.parse(await readFile(this.path, "utf8")), this.runtimeCommitSha || undefined, this.mode);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "ENOENT") throw error;
      return { schema: HYPE_ZEC_LONG_STATE_SCHEMA, runtimeCommitSha: this.runtimeCommitSha, mode: this.mode, updatedAt: Date.now(), failures: [] };
    }
  }

  async save(state: HypeZecLongRunnerState): Promise<void> {
    // Validate the caller's lineage before writing.  Never silently rewrite a
    // stale state to the current SHA: migrations are an explicit operation.
    const normalized = normalizedState({ ...state, updatedAt: Date.now() }, this.runtimeCommitSha || undefined, this.mode);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const current = await lstat(this.path);
      if (current.isSymbolicLink()) throw new Error("HYPE_ZEC_LONG_STATE_SYMLINK_FORBIDDEN");
      if (!current.isFile()) throw new Error("HYPE_ZEC_LONG_STATE_NOT_REGULAR_FILE");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "ENOENT") throw error;
    }
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
