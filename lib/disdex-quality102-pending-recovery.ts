import { copyFile } from "node:fs/promises";

import type {
  Quality102CausalV1PendingOrder,
  Quality102CausalV1State,
  Quality102CausalV1StateStore,
} from "./disdex-quality102-causal-v1-state";

export type Q102ReadonlyOrder = {
  symbol?: string;
  clientOrderId?: string;
  status?: string;
  code?: number;
};

export type Q102ReadonlyPosition = {
  symbol?: string;
  positionAmt?: string | number;
};

export type Q102ReadonlyTrade = {
  symbol?: string;
  time?: string | number;
  clientOrderId?: string;
  orderId?: string | number;
};

export type Q102ReadonlyOpenOrder = Q102ReadonlyOrder & {
  origQty?: string | number;
  executedQty?: string | number;
};

export type Q102TradeRead = {
  rows: readonly Q102ReadonlyTrade[];
  complete: boolean;
};

export interface Q102PendingRecoveryReadonlyDeps {
  getOrder(symbol: string, clientOrderId: string): Promise<Q102ReadonlyOrder>;
  getUserTrades(symbol: string, input: { startTime: number; endTime: number; limit: number }): Promise<Q102TradeRead>;
  getPositions(): Promise<readonly Q102ReadonlyPosition[]>;
  getOpenOrders(): Promise<readonly Q102ReadonlyOpenOrder[]>;
}

export interface Q102PendingRecoveryInput {
  stateStore: Quality102CausalV1StateStore;
  readonlyDeps: Q102PendingRecoveryReadonlyDeps;
  expectedRuntimeSha: string;
  expectedIdempotencyKey: string;
  expectedClientOrderId: string;
  statePath?: string;
  backupPath?: string;
  rounds?: number;
  minAgeMs?: number;
  now?: () => number;
  apply?: boolean;
  ack?: string;
  requiredAck?: string;
  backup?: (statePath: string, backupPath: string) => Promise<void>;
}

export type Q102PendingRecoveryResult = {
  status: "VERIFY_ONLY_PASS" | "NO_EXPOSURE_PENDING_RECOVERED";
  requestId: string;
  rounds: number;
  backupPath?: string;
  ordersSent: 0;
  cancelsSent: 0;
  positionChangesSent: 0;
};

const SHA = /^[0-9a-f]{40}$/i;
const DEFAULT_ACK = "I_ACK_Q102_NO_EXPOSURE_PENDING_RECOVERY_AFTER_THREE_READONLY_ROUNDS";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pendingIdentity(pending: Quality102CausalV1PendingOrder): string {
  return JSON.stringify({
    idempotencyKey: pending.idempotencyKey,
    clientOrderId: pending.clientOrderId,
    phase: pending.phase,
    symbol: pending.symbol,
    side: pending.side,
    quantity: pending.quantity,
    reduceOnly: pending.reduceOnly,
    referenceTs: pending.referenceTs,
    createdAt: pending.createdAt,
    updatedAt: pending.updatedAt,
    expectedPrice: pending.expectedPrice,
    targetGross: pending.targetGross,
    hardStop: pending.hardStop,
    family: pending.family,
    variant: pending.variant,
    layer: pending.layer,
    exitPolicy: pending.exitPolicy,
    maxHoldHours: pending.maxHoldHours,
    reason: pending.reason,
    lastError: pending.lastError,
  });
}

function stateIdentity(state: Quality102CausalV1State): string {
  return JSON.stringify(state);
}

function notFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown };
  return Number(value.code) === -2013 || (Number(value.status) === 404 && Number(value.code) === -2013);
}

function assertStaticState(state: Quality102CausalV1State, input: Q102PendingRecoveryInput, now: number): Quality102CausalV1PendingOrder {
  if (!SHA.test(input.expectedRuntimeSha)) throw new Error("Q102_PENDING_RECOVERY_RUNTIME_SHA_INVALID");
  if (state.strategyId !== "QUALITY102_CAUSAL_V1" || state.mode !== "LIVE" || state.version !== 1) {
    throw new Error("Q102_PENDING_RECOVERY_STATE_SCHEMA_INVALID");
  }
  if (state.runtimeCommitSha !== input.expectedRuntimeSha) throw new Error("Q102_PENDING_RECOVERY_RUNTIME_SHA_MISMATCH");
  if (state.position) throw new Error("Q102_PENDING_RECOVERY_LOCAL_POSITION_PRESENT");
  const pending = state.pending;
  if (!pending || pending.phase !== "planned" || pending.reduceOnly) throw new Error("Q102_PENDING_RECOVERY_PLANNED_ENTRY_REQUIRED");
  if (pending.idempotencyKey !== input.expectedIdempotencyKey || pending.clientOrderId !== input.expectedClientOrderId) {
    throw new Error("Q102_PENDING_RECOVERY_PENDING_IDENTITY_MISMATCH");
  }
  if (!(pending.createdAt > 0) || pending.createdAt > now) throw new Error("Q102_PENDING_RECOVERY_CREATED_AT_INVALID");
  if (now - pending.createdAt < (input.minAgeMs ?? 30_000)) throw new Error("Q102_PENDING_RECOVERY_PENDING_TOO_FRESH");
  return pending;
}

