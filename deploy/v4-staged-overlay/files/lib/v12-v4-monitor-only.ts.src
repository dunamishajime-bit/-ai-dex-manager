import { validateV4BudgetSocketPath } from "./disdex-v4-rate-budget-proxy";

export const V4_MONITOR_RUNTIME_MAX_AGE_MS = 15 * 60_000;
export const V4_MONITOR_FUTURE_GRACE_MS = 1_000;

type JsonRecord = Record<string, any>;

export function assertV4SharedRateBudget(path: unknown): void {
  if (path !== "/var/lib/disdex/shared/aster-rate-budget.json") {
    throw new Error("V4_MONITOR_SHARED_RATE_BUDGET_REQUIRED");
  }
}

export function assertV4MonitorRateBudget(path: unknown, socket: unknown, sha: unknown): void {
  assertV4SharedRateBudget(path);
  if (typeof socket !== "string" || !socket) throw new Error("V4_MONITOR_RATE_BUDGET_PROXY_REQUIRED");
  validateV4BudgetSocketPath(String(sha || ""), socket);
}

function createV4ReadOnlyFetch(fetchImpl: typeof fetch, allowedPaths: ReadonlySet<string>): typeof fetch {
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("V4_MONITOR_HTTP_NOT_ALLOWED"); }
    if (method !== "GET" || url.origin !== "https://fapi.asterdex.com" || !allowedPaths.has(url.pathname)) {
      throw new Error("V4_MONITOR_HTTP_NOT_ALLOWED");
    }
    return fetchImpl(input, { ...init, redirect: "error" });
  };
}

/** A transport boundary that cannot send order mutations or follow redirects. */
export function createV4MonitorFetch(fetchImpl: typeof fetch): typeof fetch {
  return createV4ReadOnlyFetch(fetchImpl, new Set(["/fapi/v3/klines", "/fapi/v3/positionRisk", "/fapi/v3/openOrders"]));
}

export function createV4EvidenceFetch(fetchImpl: typeof fetch): typeof fetch {
  return createV4ReadOnlyFetch(fetchImpl, new Set(["/fapi/v3/time", "/fapi/v3/balance", "/fapi/v3/positionRisk", "/fapi/v3/openOrders"]));
}

export type V4MonitorReadOnlySnapshot = {
  now: number;
  risk: JsonRecord;
  margin: JsonRecord;
  killSwitch: JsonRecord;
  pending: JsonRecord;
  positions: JsonRecord[];
  openOrders: JsonRecord[];
  decision?: JsonRecord;
};

export type V4MonitorResult = {
  status: "observing" | "blocked";
  reason: string;
  eventTs: number;
  candidateCount: number | null;
  orderEnabled: false;
  positionCount: number | null;
  openOrderCount: number | null;
  pendingCount: number | null;
};

export function blockedV4MonitorRead(reason: string, at: number): V4MonitorResult {
  return { status: "blocked", reason: "V4_MONITOR_READ_FAILED:" + reason, eventTs: at,
    candidateCount: null, orderEnabled: false, positionCount: null, openOrderCount: null, pendingCount: null };
}

/** Publish a tick only after the complete read-only decision cycle returns. */
export async function runV4MonitorCycle(input: {
  collect: (startedAt: number) => Promise<V4MonitorResult>;
  onError: (error: unknown, at: number) => V4MonitorResult;
  publishTick: (result: V4MonitorResult, startedAt: number, completedAt: number) => Promise<void>;
  publishHealth: (result: V4MonitorResult, heartbeatAt: number, lastTickAt: number | null) => Promise<void>;
  clock: () => number;
  lastTickAt: number | null;
}) {
  const startedAt = input.clock();
  let result: V4MonitorResult;
  let completed = false;
  try {
    result = await input.collect(startedAt);
    completed = true;
  } catch (error) {
    result = input.onError(error, input.clock());
  }
  const heartbeatAt = input.clock();
  let lastTickAt = input.lastTickAt;
  if (completed) {
    await input.publishTick(result, startedAt, heartbeatAt);
    lastTickAt = heartbeatAt;
  }
  await input.publishHealth(result, heartbeatAt, lastTickAt);
  return { result, lastTickAt };
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("V4_MONITOR_" + label + "_INVALID");
  }
  return value as JsonRecord;
}

function fresh(value: unknown, now: number, label: string) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0
      || timestamp > now + V4_MONITOR_FUTURE_GRACE_MS
      || now - timestamp > V4_MONITOR_RUNTIME_MAX_AGE_MS) {
    throw new Error("V4_MONITOR_" + label + "_STALE");
  }
  return timestamp;
}

function activePositions(rows: JsonRecord[]) {
  return rows.filter((row) => {
    const amount = row?.positionAmt;
    if ((typeof amount !== "string" && typeof amount !== "number")
        || (typeof amount === "string" && !amount.trim())) {
      throw new Error("V4_MONITOR_POSITION_AMOUNT_INVALID");
    }
    const value = Number(amount);
    if (!Number.isFinite(value)) throw new Error("V4_MONITOR_POSITION_AMOUNT_INVALID");
    return Math.abs(value) > 1e-12;
  });
}

