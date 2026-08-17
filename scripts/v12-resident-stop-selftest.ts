import assert from "node:assert/strict";
import {
    installV12Protection,
    reconcileV12Protection,
    updateV12TrailingStop,
    type ResidentOrderView,
    type ResidentStopAdapter,
    type V12StopState,
} from "@/lib/v12-resident-stop-lifecycle";

type TestAdapter = ResidentStopAdapter & {
    events: string[];
    flattened: number;
    orders: Map<string, ResidentOrderView>;
    rejectNextStop: boolean;
    rejectProtection: boolean;
};

function adapter(): TestAdapter {
    const value = {
        events: [],
        flattened: 0,
        orders: new Map<string, ResidentOrderView>(),
        rejectNextStop: false,
        rejectProtection: false,
    } as TestAdapter;
    value.normalizeStopPrice = async (_symbol, requested) => ({ price: Math.round(requested * 2) / 2 });
    value.placeStopMarket = async (input) => {
        value.events.push(`place-stop:${input.clientOrderId}`);
        if (value.rejectProtection || value.rejectNextStop) {
            value.rejectNextStop = false;
            return { acknowledged: false };
        }
        value.orders.set(input.clientOrderId, {
            clientOrderId: input.clientOrderId,
            status: "NEW",
            side: input.side,
            type: "STOP_MARKET",
            reduceOnly: true,
            quantity: input.quantity,
            stopPrice: input.stopPrice,
        });
        return { acknowledged: true };
    };
    value.placeTakeProfit = async (input) => {
        value.events.push(`place-tp:${input.clientOrderId}`);
        if (value.rejectProtection) return { acknowledged: false };
        value.orders.set(input.clientOrderId, {
            clientOrderId: input.clientOrderId,
            status: "NEW",
            side: input.side,
            type: "TAKE_PROFIT_MARKET",
            reduceOnly: true,
            quantity: input.quantity,
            stopPrice: input.stopPrice,
        });
        return { acknowledged: true };
    };
    value.cancel = async (clientOrderId) => {
        value.events.push(`cancel:${clientOrderId}`);
        const row = value.orders.get(clientOrderId);
        if (row) value.orders.set(clientOrderId, { ...row, status: "CANCELED" });
    };
    value.flattenReduceOnly = async () => { value.flattened += 1; value.events.push("flatten"); };
    value.openOrders = async () => [...value.orders.values()];
    return value;
}

async function main() {
    const state: V12StopState = {
        strategyId: "V12_X1.00_ALL",
        symbol: "ETHUSDT",
        side: "LONG",
        positionId: "p1",
        quantity: 1,
        entryPrice: 100,
        atrAtEntry: 2,
        initialStop: 95.13,
        lastAckStop: 95.13,
        takeProfit: 106.24,
        peakOrTrough: 100,
    };

    const ok = adapter();
    const installed = await installV12Protection(ok, state);
    assert.equal(installed.manualReview, undefined);
    assert.equal(installed.initialStop, 95);
    assert.equal(installed.lastAckStop, 95);
    assert.equal(installed.takeProfit, 106);
    assert.ok(installed.stopClientOrderId);
    assert.ok(installed.takeProfitClientOrderId);

    ok.events.length = 0;
    const oldStopId = installed.stopClientOrderId!;
    const moved = await updateV12TrailingStop(ok, installed, 110);
    assert.equal(moved.manualReview, undefined);
    assert.ok(moved.lastAckStop > installed.lastAckStop);
    assert.notEqual(moved.stopClientOrderId, oldStopId);
    const placeIndex = ok.events.findIndex((event) => event === `place-stop:${moved.stopClientOrderId}`);
    const cancelOldIndex = ok.events.findIndex((event) => event === `cancel:${oldStopId}`);
    assert.ok(placeIndex >= 0 && cancelOldIndex > placeIndex, "new STOP must be confirmed before old STOP is cancelled");

    const restartReconciled = await reconcileV12Protection(ok, moved);
    assert.equal(restartReconciled.manualReview, undefined, "restart must accept the last acknowledged trailing STOP, not the initial STOP");

    const failure = adapter();
    const failureInstalled = await installV12Protection(failure, state);
    const failureOldStop = failureInstalled.stopClientOrderId!;
    failure.events.length = 0;
    failure.rejectNextStop = true;
    const failedTrail = await updateV12TrailingStop(failure, failureInstalled, 110);
    assert.ok(failedTrail.manualReview?.startsWith("TRAILING_STOP_UPDATE_FAILED:"));
    assert.equal(failure.orders.get(failureOldStop)?.status, "NEW", "old confirmed STOP must remain active if the replacement fails");
    assert.equal(failure.events.includes(`cancel:${failureOldStop}`), false, "old STOP must never be cancelled first");

    const malformed = adapter();
    const malformedInstalled = await installV12Protection(malformed, state);
    const malformedStop = malformed.orders.get(malformedInstalled.stopClientOrderId!);
    malformed.orders.set(malformedInstalled.stopClientOrderId!, { ...malformedStop!, reduceOnly: undefined });
    const malformedReconcile = await reconcileV12Protection(malformed, malformedInstalled);
    assert.ok(malformedReconcile.manualReview?.startsWith("RESIDENT_PROTECTION_RECONCILIATION_FAILED:"));

    const bad = adapter();
    bad.rejectProtection = true;
    const flattened = await installV12Protection(bad, state);
    assert.ok(flattened.manualReview?.startsWith("PROTECTION_FAILED_FLATTENED:"));
    assert.equal(bad.flattened, 1);

    console.log("V12_RESIDENT_STOP_SELFTEST_PASS");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
