import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reduceFetBrk48ForCoreConflict } from "../lib/fet-brk48-live-reduction";
import { emptyFetBrk48State, readFetBrk48State, writeFetBrk48State } from "../lib/fet-brk48-state";
import { createQuality102CausalV1State } from "../lib/disdex-quality102-causal-v1-state";

const SHA = "b".repeat(40);
const Q102_SHA = "c".repeat(40);

test("FET Core preemption is reduce-only, cancels protection, clears state, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "fet-preempt-"));
  const statePath = join(root, "state.json");
  let now = Date.UTC(2026, 8, 20, 10, 0, 0);
  let positions: any[] = [{
    symbol: "FETUSDT",
    quantity: 12,
    entryPrice: 100,
    markPrice: 110,
    notionalUsd: 1320,
    unrealizedPnl: 120,
    positionSide: "LONG",
    updatedAt: now,
  }];
  let openOrders: any[] = [{
    symbol: "FETUSDT",
    clientOrderId: "fet-stop-0123456789abcdef",
    status: "NEW",
    side: "SELL",
    type: "STOP_MARKET",
    reduceOnly: true,
    quantity: 12,
    executedQuantity: 0,
    stopPrice: 95,
  }];
  const marketCalls: any[] = [];
  const cancelCalls: string[] = [];

  const oldQ102 = process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
  const oldQ102Alt = process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH;
  const oldQ102Sha = process.env.DISDEX_Q102_RUNTIME_SHA;
  const oldFetSha = process.env.FET_BRK48_RUNTIME_SHA;
  const q102Path = join(root, "q102.json");
  await writeFile(q102Path, JSON.stringify(createQuality102CausalV1State("LIVE", Q102_SHA)));
  process.env.QUALITY102_CAUSAL_V1_STATE_PATH = q102Path;
  delete process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH;
  process.env.DISDEX_Q102_RUNTIME_SHA = Q102_SHA;
  process.env.FET_BRK48_RUNTIME_SHA = SHA;

  try {
    const state = emptyFetBrk48State(SHA, now);
    state.position = {
      symbol: "FETUSDT",
      side: 1,
      quantity: 12,
      entryPrice: 100,
      entryTs: now - 3_600_000,
      exitTs: now + 23 * 3_600_000,
      gross: 1.25,
      hardStop: 95,
      stopClientOrderId: "fet-stop-0123456789abcdef",
    };
    await writeFetBrk48State(statePath, state);

    const executor: any = {
      getPositions: async () => positions.map((row) => ({ ...row })),
      getMarketQuote: async () => ({
        symbol: "FETUSDT",
        bidPrice: 109,
        askPrice: 111,
        midPrice: 110,
        spreadBps: 18.2,
        bidQuantity: 1000,
        askQuantity: 1000,
        updatedAt: now,
      }),
      executeMarket: async (input: any) => {
        marketCalls.push({ ...input });
        assert.equal(input.symbol, "FETUSDT");
        assert.equal(input.side, "SELL");
        assert.equal(input.reduceOnly, true);
        assert.equal(input.quantity, 12);
        positions = [];
        return {
          requestId: input.requestId,
          clientOrderId: input.clientOrderId,
          symbol: input.symbol,
          side: input.side,
          status: "FILLED",
          executedQuantity: 12,
          averagePrice: 109,
          quoteQuantity: 1308,
          reduceOnly: true,
          executionUnknown: false,
          updatedAt: now,
        };
      },
    };

    const adapter: any = {
      getOpenOrders: async () => openOrders.map((row) => ({ ...row })),
      cancel: async (clientOrderId: string) => {
        cancelCalls.push(clientOrderId);
        openOrders = openOrders.filter((row) => row.clientOrderId !== clientOrderId);
      },
    };

    const q102State = createQuality102CausalV1State("LIVE", Q102_SHA);
    q102State.position = { symbol: "FETUSDT", side: 1, quantity: 12, entryPrice: 100, entryTs: now - 3_600_000 };
    await writeFile(q102Path, JSON.stringify(q102State));
    const collision = await reduceFetBrk48ForCoreConflict({
      executor, adapter, causeIdempotencyKey: "V12_CORE_TEST", statePath, maxSlippageBps: 20,
    });
    assert.equal(collision.status, "blocked");
    assert.equal(collision.message, "FET_RESIDUAL_Q102_OWNERSHIP_COLLISION");
    assert.equal(marketCalls.length, 0);
    assert.equal(cancelCalls.length, 0);
    await writeFile(q102Path, JSON.stringify(createQuality102CausalV1State("LIVE", Q102_SHA)));

    const first = await reduceFetBrk48ForCoreConflict({
      executor,
      adapter,
      causeIdempotencyKey: "V12_CORE_TEST",
      statePath,
      maxSlippageBps: 20,
      expectedRuntimeSha: "a".repeat(40), // A different calling runner must not override the FET owner pin.
      now: () => now,
    });
    assert.equal(first.status, "reduced");
    assert.equal(marketCalls.length, 1);
    assert.deepEqual(cancelCalls, ["fet-stop-0123456789abcdef"]);
    assert.equal(openOrders.length, 0);
    assert.equal(positions.length, 0);

    const after = await readFetBrk48State(statePath, SHA);
    assert.equal(after.position, undefined);
    assert.equal(after.pending, undefined);
    assert.equal(after.manualReview, undefined);
    assert.ok(after.lastCompletedIdempotencyKey);
    assert.equal(after.lastReconciledAt, now);

    now += 60_000;
    const second = await reduceFetBrk48ForCoreConflict({
      executor,
      adapter,
      causeIdempotencyKey: "V12_CORE_TEST",
      statePath,
      maxSlippageBps: 20,
      expectedRuntimeSha: SHA,
      now: () => now,
    });
    assert.equal(second.status, "not-needed");
    assert.equal(marketCalls.length, 1);
    assert.equal(cancelCalls.length, 1);
  } finally {
    if (oldQ102 === undefined) delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
    else process.env.QUALITY102_CAUSAL_V1_STATE_PATH = oldQ102;
    if (oldQ102Alt === undefined) delete process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH;
    else process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH = oldQ102Alt;
    if (oldQ102Sha === undefined) delete process.env.DISDEX_Q102_RUNTIME_SHA;
    else process.env.DISDEX_Q102_RUNTIME_SHA = oldQ102Sha;
    if (oldFetSha === undefined) delete process.env.FET_BRK48_RUNTIME_SHA;
    else process.env.FET_BRK48_RUNTIME_SHA = oldFetSha;
    await rm(root, { recursive: true, force: true });
  }
});

