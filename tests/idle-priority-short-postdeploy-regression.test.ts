import assert from "node:assert/strict";
import test from "node:test";

import { IdlePriorityShortRunner, coreAndSidecarExposure } from "../lib/idle-priority-short-runner";
import { emptyIdleState, type IdlePending, type IdleState } from "../lib/idle-priority-short-state";
import type { IdleSignal } from "../lib/idle-priority-short-signal";

const SHA = "a".repeat(40);
const now = 1_800_000_000_000;

function position(symbol: string, notionalUsd: number, quantity = -1) {
    return {
        symbol,
        quantity,
        entryPrice: 100,
        markPrice: 100,
        unrealizedPnl: 0,
        pnlPct: 0,
        notionalUsd,
        positionSide: "BOTH",
        leverage: 5,
        updatedAt: now,
    } as any;
}

function signal(symbol: "TAOUSDT" | "TIAUSDT" | "DOTUSDT" | "JUPUSDT" | "RENDERUSDT", signalTs: number): IdleSignal {
    return {
        accepted: true,
        symbol,
        route: ({
            TAOUSDT: "IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",
            TIAUSDT: "IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100",
            DOTUSDT: "IDLE_DOT_MOMENTUM_SHORT_BTCREL",
            JUPUSDT: "IDLE_JUP_RELATIVE_SHORT",
            RENDERUSDT: "IDLE_RENDER_RELATIVE_SHORT",
        } as const)[symbol],
        side: "SHORT",
        holdHours: symbol === "TIAUSDT" || symbol === "DOTUSDT" ? 24 : 12,
        reason: "fixture",
        features: {
            decisionTs: signalTs + 3_600_000,
            signalTs,
            ret12: -0.04,
            ret24: -0.05,
            btc24: -0.01,
            rel24: -0.04,
            atrRatio: 0.01,
            volumeRatio: 2,
            breakdown24: true,
        },
    };
}

function runner(overrides: Record<string, any> = {}) {
    const stateStore = {
        saved: undefined as IdleState | undefined,
        async save(state: IdleState) { this.saved = structuredClone(state); },
        async load() { return this.saved || emptyIdleState(SHA, now); },
    };
    const dependencies: any = {
        marketData: { async load() { throw new Error("not-used"); } },
        executor: {},
        adapter: {},
        client: {},
        stateStore,
        lock: {},
        runtime: {
            runtimeSha: SHA,
            mode: "LIVE",
            enabled: true,
            maximumSlippageBps: 20,
        },
        now: () => now,
        logger: { info() {}, warn() {}, error() {} },
        ...overrides,
    };
    return { instance: new IdlePriorityShortRunner(dependencies), dependencies, stateStore };
}

test("Idle ownership is durable-state backed; same symbol owned by another strategy is baseline exposure", () => {
    const rows = [
        position("DOTUSDT", 100),
        position("TIAUSDT", 100),
        position("HYPEUSDT", 20, 1),
    ];
    const exposure = coreAndSidecarExposure(rows, 100, new Set(["DOTUSDT"]));
    assert.equal(exposure.cryptoGross, 2.2);
    assert.equal(exposure.baselineOpenPositions, 1, "TIA is not Idle-owned merely because it is an Idle universe symbol");
    assert.equal(exposure.nonBaselineCryptoExposure, 0.2);
});

test("per-symbol cooldown is not global and is exactly 12h", () => {
    const { instance } = runner();
    const r = instance as any;
    const state = emptyIdleState(SHA, now);
    const t = 1_776_538_800_000;
    const render = signal("RENDERUSDT", t);
    const tao = signal("TAOUSDT", t);
    assert.equal(r.candidateLifecycleAllows(state, render), true);
    r.markCandidateLifecycle(state, render);
    assert.equal(r.candidateLifecycleAllows(state, tao), true, "same-timestamp different symbol must remain eligible");
    assert.equal(r.candidateLifecycleAllows(state, signal("RENDERUSDT", t + 11 * 3_600_000)), false);
    assert.equal(r.candidateLifecycleAllows(state, signal("RENDERUSDT", t + 12 * 3_600_000)), true);
});

