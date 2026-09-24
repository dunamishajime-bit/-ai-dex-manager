import test from "node:test";
import assert from "node:assert/strict";

import { MemoryQuality102CausalV1StateStore, type Quality102CausalV1State } from "../lib/disdex-quality102-causal-v1-state";
import { Q102_PENDING_RECOVERY_ACK, reconcilePlannedQ102Pending } from "../lib/disdex-quality102-pending-recovery";

const sha = "a".repeat(40);
const pending = {
  idempotencyKey: "pending-id",
  clientOrderId: "q102v1-entry-pending-id",
  phase: "planned" as const,
  symbol: "AVAXUSDT",
  side: "BUY" as const,
  quantity: 16,
  reduceOnly: false,
  referenceTs: 1_000,
  createdAt: 1_000,
  updatedAt: 1_000,
  expectedPrice: 10,
  targetGross: 2.5,
  hardStop: 0.045,
  family: "REV" as const,
  variant: "REV12_T0.03_H12",
  layer: "S3" as const,
  exitPolicy: "FIXED_HOLD_STOP" as const,
  maxHoldHours: 12,
  reason: "QUALITY102_CAUSAL_V4_NATURAL_SIGNAL:REV",
};
function makeState(): Quality102CausalV1State {
  return { version: 1, strategyId: "QUALITY102_CAUSAL_V1", mode: "LIVE", runtimeCommitSha: sha, updatedAt: 1_000, pending, failures: [] };
}
function deps(overrides: Record<string, unknown> = {}) {
  return {
    getOrder: async () => { throw Object.assign(new Error("Order does not exist."), { code: -2013, status: 400 }); },
    getUserTrades: async () => ({ rows: [], complete: true }),
    getPositions: async () => [],
    getOpenOrders: async () => [],
    ...overrides,
  };
}
const base = () => ({ stateStore: new MemoryQuality102CausalV1StateStore(makeState()), readonlyDeps: deps(), expectedRuntimeSha: sha, expectedIdempotencyKey: pending.idempotencyKey, expectedClientOrderId: pending.clientOrderId, now: () => 100_000 });

test("requires three stable read-only rounds and never mutates in verify-only mode", async () => {
  const input = base();
  const result = await reconcilePlannedQ102Pending(input);
  assert.equal(result.status, "VERIFY_ONLY_PASS");
  assert.equal(result.rounds, 3);
  assert.ok((await input.stateStore.load()).pending);
});

test("applies only the exact proven no-exposure pending transition after backup", async () => {
  const input = { ...base(), apply: true, ack: Q102_PENDING_RECOVERY_ACK, statePath: "state.json", backupPath: "backup.json", backup: async () => undefined };
  const result = await reconcilePlannedQ102Pending(input);
  assert.equal(result.status, "NO_EXPOSURE_PENDING_RECOVERED");
  const state = await input.stateStore.load();
  assert.equal(state.pending, undefined);
  assert.equal(state.lastCompletedIdempotencyKey, pending.idempotencyKey);
  assert.equal(state.runtimeCommitSha, sha);
});

test("rejects an ambiguous order lookup without writing", async () => {
  const input = base();
  const before = JSON.stringify(await input.stateStore.load());
  await assert.rejects(() => reconcilePlannedQ102Pending({ ...input, readonlyDeps: deps({ getOrder: async () => { throw new Error("ECONNRESET"); } }) }), /ECONNRESET/);
  assert.equal(JSON.stringify(await input.stateStore.load()), before);
});

test("rejects matching trades, positions, open orders, races, and incomplete history", async () => {
  for (const override of [
    { getUserTrades: async () => ({ rows: [{ symbol: "AVAXUSDT", time: 99_999 }], complete: true }) },
    { getPositions: async () => [{ symbol: "AVAXUSDT", positionAmt: "1" }] },
    { getOpenOrders: async () => [{ symbol: "AVAXUSDT", clientOrderId: "other" }] },
    { getUserTrades: async () => ({ rows: [], complete: false }) },
  ]) {
    const input = base();
    await assert.rejects(() => reconcilePlannedQ102Pending({ ...input, readonlyDeps: deps(override) }));
    assert.ok((await input.stateStore.load()).pending);
  }
  let loads = 0;
  const input = base();
  const racing = { ...input, stateStore: { load: async () => { loads += 1; const state = makeState(); if (loads === 2) state.pending = { ...pending, updatedAt: 2_000 }; return state; }, save: async () => undefined } };
  await assert.rejects(() => reconcilePlannedQ102Pending(racing), /STATE_CHANGED/);
});
