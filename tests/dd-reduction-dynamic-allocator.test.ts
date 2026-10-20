import assert from "node:assert/strict";
import { test } from "node:test";

import {
    confirmFill,
    createInitialAllocatorState,
    decideCandidate,
    expireReservation,
    registerProtection,
    releaseReservation,
    type DynamicAllocatorCandidate,
    type DynamicAllocatorPolicy,
} from "../lib/backtest/dd-reduction/dynamic-allocator";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const TS = 1_700_000_000_000;

function policy(overrides: Partial<DynamicAllocatorPolicy> = {}): DynamicAllocatorPolicy {
    return {
        total_gross_cap: 1_000,
        crypto_gross_cap: 1_000,
        strategy_gross_caps: { V12: 1_000, Q102: 1_000 },
        symbol_gross_caps: { BTCUSDT: 1_000, ETHUSDT: 1_000 },
        reservation_ttl_ms: 60_000,
        min_qty: 0.01,
        min_notional: 10,
        ...overrides,
    };
}

function candidate(overrides: Partial<DynamicAllocatorCandidate> = {}): DynamicAllocatorCandidate {
    return {
        candidate_id: "candidate-1",
        strategy_id: "V12",
        symbol: "BTCUSDT",
        side: "LONG",
        decision_ts_ms: TS,
        signal_ts_ms: TS - 1_000,
        entry_valid_until_ms: TS + 30_000,
        requested_gross: 100,
        quantity: 1,
        entry_price: 100,
        priority: 10,
        rank: 1,
        evidence_level: "ORIGINAL_EVIDENCE",
        source_sha: "a".repeat(64),
        evidence: {
            level: "ORIGINAL_EVIDENCE",
            sourceKind: "RAW_CANDIDATE_DECISIONS",
            sourcePath: "fixture/dynamic-allocator.jsonl",
            sourceSha256: "a".repeat(64),
            rowNumber: 1,
            sourceBytes: 128,
        },
        validity: "VALID",
        asset_class: "CRYPTO",
        ...overrides,
    } as DynamicAllocatorCandidate;
}

