export const V11_ENTRY_MAX_AGE_MS = 60 * 60 * 1000;

export type V11Side = "BUY" | "SELL";
export type V11OrderStatus = "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "EXPIRED" | "REJECTED" | "UNKNOWN";

export interface V11DecisionIntent {
  decisionId: string;
  decisionTs: number;
  symbol: string;
  side: V11Side;
  quantity: string;
  expectedPrice: number;
}

export interface V11LeaseGrant {
  acquired: boolean;
  fence: number;
  owner?: string;
}

export interface V11ExecutionLease {
  tryAcquire(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<V11LeaseGrant>;
  markCommitted(input: { key: string; owner: string; fence: number }): Promise<void>;
}

export interface V11OrderSnapshot {
  clientOrderId: string;
  symbol: string;
  status: V11OrderStatus;
  reduceOnly?: boolean;
  stopPrice?: string;
}

export class V11ExecutionUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V11ExecutionUnknownError";
  }
}

export class V11OrderNotFoundError extends Error {
  constructor(message = "order not found") {
    super(message);
    this.name = "V11OrderNotFoundError";
  }
}

export class V11StaleEntryError extends Error {
  constructor(message = "entry decision deadline expired") {
    super(message);
    this.name = "V11StaleEntryError";
  }
}

export interface V11AsterGateway {
  isOneWayMode(): Promise<boolean>;
  supportsStopMarket(symbol: string): Promise<boolean>;
  getOrder(symbol: string, clientOrderId: string): Promise<V11OrderSnapshot>;
  placeMarket(input: {
    symbol: string;
    side: V11Side;
    quantity: string;
    clientOrderId: string;
    deadlineTs: number;
  }): Promise<V11OrderSnapshot>;
  placeReduceOnlyStopMarket(input: {
    symbol: string;
    side: V11Side;
    quantity: string;
    stopPrice: string;
    clientOrderId: string;
  }): Promise<V11OrderSnapshot>;
  cancelOrder(symbol: string, clientOrderId: string): Promise<V11OrderSnapshot>;
}

export type V11EntryOutcome =
  | "EXECUTED"
  | "RECONCILED_EXISTING"
  | "RECONCILED_AFTER_UNKNOWN"
  | "STALE_REJECTED"
  | "LEASE_DENIED"
  | "PREFLIGHT_REJECTED"
  | "RECONCILIATION_UNCERTAIN_FAIL_CLOSED"
  | "EXECUTION_UNKNOWN_FAIL_CLOSED";

export interface V11EntryResult {
  outcome: V11EntryOutcome;
  submitted: boolean;
  clientOrderId: string;
  fence?: number;
  order?: V11OrderSnapshot;
  reason?: string;
}

function sanitizeId(value: string) {
  const out = value.replace(/[^.A-Z:/a-z0-9_-]/g, "-").slice(0, 36);
  if (!out) throw new Error("V11 client order id is empty.");
  return out;
}

function shortHash(value: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(-7);
}

export function v11DecisionClientOrderId(intent: V11DecisionIntent) {
  const raw = `v11-e-${intent.symbol}-${intent.decisionTs.toString(36)}-${shortHash(intent.decisionId)}`;
  return sanitizeId(raw);
}

export function v11StopClientOrderId(input: { symbol: string; decisionId: string; version: number }) {
  const raw = `v11-s-${input.symbol}-${Math.max(0, Math.floor(input.version)).toString(36)}-${shortHash(input.decisionId)}`;
  return sanitizeId(raw);
}

export function isV11FreshDecision(decisionTs: number, now: number, maxAgeMs = V11_ENTRY_MAX_AGE_MS) {
  const age = now - decisionTs;
  return age >= 0 && age < maxAgeMs;
}