test("independent owner pins and readable matching Q102 state gate every venue operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "fet-owner-pin-"));
  const statePath = join(root, "fet.json");
  const q102Path = join(root, "q102.json");
  const names = ["FET_BRK48_RUNTIME_SHA", "DISDEX_Q102_RUNTIME_SHA", "DISDEX_RUNTIME_COMMIT_SHA", "QUALITY102_CAUSAL_V1_STATE_PATH", "DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  let venueCalls = 0;
  const forbidden = async () => { venueCalls++; throw new Error("unexpected venue operation"); };
  const request: any = { executor: { getPositions: forbidden, executeMarket: forbidden }, adapter: { getOpenOrders: forbidden, cancel: forbidden }, causeIdempotencyKey: "test", statePath, maxSlippageBps: 20, expectedRuntimeSha: SHA };
  try {
    await writeFetBrk48State(statePath, emptyFetBrk48State(SHA));
    await writeFile(q102Path, JSON.stringify(createQuality102CausalV1State("LIVE", Q102_SHA)));
    process.env.DISDEX_RUNTIME_COMMIT_SHA = SHA;
    process.env.QUALITY102_CAUSAL_V1_STATE_PATH = q102Path;
    delete process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH;
    delete process.env.FET_BRK48_RUNTIME_SHA;
    process.env.DISDEX_Q102_RUNTIME_SHA = Q102_SHA;
    assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "caller SHA must not be a FET pin");
    for (const invalid of ["", " ", "abc", "g".repeat(40)]) {
      process.env.FET_BRK48_RUNTIME_SHA = invalid;
      assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", `invalid FET pin ${invalid}`);
    }
    process.env.FET_BRK48_RUNTIME_SHA = SHA;
    for (const invalid of [undefined, "", " ", "abc", "g".repeat(40)]) {
      if (invalid === undefined) delete process.env.DISDEX_Q102_RUNTIME_SHA;
      else process.env.DISDEX_Q102_RUNTIME_SHA = invalid;
      assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", `invalid Q102 pin ${invalid}`);
    }
    process.env.DISDEX_Q102_RUNTIME_SHA = Q102_SHA;
    process.env.FET_BRK48_RUNTIME_SHA = "d".repeat(40);
    assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "FET state must match FET pin");
    process.env.FET_BRK48_RUNTIME_SHA = SHA;
    process.env.DISDEX_Q102_RUNTIME_SHA = "d".repeat(40);
    await assert.doesNotReject(async () => assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "Q102 state must match Q102 pin"));
    process.env.DISDEX_Q102_RUNTIME_SHA = Q102_SHA;
    process.env.QUALITY102_CAUSAL_V1_STATE_PATH = join(root, "missing.json");
    assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "missing Q102 state is not proof of no owner");
    delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
    assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "unconfigured Q102 state is not proof of no owner");
    process.env.QUALITY102_CAUSAL_V1_STATE_PATH = q102Path;
    await writeFile(q102Path, "{malformed");
    assert.equal((await reduceFetBrk48ForCoreConflict(request)).status, "blocked", "invalid Q102 state must fail closed");
    assert.equal(venueCalls, 0);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(root, { recursive: true, force: true });
  }
});