test("venue STOP fill is reconciled as a normal exit and surviving TP is cancelled", async () => {
    const cancelled: string[] = [];
    const stopId = "idle-stop-fixture";
    const tpId = "idle-tp-fixture";
    const { instance, stateStore } = runner({
        executor: {
            async reconcileOrder(_symbol: string, id: string) {
                return id === stopId
                    ? { status: "FILLED", executedQuantity: 1, executionUnknown: false }
                    : { status: "NEW", executedQuantity: 0, executionUnknown: false };
            },
        },
        adapter: { async cancel(id: string) { cancelled.push(id); } },
    });
    const state = emptyIdleState(SHA, now);
    state.positions = [{
        symbol: "DOTUSDT",
        route: "IDLE_DOT_MOMENTUM_SHORT_BTCREL",
        side: "SHORT",
        signalTs: now - 5 * 3_600_000,
        entryTs: now - 4 * 3_600_000,
        exitTs: now + 20 * 3_600_000,
        entryPrice: 100,
        quantity: 1,
        holdHours: 24,
        gross: 1,
        stopPrice: 110,
        takeProfitPrice: 75,
        stopClientOrderId: stopId,
        takeProfitClientOrderId: tpId,
        protectionVerified: true,
    }];
    const changed = await (instance as any).reconcileVenueProtectiveFills(state, [], [{
        symbol: "DOTUSDT", clientOrderId: tpId, quantity: 1, executedQuantity: 0, status: "NEW", reduceOnly: true,
    }]);
    assert.equal(changed, true);
    assert.equal(state.positions.length, 0);
    assert.equal(state.lastDecision?.reason, "EXIT:HARD_STOP_VENUE_RECONCILED");
    assert.deepEqual(cancelled, [tpId]);
    assert.equal(stateStore.saved?.positions.length, 0);
});

test("EXIT pending can reconcile after restart without an exposure reservation", async () => {
    const cancelled: string[] = [];
    const { instance } = runner({
        executor: {
            async reconcileOrder() { return { status: "FILLED", executedQuantity: 1, executionUnknown: false }; },
            async getPositions() { return []; },
        },
        adapter: { async cancel(id: string) { cancelled.push(id); } },
    });
    const state = emptyIdleState(SHA, now);
    state.positions = [{
        symbol: "TAOUSDT", route: "IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2", side: "SHORT",
        signalTs: now - 4 * 3_600_000, entryTs: now - 3 * 3_600_000, exitTs: now + 9 * 3_600_000,
        entryPrice: 100, quantity: 1, holdHours: 12, gross: 1, stopPrice: 110, takeProfitPrice: 75,
        stopClientOrderId: "stop", takeProfitClientOrderId: "tp", protectionVerified: true,
    }];
    state.pending = {
        action: "EXIT", phase: "submitted", symbol: "TAOUSDT", route: "IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",
        clientOrderId: "exit", idempotencyKey: "exit", quantity: 1, expectedPrice: 101,
        signalTs: now - 4 * 3_600_000, decisionTs: now, holdHours: 12,
        createdAt: now - 1_000, updatedAt: now - 1_000, reason: "FIXED_HOLD_EXIT",
    } satisfies IdlePending;
    const lock = { async releaseReservation() { throw new Error("EXIT must not require reservation"); } };
    const result = await (instance as any).reconcilePending(state, lock);
    assert.equal(result.status, "completed");
    assert.equal(state.pending, null);
    assert.equal(state.positions.length, 0);
    assert.deepEqual(cancelled.sort(), ["stop", "tp"]);
});

test("unprotected filled entry is safety-closed with BUY ask reference", async () => {
    let expectedPrice = 0;
    const { instance } = runner({
        executor: {
            async getMarketQuote() { return { bidPrice: 100, askPrice: 101, updatedAt: now }; },
            async executeMarket(command: any) {
                expectedPrice = command.expectedPrice;
                assert.equal(command.side, "BUY");
                assert.equal(command.reduceOnly, true);
                return { status: "FILLED", executedQuantity: 1, executionUnknown: false };
            },
            async getPositions() { return []; },
        },
        adapter: { async cancel() {} },
    });
    const state = emptyIdleState(SHA, now);
    const pending: IdlePending = {
        action: "ENTRY", phase: "submitted", symbol: "JUPUSDT", route: "IDLE_JUP_RELATIVE_SHORT",
        clientOrderId: "entry", idempotencyKey: "entry", reservationId: "reservation",
        quantity: 1, expectedPrice: 100, signalTs: now - 3_600_000, decisionTs: now,
        holdHours: 12, createdAt: now - 1_000, updatedAt: now - 1_000, reason: "fixture",
    };
    state.pending = pending;
    const result = await (instance as any).safetyCloseUnprotectedEntry(
        state,
        pending,
        position("JUPUSDT", 100, -1),
        { async releaseReservation() {}, async document() {} },
        "IDLE_PROTECTION_READBACK_FAILED",
    );
    assert.equal(expectedPrice, 101);
    assert.equal(result.status, "manual-review");
    assert.equal(state.pending, null);
    assert.match(String(state.manualReview), /SAFETY_CLOSED/);
});
