import assert from "node:assert/strict";
import test from "node:test";

import type { DirectOpenOrder, DirectPosition } from "../lib/direct-trade-executor";
import { findManagedPenguRecoveryV8ProtectiveOrders } from "../lib/disdex-managed-protective-orders";

const position: DirectPosition = {
    symbol: "PENGUUSDT",
    quantity: 4244,
    entryPrice: 0.007256,
    markPrice: 0.00736,
    unrealizedPnl: 0,
    pnlPct: 0,
    notionalUsd: 31.24,
    positionSide: "BOTH",
    leverage: 5,
    updatedAt: Date.now(),
};

const order = (quantity: number, overrides: Partial<DirectOpenOrder> = {}): DirectOpenOrder => ({
    symbol: "PENGUUSDT",
    clientOrderId: `recv8-${String(quantity).padStart(16, "0")}`,
    side: "SELL",
    status: "NEW",
    reduceOnly: true,
    quantity,
    executedQuantity: 0,
    ...overrides,
});

test("split Recovery V8 protection is managed only when it covers the full position", () => {
    const split = [order(2122), order(2123, { clientOrderId: "recv8-0000000000000003" })];
    assert.equal(findManagedPenguRecoveryV8ProtectiveOrders(split, [position]).length, 0, "sum outside tolerance must fail closed");
    const exact = [order(2122), order(2122, { clientOrderId: "recv8-0000000000000003" })];
    assert.deepEqual(findManagedPenguRecoveryV8ProtectiveOrders(exact, [position]), exact);
});

test("unknown, wrong-side, and non-reduce-only orders remain blocking", () => {
    const exact = [order(2122), order(2122, { clientOrderId: "recv8-0000000000000004" })];
    assert.equal(findManagedPenguRecoveryV8ProtectiveOrders([...exact, order(1, { clientOrderId: "manual" })], [position]).length, 2);
    assert.equal(findManagedPenguRecoveryV8ProtectiveOrders(exact.map((item) => ({ ...item, side: "BUY" })), [position]).length, 0);
    assert.equal(findManagedPenguRecoveryV8ProtectiveOrders(exact.map((item) => ({ ...item, reduceOnly: false })), [position]).length, 0);
});

test("partially filled protection uses remaining quantity", () => {
    const split = [
        order(2200, { executedQuantity: 78 }),
        order(2122, { clientOrderId: "recv8-0000000000000005" }),
    ];
    assert.deepEqual(findManagedPenguRecoveryV8ProtectiveOrders(split, [position]), split);
});
