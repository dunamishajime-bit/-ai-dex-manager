import { chmod, chown, constants as fsConstants, copyFile, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { LiveEntryApprovalSource } from "./disdex-live-entry-approval";

export const HYPE_ZEC_LONG_STATE_SCHEMA = "disdex-hype-zec-long/v1" as const;
/** HYPE/ZEC state heartbeat freshness contract used by runtime health. */
export const HYPE_ZEC_LONG_STATE_MAX_AGE_MS = 3 * 60 * 60_000;
export const HYPE_ZEC_LONG_STATE_CLOCK_SKEW_MS = 60_000;
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
  stopClientOrderId?: string;
  takeProfitClientOrderId?: string;
  stopOrderId?: number;
  stopReadBackAt?: number;
  peakPrice: number;
  /** Actual accepted gross used to derive the HYPE wallet-risk stop. */
  acceptedEntryGross?: number;
  /** Persist the contract used for restart/reconciliation audit. */
  walletStopRiskPct?: number;
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
  reservationId?: string;
  approvedGross?: number;
  marketFitScore?: number;
  scoreSource?: string;
  approvalSource?: LiveEntryApprovalSource;
}

export interface HypeZecLongRunnerState {
  schema: typeof HYPE_ZEC_LONG_STATE_SCHEMA;
  runtimeCommitSha: string;
  mode: HypeZecLongStateMode;
  updatedAt: number;
  lastDecisionTs?: number;
  lastDecision?: { strategy: "HYPE_LONG" | "ZEC_LONG"; signalTs: number | null; accepted: boolean; reason: string; approvedGross?: number; marketFitScore?: number; scoreSource?: string; approvalSource?: LiveEntryApprovalSource };
  positions?: HypeZecLongPositionState[];
  pending?: HypeZecLongPending;
  manualReview?: string;
  failures: Array<{ message: string; occurredAt: number }>;
}

export interface HypeZecLongSignedFlatVenueRead {
  source: "ASTER_SIGNED_READ_ONLY";
  positions: ReadonlyArray<{ symbol?: string; quantity?: number }>;
  openOrders: ReadonlyArray<{ symbol?: string; quantity?: number; status?: string }>;
}

export type HypeZecLongStaleRecoveryInput = {
  reason: "ASTER_SIGNED_FLAT_READBACK";
  now?: number;
  venue: HypeZecLongSignedFlatVenueRead;
  /** Capability proving the caller owns the account-order lock immediately before mutation. */
  lock: Pick<AccountLockHandle, "document">;
};

const HYPE_ZEC_LONG_KNOWN_ORDER_STATUSES = new Set([
  "NEW",
  "PARTIALLY_FILLED",
  "PENDING_NEW",
  "CANCELED",
  "FILLED",
  "EXPIRED",
  "REJECTED",
]);

function venueSymbol(value: unknown) {
  if (typeof value !== "string") return undefined;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9]+USDT$/.test(symbol) ? symbol : undefined;
}

function finiteVenueQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export type HypeZecLongStaleRecoveryResult = {
  status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS" | "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_NOOP" | "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_SKIPPED_MISSING";
  statePath: string;
  state?: HypeZecLongRunnerState;
  backupPath?: string;
  ordersSent: 0;
  cancelsSent: 0;
  positionChangesSent: 0;
};

function normalizedState(value: unknown, expectedRuntimeSha?: string, expectedMode?: HypeZecLongStateMode): HypeZecLongRunnerState {
  if (!value || typeof value !== "object") throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
  const raw = value as Partial<HypeZecLongRunnerState>;
  if (raw.schema !== HYPE_ZEC_LONG_STATE_SCHEMA || typeof raw.runtimeCommitSha !== "string" || !raw.runtimeCommitSha.trim()) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
  if (expectedRuntimeSha && raw.runtimeCommitSha.toLowerCase() !== expectedRuntimeSha.toLowerCase()) throw new Error(`HYPE_ZEC_LONG_STATE_RUNTIME_SHA_MISMATCH:${raw.runtimeCommitSha}:${expectedRuntimeSha}`);
  if (raw.mode !== "LIVE" && raw.mode !== "PAPER" && raw.mode !== "SHADOW") throw new Error("HYPE_ZEC_LONG_STATE_MODE_INVALID");
  if (expectedMode && raw.mode !== expectedMode) throw new Error(`HYPE_ZEC_LONG_STATE_MODE_MISMATCH:${raw.mode}:${expectedMode}`);
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) throw new Error("HYPE_ZEC_LONG_STATE_TIMESTAMP_INVALID");
  if (updatedAt > Date.now() + HYPE_ZEC_LONG_STATE_CLOCK_SKEW_MS) throw new Error("HYPE_ZEC_LONG_STATE_TIMESTAMP_FUTURE");
  if (raw.lastDecisionTs !== undefined && (!Number.isFinite(Number(raw.lastDecisionTs)) || Number(raw.lastDecisionTs) <= 0 || Number(raw.lastDecisionTs) > Date.now() + HYPE_ZEC_LONG_STATE_CLOCK_SKEW_MS)) {
    throw new Error("HYPE_ZEC_LONG_STATE_DECISION_TIMESTAMP_INVALID");
  }
  return {
    schema: HYPE_ZEC_LONG_STATE_SCHEMA,
    runtimeCommitSha: raw.runtimeCommitSha,
    mode: raw.mode,
    updatedAt,
    lastDecisionTs: raw.lastDecisionTs,
    lastDecision: raw.lastDecision,
    positions: Array.isArray(raw.positions) ? raw.positions.map((position) => ({ ...position })) : undefined,
    pending: raw.pending,
    manualReview: raw.manualReview,
    failures: Array.isArray(raw.failures) ? raw.failures.slice(-100) : [],
  };
}

