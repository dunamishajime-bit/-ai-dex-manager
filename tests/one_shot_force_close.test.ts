import assert from "node:assert/strict";
import test from "node:test";

import {
  ONE_SHOT_FORCE_CLOSE_REQUESTS,
  createOneShotPlan,
  planDueCloseOrders,
  recordEntryExecution,
  recordCloseExecution,
  markEntryPending,
  markCloseSubmitted,
  isOneShotStrategyPosition,
  FileOneShotForceCloseStateStore,
  type OneShotExecutionResult,
} from "../lib/disdex-one-shot-force-close";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";
import { createPenguDualLsV2RunnerState, FilePenguDualLsV2RunnerStateStore } from "../lib/pengu-dual-ls-v2-runner-state";
import { createQuality102CausalV1State, FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function fill(overrides: Partial<OneShotExecutionResult> = {}): OneShotExecutionResult {
  return {
    status: "FILLED",
    executedQuantity: 2,
    averagePrice: 5,
    updatedAt: NOW + 1_000,
    clientOrderId: "one-shot-entry",
    executionUnknown: false,
    ...overrides,
  };
}

test("one-shot plan is exactly DOGE/AAVE/PENGU short at a maximum of 10 USD each", () => {
  assert.deepEqual(
    ONE_SHOT_FORCE_CLOSE_REQUESTS.map((request) => [request.owner, request.symbol, request.side, request.maxNotionalUsd]),
    [
      ["V12_X1.00_ALL", "DOGEUSDT", "SHORT", 10],
      ["QUALITY102_CAUSAL_V1", "AAVEUSDT", "SHORT", 10],
      ["PENGU_DUAL_LS_V2_FINAL", "PENGUUSDT", "SHORT", 10],
    ],
  );
  assert.throws(() => createOneShotPlan(NOW, [
    ...ONE_SHOT_FORCE_CLOSE_REQUESTS,
    { ...ONE_SHOT_FORCE_CLOSE_REQUESTS[0], legId: "duplicate" },
  ]), /EXACTLY_THREE/);
});

test("filled entry records the actual fill time and a one-hour close deadline", () => {
  let state = createOneShotPlan(NOW);
  const entry = state.legs.find((item) => item.owner === "V12_X1.00_ALL")!;
  state = recordEntryExecution(state, "V12_X1.00_ALL", fill({ clientOrderId: entry.entryClientOrderId, updatedAt: NOW + 2_000 }), NOW + 2_000);
  const leg = state.legs.find((item) => item.owner === "V12_X1.00_ALL");
  assert.equal(leg?.status, "CLOSE_PENDING");
  assert.equal(leg?.filledAtTs, NOW + 2_000);
  assert.equal(leg?.closeAtTs, NOW + 2_000 + HOUR);
  assert.equal(planDueCloseOrders(state, NOW + HOUR + 1_999).length, 0);
  const due = planDueCloseOrders(state, NOW + 2_000 + HOUR + 1);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.reduceOnly, true);
  assert.equal(due[0]?.side, "BUY");
  assert.equal(due[0]?.quantity, 2);
});

test("unknown entry execution moves the leg to manual review and never creates a retry", () => {
  const state = createOneShotPlan(NOW);
  const next = recordEntryExecution(state, "V12_X1.00_ALL", fill({ status: "UNKNOWN", executionUnknown: true }), NOW + 2_000);
  const leg = next.legs.find((item) => item.owner === "V12_X1.00_ALL");
  assert.equal(leg?.status, "MANUAL_REVIEW");
  assert.equal(planDueCloseOrders(next, NOW + 2_000 + HOUR).length, 0);
  assert.match(leg?.error || "", /unknown/i);
});

