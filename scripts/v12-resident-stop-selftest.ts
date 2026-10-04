import assert from "node:assert/strict";
import { installV12Protection, updateV12TrailingStop, type ResidentStopAdapter, type V12StopState } from "@/lib/v12-resident-stop-lifecycle";

function adapter(ack = true): ResidentStopAdapter & { placed: string[]; flattened: number } {
    const value = { placed: [], flattened: 0 } as ResidentStopAdapter & { placed: string[]; flattened: number };
    value.placeStopMarket = async (input) => { value.placed.push(input.clientOrderId); return { acknowledged: ack }; };
    value.placeTakeProfit = async (input) => { value.placed.push(input.clientOrderId); return { acknowledged: ack }; };
    value.cancel = async () => undefined;
    value.flattenReduceOnly = async () => { value.flattened += 1; };
    value.openOrders = async () => value.placed.map((clientOrderId) => ({ clientOrderId, status: "NEW" }));
    return value;
}

async function main() {
const state: V12StopState = { strategyId: "V12_X1.00_ALL", symbol: "ETHUSDT", side: "LONG", positionId: "p1", quantity: 1, entryPrice: 100, atrAtEntry: 2, initialStop: 95, lastAckStop: 95, takeProfit: 106, peakOrTrough: 100 };
const okAdapter = adapter(true);
const installed = await installV12Protection(okAdapter, state);
assert.equal(installed.manualReview, undefined);
const moved = await updateV12TrailingStop(okAdapter, installed, 110);
assert.ok(moved.lastAckStop >= installed.lastAckStop);
assert.equal((await import("@/lib/v12-resident-stop-lifecycle")).reconcileV12Protection ? true : false, true);
const badAdapter = adapter(false);
const flattened = await installV12Protection(badAdapter, state);
assert.ok(flattened.manualReview);
assert.equal(badAdapter.flattened, 1);
console.log("V12_RESIDENT_STOP_SELFTEST_PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