test("accepts a candidate with an immutable before/after reservation ledger", () => {
    assertFixtureIdentity(
        { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
        ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
        "dynamic-allocator.fixture",
    );
    const state = createInitialAllocatorState({ wallet_jpy: 1_000, equity_jpy: 1_000, available_margin: 500 });

    const decision = decideCandidate(state, candidate(), policy());

    assert.equal(decision.accepted, true);
    assert.equal(decision.reason, null);
    assert.equal(decision.state_before.reserved_gross, 0);
    assert.equal(decision.state_after.reserved_gross, 100);
    assert.equal(decision.state_after.pending_gross, 100);
    assert.equal(decision.state_after.available_margin, 400);
    assert.ok(decision.reservation);
    assert.match(decision.state_hash_before, /^[a-f0-9]{64}$/);
    assert.match(decision.state_hash_after, /^[a-f0-9]{64}$/);
    assert.notEqual(decision.state_hash_before, decision.state_hash_after);
    assert.deepEqual(state, decision.state_before);
});

test("produces the same state hashes for equal input and does not double-count filled gross", () => {
    const state = createInitialAllocatorState({ available_margin: 1_000 });
    const first = decideCandidate(state, candidate(), policy({ total_gross_cap: 200, crypto_gross_cap: 200 }));
    const second = decideCandidate(state, candidate(), policy({ total_gross_cap: 200, crypto_gross_cap: 200 }));
    assert.equal(first.state_hash_after, second.state_hash_after);
    assert.deepEqual(first.state_after, second.state_after);

    const filled = confirmFill(first.state_after, first.reservation!.reservation_id, { fill_ts_ms: TS + 1, filled_gross: 100 });
    const nextSymbol = decideCandidate(
        filled.state_after,
        candidate({ candidate_id: "candidate-2", symbol: "ETHUSDT" }),
        policy({ total_gross_cap: 200, crypto_gross_cap: 200 }),
    );
    assert.equal(nextSymbol.accepted, true);
});

test("accounts for crypto gross exactly once across fill and release", () => {
    const state = createInitialAllocatorState({ available_margin: 1_000 });
    const first = decideCandidate(state, candidate(), policy({ total_gross_cap: 1_000, crypto_gross_cap: 100 }));
    const filled = confirmFill(first.state_after, first.reservation!.reservation_id, { fill_ts_ms: TS + 1, filled_gross: 100 });
    assert.equal(filled.state_after.crypto_gross, 100);

    const second = decideCandidate(
        filled.state_after,
        candidate({ candidate_id: "candidate-2", symbol: "ETHUSDT" }),
        policy({ total_gross_cap: 1_000, crypto_gross_cap: 100 }),
    );
    assert.equal(second.reason, "GROSS_CAP_CRYPTO");

    const released = releaseReservation(filled.state_after, first.reservation!.reservation_id, {
        at_ts_ms: TS + 2,
        reason: "EXIT",
    });
    assert.equal(released.state_after.crypto_gross, 0);
    const reAdmitted = decideCandidate(
        released.state_after,
        candidate({ candidate_id: "candidate-3", symbol: "ETHUSDT" }),
        policy({ total_gross_cap: 1_000, crypto_gross_cap: 100 }),
    );
    assert.equal(reAdmitted.accepted, true);
});

test("enforces total, crypto, strategy, and symbol gross caps including reservations", () => {
    const cases: readonly [string, Partial<DynamicAllocatorPolicy>, DynamicAllocatorCandidate, string][] = [
        ["total", { total_gross_cap: 100 }, candidate(), "GROSS_CAP_TOTAL"],
        ["crypto", { crypto_gross_cap: 100 }, candidate(), "GROSS_CAP_CRYPTO"],
        ["strategy", { strategy_gross_caps: { V12: 99 } }, candidate(), "GROSS_CAP_STRATEGY"],
        ["symbol", { symbol_gross_caps: { BTCUSDT: 99 } }, candidate(), "GROSS_CAP_SYMBOL"],
    ];

    for (const [, policyOverrides, item, reason] of cases) {
        const state = createInitialAllocatorState({ reserved_gross: 1, available_margin: 1_000 });
        const result = decideCandidate(state, item, policy(policyOverrides));
        assert.equal(result.accepted, false);
        assert.equal(result.reason, reason);
        assert.equal(result.state_hash_before, result.state_hash_after);
        assert.equal(result.state_after.reserved_gross, state.reserved_gross);
    }
});

test("rejects pending and reserved gross limits without creating a reservation", () => {
    const pending = decideCandidate(
        createInitialAllocatorState({ pending_gross: 90, reserved_gross: 90, available_margin: 1_000 }),
        candidate(),
        policy({ pending_gross_cap: 100 }),
    );
    assert.equal(pending.reason, "PENDING_GROSS");
    assert.equal(pending.reservation, null);

    const reserved = decideCandidate(
        createInitialAllocatorState({ reserved_gross: 90, available_margin: 1_000 }),
        candidate(),
        policy({ reserved_gross_cap: 100, total_gross_cap: 10_000, crypto_gross_cap: 10_000 }),
    );
    assert.equal(reserved.reason, "RESERVED_GROSS");
    assert.equal(reserved.reservation, null);
});

test("rejects a candidate below minimum quantity or notional", () => {
    const tooSmallQuantity = decideCandidate(
        createInitialAllocatorState({ available_margin: 1_000 }),
        candidate({ quantity: 0.001 }),
        policy({ min_qty: 0.01 }),
    );
    assert.equal(tooSmallQuantity.reason, "MIN_QTY");

    const tooSmallNotional = decideCandidate(
        createInitialAllocatorState({ available_margin: 1_000 }),
        candidate({ requested_gross: 5 }),
        policy({ min_notional: 10 }),
    );
    assert.equal(tooSmallNotional.reason, "MIN_NOTIONAL");
});

test("fails closed when minimum quantity is required but quantity evidence is missing", () => {
    const result = decideCandidate(
        createInitialAllocatorState({ available_margin: 1_000 }),
        candidate({ quantity: null }),
        policy({ min_qty: 0.01 }),
    );
    assert.equal(result.reason, "DATA_MISSING");
    assert.equal(result.reservation, null);
});

test("blocks same-symbol ownership and explicit opposite-direction conflicts", () => {
    const first = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    assert.equal(first.accepted, true);

    const sameSide = decideCandidate(first.state_after, candidate({ candidate_id: "candidate-2" }), policy());
    assert.equal(sameSide.reason, "SAME_SYMBOL_OWNERSHIP");

    const oppositeSide = decideCandidate(
        first.state_after,
        candidate({ candidate_id: "candidate-3", side: "SHORT" }),
        policy(),
    );
    assert.equal(oppositeSide.reason, "OPPOSITE_SIDE_CONFLICT");
});

test("requires causal cooldown evidence and does not let a future STOP block an earlier decision", () => {
    const state = createInitialAllocatorState({
        available_margin: 1_000,
        cooldown_by_symbol_side_strategy: {
            "BTCUSDT|LONG|V12": { until_ts_ms: TS + 60_000, source_event_ts_ms: TS + 1, reason: "STOP" },
        },
    });
    const result = decideCandidate(state, candidate(), policy());
    assert.equal(result.accepted, true);

    const causalState = createInitialAllocatorState({
        available_margin: 1_000,
        cooldown_by_symbol_side_strategy: {
            "BTCUSDT|LONG|V12": { until_ts_ms: TS + 60_000, source_event_ts_ms: TS - 1, reason: "STOP" },
        },
    });
    const blocked = decideCandidate(causalState, candidate(), policy());
    assert.equal(blocked.reason, "COOLDOWN_ACTIVE");
});

test("rejected candidates do not create cooldown or become reservations automatically", () => {
    const state = createInitialAllocatorState({
        cooldown_by_symbol_side_strategy: {},
        available_margin: 0,
    });
    const rejected = decideCandidate(state, candidate(), policy());
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, "MARGIN_UNAVAILABLE");
    assert.deepEqual(rejected.state_after.cooldown_by_symbol_side_strategy, {});

    const later = decideCandidate(
        createInitialAllocatorState({ available_margin: 100 }),
        candidate({ decision_ts_ms: TS + 1 }),
        policy(),
    );
    assert.equal(later.accepted, true);
});

