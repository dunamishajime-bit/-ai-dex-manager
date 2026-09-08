import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const HOUR_MS = 3_600_000;
const QUANTITY_EPSILON = 1e-12;

export type OneShotOwner =
  | "V12_X1.00_ALL"
  | "PENGU_DUAL_LS_V2_FINAL"
  | "QUALITY102_CAUSAL_V1";

export interface OneShotForceCloseRequest {
  legId: string;
  owner: OneShotOwner;
  symbol: "DOGEUSDT" | "AAVEUSDT" | "PENGUUSDT";
  side: "SHORT";
  maxNotionalUsd: 10;
}

/**
 * The request set is deliberately closed. This command is not a generic
 * order console: it can only run the three one-time legs that were approved.
 */
export const ONE_SHOT_FORCE_CLOSE_REQUESTS: readonly OneShotForceCloseRequest[] = Object.freeze([
  { legId: "v12-doge-short", owner: "V12_X1.00_ALL", symbol: "DOGEUSDT", side: "SHORT", maxNotionalUsd: 10 },
  { legId: "q102-aave-short", owner: "QUALITY102_CAUSAL_V1", symbol: "AAVEUSDT", side: "SHORT", maxNotionalUsd: 10 },
  { legId: "pengu-pengu-short", owner: "PENGU_DUAL_LS_V2_FINAL", symbol: "PENGUUSDT", side: "SHORT", maxNotionalUsd: 10 },
]);

export type OneShotLegStatus =
  | "PLANNED"
  | "ENTRY_PENDING"
  | "CLOSE_PENDING"
  | "CLOSE_SUBMITTED"
  | "CLOSED"
  | "MANUAL_REVIEW";

export interface OneShotExecutionResult {
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "REJECTED" | "CANCELED" | "EXPIRED" | "UNKNOWN";
  executedQuantity: number;
  averagePrice: number;
  updatedAt?: number;
  clientOrderId: string;
  executionUnknown: boolean;
  reduceOnly?: boolean;
  orderId?: number;
  error?: string;
}

export interface OneShotLegState {
  legId: string;
  owner: OneShotOwner;
  symbol: string;
  entrySide: "SELL";
  closeSide: "BUY";
  requestedNotionalUsd: 10;
  status: OneShotLegStatus;
  entryClientOrderId: string;
  closeClientOrderId: string;
  entryOrderId?: number;
  closeOrderId?: number;
  filledQuantity?: number;
  averageEntryPrice?: number;
  filledAtTs?: number;
  closeAtTs?: number;
  closedAtTs?: number;
  closeAttemptCount: number;
  error?: string;
}

export interface OneShotForceCloseState {
  schema: "disdex-one-shot-force-close/v1";
  testId: string;
  createdAt: number;
  updatedAt: number;
  status: "PLANNED" | "ENTRY_IN_PROGRESS" | "CLOSE_PENDING" | "COMPLETE" | "MANUAL_REVIEW";
  legs: OneShotLegState[];
}

export interface OneShotCloseOrder {
  legId: string;
  owner: OneShotOwner;
  symbol: string;
  side: "BUY";
  quantity: number;
  reduceOnly: true;
  clientOrderId: string;
}

export function isOneShotStrategyPosition(value: {
  oneShotTestId?: string;
  oneShotCloseAtTs?: number;
}): boolean {
  return typeof value.oneShotTestId === "string"
    && value.oneShotTestId.trim().length > 0
    && Number.isFinite(value.oneShotCloseAtTs)
    && Number(value.oneShotCloseAtTs) > 0;
}

function finitePositive(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`ONE_SHOT_INVALID_${field}`);
  return number;
}

