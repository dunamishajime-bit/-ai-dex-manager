import fs from "fs/promises";
import path from "path";

import {
  V11_ENTRY_MAX_AGE_MS,
  V11ExecutionUnknownError,
  V11OrderNotFoundError,
  executeV11FreshEntry,
  replaceV11ResidentStop,
  v11DecisionClientOrderId,
  v11StopClientOrderId,
  type V11AsterGateway,
  type V11DecisionIntent,
  type V11ExecutionLease,
  type V11LeaseGrant,
  type V11OrderSnapshot,
} from "../lib/research-lab/perp/v11-execution-safety";

class FakeLease implements V11ExecutionLease {
  private fence = 0;
  private readonly leases = new Map<string, { owner: string; expiresAt: number; fence: number; committed: boolean }>();
  unavailable = false;

  async tryAcquire(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<V11LeaseGrant> {
    if (this.unavailable) throw new Error("lease store unavailable");
    const existing = this.leases.get(input.key);
    if (existing && (existing.committed || existing.expiresAt > input.now)) {
      return { acquired: existing.owner === input.owner && !existing.committed, fence: existing.fence, owner: existing.owner };
    }
    this.fence += 1;
    this.leases.set(input.key, { owner: input.owner, expiresAt: input.expiresAt, fence: this.fence, committed: false });
    return { acquired: true, fence: this.fence, owner: input.owner };
  }

  async markCommitted(input: { key: string; owner: string; fence: number }) {
    const current = this.leases.get(input.key);
    if (!current || current.owner !== input.owner || current.fence !== input.fence) throw new Error("fence mismatch");
    current.committed = true;
  }
}

class FakeGateway implements V11AsterGateway {
  oneWay = true;
  stopMarket = true;
  marketCalls = 0;
  stopCalls = 0;
  cancelCalls = 0;
  unknownMarketAfterRecord = false;
  unknownMarketWithoutRecord = false;
  uncertainGetOrder = false;
  failStopBeforeRecord = false;
  unknownStopAfterRecord = false;
  failCancel = false;
  readonly orders = new Map<string, V11OrderSnapshot>();

