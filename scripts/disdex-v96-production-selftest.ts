import assert from "node:assert/strict";
import { DISDEX_V96_ALLOCATION, DISDEX_V96_RUNTIME, DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { allocateDisDexV96ReservedPengu } from "../lib/disdex-v96-allocation";
import { evaluateDisDexV96LiveGates } from "../lib/disdex-v96-live-gates";
import { normalizeDisDexV96OrderQuantity } from "../lib/disdex-v96-order-quantity";
import { createDisDexV96RunnerState } from "../lib/disdex-v96-runner-state";
import type { DirectTradeExecutor } from "../lib/direct-trade-executor";

assert.equal(DISDEX_V96_STRATEGY_ID, "DISDEX_V35_STRONG_RESERVED_PENGU_V96");
assert.equal(DISDEX_V96_RUNTIME.liveTradingEnabled, false);
assert.equal(DISDEX_V96_ALLOCATION.penguTargetGross, 1.15);
assert.equal(DISDEX_V96_ALLOCATION.totalGrossCap, 2);
assert.equal(DISDEX_V96_ALLOCATION.minimumActivePenguClip, 0.5);

const reserved = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 0.9, ETHUSDT: 0.9 },
    penguSide: 1,
});
assert.ok(Math.abs(reserved.coreScale - (1.425 / 1.8)) < 1e-12);
assert.equal(reserved.penguClip, 0.5);
assert.ok(reserved.finalGross <= 2 + 1e-12);

const capacityClip = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 1 },
    penguSide: -1,
});
assert.ok(Math.abs(capacityClip.penguClip - (1 / 1.15)) < 1e-12);
assert.ok(Math.abs(capacityClip.targetWeights.PENGUUSDT + 1) < 1e-12);
assert.ok(capacityClip.finalGross <= 2 + 1e-12);

const coreOnly = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 1.2, ETHUSDT: 1.2 },
    penguSide: 0,
});
assert.ok(Math.abs(coreOnly.finalGross - 2) < 1e-12);
assert.equal(coreOnly.penguFinalGross, 0);

const blocked = evaluateDisDexV96LiveGates({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
});
assert.equal(blocked.allowed, false);
assert.ok(blocked.reasons.some((reason) => reason.includes("Forward Evidence")));
assert.ok(blocked.reasons.some((reason) => reason.includes("execution-parity")));
assert.ok(blocked.reasons.some((reason) => reason.includes("liveTradingEnabled")));

async function main() {
    const fakeExecutor: DirectTradeExecutor = {
        getAccountSnapshot: async () => { throw new Error("unused"); },
        getPositions: async () => { throw new Error("unused"); },
        getOpenOrders: async () => { throw new Error("unused"); },
        getMarketQuote: async () => { throw new Error("unused"); },
        normalizeMarketQuantity: async (symbol, requestedQuantity, referencePrice) => ({
            symbol,
            quantity: Math.floor(requestedQuantity * 10) / 10,
            quantityText: (Math.floor(requestedQuantity * 10) / 10).toFixed(1),
            minQuantity: 0.1,
            maxQuantity: 100000,
            stepSize: 0.1,
            minNotional: 5,
            notional: (Math.floor(requestedQuantity * 10) / 10) * referencePrice,
        }),
        executeMarket: async () => { throw new Error("unused"); },
        reconcileOrder: async () => { throw new Error("unused"); },
    };
    const quantity = await normalizeDisDexV96OrderQuantity({
        executor: fakeExecutor,
        symbol: "PENGUUSDT",
        side: "BUY",
        quote: {
            symbol: "PENGUUSDT",
            bidPrice: 9.9,
            askPrice: 10,
            bidQuantity: 100,
            askQuantity: 100,
            midPrice: 9.95,
            spreadBps: 100.5,
            updatedAt: Date.now(),
        },
        deltaNotionalUsd: 101,
        minimumOrderNotionalUsd: 5,
        reduceOnly: false,
    });
    assert.equal(quantity.referencePrice, 10);
    assert.equal(quantity.requestedQuantity, 10.1);
    assert.equal(quantity.normalized.quantity, 10.1);
    assert.equal(quantity.roundingPolicy, "FLOOR_TO_ASTER_MARKET_STEP");

    const state = createDisDexV96RunnerState("paper");
    assert.equal(state.strategyId, DISDEX_V96_STRATEGY_ID);
    assert.equal(state.version, 1);
    assert.equal(state.bootstrapRequired, true);
    assert.equal(state.forwardEvidence.completedDecisionBars, 0);

    console.log(JSON.stringify({
        status: "DISDEX_V96_PRODUCTION_CONTRACT_SELFTEST_PASS",
        strategyId: DISDEX_V96_STRATEGY_ID,
        liveTradingEnabled: DISDEX_V96_RUNTIME.liveTradingEnabled,
        liveGateAllowed: blocked.allowed,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
