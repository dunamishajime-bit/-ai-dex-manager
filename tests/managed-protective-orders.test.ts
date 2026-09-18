import assert from "node:assert/strict";
import test from "node:test";

import type { DirectOpenOrder, DirectPosition } from "../lib/direct-trade-executor";
import { findManagedPenguRecoveryV8ProtectiveOrders, findManagedV12ProtectiveOrders } from "../lib/disdex-managed-protective-orders";

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
    const split = [order(2122), order(2178, { clientOrderId: "recv8-0000000000000003" })];
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

test("V12 full-quantity STOP and TP are managed, mismatches remain blocking", () => {
    const v12Position: DirectPosition = {
        symbol: "ETHUSDT",
        quantity: 0.8,
        entryPrice: 100,
        markPrice: 101,
        unrealizedPnl: 0.8,
        pnlPct: 1,
        notionalUsd: 80.8,
        positionSide: "LONG",
        leverage: 5,
        updatedAt: Date.now(),
    };
    const stop: DirectOpenOrder = {
        symbol: "ETHUSDT",
        clientOrderId: "v12-stop-0123456789abcdef012345",
        side: "SELL",
        status: "NEW",
        type: "STOP_MARKET",
        reduceOnly: true,
        quantity: 0.8,
        executedQuantity: 0,
    };
    const tp: DirectOpenOrder = {
        symbol: "ETHUSDT",
        clientOrderId: "v12-tp-0123456789abcdef012345",
        side: "SELL",
        status: "NEW",
        type: "TAKE_PROFIT_MARKET",
        reduceOnly: true,
        quantity: 0.8,
        executedQuantity: 0,
    };
    assert.deepEqual(findManagedV12ProtectiveOrders([stop, tp], [v12Position]), [stop, tp]);
    assert.equal(findManagedV12ProtectiveOrders([{ ...stop, quantity: 0.6 }, tp], [v12Position]).length, 0);
    assert.equal(findManagedV12ProtectiveOrders([stop, { ...tp, type: "LIMIT" }], [v12Position]).length, 0);
});
