import assert from "node:assert/strict";
import test from "node:test";
import { V12LiveExecutionEngine } from "../lib/v12-live-execution-engine";

const now = 1_800_000_000_000;
for (const updatedAt of [0, Infinity, now + 1]) {
  test(`pending exit invalid actual timestamp ${updatedAt} preserves protection and state`, async () => {
    const canceled: string[] = [];
    const active = { symbol: "ETHUSDT", positionId: "eth", quantity: 1,
      protection: { symbol: "ETHUSDT", stopClientOrderId: "stop", takeProfitClientOrderId: "tp" } };
    const pending = { symbol: "ETHUSDT", quantity: 1, clientOrderId: "exit", idempotencyKey: "exit" };
    const state = { active, activePositions: [active], pending };
    const engine = new V12LiveExecutionEngine({ now: () => now, log: () => {},
      adapter: { reconcileOrder: async () => ({ status: "FILLED", executedQuantity: 1, updatedAt }),
        openOrders: async () => [], cancel: async (id: string) => canceled.push(id) },
      stateStore: { save: async () => {}, tripKillSwitch: async (s: any, reason: string) => { s.manualReview = reason; } },
    } as any);
    const result = await (engine as any).reconcilePendingExit(state, pending, []);
    assert.equal(result.status, "manual-review");
    assert.deepEqual(canceled, []);
    assert.equal(state.pending, pending);
    assert.equal(state.active, active);
  });
  test(`resident protection fill invalid actual timestamp ${updatedAt} fails closed`, async () => {
    const engine = new V12LiveExecutionEngine({ now: () => now, log: () => {},
      adapter: { queryOrderSameId: async () => ({ status: "FILLED", updatedAt }) },
    } as any);
    await assert.rejects(() => (engine as any).completedProtectionExit({ symbol: "ETHUSDT",
      protection: { stopClientOrderId: "stop", takeProfitClientOrderId: "tp" } }), /TIMESTAMP/);
  });
}

for (const status of ["CANCELED", "PARTIALLY_FILLED"]) test(`flat venue alone cannot certify a ${status} pending exit`, async () => {
  const canceled: string[] = [];
  const pending = { symbol: "ETHUSDT", quantity: 1, clientOrderId: "exit", idempotencyKey: "exit" };
  const state = { pending, activePositions: [], active: undefined };
  const engine = new V12LiveExecutionEngine({ now: () => now, log: () => {},
    adapter: { reconcileOrder: async () => ({ status, executedQuantity: 0, updatedAt: now - 1000 }),
      openOrders: async () => [], cancel: async (id: string) => canceled.push(id) },
    stateStore: { save: async () => {}, tripKillSwitch: async (s: any, reason: string) => { s.manualReview = reason; } },
  } as any);
  const result = await (engine as any).reconcilePendingExit(state, pending, []);
  assert.equal(result.status, "manual-review");
  assert.equal(state.pending, pending);
  assert.deepEqual(canceled, []);
});
