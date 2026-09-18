import assert from "node:assert/strict";
import {
    buildRecoveryV8HardStopPlan,
    findRecoveryV8ManagedProtectiveOrders,
    replaceRecoveryV8Stops,
    type RecoveryV8ProtectiveOrderGateway,
} from "@/lib/pengu-recovery-v8-protective-orders";

const events: string[] = [];
const activeOrders: Array<{ symbol: string; clientOrderId: string; status: string; reduceOnly: boolean; quantity: number; stopPrice: number }> = [];
const gateway: RecoveryV8ProtectiveOrderGateway = {
    async placeStopMarket(input) {
        events.push(`place:${input.clientOrderId}:${input.quantity}:${input.stopPrice}`);
        const order = { symbol: input.symbol, clientOrderId: input.clientOrderId, status: "NEW", reduceOnly: true, quantity: input.quantity, stopPrice: input.stopPrice };
        activeOrders.push(order);
        return order;
    },
    async cancel(clientOrderId) {
        events.push(`cancel:${clientOrderId}`);
        const index = activeOrders.findIndex((order) => order.clientOrderId === clientOrderId);
        if (index >= 0) activeOrders.splice(index, 1);
    },
    async getOpenOrders() {
        return [...activeOrders];
    },
};

async function main() {
    const entry = buildRecoveryV8HardStopPlan({ symbol: "PENGUUSDT", entryTs: 1000, entryPrice: 100, quantity: 1 });
    assert.equal(entry.quantity, 1);
    assert.equal(entry.stopPrice, 94);
    assert.equal(entry.reduceOnly, true);

    const position = { symbol: "PENGUUSDT", quantity: 4244, entryPrice: 0.007256, markPrice: 0.0075, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 31.8, positionSide: "BOTH" as const, leverage: 5, updatedAt: Date.now() };
    const split = [
        { symbol: "PENGUUSDT", clientOrderId: "recv8-20b3c3a02e5a07d1d79c5f7761eff1", side: "SELL" as const, status: "NEW", reduceOnly: true, quantity: 2122, executedQuantity: 0 },
        { symbol: "PENGUUSDT", clientOrderId: "recv8-1b00e3de1d7092ef238ff60fe6eafa", side: "SELL" as const, status: "NEW", reduceOnly: true, quantity: 2122, executedQuantity: 0 },
    ];
    assert.deepEqual(findRecoveryV8ManagedProtectiveOrders(split, [position]).map((row) => row.clientOrderId), split.map((row) => row.clientOrderId));
    assert.equal(findRecoveryV8ManagedProtectiveOrders([{ ...split[0], quantity: 2000 }, { ...split[1], quantity: 2000 }], [position]).length, 0);
    assert.equal(findRecoveryV8ManagedProtectiveOrders([{ ...split[0], reduceOnly: false }, split[1]], [position]).length, 0);
    assert.equal(findRecoveryV8ManagedProtectiveOrders([{ ...split[0], side: "BUY" }, split[1]], [position]).length, 0);

    const result = await replaceRecoveryV8Stops(gateway, {
        symbol: "PENGUUSDT",
        entryTs: 1000,
        entryPrice: 100,
        currentQuantity: 1,
        oldHardStopClientOrderId: "old-hard",
        nowTs: 1000 + 24 * 3_600_000,
    });
    assert.equal(result.partial.stopPrice, 96);
    assert.equal(result.partial.quantity, 0.5);
    assert.equal(result.remainingHard.stopPrice, 94);
    assert.equal(result.remainingHard.quantity, 0.5);
    assert.ok(events.findIndex((value) => value.startsWith("place:")) < events.findIndex((value) => value === "cancel:old-hard"));
    assert.equal(result.partial.reduceOnly, true);
    assert.equal(result.remainingHard.reduceOnly, true);
    await assert.rejects(() => replaceRecoveryV8Stops(gateway, {
        symbol: "PENGUUSDT",
        entryTs: 1000,
        entryPrice: 100,
        currentQuantity: 1,
        oldHardStopClientOrderId: "old-hard",
        nowTs: 1000 + 23 * 3_600_000,
    }), /before the 24-hour deadline/);

    const failureEvents: string[] = [];
    const failingGateway: RecoveryV8ProtectiveOrderGateway = {
        async placeStopMarket(input) {
            failureEvents.push(`place:${input.reason}`);
            if (input.reason === "RECOVERY_V8_PARTIAL_DEFENSE") throw new Error("partial acknowledgement timeout");
            return { symbol: input.symbol, clientOrderId: input.clientOrderId, status: "NEW", reduceOnly: true, quantity: input.quantity, stopPrice: input.stopPrice };
        },
        async cancel(clientOrderId) { failureEvents.push(`cancel:${clientOrderId}`); },
        async getOpenOrders() { return []; },
    };
    await assert.rejects(() => replaceRecoveryV8Stops(failingGateway, {
        symbol: "PENGUUSDT",
        entryTs: 1000,
        entryPrice: 100,
        currentQuantity: 1,
        oldHardStopClientOrderId: "old-hard",
        nowTs: 1000 + 24 * 3_600_000,
    }), /partial acknowledgement timeout/);
    assert.equal(failureEvents.includes("cancel:old-hard"), false, "old full hard stop must be retained on replacement failure");

    console.log("PENGU_RECOVERY_V8_PROTECTIVE_ORDER_SELFTEST_PASS");
}

void main();