async function proveRound(input: Q102PendingRecoveryInput, pending: Quality102CausalV1PendingOrder, now: number) {
  try {
    const order = await input.readonlyDeps.getOrder(pending.symbol, pending.clientOrderId);
    throw new Error(`Q102_PENDING_RECOVERY_ORDER_PRESENT:${order.status || "UNKNOWN"}`);
  } catch (error) {
    if (!notFoundError(error)) throw error;
  }

  const [tradeRead, positions, openOrders] = await Promise.all([
    input.readonlyDeps.getUserTrades(pending.symbol, {
      startTime: Math.max(0, pending.createdAt - 60_000),
      endTime: now + 1_000,
      limit: 1_000,
    }),
    input.readonlyDeps.getPositions(),
    input.readonlyDeps.getOpenOrders(),
  ]);
  if (!tradeRead.complete) throw new Error("Q102_PENDING_RECOVERY_USER_TRADES_INCOMPLETE");
  const relevantTrades = tradeRead.rows.filter((row) => numberValue(row.time) >= pending.createdAt - 60_000);
  if (relevantTrades.length) throw new Error("Q102_PENDING_RECOVERY_MATCHING_TRADE_PRESENT");
  const nonFlatPositions = positions.filter((row) => Math.abs(numberValue(row.positionAmt)) > 1e-12);
  if (nonFlatPositions.length) throw new Error("Q102_PENDING_RECOVERY_ACCOUNT_POSITION_PRESENT");
  if (openOrders.length) throw new Error("Q102_PENDING_RECOVERY_OPEN_ORDER_PRESENT");
}

async function defaultBackup(statePath: string, backupPath: string) {
  await copyFile(statePath, backupPath);
}

export async function reconcilePlannedQ102Pending(input: Q102PendingRecoveryInput): Promise<Q102PendingRecoveryResult> {
  const rounds = input.rounds ?? 3;
  if (rounds !== 3) throw new Error("Q102_PENDING_RECOVERY_EXACTLY_THREE_ROUNDS_REQUIRED");
  if (input.apply && input.ack !== (input.requiredAck || DEFAULT_ACK)) throw new Error("Q102_PENDING_RECOVERY_ACK_REQUIRED");
  if (input.statePath && input.apply && !input.backupPath) throw new Error("Q102_PENDING_RECOVERY_BACKUP_PATH_REQUIRED");

  const now = input.now || (() => Date.now());
  let initial = await input.stateStore.load();
  const pending = assertStaticState(initial, input, now());
  const requestId = pending.idempotencyKey;
  const expectedPendingIdentity = pendingIdentity(pending);
  const expectedStateIdentity = stateIdentity(initial);

  for (let round = 0; round < rounds; round += 1) {
    const roundState = await input.stateStore.load();
    const roundPending = assertStaticState(roundState, input, now());
    if (pendingIdentity(roundPending) !== expectedPendingIdentity || stateIdentity(roundState) !== expectedStateIdentity) {
      throw new Error("Q102_PENDING_RECOVERY_STATE_CHANGED_DURING_READONLY_ROUNDS");
    }
    await proveRound(input, roundPending, now());
  }

  if (!input.apply) {
    return { status: "VERIFY_ONLY_PASS", requestId, rounds, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
  }

  initial = await input.stateStore.load();
  const finalPending = assertStaticState(initial, input, now());
  if (pendingIdentity(finalPending) !== expectedPendingIdentity || stateIdentity(initial) !== expectedStateIdentity) {
    throw new Error("Q102_PENDING_RECOVERY_FINAL_STATE_CHANGED");
  }
  const backupPath = input.backupPath as string;
  await (input.backup || defaultBackup)(input.statePath as string, backupPath);
  const recovered: Quality102CausalV1State = {
    ...initial,
    pending: undefined,
    lastCompletedIdempotencyKey: finalPending.idempotencyKey,
    lastProcessedReferenceTs: Math.max(initial.lastProcessedReferenceTs || 0, finalPending.referenceTs),
    lastReconciledAt: now(),
    updatedAt: now(),
  };
  await input.stateStore.save(recovered);
  return { status: "NO_EXPOSURE_PENDING_RECOVERED", requestId, rounds, backupPath, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
}

export const Q102_PENDING_RECOVERY_ACK = DEFAULT_ACK;