test("requires fresh validity and evidence when a released gross slot is re-admitted", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    assert.ok(accepted.reservation);
    const released = releaseReservation(accepted.state_after, accepted.reservation!.reservation_id, {
        at_ts_ms: TS + 1,
        reason: "EXIT",
    });
    assert.equal(released.applied, true);
    assert.equal(released.state_after.reserved_gross, 0);

    const expired = decideCandidate(
        released.state_after,
        candidate({ candidate_id: "candidate-2", decision_ts_ms: TS + 2, entry_valid_until_ms: TS + 1 }),
        policy(),
    );
    assert.equal(expired.reason, "ENTRY_EXPIRED");

    const missingEvidence = decideCandidate(
        released.state_after,
        candidate({ candidate_id: "candidate-3", evidence_level: "UNVERIFIABLE" }),
        policy(),
    );
    assert.equal(missingEvidence.reason, "DATA_MISSING");
});

test("reservation expiry is explicit and single-use", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    assert.ok(accepted.reservation);

    const tooEarly = expireReservation(accepted.state_after, accepted.reservation!.reservation_id, TS + 1);
    assert.equal(tooEarly.applied, false);
    assert.equal(tooEarly.reason, "RESERVATION_NOT_EXPIRED");

    const expired = expireReservation(accepted.state_after, accepted.reservation!.reservation_id, TS + 60_000);
    assert.equal(expired.applied, true);
    assert.equal(expired.state_after.pending_gross, 0);
    assert.equal(expired.state_after.reserved_gross, 0);

    const repeated = expireReservation(expired.state_after, accepted.reservation!.reservation_id, TS + 120_000);
    assert.equal(repeated.applied, false);
    assert.equal(repeated.reason, "RESERVATION_ALREADY_RELEASED");
    assert.equal(repeated.state_hash_before, repeated.state_hash_after);
});