  async isOneWayMode() { return this.oneWay; }
  async supportsStopMarket() { return this.stopMarket; }
  async getOrder(symbol: string, clientOrderId: string) {
    if (this.uncertainGetOrder) throw new Error("Aster query unavailable");
    const order = this.orders.get(clientOrderId);
    if (!order || order.symbol !== symbol) throw new V11OrderNotFoundError();
    return order;
  }
  async placeMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: string; clientOrderId: string }) {
    this.marketCalls += 1;
    if (this.unknownMarketWithoutRecord) throw new V11ExecutionUnknownError("timeout before known ack");
    const order: V11OrderSnapshot = { clientOrderId: input.clientOrderId, symbol: input.symbol, status: "FILLED", reduceOnly: false };
    this.orders.set(input.clientOrderId, order);
    if (this.unknownMarketAfterRecord) throw new V11ExecutionUnknownError("timeout after exchange accepted order");
    return order;
  }
  async placeReduceOnlyStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: string; stopPrice: string; clientOrderId: string }) {
    this.stopCalls += 1;
    if (this.failStopBeforeRecord) throw new Error("new stop rejected");
    const order: V11OrderSnapshot = { clientOrderId: input.clientOrderId, symbol: input.symbol, status: "NEW", reduceOnly: true, stopPrice: input.stopPrice };
    this.orders.set(input.clientOrderId, order);
    if (this.unknownStopAfterRecord) throw new V11ExecutionUnknownError("stop ack lost");
    return order;
  }
  async cancelOrder(symbol: string, clientOrderId: string) {
    this.cancelCalls += 1;
    if (this.failCancel) throw new Error("cancel unavailable");
    const order = await this.getOrder(symbol, clientOrderId);
    const canceled = { ...order, status: "CANCELED" as const };
    this.orders.set(clientOrderId, canceled);
    return canceled;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V11_EXECUTION_SELFTEST_FAIL:${message}`);
}

function intent(decisionTs = Date.UTC(2026, 7, 16, 10, 0, 0)): V11DecisionIntent {
  return { decisionId: "BTC-20260816T100000Z-LONG", decisionTs, symbol: "BTCUSDT", side: "BUY", quantity: "0.01", expectedPrice: 100000 };
}

async function main() {
  const cases: Record<string, unknown> = {};
  const base = intent();

  {
    const lease = new FakeLease(); const gateway = new FakeGateway();
    const primary = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 10_000, lease, gateway });
    const secondary = await executeV11FreshEntry({ intent: base, executorId: "secondary", now: base.decisionTs + 20_000, lease, gateway });
    assert(primary.outcome === "EXECUTED", "primary did not execute");
    assert(secondary.outcome === "LEASE_DENIED", "secondary was not fenced");
    assert(gateway.marketCalls === 1, "split-brain produced duplicate market order");
    cases.splitBrainLeaseFencing = { primary: primary.outcome, secondary: secondary.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); const gateway = new FakeGateway(); gateway.unknownMarketAfterRecord = true;
    const result = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 5_000, lease, gateway });
    assert(result.outcome === "RECONCILED_AFTER_UNKNOWN", "unknown execution was not reconciled");
    assert(gateway.marketCalls === 1, "unknown execution was retried");
    cases.ackLossAfterExchangeAccept = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); const gateway = new FakeGateway(); gateway.unknownMarketWithoutRecord = true;
    const result = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 5_000, lease, gateway });
    assert(result.outcome === "EXECUTION_UNKNOWN_FAIL_CLOSED", "absent order after unknown did not fail closed");
    assert(gateway.marketCalls === 1, "execution-unknown path automatically retried");
    cases.unknownWithoutOrder = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); const gateway = new FakeGateway(); gateway.uncertainGetOrder = true;
    const result = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 5_000, lease, gateway });
    assert(result.outcome === "RECONCILIATION_UNCERTAIN_FAIL_CLOSED", "query uncertainty did not fail closed");
    assert(gateway.marketCalls === 0, "order submitted despite uncertain pre-reconciliation");
    cases.preSubmitReconciliationUnavailable = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); lease.unavailable = true; const gateway = new FakeGateway();
    const result = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 5_000, lease, gateway });
    assert(result.outcome === "LEASE_DENIED", "lease outage did not fail closed");
    assert(gateway.marketCalls === 0, "order submitted without lease");
    cases.leaseUnavailable = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); const gateway = new FakeGateway();
    const result = await executeV11FreshEntry({ intent: base, executorId: "standby", now: base.decisionTs + V11_ENTRY_MAX_AGE_MS, lease, gateway });
    assert(result.outcome === "STALE_REJECTED", "one-hour stale entry was not rejected");
    assert(gateway.marketCalls === 0, "stale entry reached Aster");
    cases.staleOneHourEntry = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  {
    const lease = new FakeLease(); const gateway = new FakeGateway(); gateway.oneWay = false;
    const result = await executeV11FreshEntry({ intent: base, executorId: "primary", now: base.decisionTs + 1_000, lease, gateway });
    assert(result.outcome === "PREFLIGHT_REJECTED", "hedge mode was not rejected");
    assert(gateway.marketCalls === 0, "hedge-mode preflight leaked order");
    cases.hedgeModeRejected = { outcome: result.outcome, marketCalls: gateway.marketCalls };
  }

  const oldStopId = v11StopClientOrderId({ symbol: "BTCUSDT", decisionId: base.decisionId, version: 1 });
  {
    const gateway = new FakeGateway(); gateway.orders.set(oldStopId, { clientOrderId: oldStopId, symbol: "BTCUSDT", status: "NEW", reduceOnly: true, stopPrice: "95000" });
    const result = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: base.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "97000", oldStopClientOrderId: oldStopId });
    assert(result.outcome === "REPLACED", "resident stop was not replaced");
    assert(result.newStopConfirmed && !result.oldStopRetained, "replacement state incorrect");
    assert(gateway.stopCalls === 1 && gateway.cancelCalls === 1, "replace sequence call count incorrect");
    cases.stopPlaceVerifyThenCancel = { outcome: result.outcome, stopCalls: gateway.stopCalls, cancelCalls: gateway.cancelCalls };
  }

  {
    const gateway = new FakeGateway(); gateway.failStopBeforeRecord = true; gateway.orders.set(oldStopId, { clientOrderId: oldStopId, symbol: "BTCUSDT", status: "NEW", reduceOnly: true, stopPrice: "95000" });
    const result = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: base.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "97000", oldStopClientOrderId: oldStopId });
    assert(result.outcome === "NEW_STOP_UNCONFIRMED_OLD_RETAINED", "failed new stop did not retain old protection");
    assert(gateway.cancelCalls === 0, "old stop canceled before new stop confirmation");
    assert(gateway.orders.get(oldStopId)?.status === "NEW", "old stop protection disappeared");
    cases.newStopRejectedOldRetained = { outcome: result.outcome, cancelCalls: gateway.cancelCalls, oldStatus: gateway.orders.get(oldStopId)?.status };
  }

  {
    const gateway = new FakeGateway(); gateway.unknownStopAfterRecord = true; gateway.orders.set(oldStopId, { clientOrderId: oldStopId, symbol: "BTCUSDT", status: "NEW", reduceOnly: true, stopPrice: "95000" });
    const result = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: base.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "97000", oldStopClientOrderId: oldStopId });
    assert(result.outcome === "REPLACED", "lost stop ACK was not reconciled before cancel");
    assert(gateway.cancelCalls === 1, "old stop not canceled after confirmed replacement");
    cases.stopAckLostReconciled = { outcome: result.outcome, cancelCalls: gateway.cancelCalls };
  }

  {
    const gateway = new FakeGateway(); gateway.failCancel = true; gateway.orders.set(oldStopId, { clientOrderId: oldStopId, symbol: "BTCUSDT", status: "NEW", reduceOnly: true, stopPrice: "95000" });
    const result = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: base.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "97000", oldStopClientOrderId: oldStopId });
    assert(result.outcome === "OVERLAP_SAFE_OLD_CANCEL_FAILED", "cancel failure did not preserve overlap-safe protection");
    assert(result.newStopConfirmed && result.oldStopRetained, "overlap-safe state incorrect");
    const newOrder = gateway.orders.get(result.newStopClientOrderId); const oldOrder = gateway.orders.get(oldStopId);
    assert(newOrder?.reduceOnly === true && oldOrder?.reduceOnly === true, "overlap stops are not both reduce-only");
    cases.oldStopCancelFailedOverlapSafe = { outcome: result.outcome, oldReduceOnly: oldOrder?.reduceOnly, newReduceOnly: newOrder?.reduceOnly };
  }

  const entryId = v11DecisionClientOrderId(base); const stopId = v11StopClientOrderId({ symbol: base.symbol, decisionId: base.decisionId, version: 999 });
  const idRegex = /^[.A-Z:/a-z0-9_-]{1,36}$/;
  assert(idRegex.test(entryId) && idRegex.test(stopId), "deterministic IDs violate Aster format");
  cases.clientOrderIds = { entryId, stopId, entryLength: entryId.length, stopLength: stopId.length };

  const output = {
    researchLine: "V26_V11_EXECUTION_SAFETY_SELFTEST",
    researchOnly: true,
    productionDeployed: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    architecture: {
      entryFreshnessMs: V11_ENTRY_MAX_AGE_MS,
      staleEntryPolicy: "FAIL_CLOSED_REJECT",
      positionModeRequirement: "ONE_WAY",
      entryRedundancy: "LEASE_FENCED_ACTIVE_STANDBY_WITH_PRE_SUBMIT_RECONCILIATION",
      executionUnknownPolicy: "RECONCILE_THEN_NEVER_BLIND_RETRY",
      residentStopUpdate: "PLACE_NEW_REDUCE_ONLY_STOP_VERIFY_THEN_CANCEL_OLD",
      stopCancelFailure: "KEEP_BOTH_REDUCE_ONLY_STOPS_UNTIL_RECONCILED",
    },
    pass: true,
    caseCount: Object.keys(cases).length,
    cases,
  };
  const dir = process.env.RESEARCH_STATE_DIR || ".research-state"; await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "v26-v11-execution-safety.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
