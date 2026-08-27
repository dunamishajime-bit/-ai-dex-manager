import assert from "node:assert/strict";
import {
    buildRecoveryV8HardStopPlan,
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