test("rejects fills before creation and after expiry without mutating the reservation", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const reservationId = accepted.reservation!.reservation_id;
    const beforeCreation = confirmFill(accepted.state_after, reservationId, { fill_ts_ms: TS - 1, filled_gross: 100 });
    assert.equal(beforeCreation.reason, "FILL_GROSS_MISMATCH");
    assert.equal(beforeCreation.state_hash_before, beforeCreation.state_hash_after);

    const afterExpiry = confirmFill(accepted.state_after, reservationId, { fill_ts_ms: TS + 60_001, filled_gross: 100 });
    assert.equal(afterExpiry.reason, "FILL_GROSS_MISMATCH");
    assert.equal(afterExpiry.state_hash_before, afterExpiry.state_hash_after);
});

test("fails closed for missing or invalid asset class instead of defaulting to crypto", () => {
    for (const assetClass of [null, "UNKNOWN"] as const) {
        const result = decideCandidate(
            createInitialAllocatorState({ available_margin: 1_000 }),
            candidate({ candidate_id: `asset-${String(assetClass)}`, asset_class: assetClass }),
            policy(),
        );
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.reservation, null);
    }
});

test("fill confirmation and protection registration are explicit lifecycle transitions", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const reservationId = accepted.reservation!.reservation_id;

    const filled = confirmFill(accepted.state_after, reservationId, { fill_ts_ms: TS + 2, filled_gross: 100 });
    assert.equal(filled.applied, true);
    assert.equal(filled.state_after.pending_gross, 0);
    assert.equal(filled.state_after.reserved_gross, 0);
    assert.equal(filled.state_after.total_gross, 100);
    assert.equal(filled.state_after.gross_by_symbol.BTCUSDT, 100);

    const protectedState = registerProtection(filled.state_after, reservationId, {
        protection_id: "stop-1",
        registered_ts_ms: TS + 3,
    });
    assert.equal(protectedState.applied, true);
    assert.equal(protectedState.state_after.reservations[0]?.protection_id, "stop-1");

    const duplicateFill = confirmFill(protectedState.state_after, reservationId, { fill_ts_ms: TS + 4, filled_gross: 100 });
    assert.equal(duplicateFill.applied, false);
    assert.equal(duplicateFill.reason, "RESERVATION_ALREADY_FILLED");
});

test("fails closed on a partial fill until the execution lifecycle contract handles it", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const partial = confirmFill(accepted.state_after, accepted.reservation!.reservation_id, { fill_ts_ms: TS + 2, filled_gross: 50 });
    assert.equal(partial.applied, false);
    assert.equal(partial.reason, "FILL_GROSS_MISMATCH");
    assert.equal(partial.state_hash_before, partial.state_hash_after);
});

test("release makes filled gross reusable and applies cooldown only with the explicit causal release", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const reservationId = accepted.reservation!.reservation_id;
    const filled = confirmFill(accepted.state_after, reservationId, { fill_ts_ms: TS + 1, filled_gross: 100 });
    const released = releaseReservation(filled.state_after, reservationId, {
        at_ts_ms: TS + 2,
        reason: "STOP",
        cooldown_until_ts_ms: TS + 60_000,
        cooldown_source_event_ts_ms: TS + 2,
    });
    assert.equal(released.applied, true);
    assert.equal(released.state_after.total_gross, 0);
    assert.equal(released.state_after.reserved_gross, 0);
    assert.equal(released.state_after.gross_by_symbol.BTCUSDT, undefined);
    assert.equal(released.state_after.cooldown_by_symbol_side_strategy["BTCUSDT|LONG|V12"]?.until_ts_ms, TS + 60_000);
});

