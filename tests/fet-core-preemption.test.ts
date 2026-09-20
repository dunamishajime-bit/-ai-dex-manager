import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reduceFetBrk48ForCoreConflict } from "../lib/fet-brk48-live-reduction";
import { emptyFetBrk48State, readFetBrk48State, writeFetBrk48State } from "../lib/fet-brk48-state";

const SHA = "b".repeat(40);

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
  delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
  delete process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH;
  delete process.env.DISDEX_Q102_RUNTIME_SHA;

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

    const first = await reduceFetBrk48ForCoreConflict({
      executor,
      adapter,
      causeIdempotencyKey: "V12_CORE_TEST",
      statePath,
      maxSlippageBps: 20,
      expectedRuntimeSha: SHA,
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
    await rm(root, { recursive: true, force: true });
  }
});
