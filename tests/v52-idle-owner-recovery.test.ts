import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_V52_IDLE_OWNER_MARGIN_MAX_AGE_MS,
    isMarginGuardFresh,
    protectedIdleSnapshotFingerprint,
    protectedIdleValidationFingerprint,
    validateProtectedIdleSnapshot,
    type ProtectedIdleValidation,
    type ProtectedIdleVenueSnapshot,
} from "../scripts/disdex-v52-idle-owner-recovery";
import { emptyIdleState, type IdleOwnedPosition } from "../lib/idle-priority-short-state";

const SHA = "a".repeat(40);

function position(input: Partial<IdleOwnedPosition> = {}): IdleOwnedPosition {
    return {
        symbol: "DOTUSDT",
        route: "DOT_MOMENTUM_SHORT_BTCREL",
        side: "SHORT",
        signalTs: 1_700_000_000_000,
        entryTs: 1_700_000_000_000,
        exitTs: 1_700_000_000_000 + 24 * 3_600_000,
        entryPrice: 1.087,
        quantity: 65.9,
        holdHours: 24,
        gross: 1,
        stopPrice: 1.196,
        takeProfitPrice: 0.815,
        stopClientOrderId: "idle-stop-dot",
        takeProfitClientOrderId: "idle-tp-dot",
        protectionVerified: true,
        ...input,
    };
}

function snapshot(statePositions = [position()]): ProtectedIdleVenueSnapshot {
    const state = emptyIdleState(SHA, 1_700_000_100_000);
    state.positions = statePositions;
    return {
        state,
        venuePositions: statePositions.map((p) => ({
            symbol: p.symbol,
            positionAmt: String(-p.quantity),
            entryPrice: String(p.entryPrice),
            markPrice: String(p.entryPrice * 1.01),
            leverage: "5",
            marginType: "cross",
            positionSide: "BOTH",
        })),
        openOrders: statePositions.flatMap((p) => [
            {
                symbol: p.symbol,
                clientOrderId: p.stopClientOrderId,
                status: "NEW",
                side: "BUY",
                type: "STOP_MARKET",
                reduceOnly: true,
                origQty: String(p.quantity),
                stopPrice: String(p.stopPrice),
            },
            {
                symbol: p.symbol,
                clientOrderId: p.takeProfitClientOrderId,
                status: "NEW",
                side: "BUY",
                type: "TAKE_PROFIT_MARKET",
                reduceOnly: true,
                origQty: String(p.quantity),
                stopPrice: String(p.takeProfitPrice),
            },
        ]),
        capturedAt: 1_700_000_100_000,
    };
}

test("protected Idle venue snapshot accepts exact short positions and STOP/TP ownership", () => {
    const result = validateProtectedIdleSnapshot(snapshot(), SHA, 1_700_000_100_001, 10_000);
    assert.deepEqual(result.symbols, ["DOTUSDT"]);
    assert.equal(result.positionCount, 1);
    assert.equal(result.protectiveOrderCount, 2);
});

test("signed-read stability ignores mark-price movement but tracks ownership-critical drift", () => {
    const first = snapshot();
    const second = snapshot();
    second.venuePositions[0].markPrice = "1.2345";

    assert.equal(
        protectedIdleSnapshotFingerprint(first),
        protectedIdleSnapshotFingerprint(second),
    );

    second.venuePositions[0].positionAmt = "-64.9";
    assert.notEqual(
        protectedIdleSnapshotFingerprint(first),
        protectedIdleSnapshotFingerprint(second),
    );
});

test("margin freshness default covers the configured five-minute guard poll", () => {
    const checkedAt = 1_000_000;
    assert.equal(DEFAULT_V52_IDLE_OWNER_MARGIN_MAX_AGE_MS, 360_000);
    assert.equal(
        isMarginGuardFresh(
            { stage: "HEALTHY", ordersAllowed: true, checkedAt },
            checkedAt + 300_000,
        ),
        true,
    );
    assert.equal(
        isMarginGuardFresh(
            { stage: "HEALTHY", ordersAllowed: true, checkedAt },
            checkedAt + 360_001,
        ),
        false,
    );
});

test("final signed-read comparison ignores observation timestamp drift", () => {
    const first: ProtectedIdleValidation = {
        symbols: ["DOTUSDT", "JUPUSDT"],
        positionCount: 2,
        protectiveOrderCount: 4,
        capturedAt: 1_000,
    };
    const second = { ...first, capturedAt: 2_000 };
    assert.equal(
        protectedIdleValidationFingerprint(first),
        protectedIdleValidationFingerprint(second),
    );
});

test("extra venue position fails closed instead of clearing the global hold", () => {
    const input = snapshot();
    input.venuePositions = [
        ...input.venuePositions,
        { symbol: "JUPUSDT", positionAmt: "-1", entryPrice: "0.3", markPrice: "0.31", leverage: "5", marginType: "cross" },
    ];
    assert.throws(() => validateProtectedIdleSnapshot(input, SHA, 1_700_000_100_001, 10_000), /VENUE_POSITION_SET_MISMATCH/);
});

test("missing or non-reduce-only protection fails closed", () => {
    const input = snapshot();
    input.openOrders = input.openOrders.slice(0, 1);
    assert.throws(() => validateProtectedIdleSnapshot(input, SHA, 1_700_000_100_001, 10_000), /PROTECTIVE_ORDER_SET_MISMATCH/);

    const second = snapshot();
    second.openOrders[0].reduceOnly = false;
    assert.throws(() => validateProtectedIdleSnapshot(second, SHA, 1_700_000_100_001, 10_000), /PROTECTIVE_ORDER_NOT_REDUCE_ONLY/);
});

test("pending, manual review, stale state, and SHA drift fail closed", () => {
    const pending = snapshot();
    pending.state.pending = { action: "ENTRY", phase: "planned", symbol: "DOTUSDT", route: "DOT_MOMENTUM_SHORT_BTCREL", clientOrderId: "p", idempotencyKey: "i", quantity: 1, expectedPrice: 1, signalTs: 1_700_000_000_000, decisionTs: 1_700_000_000_000, holdHours: 24, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, reason: "test" };
    assert.throws(() => validateProtectedIdleSnapshot(pending, SHA, 1_700_000_100_001, 10_000), /STATE_PENDING_OR_MANUAL_REVIEW/);

    const stale = snapshot();
    assert.throws(() => validateProtectedIdleSnapshot(stale, SHA, 1_700_100_100_001, 10_000), /STATE_STALE/);

    const drifted = snapshot();
    assert.throws(() => validateProtectedIdleSnapshot(drifted, "b".repeat(40), 1_700_000_100_001, 10_000), /STATE_RUNTIME_SHA_MISMATCH/);
});