function validateRequests(requests: readonly OneShotForceCloseRequest[]): OneShotForceCloseRequest[] {
  if (requests.length !== ONE_SHOT_FORCE_CLOSE_REQUESTS.length) throw new Error("ONE_SHOT_REQUIRES_EXACTLY_THREE_REQUESTS");
  const expected = new Map(ONE_SHOT_FORCE_CLOSE_REQUESTS.map((request) => [request.legId, request]));
  const seen = new Set<string>();
  for (const request of requests) {
    const canonical = expected.get(request.legId);
    if (!canonical || seen.has(request.legId)) throw new Error("ONE_SHOT_REQUEST_SET_MISMATCH");
    if (request.owner !== canonical.owner || request.symbol !== canonical.symbol || request.side !== "SHORT" || request.maxNotionalUsd !== 10) {
      throw new Error("ONE_SHOT_REQUEST_NOT_APPROVED");
    }
    seen.add(request.legId);
  }
  if (seen.size !== expected.size) throw new Error("ONE_SHOT_REQUEST_SET_INCOMPLETE");
  return [...requests];
}

function stateStatus(legs: readonly OneShotLegState[]): OneShotForceCloseState["status"] {
  if (legs.some((leg) => leg.status === "MANUAL_REVIEW")) return "MANUAL_REVIEW";
  if (legs.every((leg) => leg.status === "CLOSED")) return "COMPLETE";
  if (legs.some((leg) => leg.status === "CLOSE_PENDING" || leg.status === "CLOSE_SUBMITTED")) return "CLOSE_PENDING";
  if (legs.some((leg) => leg.status === "ENTRY_PENDING")) return "ENTRY_IN_PROGRESS";
  return "PLANNED";
}

function withStatus(state: OneShotForceCloseState, legs: OneShotLegState[], updatedAt: number): OneShotForceCloseState {
  return { ...state, legs, status: stateStatus(legs), updatedAt };
}

export function entryClientOrderId(testId: string, legId: string): string {
  return `q1-${testId}-entry-${legId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 36);
}

export function closeClientOrderId(testId: string, legId: string, attempt = 0): string {
  return `q1-${testId}-close-${legId}-${attempt}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 36);
}

export function createOneShotPlan(now: number, requests: readonly OneShotForceCloseRequest[] = ONE_SHOT_FORCE_CLOSE_REQUESTS): OneShotForceCloseState {
  finitePositive(now, "PLAN_TIMESTAMP");
  const normalized = validateRequests(requests);
  const testId = `20260908-${now}`;
  return {
    schema: "disdex-one-shot-force-close/v1",
    testId,
    createdAt: now,
    updatedAt: now,
    status: "PLANNED",
    legs: normalized.map((request) => ({
      legId: request.legId,
      owner: request.owner,
      symbol: request.symbol,
      entrySide: "SELL",
      closeSide: "BUY",
      requestedNotionalUsd: request.maxNotionalUsd,
      status: "PLANNED",
      entryClientOrderId: entryClientOrderId(testId, request.legId),
      closeClientOrderId: closeClientOrderId(testId, request.legId),
      closeAttemptCount: 0,
    })),
  };
}

export function recordEntryExecution(
  state: OneShotForceCloseState,
  owner: OneShotOwner,
  result: OneShotExecutionResult,
  fillTs: number,
): OneShotForceCloseState {
  const leg = state.legs.find((item) => item.owner === owner);
  if (!leg) throw new Error(`ONE_SHOT_UNKNOWN_ENTRY_OWNER:${owner}`);
  if (leg.status !== "PLANNED" && leg.status !== "ENTRY_PENDING") throw new Error(`ONE_SHOT_ENTRY_NOT_PENDING:${owner}`);
  if (result.executionUnknown || result.status === "UNKNOWN") {
    return withStatus(state, state.legs.map((item) => item.legId === leg.legId
      ? { ...item, status: "MANUAL_REVIEW", error: "ENTRY_EXECUTION_UNKNOWN_NO_RETRY" }
      : item), fillTs);
  }
  if (result.status !== "FILLED" && result.status !== "PARTIALLY_FILLED") {
    return withStatus(state, state.legs.map((item) => item.legId === leg.legId
      ? { ...item, status: "MANUAL_REVIEW", error: `ENTRY_NOT_FILLED:${result.status}` }
      : item), fillTs);
  }
  const quantity = finitePositive(result.executedQuantity, "ENTRY_QUANTITY");
  const averagePrice = finitePositive(result.averagePrice, "ENTRY_PRICE");
  const timestamp = finitePositive(fillTs, "FILL_TIMESTAMP");
  if (result.clientOrderId !== leg.entryClientOrderId) throw new Error("ONE_SHOT_ENTRY_CLIENT_ORDER_ID_MISMATCH");
  return withStatus(state, state.legs.map((item) => item.legId === leg.legId
    ? {
      ...item,
      status: "CLOSE_PENDING",
      entryOrderId: result.orderId,
      filledQuantity: quantity,
      averageEntryPrice: averagePrice,
      filledAtTs: timestamp,
      closeAtTs: timestamp + HOUR_MS,
      error: undefined,
    }
    : item), timestamp);
}