export function assertHypeZecLongRunnerStateFresh(state: HypeZecLongRunnerState, now = Date.now()): HypeZecLongRunnerState {
  if (!Number.isFinite(state.updatedAt) || state.updatedAt <= 0) throw new Error("HYPE_ZEC_LONG_STATE_TIMESTAMP_INVALID");
  if (state.updatedAt > now + HYPE_ZEC_LONG_STATE_CLOCK_SKEW_MS) throw new Error("HYPE_ZEC_LONG_STATE_TIMESTAMP_FUTURE");
  if (now - state.updatedAt > HYPE_ZEC_LONG_STATE_MAX_AGE_MS) throw new Error("HYPE_ZEC_LONG_STATE_STALE");
  return state;
}

export function heartbeatHypeZecRateBudgetDeferral(state: HypeZecLongRunnerState, reason: string, now = Date.now()): HypeZecLongRunnerState {
  if (state.pending || state.manualReview) return state;
  const owned = state.positions || [];
  const protectedState = owned.length > 0 && owned.every((position) => (
    typeof position.stopClientOrderId === "string" && position.stopClientOrderId.length > 0
    && typeof position.takeProfitClientOrderId === "string" && position.takeProfitClientOrderId.length > 0
    && Number.isFinite(position.stopReadBackAt) && Number(position.stopReadBackAt) > 0
  ));
  if (owned.length > 0 && !protectedState) return state;
  return {
    ...state,
    updatedAt: now,
    lastDecisionTs: now,
    lastDecision: {
      strategy: owned[0]?.strategy || "HYPE_LONG",
      signalTs: owned[0]?.signalTs ?? null,
      accepted: false,
      reason: `HYPE_ZEC_${owned.length > 0 ? "PROTECTED_" : ""}RATE_BUDGET_DEFERRED:${reason}`,
    },
  };
}

export class FileHypeZecLongRunnerStateStore {
  private readonly path: string;
  constructor(path = process.env.DISDEX_HYPE_ZEC_STATE_PATH || "/var/lib/disdex/hype-zec-long/runner.json", private readonly runtimeCommitSha = process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "", private readonly mode: HypeZecLongStateMode = "SHADOW") {
    this.path = resolve(path);
  }