test("entry and close are durably marked before mutation so a restart never blindly resubmits", () => {
  let state = createOneShotPlan(NOW);
  const leg = state.legs[0]!;
  state = markEntryPending(state, leg.legId, NOW + 1);
  assert.equal(state.legs[0]?.status, "ENTRY_PENDING");
  state = recordEntryExecution(state, leg.owner, fill({ clientOrderId: leg.entryClientOrderId, updatedAt: NOW + 2 }), NOW + 2);
  state = markCloseSubmitted(state, leg.legId, NOW + HOUR + 1);
  assert.equal(state.legs[0]?.status, "CLOSE_SUBMITTED");
  assert.equal(planDueCloseOrders(state, NOW + 2 * HOUR).length, 0);
});

test("a confirmed close marks the leg closed and rejects non-reduce-only close results", () => {
  let state = createOneShotPlan(NOW);
  const entry = state.legs.find((item) => item.owner === "PENGU_DUAL_LS_V2_FINAL")!;
  state = recordEntryExecution(state, "PENGU_DUAL_LS_V2_FINAL", fill({ clientOrderId: entry.entryClientOrderId, updatedAt: NOW + 1_000 }), NOW + 1_000);
  const due = planDueCloseOrders(state, NOW + 1_000 + HOUR + 1)[0];
  assert.ok(due);
  assert.throws(() => recordCloseExecution(state, due.legId, { ...fill({ clientOrderId: due.clientOrderId }), reduceOnly: false }, NOW + 1_000 + HOUR + 1), /REDUCE_ONLY/);
  const closed = recordCloseExecution(state, due.legId, { ...fill({ clientOrderId: due.clientOrderId }), reduceOnly: true, updatedAt: NOW + 1_000 + HOUR + 2_000 }, NOW + 1_000 + HOUR + 2_000);
  assert.equal(closed.legs.find((item) => item.legId === due.legId)?.status, "CLOSED");
  assert.equal(planDueCloseOrders(closed, NOW + 2 * HOUR).length, 0);
});

test("strategy state marker keeps a one-shot position out of normal strategy management", () => {
  assert.equal(isOneShotStrategyPosition({ oneShotTestId: "test", oneShotCloseAtTs: NOW + HOUR }), true);
  assert.equal(isOneShotStrategyPosition({ oneShotTestId: "test", oneShotCloseAtTs: NOW - HOUR }), true);
  assert.equal(isOneShotStrategyPosition({ oneShotTestId: "", oneShotCloseAtTs: NOW + HOUR }), false);
  assert.equal(isOneShotStrategyPosition({ oneShotTestId: "test" }), false);
});

test("one-shot state survives a file-store restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-one-shot-state-"));
  try {
    const path = join(root, "one-shot.json");
    const store = new FileOneShotForceCloseStateStore(path);
    const state = createOneShotPlan(NOW);
    await store.save(state);
    const restarted = new FileOneShotForceCloseStateStore(path);
    assert.deepEqual(await restarted.load(), state);
    assert.match(await readFile(path, "utf8"), /disdex-one-shot-force-close\/v1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all three live strategy state stores persist the one-shot ownership marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-one-shot-strategy-state-"));
  const runtimeSha = "a".repeat(40);
  try {
    const v12Store = new FileV12X1AllRunnerStateStore(join(root, "v12.json"), "LIVE");
    await v12Store.save({ ...(await v12Store.load()), oneShotTestId: "test", oneShotCloseAtTs: NOW + HOUR });
    assert.equal((await v12Store.load()).oneShotTestId, "test");

    const penguStore = new FilePenguDualLsV2RunnerStateStore(join(root, "pengu.json"), "LIVE");
    await penguStore.save({ ...createPenguDualLsV2RunnerState("LIVE"), oneShotTestId: "test", oneShotCloseAtTs: NOW + HOUR });
    assert.equal((await penguStore.load()).oneShotCloseAtTs, NOW + HOUR);

    const q102Store = new FileQuality102CausalV1StateStore(join(root, "q102.json"), "LIVE", runtimeSha);
    await q102Store.save({ ...createQuality102CausalV1State("LIVE", runtimeSha), oneShotTestId: "test", oneShotCloseAtTs: NOW + HOUR });
    assert.equal((await q102Store.load()).oneShotTestId, "test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