export function markEntryPending(state: OneShotForceCloseState, legId: string, updatedAt: number): OneShotForceCloseState {
  const leg = state.legs.find((item) => item.legId === legId);
  if (!leg || leg.status !== "PLANNED") throw new Error(`ONE_SHOT_ENTRY_PLAN_NOT_PENDING:${legId}`);
  return withStatus(state, state.legs.map((item) => item.legId === legId ? { ...item, status: "ENTRY_PENDING", error: undefined } : item), updatedAt);
}

export function planDueCloseOrders(state: OneShotForceCloseState, now: number): OneShotCloseOrder[] {
  finitePositive(now, "CLOSE_TIMESTAMP");
  return state.legs
    .filter((leg) => leg.status === "CLOSE_PENDING" && Number(leg.closeAtTs) <= now && Number(leg.filledQuantity) > QUANTITY_EPSILON)
    .map((leg) => ({
      legId: leg.legId,
      owner: leg.owner,
      symbol: leg.symbol,
      side: "BUY" as const,
      quantity: leg.filledQuantity as number,
      reduceOnly: true as const,
      clientOrderId: leg.closeClientOrderId,
    }));
}

export function markCloseSubmitted(state: OneShotForceCloseState, legId: string, updatedAt: number): OneShotForceCloseState {
  const leg = state.legs.find((item) => item.legId === legId);
  if (!leg || leg.status !== "CLOSE_PENDING") throw new Error(`ONE_SHOT_CLOSE_PLAN_NOT_PENDING:${legId}`);
  return withStatus(state, state.legs.map((item) => item.legId === legId ? { ...item, status: "CLOSE_SUBMITTED" } : item), updatedAt);
}

export function recordCloseExecution(
  state: OneShotForceCloseState,
  legId: string,
  result: OneShotExecutionResult,
  now: number,
): OneShotForceCloseState {
  const leg = state.legs.find((item) => item.legId === legId);
  if (!leg) throw new Error(`ONE_SHOT_UNKNOWN_CLOSE_LEG:${legId}`);
  if (leg.status !== "CLOSE_PENDING" && leg.status !== "CLOSE_SUBMITTED") throw new Error(`ONE_SHOT_CLOSE_NOT_PENDING:${legId}`);
  if (result.reduceOnly !== true) throw new Error("ONE_SHOT_CLOSE_MUST_BE_REDUCE_ONLY");
  if (result.clientOrderId !== leg.closeClientOrderId) throw new Error("ONE_SHOT_CLOSE_CLIENT_ORDER_ID_MISMATCH");
  if (result.executionUnknown || result.status === "UNKNOWN") {
    return withStatus(state, state.legs.map((item) => item.legId === legId
      ? { ...item, status: "MANUAL_REVIEW", error: "CLOSE_EXECUTION_UNKNOWN_NO_RETRY" }
      : item), now);
  }
  if (result.status !== "FILLED" && result.status !== "PARTIALLY_FILLED") {
    return withStatus(state, state.legs.map((item) => item.legId === legId
      ? { ...item, status: "MANUAL_REVIEW", error: `CLOSE_NOT_FILLED:${result.status}` }
      : item), now);
  }
  const executed = finitePositive(result.executedQuantity, "CLOSE_QUANTITY");
  const remaining = Math.max(0, (leg.filledQuantity || 0) - executed);
  const timestamp = finitePositive(now, "CLOSE_TIMESTAMP");
  return withStatus(state, state.legs.map((item) => {
    if (item.legId !== legId) return item;
    if (remaining <= QUANTITY_EPSILON) return { ...item, status: "CLOSED", closeOrderId: result.orderId, closedAtTs: timestamp, filledQuantity: 0, closeAttemptCount: item.closeAttemptCount + 1, error: undefined };
    return {
      ...item,
      status: "CLOSE_PENDING",
      closeOrderId: result.orderId,
      filledQuantity: remaining,
      closeAtTs: timestamp,
      closeAttemptCount: item.closeAttemptCount + 1,
      closeClientOrderId: closeClientOrderId(state.testId, item.legId, item.closeAttemptCount + 1),
    };
  }), timestamp);
}