  async load(): Promise<HypeZecLongRunnerState> {
    try {
      return assertHypeZecLongRunnerStateFresh(normalizedState(JSON.parse(await readFile(this.path, "utf8")), this.runtimeCommitSha || undefined, this.mode));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "ENOENT") throw error;
      return { schema: HYPE_ZEC_LONG_STATE_SCHEMA, runtimeCommitSha: this.runtimeCommitSha, mode: this.mode, updatedAt: Date.now(), failures: [] };
    }
  }

  async recoverFlatStaleState(input: HypeZecLongStaleRecoveryInput): Promise<HypeZecLongStaleRecoveryResult> {
    if (!input.lock || typeof input.lock.document !== "function") throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_LOCK_REQUIRED");
    await input.lock.document();
    const now = input.now ?? Date.now();
    let metadata;
    try {
      metadata = await lstat(this.path);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") return { status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_SKIPPED_MISSING", statePath: this.path, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_SYMLINK_FORBIDDEN");
    if (!metadata.isFile()) throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_NOT_REGULAR_FILE");
    if (input.venue.source !== "ASTER_SIGNED_READ_ONLY") throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_SIGNED_READ_REQUIRED");
    if (!Array.isArray(input.venue.positions) || !Array.isArray(input.venue.openOrders)) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_READ_INVALID");
    const positions = input.venue.positions.map((position) => {
      if (!position || typeof position !== "object" || Array.isArray(position)) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_ROW_INVALID");
      const symbol = venueSymbol((position as { symbol?: unknown }).symbol);
      if (!symbol) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_SYMBOL_INVALID");
      const quantity = (position as { quantity?: unknown }).quantity;
      if (!finiteVenueQuantity(quantity)) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_QUANTITY_INVALID");
      return { symbol, quantity };
    });
    const openOrders = input.venue.openOrders.map((order) => {
      if (!order || typeof order !== "object" || Array.isArray(order)) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_ROW_INVALID");
      const symbol = venueSymbol((order as { symbol?: unknown }).symbol);
      if (!symbol) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_SYMBOL_INVALID");
      const quantity = (order as { quantity?: unknown }).quantity;
      if (!finiteVenueQuantity(quantity)) throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_QUANTITY_INVALID");
      const status = (order as { status?: unknown }).status;
      if (typeof status !== "string" || !HYPE_ZEC_LONG_KNOWN_ORDER_STATUSES.has(status.trim().toUpperCase())) {
        throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_ORDER_STATUS_INVALID");
      }
      return { symbol, quantity, status: status.trim().toUpperCase() };
    });
    const isSidecar = (symbol: string) => symbol === "HYPEUSDT" || symbol === "ZECUSDT";
    const isActive = (status: string) => ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(status);
    if (positions.some((position) => !isSidecar(position.symbol) && Math.abs(position.quantity) > 1e-9)) {
      throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_FOREIGN_NONZERO_POSITION");
    }
    if (positions.some((position) => isSidecar(position.symbol) && Math.abs(position.quantity) > 1e-9)
      || openOrders.some((order) => order.symbol === "ZECUSDT" || (order.symbol === "HYPEUSDT" && isActive(order.status)))) {
      throw new Error("HYPE_ZEC_LONG_STALE_RECOVERY_VENUE_NOT_FLAT");
    }

    const beforeBytes = await readFile(this.path);
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(beforeBytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
      raw = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
      throw error;
    }
    const before = normalizedState(raw, this.runtimeCommitSha || undefined, this.mode);
    if (raw.positions !== undefined && raw.positions !== null && !Array.isArray(raw.positions)) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
    if (!Array.isArray(raw.failures)) throw new Error("HYPE_ZEC_LONG_STATE_MALFORMED");
    if ((before.positions || []).length > 0 || before.pending || before.manualReview) throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_NOT_FLAT");
    if (now - before.updatedAt <= HYPE_ZEC_LONG_STATE_MAX_AGE_MS) return { status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_NOOP", statePath: this.path, state: before, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };

    const backupPath = `${this.path}.before-stale-flat-recovery-${now}`;
    await input.lock.document();
    try {
      await copyFile(this.path, backupPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "EEXIST") throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_BACKUP_EXISTS");
      throw error;
    }
    if (!beforeBytes.equals(await readFile(backupPath))) throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_BACKUP_NOT_EXACT");
    if (process.platform !== "win32") {
      await chown(backupPath, metadata.uid, metadata.gid);
      await chmod(backupPath, metadata.mode & 0o777);
    }

    const auditReason = `HYPE_ZEC_STALE_FLAT_RECONCILED:${input.reason}`;
    const nextRaw = {
      ...raw,
      // V4 CERTIFIED/ATTEST_EACH_PEER treats an omitted HYPE positions field
      // as canonical flat state; preserving legacy null would fail attestation.
      positions: undefined,
      updatedAt: now,
      lastDecisionTs: now,
      lastDecision: { strategy: "HYPE_LONG", signalTs: null, accepted: false, reason: auditReason },
      failures: [...before.failures, { message: auditReason, occurredAt: now }].slice(-100),
    };
    const nextBytes = `${JSON.stringify(nextRaw, null, 2)}\n`;
    const temporary = `${this.path}.${process.pid}.${Date.now()}.stale-recovery.tmp`;
    const handle = await open(temporary, "wx", metadata.mode & 0o777);
    try {
      await handle.writeFile(nextBytes, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (process.platform !== "win32") {
        await chown(temporary, metadata.uid, metadata.gid);
        await chmod(temporary, metadata.mode & 0o777);
      }
      await input.lock.document();
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const readback = await readFile(this.path);
    if (!readback.equals(Buffer.from(nextBytes))) throw new Error("HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_READBACK_MISMATCH");
    return {
      status: "HYPE_ZEC_LONG_STALE_FLAT_RECOVERY_PASS",
      statePath: this.path,
      state: normalizedState(JSON.parse(nextBytes), this.runtimeCommitSha || undefined, this.mode),
      backupPath,
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    };
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