/** A finished read-only decision can be recorded even when entries are blocked. */
export function evaluateV4MonitorCompletedDecision(input: V4MonitorReadOnlySnapshot, entrySafetyError: string | null): V4MonitorResult {
  if (!entrySafetyError) return validateV4MonitorReadOnlySnapshot(input);
  const now = Number(input.now);
  if (!Number.isFinite(now) || now <= 0) throw new Error("V4_MONITOR_TIME_INVALID");
  if (!input.decision) throw new Error("V4_MONITOR_DECISION_MISSING");
  const decision = record(input.decision, "DECISION");
  if (decision.orderEnabled !== false || decision.tradingMutation !== 0 || decision.realOrderEnabledV4 !== 0)
    throw new Error("V4_MONITOR_DECISION_MUTATION_CONTRACT_INVALID");
  if (!Array.isArray(decision.errors) || decision.errors.length) throw new Error("V4_MONITOR_DECISION_INCOMPLETE");
  const candidateCount = decision.candidateCount;
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) throw new Error("V4_MONITOR_CANDIDATE_COUNT_INVALID");
  const reason = entrySafetyError.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 160);
  if (!reason) throw new Error("V4_MONITOR_SAFETY_REASON_INVALID");
  return {status:"blocked",reason:"V4_MONITOR_ENTRY_SAFETY_BLOCKED:"+reason,eventTs:now,
    candidateCount,orderEnabled:false,positionCount:null,openOrderCount:null,pendingCount:null};
}

export function validateV4MonitorReadOnlySnapshot(input: V4MonitorReadOnlySnapshot): V4MonitorResult {
  const now = Number(input.now);
  if (!Number.isFinite(now) || now <= 0) throw new Error("V4_MONITOR_TIME_INVALID");

  const risk = record(input.risk, "SHARED_RISK");
  if (risk.sourceComplete !== true || risk.tripped !== false) {
    throw new Error("V4_MONITOR_SHARED_RISK_NOT_HEALTHY");
  }
  if (risk.maximumLossPct !== 7.5) throw new Error("V4_MONITOR_SHARED_RISK_LIMIT_INVALID");
  if (risk.utcDay !== new Date(now).toISOString().slice(0, 10)) {
    throw new Error("V4_MONITOR_SHARED_RISK_WRONG_UTC_DAY");
  }
  fresh(risk.updatedAt, now, "SHARED_RISK");

  const margin = record(input.margin, "MARGIN_GUARD");
  if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) {
    throw new Error("V4_MONITOR_MARGIN_GUARD_NOT_HEALTHY");
  }
  fresh(margin.checkedAt, now, "MARGIN_GUARD");

  const kill = record(input.killSwitch, "KILL_SWITCH");
  if (kill.active !== false) throw new Error("V4_MONITOR_KILL_SWITCH_NOT_PROVEN_INACTIVE");

  const pending = record(input.pending, "PENDING");
  if (pending.schema !== "disdex-pending-exposure/v1"
      || pending.accountScope !== "ASTER_FUTURES"
      || !Array.isArray(pending.entries)) {
    throw new Error("V4_MONITOR_PENDING_REGISTRY_INVALID");
  }
  fresh(pending.updatedAt, now, "PENDING");
  const activePending = pending.entries.filter(
    (entry: JsonRecord) => String(entry?.status || "").toUpperCase() !== "RELEASED",
  );
  if (activePending.length) throw new Error("V4_MONITOR_PENDING_NOT_EMPTY:" + activePending.length);

  if (!Array.isArray(input.positions) || !Array.isArray(input.openOrders)) {
    throw new Error("V4_MONITOR_VENUE_SNAPSHOT_INVALID");
  }
  const positions = activePositions(input.positions);
  const openOrders = input.openOrders;
  const decision = input.decision ? record(input.decision, "DECISION") : undefined;
  if (!decision) throw new Error("V4_MONITOR_DECISION_MISSING");
  if (decision.orderEnabled !== false || decision.tradingMutation !== 0
      || decision.realOrderEnabledV4 !== 0) {
    throw new Error("V4_MONITOR_DECISION_MUTATION_CONTRACT_INVALID");
  }
  if (!Array.isArray(decision.errors) || decision.errors.length) throw new Error("V4_MONITOR_DECISION_INCOMPLETE");
  const candidateCount = decision.candidateCount;
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new Error("V4_MONITOR_CANDIDATE_COUNT_INVALID");
  }
  // Monitor-only has no independent ownership graph. Non-flat venue state must
  // be handled by the separate STOP/gross ownership attestation before LIVE.
  if (positions.length || openOrders.length) {
    return {
      status: "blocked",
      reason: "V4_MONITOR_NONFLAT_REQUIRES_INDEPENDENT_OWNERSHIP_PROOF",
      eventTs: now,
      candidateCount,
      orderEnabled: false,
      positionCount: positions.length,
      openOrderCount: openOrders.length,
      pendingCount: activePending.length,
    };
  }

  return {
    status: "observing",
    reason: "V4_MONITOR_ONLY_READONLY_CYCLE",
    eventTs: now,
    candidateCount,
    orderEnabled: false,
    positionCount: 0,
    openOrderCount: 0,
    pendingCount: 0,
  };
}
