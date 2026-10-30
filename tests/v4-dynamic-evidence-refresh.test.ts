import assert from "node:assert/strict";
import test from "node:test";
import {
  buildV4DynamicEvidence,
  buildV4DynamicRefreshPlan,
  collectV4DynamicEvidence,
  type V4DynamicRuntimeSnapshot,
} from "../scripts/ops/root/disdex-v4-dynamic-evidence-refresh";

const SHA = "a".repeat(40);
const NOW = Date.parse("2026-10-30T00:00:00.000Z");
const staticPayloads = {
  routeSourceParity: { status: "PASS", candidateSha: SHA, capturedAt: new Date(NOW - 30 * 86400000).toISOString(), routeCount: 41, sourceParity: true },
  v4ExecutionTests: { status: "PASS", candidateSha: SHA, capturedAt: new Date(NOW - 30 * 86400000).toISOString(), testPasses: 206, failCount: 0, typecheck: true },
};
const healthyRuntime: V4DynamicRuntimeSnapshot = {
  sharedRisk: { sourceComplete: true, tripped: false },
  marginGuard: { stage: "HEALTHY", ordersAllowed: true },
  killSwitch: { active: false },
  pendingExposure: { schema: "disdex-pending-exposure/v1", entries: [] },
};

test("dynamic refresh performs one ordered read-only Aster round and never creates order authority", async () => {
  const calls: string[] = [];
  const client = {
    hasTradingCredentials: () => true,
    getServerTime: async () => { calls.push("time"); return { serverTime: NOW }; },
    getBalances: async () => { calls.push("balances"); return [{ asset: "USDT", balance: "100", availableBalance: "100" }]; },
    getPositions: async () => { calls.push("positions"); return [{ symbol: "NEARUSDT", positionAmt: "-2", entryPrice: "5", markPrice: "5" }]; },
    getOpenOrders: async () => { calls.push("openOrders"); return [{ symbol: "NEARUSDT", clientOrderId: "protected-stop", status: "NEW", side: "BUY" as const, type: "STOP_MARKET", reduceOnly: true, origQty: "2", stopPrice: "4.874" }]; },
  };
  const dynamic = await collectV4DynamicEvidence({ sha: SHA, now: NOW, client, runtime: healthyRuntime });
  assert.deepEqual(calls, ["time", "balances", "positions", "openOrders"]);
  assert.equal(dynamic.signedAsterAccount.signedGet, true);
  assert.equal(dynamic.signedAsterAccount.mutationCalls, 0);
  assert.equal(dynamic.sharedRiskAndPeers.pendingCount, 0);
  const plan = buildV4DynamicRefreshPlan({ sha: SHA, staticPayloads, dynamicPayloads: dynamic, now: NOW });
  assert.equal(plan.readOnly, true);
  assert.equal(plan.authorizesTrading, false);
  assert.deepEqual(plan.tradingEffects, { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 });
});

test("dynamic refresh fails closed on risk, lock, or pending drift", () => {
  const aster = { serverTime: NOW, balances: [], positions: [], openOrders: [], signedGet: true as const, mutationCalls: 0 as const };
  assert.throws(() => buildV4DynamicEvidence({ sha: SHA, now: NOW, aster, runtime: { ...healthyRuntime, killSwitch: { active: true } } }), /KILL_SWITCH/);
  assert.throws(() => buildV4DynamicEvidence({ sha: SHA, now: NOW, aster, runtime: { ...healthyRuntime, marginGuard: { stage: "BLOCKED", ordersAllowed: false } } }), /MARGIN_GUARD/);
  assert.throws(() => buildV4DynamicEvidence({ sha: SHA, now: NOW, aster, runtime: { ...healthyRuntime, pendingExposure: { entries: [{ status: "SUBMITTED" }] } } }), /PENDING_EXPOSURE/);
});

test("mixed dynamic generations are rejected instead of being treated as fresh", () => {
  const aster = { serverTime: NOW, balances: [], positions: [], openOrders: [], signedGet: true as const, mutationCalls: 0 as const };
  const dynamic = buildV4DynamicEvidence({ sha: SHA, now: NOW, aster, runtime: healthyRuntime });
  assert.throws(() => buildV4DynamicRefreshPlan({
    sha: SHA,
    staticPayloads,
    dynamicPayloads: { ...dynamic, signedAsterAccount: { ...dynamic.signedAsterAccount, refreshGeneration: "different-generation" } },
    now: NOW,
  }), /GENERATION_MISMATCH/);
});