async function reconcileExisting(gateway: V11AsterGateway, symbol: string, clientOrderId: string) {
  try {
    return { kind: "found" as const, order: await gateway.getOrder(symbol, clientOrderId) };
  } catch (error) {
    if (error instanceof V11OrderNotFoundError) return { kind: "not-found" as const };
    return { kind: "uncertain" as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeV11FreshEntry(input: {
  intent: V11DecisionIntent;
  executorId: string;
  clock: () => number;
  lease: V11ExecutionLease;
  gateway: V11AsterGateway;
  maxAgeMs?: number;
}): Promise<V11EntryResult> {
  const { intent, executorId, clock, lease, gateway } = input;
  const maxAgeMs = input.maxAgeMs ?? V11_ENTRY_MAX_AGE_MS;
  const clientOrderId = v11DecisionClientOrderId(intent);
  const deadlineTs = intent.decisionTs + maxAgeMs;
  const initialNow = clock();

  if (!isV11FreshDecision(intent.decisionTs, initialNow, maxAgeMs)) {
    return { outcome: "STALE_REJECTED", submitted: false, clientOrderId, reason: "decision tick is stale" };
  }
  if (!(await gateway.isOneWayMode())) {
    return { outcome: "PREFLIGHT_REJECTED", submitted: false, clientOrderId, reason: "V11 requires Aster One-way Mode" };
  }
  if (!(await gateway.supportsStopMarket(intent.symbol))) {
    return { outcome: "PREFLIGHT_REJECTED", submitted: false, clientOrderId, reason: "STOP_MARKET unavailable" };
  }

  const leaseKey = `v11:${intent.decisionId}`;
  let grant: V11LeaseGrant;
  try {
    const leaseNow = clock();
    if (!isV11FreshDecision(intent.decisionTs, leaseNow, maxAgeMs)) {
      return { outcome: "STALE_REJECTED", submitted: false, clientOrderId, reason: "decision tick expired during preflight" };
    }
    grant = await lease.tryAcquire({ key: leaseKey, owner: executorId, now: leaseNow, expiresAt: deadlineTs });
  } catch (error) {
    return { outcome: "LEASE_DENIED", submitted: false, clientOrderId, reason: `lease unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!grant.acquired) {
    return { outcome: "LEASE_DENIED", submitted: false, clientOrderId, fence: grant.fence, reason: `owned by ${grant.owner || "another executor"}` };
  }

  const before = await reconcileExisting(gateway, intent.symbol, clientOrderId);
  if (before.kind === "found") {
    await lease.markCommitted({ key: leaseKey, owner: executorId, fence: grant.fence });
    return { outcome: "RECONCILED_EXISTING", submitted: false, clientOrderId, fence: grant.fence, order: before.order };
  }
  if (before.kind === "uncertain") {
    return { outcome: "RECONCILIATION_UNCERTAIN_FAIL_CLOSED", submitted: false, clientOrderId, fence: grant.fence, reason: before.error };
  }

  if (!isV11FreshDecision(intent.decisionTs, clock(), maxAgeMs)) {
    return { outcome: "STALE_REJECTED", submitted: false, clientOrderId, fence: grant.fence, reason: "decision tick expired before submission" };
  }

  try {
    const order = await gateway.placeMarket({ symbol: intent.symbol, side: intent.side, quantity: intent.quantity, clientOrderId, deadlineTs });
    await lease.markCommitted({ key: leaseKey, owner: executorId, fence: grant.fence });
    return { outcome: "EXECUTED", submitted: true, clientOrderId, fence: grant.fence, order };
  } catch (error) {
    if (error instanceof V11StaleEntryError) {
      return { outcome: "STALE_REJECTED", submitted: false, clientOrderId, fence: grant.fence, reason: error.message };
    }
    if (!(error instanceof V11ExecutionUnknownError)) throw error;
    const after = await reconcileExisting(gateway, intent.symbol, clientOrderId);
    if (after.kind === "found") {
      await lease.markCommitted({ key: leaseKey, owner: executorId, fence: grant.fence });
      return { outcome: "RECONCILED_AFTER_UNKNOWN", submitted: true, clientOrderId, fence: grant.fence, order: after.order };
    }
    return {
      outcome: "EXECUTION_UNKNOWN_FAIL_CLOSED",
      submitted: true,
      clientOrderId,
      fence: grant.fence,
      reason: after.kind === "uncertain" ? after.error : "order absent after execution-unknown; automatic retry prohibited",
    };
  }
}

export type V11StopReplaceOutcome =
  | "REPLACED"
  | "NEW_STOP_UNCONFIRMED_OLD_RETAINED"
  | "OVERLAP_SAFE_OLD_CANCEL_FAILED"
  | "PREFLIGHT_REJECTED";

export interface V11StopReplaceResult {
  outcome: V11StopReplaceOutcome;
  oldStopClientOrderId: string;
  newStopClientOrderId: string;
  oldStopRetained: boolean;
  newStopConfirmed: boolean;
  reason?: string;
}

export async function replaceV11ResidentStop(input: {
  gateway: V11AsterGateway;
  symbol: string;
  decisionId: string;
  version: number;
  closeSide: V11Side;
  quantity: string;
  stopPrice: string;
  oldStopClientOrderId: string;
}): Promise<V11StopReplaceResult> {
  const newStopClientOrderId = v11StopClientOrderId({ symbol: input.symbol, decisionId: input.decisionId, version: input.version });
  if (!(await input.gateway.isOneWayMode()) || !(await input.gateway.supportsStopMarket(input.symbol))) {
    return { outcome: "PREFLIGHT_REJECTED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: true, newStopConfirmed: false, reason: "One-way STOP_MARKET preflight failed" };
  }

  let placed: V11OrderSnapshot | undefined;
  try {
    placed = await input.gateway.placeReduceOnlyStopMarket({
      symbol: input.symbol,
      side: input.closeSide,
      quantity: input.quantity,
      stopPrice: input.stopPrice,
      clientOrderId: newStopClientOrderId,
    });
  } catch (error) {
    if (error instanceof V11ExecutionUnknownError) {
      const reconciled = await reconcileExisting(input.gateway, input.symbol, newStopClientOrderId);
      if (reconciled.kind === "found") placed = reconciled.order;
      else return { outcome: "NEW_STOP_UNCONFIRMED_OLD_RETAINED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: true, newStopConfirmed: false, reason: "new stop execution state unresolved" };
    } else {
      return { outcome: "NEW_STOP_UNCONFIRMED_OLD_RETAINED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: true, newStopConfirmed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const confirmed = placed?.status === "NEW" || placed?.status === "PARTIALLY_FILLED";
  if (!confirmed || placed?.reduceOnly !== true) {
    return { outcome: "NEW_STOP_UNCONFIRMED_OLD_RETAINED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: true, newStopConfirmed: false, reason: "new stop is not confirmed active reduce-only" };
  }

  try {
    await input.gateway.cancelOrder(input.symbol, input.oldStopClientOrderId);
    return { outcome: "REPLACED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: false, newStopConfirmed: true };
  } catch (error) {
    // Keep the new reduce-only stop. Two overlapping reduce-only protective stops are safer than a naked position.
    return { outcome: "OVERLAP_SAFE_OLD_CANCEL_FAILED", oldStopClientOrderId: input.oldStopClientOrderId, newStopClientOrderId, oldStopRetained: true, newStopConfirmed: true, reason: error instanceof Error ? error.message : String(error) };
  }
}