function normalizeState(value: unknown): OneShotForceCloseState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ONE_SHOT_STATE_MALFORMED");
  const raw = value as Partial<OneShotForceCloseState>;
  if (raw.schema !== "disdex-one-shot-force-close/v1" || typeof raw.testId !== "string" || !raw.testId) throw new Error("ONE_SHOT_STATE_IDENTITY_INVALID");
  if (!Array.isArray(raw.legs) || raw.legs.length !== ONE_SHOT_FORCE_CLOSE_REQUESTS.length) throw new Error("ONE_SHOT_STATE_LEG_COUNT_INVALID");
  const expected = new Map(ONE_SHOT_FORCE_CLOSE_REQUESTS.map((request) => [request.legId, request]));
  const legIds = new Set<string>();
  const legs = raw.legs.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("ONE_SHOT_STATE_LEG_INVALID");
    const leg = candidate as OneShotLegState;
    const request = expected.get(leg.legId);
    if (!request || legIds.has(leg.legId) || leg.owner !== request.owner || leg.symbol !== request.symbol || leg.entrySide !== "SELL" || leg.closeSide !== "BUY" || leg.requestedNotionalUsd !== 10) throw new Error("ONE_SHOT_STATE_LEG_IDENTITY_INVALID");
    legIds.add(leg.legId);
    if (!["PLANNED", "ENTRY_PENDING", "CLOSE_PENDING", "CLOSE_SUBMITTED", "CLOSED", "MANUAL_REVIEW"].includes(leg.status)) throw new Error("ONE_SHOT_STATE_LEG_STATUS_INVALID");
    if (typeof leg.entryClientOrderId !== "string" || typeof leg.closeClientOrderId !== "string" || !Number.isInteger(leg.closeAttemptCount) || leg.closeAttemptCount < 0) throw new Error("ONE_SHOT_STATE_LEG_ORDER_ID_INVALID");
    return { ...leg };
  });
  if (legIds.size !== expected.size) throw new Error("ONE_SHOT_STATE_LEG_SET_INCOMPLETE");
  if (!Number.isFinite(Number(raw.createdAt)) || !Number.isFinite(Number(raw.updatedAt))) throw new Error("ONE_SHOT_STATE_TIMESTAMP_INVALID");
  return { schema: "disdex-one-shot-force-close/v1", testId: raw.testId, createdAt: Number(raw.createdAt), updatedAt: Number(raw.updatedAt), status: stateStatus(legs), legs };
}

export class FileOneShotForceCloseStateStore {
  private readonly path: string;
  constructor(path: string) { this.path = resolve(path); }

  async load(): Promise<OneShotForceCloseState | undefined> {
    try {
      return normalizeState(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(state: OneShotForceCloseState): Promise<void> {
    const normalized = normalizeState(state);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
