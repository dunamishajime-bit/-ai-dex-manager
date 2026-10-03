import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { preemptV12ForQ102Priority } from "../lib/v12-q102-priority-preemption";
import { FileV12X1AllRunnerStateStore, type V12ActivePositionState } from "../lib/v12-x1-all-runner-state";

const now = 1_800_000_000_000;
const sha = "a".repeat(40);

function active(symbol: string, rank: 1 | 2 | 3, quantity: number): V12ActivePositionState {
  const positionId = `p-${symbol}`;
  return {
    symbol, side: "LONG", quantity, gross: quantity,
    baseQuantity: rank === 3 ? 0 : quantity, baseGross: rank === 3 ? 0 : quantity,
    dynamicQuantity: rank === 3 ? quantity : 0, dynamicGross: rank === 3 ? quantity : 0,
    entryRank: rank, positionId, entryPrice: 100, atrAtEntry: 2,
    entrySignalTs: now - 60_000, holdingBars: 0, peakPrice: 100, troughPrice: 100,
    protection: { strategyId: "V12_X1.00_ALL", symbol, side: "LONG", positionId,
      quantity, entryPrice: 100, atrAtEntry: 2, initialStop: 95,
      lastAckStop: 95, takeProfit: 110, peakOrTrough: 100,
      stopClientOrderId: `stop-${symbol}`, takeProfitClientOrderId: `tp-${symbol}` },
  };
}

async function fixture(run: (f: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "formal-q102-handoff-"));
  try { await run(await prepare(join(dir, "runner.json"))); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function prepare(statePath: string) {
  const store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
  const rows = [active("ETHUSDT", 1, 0.8), active("SOLUSDT", 2, 0.8), active("AVAXUSDT", 3, 0.4)];
  await store.save({ schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL",
    mode: "LIVE", updatedAt: now, runtimeCommitSha: sha, active: rows[0], activePositions: rows });
  const venue = new Map(rows.map(r => [r.symbol, r.quantity]));
  const exits: string[] = [];
  const canceled: string[] = [];
  const settings = { filledAt: now - 1234, unknown: false, partial: false };
  const adapter = {
    executor: { getMarketQuote: async (symbol: string) => ({ symbol, bidPrice: 100,
      askPrice: 100, midPrice: 100, bidQuantity: 100, askQuantity: 100,
      spreadBps: 0, updatedAt: now }) },
    getPositions: async () => [...venue].filter(([,quantity]) => quantity > 0).map(([symbol,quantity]) => ({
      symbol, quantity, positionSide: "LONG", entryPrice: 100, markPrice: 100,
      unrealizedPnl: 0, pnlPct: 0, notionalUsd: quantity * 100, leverage: 5, updatedAt: now })),
    executeExit: async (input: { symbol: string; quantity: number; clientOrderId: string }) => {
      exits.push(input.symbol);
      if (!settings.unknown) venue.set(input.symbol, settings.partial ? input.quantity / 2 : 0);
      return { requestId: input.clientOrderId, clientOrderId: input.clientOrderId,
        symbol: input.symbol, side: "SELL", status: settings.unknown ? "UNKNOWN" : settings.partial ? "PARTIALLY_FILLED" : "FILLED",
        requestedQuantity: input.quantity, submittedQuantity: input.quantity,
        executedQuantity: settings.unknown ? 0 : settings.partial ? input.quantity / 2 : input.quantity,
        averagePrice: 100, quoteQuantity: input.quantity * 100, reduceOnly: true,
        reconciled: true, executionUnknown: settings.unknown, updatedAt: settings.filledAt };
    },
    cancel: async (id: string) => { canceled.push(id); },
    openOrders: async () => [],
  } as unknown as V12AsterLiveAdapter;
  const request = { adapter, statePath, requiredGross: 1.5, equity: 100,
    q102Family: "PB", expectedRuntimeSha: sha,
    causeIdempotencyKey: "q102-pb-opportunity", now: () => now };
  return { store, venue, exits, canceled, settings, request };
}

test("one realized victim per call forces fresh Q102 capacity planning between whole-position exits", async () => {
  await fixture(async f => {
    const result = await preemptV12ForQ102Priority(f.request);
    assert.equal(result.status, "reduced");
    assert.equal(result.exits, 1);
    assert.deepEqual(f.exits, ["AVAXUSDT"]);
    const after = await f.store.load();
    assert.deepEqual(after.activePositions?.map(p => p.symbol), ["ETHUSDT", "SOLUSDT"]);
    assert.equal(after.pending, undefined);
    assert.equal(after.symbolCooldownUntilTs?.AVAXUSDT, now - 1234 + 7_200_000);
    assert.equal(after.symbolLastExitTs?.AVAXUSDT, now - 1234);
    assert.equal(after.lastPriorityHandoff?.reason, "Q102_PRIORITY_PREEMPT:PB:V12_R3");
    const second = await preemptV12ForQ102Priority({ ...f.request, equity: 95, requiredGross: 0.6 });
    assert.equal(second.exits, 1);
    assert.deepEqual(f.exits, ["AVAXUSDT", "SOLUSDT"]);
    assert.equal(f.venue.get("ETHUSDT"), 0.8);
  });
});

for (const family of ["MR", "BRK"]) test(`${family} cannot close V12 or cancel its protection`, async () => {
  await fixture(async f => {
    const result = await preemptV12ForQ102Priority({ ...f.request, q102Family: family });
    assert.equal(result.status, "not-needed");
    assert.deepEqual(f.exits, []);
    assert.deepEqual(f.canceled, []);
    assert.equal((await f.store.load()).activePositions?.length, 3);
  });
});

for (const variant of ["unknown", "partial"] as const) test(`${variant} exit keeps pending and protection and never advances to another victim`, async () => {
  await fixture(async f => {
    f.settings[variant] = true;
    const result = await preemptV12ForQ102Priority(f.request);
    assert.equal(result.status, "blocked");
    assert.deepEqual(f.exits, ["AVAXUSDT"]);
    assert.deepEqual(f.canceled, []);
    assert.ok((await f.store.load()).pending);
    assert.ok((await f.store.load()).manualReview);
  });
});

test("missing actual fill timestamp keeps pending and fails closed", async () => {
  await fixture(async f => {
    f.settings.filledAt = 0;
    const result = await preemptV12ForQ102Priority(f.request);
    assert.equal(result.status, "blocked");
    assert.deepEqual(f.canceled, []);
    const after = await f.store.load();
    assert.ok(after.pending);
    assert.equal(after.symbolCooldownUntilTs, undefined);
  });
});

test("venue quantity mismatch blocks the handoff before any order", async () => {
  await fixture(async f => {
    f.venue.set("AVAXUSDT", 0.3);
    const result = await preemptV12ForQ102Priority(f.request);
    assert.equal(result.status, "blocked");
    assert.deepEqual(f.exits, []);
    assert.deepEqual(f.canceled, []);
  });
});

test("a stale V12 runtime SHA cannot be preempted by the current Q102 runner", async () => {
  await fixture(async f => {
    const result = await preemptV12ForQ102Priority({ ...f.request, expectedRuntimeSha: "b".repeat(40) });
    assert.equal(result.status, "blocked");
    assert.deepEqual(f.exits, []);
    assert.deepEqual(f.canceled, []);
  });
});

test("future venue exit timestamp cannot clear pending or cancel protection", async () => {
  await fixture(async f => {
    f.settings.filledAt = now + 60_000;
    const result = await preemptV12ForQ102Priority(f.request);
    assert.equal(result.status, "blocked");
    assert.deepEqual(f.canceled, []);
    assert.ok((await f.store.load()).pending);
  });
});