test("rejects invalid protection metadata without changing lifecycle state", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const filled = confirmFill(accepted.state_after, accepted.reservation!.reservation_id, { fill_ts_ms: TS + 1, filled_gross: 100 });
    for (const protection of [
        { protection_id: "", registered_ts_ms: TS + 2 },
        { protection_id: "   ", registered_ts_ms: TS + 2 },
        { protection_id: "stop-nan", registered_ts_ms: Number.NaN },
        { protection_id: "stop-before-fill", registered_ts_ms: TS },
    ]) {
        const result = registerProtection(filled.state_after, accepted.reservation!.reservation_id, protection);
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.state_hash_before, result.state_hash_after);
    }
});

test("rejects release timestamps, reasons, and cooldown source metadata that are not causal", () => {
    const accepted = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), candidate(), policy());
    const reservationId = accepted.reservation!.reservation_id;
    const beforeCreation = releaseReservation(accepted.state_after, reservationId, { at_ts_ms: TS - 1, reason: "EXIT" });
    assert.equal(beforeCreation.reason, "DATA_MISSING");
    const emptyReason = releaseReservation(accepted.state_after, reservationId, { at_ts_ms: TS + 1, reason: "   " });
    assert.equal(emptyReason.reason, "DATA_MISSING");

    const filled = confirmFill(accepted.state_after, reservationId, { fill_ts_ms: TS + 1, filled_gross: 100 });
    const beforeFill = releaseReservation(filled.state_after, reservationId, { at_ts_ms: TS, reason: "EXIT" });
    assert.equal(beforeFill.reason, "DATA_MISSING");
    for (const source of [undefined, null, Number.NaN, TS + 4] as const) {
        const result = releaseReservation(filled.state_after, reservationId, {
            at_ts_ms: TS + 3,
            reason: "STOP",
            cooldown_until_ts_ms: TS + 60_000,
            cooldown_source_event_ts_ms: source,
        });
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.state_hash_before, result.state_hash_after);
    }
});

test("requires usable source provenance for normalized evidence levels", () => {
    for (const evidenceLevel of ["ORIGINAL_EVIDENCE", "CAUSALLY_REGENERATED"] as const) {
        const missingProvenance = decideCandidate(
            createInitialAllocatorState({ available_margin: 1_000 }),
            candidate({ candidate_id: `missing-${evidenceLevel}`, evidence: { level: evidenceLevel }, source_sha: null }),
            policy(),
        );
        assert.equal(missingProvenance.reason, "DATA_MISSING");

        const invalidHash = decideCandidate(
            createInitialAllocatorState({ available_margin: 1_000 }),
            candidate({
                candidate_id: `invalid-${evidenceLevel}`,
                evidence_level: evidenceLevel,
                evidence: {
                    level: evidenceLevel,
                    sourceKind: "RAW_CANDIDATE_DECISIONS",
                    sourcePath: "fixture.jsonl",
                    sourceSha256: "not-a-sha",
                    rowNumber: 1,
                    sourceBytes: 1,
                },
                source_sha: "not-a-sha",
            }),
            policy(),
        );
        assert.equal(invalidHash.reason, "DATA_MISSING");
    }
});

test("requires a positive finite reservation TTL", () => {
    for (const ttl of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY] as const) {
        const result = decideCandidate(
            createInitialAllocatorState({ available_margin: 1_000 }),
            candidate({ candidate_id: `ttl-${String(ttl)}` }),
            policy({ reservation_ttl_ms: ttl }),
        );
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.reservation, null);
    }
});
