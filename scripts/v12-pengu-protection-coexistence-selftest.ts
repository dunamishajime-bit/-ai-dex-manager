import assert from "node:assert/strict";
import { strictPortfolioConflictingOpenOrders } from "@/lib/v12-strict-live-adapter";

const position = {
    symbol: "PENGUUSDT", quantity: 4244, entryPrice: 0.007256, markPrice: 0.0075,
    unrealizedPnl: 0, pnlPct: 0, notionalUsd: 31.8, positionSide: "BOTH" as const,
    leverage: 5, updatedAt: Date.now(),
};
const protection = [
    { symbol: "PENGUUSDT", clientOrderId: "recv8-20b3c3a02e5a07d1d79c5f7761eff1", side: "SELL" as const, status: "NEW", reduceOnly: true, quantity: 2122, executedQuantity: 0 },
    { symbol: "PENGUUSDT", clientOrderId: "recv8-1b00e3de1d7092ef238ff60fe6eafa", side: "SELL" as const, status: "NEW", reduceOnly: true, quantity: 2122, executedQuantity: 0 },
];

assert.equal(strictPortfolioConflictingOpenOrders(protection, [position]).length, 0,
    "V12 must coexist with verified PENGU Recovery V8 protection");
assert.equal(strictPortfolioConflictingOpenOrders(
    [...protection, { ...protection[0], clientOrderId: "manual-order" }], [position],
).length, 1, "unmanaged order must remain a strict conflict");
assert.equal(strictPortfolioConflictingOpenOrders(
    [{ ...protection[0], quantity: 2000 }, { ...protection[1], quantity: 2000 }], [position],
).length, 2, "under-protected split must not be trusted");

console.log("V12_PENGU_PROTECTION_COEXISTENCE_SELFTEST_PASS");
