import assert from "node:assert/strict";
import test from "node:test";

import {
    heartbeatIdleProtectedRateBudgetDeferral,
} from "../lib/idle-priority-short-runner";

const state = {
    schema: "disdex-idle-priority-state/v2",
    runtimeSha: "a".repeat(40),
    updatedAt: 100,
    positions: [{
        symbol: "DOTUSDT",
        route: "IDLE_DOT_MOMENTUM_SHORT_BTCREL",
        side: "SHORT",
        signalTs: 1,
        entryTs: 2,
        exitTs: 86_402,
        entryPrice: 1.087,
        quantity: 65.9,
        holdHours: 24,
        gross: 1,
        stopPrice: 1.196,
        takeProfitPrice: 0.815,
        stopClientOrderId: "idle-stop-dot",
        takeProfitClientOrderId: "idle-tp-dot",
        protectionVerified: true,
    }],
    manualReview: null,
    pending: null,
    lastAcceptedBySymbol: {},
    failures: [],
} as any;

test("protected rate-budget deferral refreshes heartbeat without changing exposure", () => {
    const reason = "IDLE_PROTECTED_POSITION_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:3056";
    const next = heartbeatIdleProtectedRateBudgetDeferral(state, reason, 200);

    assert.equal(next.updatedAt, 200);
    assert.deepEqual(next.positions, state.positions);
    assert.equal(next.pending, null);
    assert.equal(next.manualReview, null);
    assert.deepEqual(next.lastDecision, {
        decisionTs: 200,
        accepted: false,
        reason,
    });
    assert.equal(state.updatedAt, 100);
    assert.equal(state.lastDecision, undefined);
});
