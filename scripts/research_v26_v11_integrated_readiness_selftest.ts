import fs from "fs/promises";
import path from "path";

import { AsterV3Client } from "../lib/aster-v3-client";
import { V11AsterExecutionGateway } from "../lib/research-lab/perp/v11-aster-execution-gateway";
import {
  V11_ENTRY_MAX_AGE_MS,
  V11StaleEntryError,
  executeV11FreshEntry,
  replaceV11ResidentStop,
  v11DecisionClientOrderId,
  v11StopClientOrderId,
  type V11DecisionIntent,
} from "../lib/research-lab/perp/v11-execution-safety";
import { UpstashV11ExecutionLease } from "../lib/research-lab/perp/v11-upstash-execution-lease";

const TEST_PRIVATE_KEY = `0x${"22".repeat(32)}` as `0x${string}`;
const TEST_USER = "0x2222222222222222222222222222222222222222";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V11_INTEGRATED_READINESS_FAIL:${message}`);
}

class FakeEvalRedis {
  now = 0;
  private fence = 0;
  private readonly leases = new Map<string, { value: string; expiresAt: number }>();
  private readonly committed = new Map<string, string>();

  async eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData> {
    if (script.includes("V11_TRY_ACQUIRE")) {
      const committed = this.committed.get(keys[2]!);
      if (committed) {
        const [fence] = committed.split("|");
        return [0, Number(fence), "COMMITTED"] as TData;
      }
      const current = this.leases.get(keys[0]!);
      if (current && current.expiresAt > this.now) {
        const [fence, owner] = current.value.split("|");
        return [0, Number(fence), owner || "UNKNOWN"] as TData;
      }
      this.leases.delete(keys[0]!);
      this.fence += 1;
      const owner = String(args[0]);
      const ttlMs = Number(args[1]);
      this.leases.set(keys[0]!, { value: `${this.fence}|${owner}`, expiresAt: this.now + ttlMs });
      return [1, this.fence, owner] as TData;
    }
    if (script.includes("V11_MARK_COMMITTED")) {
      const expected = `${String(args[0])}|${String(args[1])}`;
      const current = this.leases.get(keys[0]!);
      if (!current || current.expiresAt <= this.now || current.value !== expected) return 0 as TData;
      this.committed.set(keys[2]!, expected);
      this.leases.delete(keys[0]!);
      return 1 as TData;
    }
    throw new Error("unexpected Redis script");
  }
}

type Captured = { method: string; pathname: string; params: URLSearchParams };
type StoredOrder = {
  symbol: string;
  clientOrderId: string;
  status: string;
  side: "BUY" | "SELL";
  positionSide: "BOTH";
  type: string;
  reduceOnly: boolean;
  stopPrice?: string;
  origQty: string;
  executedQty: string;
};

function buildVenue() {
  const calls: Captured[] = [];
  const orders = new Map<string, StoredOrder>();
  let market503AfterStore = false;
  let stop503AfterStore = false;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = String(init?.method || "GET");
    const params = method === "GET"
      ? url.searchParams
      : new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    calls.push({ method, pathname: url.pathname, params });

    if (url.pathname === "/fapi/v3/positionSide/dual") {
      return new Response(JSON.stringify({ dualSidePosition: false }), { status: 200 });
    }
    if (url.pathname === "/fapi/v3/exchangeInfo") {
      return new Response(JSON.stringify({ symbols: [{ symbol: "BTCUSDT", status: "TRADING", orderTypes: ["MARKET", "STOP_MARKET"] }] }), { status: 200 });
    }
    if (url.pathname === "/fapi/v3/order" && method === "GET") {
      const clientOrderId = String(params.get("origClientOrderId") || "");
      const order = orders.get(clientOrderId);
      if (!order) return new Response(JSON.stringify({ code: -2013, msg: "Order does not exist." }), { status: 400 });
      return new Response(JSON.stringify(order), { status: 200 });
    }
    if (url.pathname === "/fapi/v3/order" && method === "POST") {
      const clientOrderId = String(params.get("newClientOrderId") || "");
      const type = String(params.get("type") || "");
      const order: StoredOrder = {
        symbol: String(params.get("symbol") || ""),
        clientOrderId,
        status: type === "MARKET" ? "FILLED" : "NEW",
        side: String(params.get("side")) as "BUY" | "SELL",
        positionSide: "BOTH",
        type,
        reduceOnly: params.get("reduceOnly") === "true",
        stopPrice: params.get("stopPrice") || undefined,
        origQty: String(params.get("quantity") || "0"),
        executedQty: type === "MARKET" ? String(params.get("quantity") || "0") : "0",
      };
      orders.set(clientOrderId, order);
      if (type === "MARKET" && market503AfterStore) {
        market503AfterStore = false;
        return new Response(JSON.stringify({ code: -1000, msg: "execution unknown" }), { status: 503 });
      }
      if (type === "STOP_MARKET" && stop503AfterStore) {
        stop503AfterStore = false;
        return new Response(JSON.stringify({ code: -1000, msg: "execution unknown" }), { status: 503 });
      }
      return new Response(JSON.stringify(order), { status: 200 });
    }
    if (url.pathname === "/fapi/v3/order" && method === "DELETE") {
      const clientOrderId = String(params.get("origClientOrderId") || "");
      const order = orders.get(clientOrderId);
      if (!order) return new Response(JSON.stringify({ code: -2011, msg: "Unknown order sent." }), { status: 400 });
      const canceled = { ...order, status: "CANCELED" };
      orders.set(clientOrderId, canceled);
      return new Response(JSON.stringify(canceled), { status: 200 });
    }
    return new Response(JSON.stringify({ code: -1002, msg: "unexpected endpoint" }), { status: 400 });
  };

  return {
    calls,
    orders,
    fakeFetch,
    armMarket503AfterStore: () => { market503AfterStore = true; },
    armStop503AfterStore: () => { stop503AfterStore = true; },
  };
}

function decision(id: string, decisionTs: number): V11DecisionIntent {
  return {
    decisionId: id,
    decisionTs,
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "0.01",
    expectedPrice: 100_000,
  };
}

async function main() {
  const venue = buildVenue();
  const redis = new FakeEvalRedis();
  const tradingClient = new AsterV3Client({
    baseUrl: "https://unit.test",
    userAddress: TEST_USER,
    privateKey: TEST_PRIVATE_KEY,
    fetchImpl: venue.fakeFetch,
    requestTimeoutMs: 2_000,
    now: () => redis.now,
  });
  const gateway = new V11AsterExecutionGateway(tradingClient);
  const lease = new UpstashV11ExecutionLease(redis, { claimSafetyMs: 60_000, committedTtlMs: 60 * 60 * 1000 });
  const baseTs = Date.UTC(2026, 7, 16, 12, 0, 0);
  const cases: Record<string, unknown> = {};

  // Aster only promises client-order-id uniqueness among open orders. If the
  // owner dies after claiming but before submission, takeover could duplicate a
  // filled MARKET order. Keep the claim through the deadline and skip safely.
  const failoverIntent = decision("BTC-20260816T120000Z-LONG", baseTs);
  redis.now = baseTs + 1_000;
  const abandoned = await lease.tryAcquire({
    key: `v11:${failoverIntent.decisionId}`,
    owner: "primary",
    now: redis.now,
    expiresAt: baseTs + V11_ENTRY_MAX_AGE_MS,
  });
  assert(abandoned.acquired && abandoned.fence === 1, "primary did not acquire initial fence");
  redis.now = baseTs + 7_000;
  const standby = await executeV11FreshEntry({ intent: failoverIntent, executorId: "standby", clock: () => redis.now, lease, gateway });
  redis.now = baseTs + V11_ENTRY_MAX_AGE_MS;
  const expired = await executeV11FreshEntry({ intent: failoverIntent, executorId: "third", clock: () => redis.now, lease, gateway });
  const failoverId = v11DecisionClientOrderId(failoverIntent);
  const failoverMarketCalls = venue.calls.filter((call) => call.method === "POST" && call.params.get("type") === "MARKET" && call.params.get("newClientOrderId") === failoverId).length;
  assert(standby.outcome === "LEASE_DENIED", "claimed decision was taken over");
  assert(expired.outcome === "STALE_REJECTED", "expired claimed decision did not fail closed");
  assert(failoverMarketCalls === 0, "claimed-owner crash leaked a market order");
  cases.claimedOwnerCrashFailsClosed = { abandonedFence: abandoned.fence, standby: standby.outcome, expired: expired.outcome, marketCalls: failoverMarketCalls };

  // If the primary is unavailable before any claim, the standby can own the
  // same fresh decision tick and execute it exactly once.
  const standbyIntent = decision("BTC-20260816T121000Z-LONG", baseTs + 10 * 60_000);
  redis.now = standbyIntent.decisionTs + 1_000;
  const standbyFirst = await executeV11FreshEntry({ intent: standbyIntent, executorId: "standby", clock: () => redis.now, lease, gateway });
  const duplicate = await executeV11FreshEntry({ intent: standbyIntent, executorId: "primary", clock: () => redis.now, lease, gateway });
  const standbyId = v11DecisionClientOrderId(standbyIntent);
  const standbyMarketCalls = venue.calls.filter((call) => call.method === "POST" && call.params.get("type") === "MARKET" && call.params.get("newClientOrderId") === standbyId).length;
  assert(standbyFirst.outcome === "EXECUTED", "standby could not own an unclaimed fresh tick");
  assert(duplicate.outcome === "LEASE_DENIED", "completed standby decision was reacquired");
  assert(standbyMarketCalls === 1, "standby-first execution was not exactly once");
  cases.unclaimedTickStandbyExecution = { standby: standbyFirst.outcome, duplicate: duplicate.outcome, marketCalls: standbyMarketCalls };

  // Aster accepts the order but returns 503. The exact clientOrderId is queried and never blindly retried.
  const unknownIntent = decision("BTC-20260816T122000Z-LONG", baseTs + 20 * 60_000);
  venue.armMarket503AfterStore();
  redis.now = unknownIntent.decisionTs + 1_000;
  const unknown = await executeV11FreshEntry({ intent: unknownIntent, executorId: "primary", clock: () => redis.now, lease, gateway });
  const unknownId = v11DecisionClientOrderId(unknownIntent);
  const unknownMarketCalls = venue.calls.filter((call) => call.method === "POST" && call.params.get("type") === "MARKET" && call.params.get("newClientOrderId") === unknownId).length;
  assert(unknown.outcome === "RECONCILED_AFTER_UNKNOWN", "accepted 503 entry was not reconciled");
  assert(unknownMarketCalls === 1, "accepted 503 entry was blindly retried");
  cases.entry503AfterAccept = { outcome: unknown.outcome, marketCalls: unknownMarketCalls };

  // Ratchet the stop by placing and verifying the new venue order before canceling the old one.
  const oldStopId = v11StopClientOrderId({ symbol: "BTCUSDT", decisionId: failoverIntent.decisionId, version: 1 });
  venue.orders.set(oldStopId, { symbol: "BTCUSDT", clientOrderId: oldStopId, status: "NEW", side: "SELL", positionSide: "BOTH", type: "STOP_MARKET", reduceOnly: true, stopPrice: "95000", origQty: "0.01", executedQty: "0" });
  const beforeReplace = venue.calls.length;
  const replaced = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: failoverIntent.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "97000", oldStopClientOrderId: oldStopId });
  const replaceCalls = venue.calls.slice(beforeReplace);
  const stopPostIndex = replaceCalls.findIndex((call) => call.method === "POST" && call.params.get("type") === "STOP_MARKET");
  const oldCancelIndex = replaceCalls.findIndex((call) => call.method === "DELETE" && call.params.get("origClientOrderId") === oldStopId);
  assert(replaced.outcome === "REPLACED", "integrated stop replacement failed");
  assert(stopPostIndex >= 0 && oldCancelIndex > stopPostIndex, "old stop canceled before new stop placement");
  assert(venue.orders.get(replaced.newStopClientOrderId)?.reduceOnly === true, "new stop is not reduce-only");
  cases.stopRatchetOrder = { outcome: replaced.outcome, newStopBeforeOldCancel: oldCancelIndex > stopPostIndex };

  // Lost STOP_MARKET ACK is reconciled before the old stop is canceled.
  const oldStop503Id = v11StopClientOrderId({ symbol: "BTCUSDT", decisionId: unknownIntent.decisionId, version: 1 });
  venue.orders.set(oldStop503Id, { symbol: "BTCUSDT", clientOrderId: oldStop503Id, status: "NEW", side: "SELL", positionSide: "BOTH", type: "STOP_MARKET", reduceOnly: true, stopPrice: "94000", origQty: "0.01", executedQty: "0" });
  venue.armStop503AfterStore();
  const stopUnknown = await replaceV11ResidentStop({ gateway, symbol: "BTCUSDT", decisionId: unknownIntent.decisionId, version: 2, closeSide: "SELL", quantity: "0.01", stopPrice: "96000", oldStopClientOrderId: oldStop503Id });
  assert(stopUnknown.outcome === "REPLACED", "accepted 503 stop was not reconciled");
  assert(venue.orders.get(stopUnknown.newStopClientOrderId)?.reduceOnly === true, "reconciled stop lost reduce-only flag");
  cases.stop503AfterAccept = { outcome: stopUnknown.outcome, newStopConfirmed: stopUnknown.newStopConfirmed };

  const staleIntent = decision("BTC-20260816T130000Z-LONG", baseTs + 60 * 60_000);
  const postCountBeforeStale = venue.calls.filter((call) => call.method === "POST").length;
  redis.now = staleIntent.decisionTs + V11_ENTRY_MAX_AGE_MS;
  const stale = await executeV11FreshEntry({ intent: staleIntent, executorId: "standby", clock: () => redis.now, lease, gateway });
  const postCountAfterStale = venue.calls.filter((call) => call.method === "POST").length;
  assert(stale.outcome === "STALE_REJECTED" && postCountAfterStale === postCountBeforeStale, "stale entry reached Aster");
  cases.staleEntry = { outcome: stale.outcome, submitted: stale.submitted };

  const postCountBeforeDeadline = venue.calls.filter((call) => call.method === "POST").length;
  let hardDeadlineRejected = false;
  try {
    await gateway.placeMarket({ symbol: "BTCUSDT", side: "BUY", quantity: "0.01", clientOrderId: "v11-e-expired-deadline", deadlineTs: redis.now });
  } catch (error) {
    hardDeadlineRejected = error instanceof V11StaleEntryError;
  }
  const postCountAfterDeadline = venue.calls.filter((call) => call.method === "POST").length;
  assert(hardDeadlineRejected && postCountAfterDeadline === postCountBeforeDeadline, "gateway submitted after the hard entry deadline");
  cases.hardEntryDeadline = { rejected: hardDeadlineRejected, submitted: false };

  const signedNonces = venue.calls
    .map((call) => call.params.get("nonce"))
    .filter((value): value is string => Boolean(value))
    .map((value) => BigInt(value));
  assert(new Set(signedNonces.map(String)).size === signedNonces.length, "single Agent nonce stream repeated a nonce");
  assert(signedNonces.every((value, index) => index === 0 || value > signedNonces[index - 1]!), "single Agent nonce stream is not strictly increasing");
  cases.singleAgentNonceStream = { signedRequestCount: signedNonces.length, unique: true, strictlyIncreasing: true };

  const output = {
    researchLine: "V26_V11_INTEGRATED_EXECUTION_READINESS",
    researchOnly: true,
    productionDeployed: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    pass: true,
    architectureVerified: {
      concreteAsterGateway: true,
      singleClientNonceStreamPerAgent: true,
      fullFreshnessAtMostOnceClaim: true,
      standbyCanOwnUnclaimedFreshDecision: true,
      claimedOwnerCrashFailsClosed: true,
      committedDecisionCannotReacquire: true,
      deterministicClientOrderReconciliation: true,
      exchangeClientIdNotTreatedAsPermanentIdempotency: true,
      noBlindRetryAfter503: true,
      venueResidentReduceOnlyStop: true,
      newStopVerifiedBeforeOldCancel: true,
      staleEntryFailsClosed: true,
      hardEntryDeadlineAtClientBoundary: true,
    },
    operationalRequirements: {
      distinctAsterAgentSignerPerExecutor: true,
      nonceScope: "Aster V3 nonce uniqueness is maintained per Agent address; primary and standby must not share one signer key.",
      requirementVerifiedOnDeployment: false,
      claimedOwnerCrashPolicy: "FAIL_CLOSED_SKIP_ENTRY",
      clientOrderIdScope: "OPEN_ORDERS_ONLY_PER_ASTER_DOCUMENTATION",
      claimLossStressBacktested: true,
      claimLossStressEvidence: "docs/research-results/v26-latency-aware-v12-latest.json",
    },
    authenticatedVenueDryRun: false,
    liveFeasibilityVerified: false,
    remainingBoundary: "Verify a distinct Aster Agent signer per executor, authenticated /order/test, and an isolated non-production STOP_MARKET lifecycle before any LIVE integration.",
    caseCount: Object.keys(cases).length,
    cases,
  };
  const dir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "v26-v11-integrated-readiness.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
