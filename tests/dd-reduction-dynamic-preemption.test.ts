import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyPreemption,
    eligiblePreemption,
    releasePreemptionGross,
    observeHistoricalPreemptionCount,
    type DynamicPreemptionCandidate,
    type DynamicPreemptionPosition,
} from "../lib/backtest/dd-reduction/dynamic-preemption";
import {
    confirmFill,
    createInitialAllocatorState,
    decideCandidate,
    registerProtection,
    type DynamicAllocatorCandidate,
    type DynamicAllocatorPolicy,
} from "../lib/backtest/dd-reduction/dynamic-allocator";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const TS = 1_700_000_000_000;
const SHA = "a".repeat(64);

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
        candidate_id: "incoming-1",
        strategy_id: "Q102",
        symbol: "BTCUSDT",
        side: "LONG",
        decision_ts_ms: TS + 10,
        signal_ts_ms: TS,
        entry_valid_until_ms: TS + 30_000,
        requested_gross: 100,
        quantity: 1,
        entry_price: 100,
        priority: 1,
        evidence_level: "ORIGINAL_EVIDENCE",
        source_sha: SHA,
        evidence: {
            level: "ORIGINAL_EVIDENCE",
            sourceKind: "RAW_CANDIDATE_DECISIONS",
            sourcePath: "fixture/preemption.jsonl",
            sourceSha256: SHA,
            rowNumber: 1,
            sourceBytes: 128,
        },
        validity: "VALID",
        asset_class: "CRYPTO",
        ...overrides,
    } as DynamicAllocatorCandidate;
}

function victimCandidate(): DynamicAllocatorCandidate {
    return candidate({
        candidate_id: "victim-1",
        strategy_id: "V12",
        priority: 10,
        decision_ts_ms: TS,
        entry_valid_until_ms: TS + 30_000,
    });
}

function openVictim(): { state: ReturnType<typeof createInitialAllocatorState>; position: DynamicPreemptionPosition } {
    const reserved = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), victimCandidate(), policy());
    assert.equal(reserved.accepted, true);
    const filled = confirmFill(reserved.state_after, reserved.reservation!.reservation_id, {
        fill_ts_ms: TS + 1,
        filled_gross: 100,
    });
    assert.equal(filled.applied, true);
    return {
        state: filled.state_after,
        position: {
            position_id: "position:victim-1",
            reservation_id: reserved.reservation!.reservation_id,
            candidate_id: "victim-1",
            strategy_id: "V12",
            symbol: "BTCUSDT",
            side: "LONG",
            gross: 100,
            quantity: 1,
            entry_price: 100,
            priority: 10,
            status: "OPEN",
            protected: false,
            opened_ts_ms: TS + 1,
        },
    };
}

test("eligiblePreemption accepts an explicit whole victim only when incoming priority wins", () => {
    assertFixtureIdentity(
        { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
        ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
        "dynamic-preemption.fixture",
    );
    const { position } = openVictim();
    const result = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });

    assert.equal(result.eligible, true);
    assert.equal(result.mode, "WHOLE");
    assert.equal(result.requested_gross, 100);
    assert.equal(result.releasable_gross, 100);
    assert.equal(result.released_gross, 0);
    assert.equal(result.reason, null);
});

test("rejects protected victims and priority losers without changing allocator state", () => {
    const { position } = openVictim();
    const protectedResult = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: { ...position, protected: true },
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(protectedResult.eligible, false);
    assert.equal(protectedResult.reason, "VICTIM_PROTECTED");

    const loser = eligiblePreemption({
        incoming_candidate: candidate({ priority: 20 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(loser.eligible, false);
    assert.equal(loser.reason, "INCOMING_PRIORITY_LOST");
});

test("same-priority candidates use deterministic candidate-id tie-break", () => {
    const { position } = openVictim();
    const winner = eligiblePreemption({
        incoming_candidate: candidate({ candidate_id: "aaa", priority: 10 }),
        victim_position: { ...position, candidate_id: "zzz", priority: 10 },
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(winner.eligible, true);

    const loser = eligiblePreemption({
        incoming_candidate: candidate({ candidate_id: "zzz", priority: 10 }),
        victim_position: { ...position, candidate_id: "aaa", priority: 10 },
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(loser.eligible, false);
    assert.equal(loser.reason, "INCOMING_PRIORITY_LOST");
});

test("partial and unknown execution are explicit fail-closed boundaries", () => {
    const { position } = openVictim();
    const partial = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "PARTIAL",
        requested_gross: 50,
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(partial.eligible, true);
    assert.equal(partial.mode, "PARTIAL");

    const unknown = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        exit_status: "UNKNOWN",
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(unknown.eligible, false);
    assert.equal(unknown.reason, "UNKNOWN_EXECUTION");
});

test("unresolved same-timestamp ordering is noncanonical and cannot preempt", () => {
    const { position } = openVictim();
    const result = eligiblePreemption({
        incoming_candidate: candidate({ decision_ts_ms: TS + 1 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 1,
        ordering_events: [
            { timestamp: TS + 1, kind: "PREEMPTION_EXIT" },
            { timestamp: TS + 1, kind: "ENTRY" },
        ],
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "NONCANONICAL_ORDERING");
});

test("whole preemption enforces exit confirmation, release, cooldown, then incoming re-admission", () => {
    const { state, position } = openVictim();
    const result = applyPreemption({
        state,
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 10 },
        cooldown: { until_ts_ms: TS + 60_000, source_event_ts_ms: TS + 10 },
        policy: policy(),
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    });
    assert.equal(result.applied, true);
    assert.equal(result.lifecycle, "VICTIM_EXIT_RELEASE_COOLDOWN_READMIT");
    assert.equal(result.exit_confirmation?.confirmed, true);
    assert.equal(result.gross_release?.applied, true);
    assert.equal(result.incoming_admission?.accepted, true);
    assert.equal(result.incoming_admission?.state_after.pending_gross, 100);
    assert.equal(result.incoming_admission?.state_after.cooldown_by_symbol_side_strategy["BTCUSDT|LONG|V12"]?.until_ts_ms, TS + 60_000);
});

test("duplicate exit or release fails closed and never admits the incoming candidate", () => {
    const { state, position } = openVictim();
    const released = releasePreemptionGross(state, position, {
        exit_ts_ms: TS + 10,
        status: "FILLED",
        confirmed: true,
        filled_gross: 100,
    });
    assert.equal(released.applied, true);

    const duplicate = releasePreemptionGross(released.state_after, position, {
        exit_ts_ms: TS + 11,
        status: "FILLED",
        confirmed: true,
        filled_gross: 100,
    });
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.reason, "DUPLICATE_RELEASE");
    assert.deepEqual(duplicate.state_after, released.state_after);

    const applied = applyPreemption({
        state: released.state_after,
        incoming_candidate: candidate({ candidate_id: "incoming-after-duplicate" }),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 11 },
        policy: policy(),
    });
    assert.equal(applied.applied, false);
    assert.equal(applied.reason, "DUPLICATE_EXIT_OR_RELEASE");
    assert.equal(applied.incoming_admission, null);
});

test("protection registration makes a victim ineligible without exposing a mutable copy path", () => {
    const { state, position } = openVictim();
    const protectedState = registerProtection(state, position.reservation_id, {
        protection_id: "stop-victim",
        registered_ts_ms: TS + 2,
    });
    assert.equal(protectedState.applied, true);
    const result = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        allocator_state: protectedState.state_after,
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "VICTIM_PROTECTED");
});

test("applyPreemption uses authoritative allocator protection even when victim metadata omits protection fields", () => {
    const { state, position } = openVictim();
    const protectedState = registerProtection(state, position.reservation_id, {
        protection_id: "stop-authoritative",
        registered_ts_ms: TS + 2,
    });
    assert.equal(protectedState.applied, true);
    const { protected: _protected, protection_id: _protectionId, protection_verified: _verified, ...untrustedPosition } = position;
    const result = applyPreemption({
        state: protectedState.state_after,
        incoming_candidate: candidate(),
        victim_position: untrustedPosition,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 10 },
        policy: policy(),
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, "VICTIM_PROTECTED");
    assert.equal(result.victim_release_applied, false);
});

test("ordering evidence is required and event evidence overrides contradictory caller metadata", () => {
    const { position } = openVictim();
    const missing = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
    });
    assert.equal(missing.eligible, false);
    assert.equal(missing.reason, "NONCANONICAL_ORDERING");

    const contradictory = eligiblePreemption({
        incoming_candidate: candidate({ decision_ts_ms: TS + 10 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 9,
        ordering_evidence: "CANONICAL_ORDERING",
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT" },
            { timestamp: TS + 10, kind: "ENTRY" },
        ],
    });
    assert.equal(contradictory.eligible, false);
    assert.equal(contradictory.reason, "NONCANONICAL_ORDERING");
});

test("rejects a future exit and requires event sequence evidence for equal decision/exit timestamps", () => {
    const { position } = openVictim();
    const future = eligiblePreemption({
        incoming_candidate: candidate({ decision_ts_ms: TS + 10 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 11,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(future.eligible, false);
    assert.equal(future.reason, "TEMPORAL_ORDER_INVALID");

    const equalWithoutSequence = eligiblePreemption({
        incoming_candidate: candidate({ decision_ts_ms: TS + 10 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(equalWithoutSequence.eligible, false);
    assert.equal(equalWithoutSequence.reason, "NONCANONICAL_ORDERING");

    const equalWithSequence = eligiblePreemption({
        incoming_candidate: candidate({ decision_ts_ms: TS + 10 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    });
    assert.equal(equalWithSequence.eligible, true);
});

test("validates exact open victim identity before eligibility and direct release", () => {
    const { state, position } = openVictim();
    const mismatched = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: { ...position, symbol: "ETHUSDT" },
        allocator_state: state,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(mismatched.eligible, false);
    assert.equal(mismatched.reason, "VICTIM_IDENTITY_MISMATCH");

    const pending = decideCandidate(createInitialAllocatorState({ available_margin: 1_000 }), victimCandidate(), policy());
    assert.equal(pending.accepted, true);
    const pendingPosition = { ...position, reservation_id: pending.reservation!.reservation_id, status: "OPEN" as const };
    const pendingRelease = releasePreemptionGross(pending.state_after, pendingPosition, {
        exit_ts_ms: TS + 10,
        status: "FILLED",
        confirmed: true,
        filled_gross: 100,
    });
    assert.equal(pendingRelease.applied, false);
    assert.equal(pendingRelease.reason, "VICTIM_NOT_OPEN");
});

test("reports successful victim release separately when incoming re-admission fails", () => {
    const { state, position } = openVictim();
    const result = applyPreemption({
        state,
        incoming_candidate: candidate({ requested_gross: 2_000 }),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 9 },
        policy: policy(),
        ordering_evidence: "CANONICAL_ORDERING",
    });
    assert.equal(result.applied, false);
    assert.equal(result.lifecycle, "VICTIM_RELEASED_INCOMING_REJECTED");
    assert.equal(result.victim_release_applied, true);
    assert.equal(result.gross_release?.applied, true);
    assert.equal(result.incoming_admission?.accepted, false);
});

test("historical 123/125 counts are observation-only and require provenance", () => {
    const observationPath = "docs/research/results/dd-reduction-initial-adverse-stop-audit-20261020/TASK9_ENGINE_AUDIT_FINAL_REPORT_JA.md";
    const observationSha = "e80a11de44815c82a9bd6eb917e6346ec5172e9a2c6a0627f48c3a7ce75a57a5";
    const manifestPath = "docs/research/results/dd-reduction-initial-adverse-stop-audit-20261020/manifest.json";
    const manifestSha = "7aec37cab3efae22e347b41890a5d049481327d29d22f1f3040321d0e483417d";
    const tenBps = observeHistoricalPreemptionCount({
        cost_bps: 10,
        observed_count: 123,
        source_path: observationPath,
        source_sha256: observationSha,
        provenance: { manifest_path: manifestPath, manifest_sha256: manifestSha },
    });
    assert.equal(tenBps.status, "OBSERVED");
    assert.equal(tenBps.expected_count, 123);
    assert.equal(tenBps.matches_expected, true);
    assert.equal(tenBps.formal_parity_eligible, false);
    assert.equal(tenBps.classification, "OBSERVATION_ONLY");
    assert.equal(tenBps.source_path, observationPath);
    assert.equal(tenBps.source_sha256, observationSha);
    assert.equal(tenBps.provenance.manifest_path, manifestPath);
    assert.equal(tenBps.provenance.verified, true);

    const mismatch = observeHistoricalPreemptionCount({
        cost_bps: 30,
        observed_count: 124,
        source_path: observationPath,
        source_sha256: observationSha,
        provenance: { manifest_path: manifestPath, manifest_sha256: manifestSha },
    });
    assert.equal(mismatch.status, "UNSUPPORTED");
    assert.equal(mismatch.reason, "COUNT_MISMATCH");
    assert.equal(mismatch.formal_parity_eligible, false);

    const missing = observeHistoricalPreemptionCount({ cost_bps: 30, observed_count: 125, source_path: "", source_sha256: null, provenance: null });
    assert.equal(missing.status, "UNSUPPORTED");
    assert.equal(missing.reason, "MISSING_PROVENANCE");
    assert.equal(missing.formal_parity_eligible, false);

    const nonexistent = observeHistoricalPreemptionCount({
        cost_bps: 10,
        observed_count: 123,
        source_path: "docs/research/missing-historical-report.md",
        source_sha256: observationSha,
        provenance: { manifest_path: manifestPath, manifest_sha256: manifestSha },
    });
    assert.equal(nonexistent.status, "UNSUPPORTED");
    assert.equal(nonexistent.reason, "PROVENANCE_NOT_FOUND");

    const mismatched = observeHistoricalPreemptionCount({
        cost_bps: 10,
        observed_count: 123,
        source_path: observationPath,
        source_sha256: "0".repeat(64),
        provenance: { manifest_path: manifestPath, manifest_sha256: manifestSha },
    });
    assert.equal(mismatched.status, "UNSUPPORTED");
    assert.equal(mismatched.reason, "PROVENANCE_MISMATCH");

    const invalidCost = observeHistoricalPreemptionCount({
        cost_bps: 20,
        observed_count: 123,
        source_path: observationPath,
        source_sha256: observationSha,
        provenance: { manifest_path: manifestPath, manifest_sha256: manifestSha },
    });
    assert.equal(invalidCost.status, "UNSUPPORTED");
    assert.equal(invalidCost.reason, "INVALID_COST_BPS");
});

test("same-timestamp ordering requires matching nonempty exit-before-entry evidence", () => {
    const { position } = openVictim();
    const base = {
        incoming_candidate: candidate({ decision_ts_ms: TS + 10 }),
        victim_position: position,
        mode: "WHOLE" as const,
        exit_ts_ms: TS + 10,
    };
    const cases = [
        [],
        [{ timestamp: TS + 10, kind: "OTHER", event_seq: 1, candidate_id: "incoming-1" }],
        [
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 1, candidate_id: "incoming-1" },
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 2, candidate_id: "victim-1" },
        ],
        [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 1, candidate_id: "incoming-1" },
        ],
        [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "wrong-victim" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    ] as const;
    for (const ordering_events of cases) {
        const result = eligiblePreemption({ ...base, ordering_events });
        assert.equal(result.eligible, false);
        assert.equal(result.reason, "NONCANONICAL_ORDERING");
    }
});

test("malformed victim, reservation, ownership, and execution gross fail closed without state changes", () => {
    const { state, position } = openVictim();
    for (const gross of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = releasePreemptionGross(state, { ...position, gross }, {
            exit_ts_ms: TS + 10,
            status: "FILLED",
            confirmed: true,
            filled_gross: 100,
        });
        assert.equal(result.applied, false);
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.state_hash_before, result.state_hash_after);
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        const malformedReservation = { ...state, reservations: state.reservations.map((reservation) => ({ ...reservation, filled_gross: value })) };
        const malformedReservationResult = releasePreemptionGross(malformedReservation, position, {
            exit_ts_ms: TS + 10,
            status: "FILLED",
            confirmed: true,
            filled_gross: 100,
        });
        assert.equal(malformedReservationResult.applied, false);
        assert.equal(malformedReservationResult.reason, "DATA_MISSING");
        assert.equal(malformedReservationResult.state_hash_before, malformedReservationResult.state_hash_after);

        const malformedOwnership = { ...state, ownership: state.ownership.map((ownership) => ({ ...ownership, gross: value })) };
        const malformedOwnershipResult = releasePreemptionGross(malformedOwnership, position, {
            exit_ts_ms: TS + 10,
            status: "FILLED",
            confirmed: true,
            filled_gross: 100,
        });
        assert.equal(malformedOwnershipResult.applied, false);
        assert.equal(malformedOwnershipResult.reason, "DATA_MISSING");
        assert.equal(malformedOwnershipResult.state_hash_before, malformedOwnershipResult.state_hash_after);
    }
    const malformedExecution = releasePreemptionGross(state, position, {
        exit_ts_ms: TS + 10,
        status: "FILLED",
        confirmed: true,
        filled_gross: Number.POSITIVE_INFINITY,
    });
    assert.equal(malformedExecution.applied, false);
    assert.equal(malformedExecution.reason, "DATA_MISSING");
    assert.equal(malformedExecution.state_hash_before, malformedExecution.state_hash_after);
});

test("rejects malformed allocator aggregate scalars before normalization or release", () => {
    const { state, position } = openVictim();
    const scalarFields = ["total_gross", "crypto_gross", "pending_gross", "reserved_gross", "available_margin"] as const;
    for (const field of scalarFields) {
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
            const malformedState = { ...state, [field]: value };
            const result = releasePreemptionGross(malformedState, position, {
                exit_ts_ms: TS + 10,
                status: "FILLED",
                confirmed: true,
                filled_gross: 100,
            });
            assert.equal(result.applied, false, `${field}=${String(value)}`);
            assert.equal(result.reason, "DATA_MISSING", `${field}=${String(value)}`);
            assert.equal(result.state_hash_before, result.state_hash_after, `${field}=${String(value)}`);
            assert.equal(result.released_gross, 0, `${field}=${String(value)}`);
        }
    }
});

test("rejects inconsistent gross maps and related pending/reserved maps before release", () => {
    const { state, position } = openVictim();
    const malformedStates = [
        { ...state, gross_by_strategy: { V12: Number.NaN } },
        { ...state, gross_by_strategy: { V12: Number.POSITIVE_INFINITY } },
        { ...state, gross_by_strategy: { V12: -1 } },
        { ...state, gross_by_symbol: { BTCUSDT: 99 } },
        { ...state, pending_gross_by_strategy: { V12: 1 } },
        { ...state, pending_gross_by_symbol: { BTCUSDT: 1 } },
        { ...state, reserved_gross_by_strategy: { V12: Number.NaN } },
        { ...state, reserved_gross_by_symbol: { BTCUSDT: Number.POSITIVE_INFINITY } },
        { ...state, ownership_by_symbol: { BTCUSDT: [] } },
        { ...state, reservation_ids: [] },
    ];
    for (const malformedState of malformedStates) {
        const result = releasePreemptionGross(malformedState, position, {
            exit_ts_ms: TS + 10,
            status: "FILLED",
            confirmed: true,
            filled_gross: 100,
        });
        assert.equal(result.applied, false);
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.state_hash_before, result.state_hash_after);
        assert.equal(result.released_gross, 0);
    }
});

test("accepts valid zero pending/reserved values in a normal filled victim release", () => {
    const { state, position } = openVictim();
    assert.equal(state.pending_gross, 0);
    assert.equal(state.reserved_gross, 0);
    assert.equal(state.pending_gross_by_strategy.V12, undefined);
    assert.equal(state.reserved_gross_by_symbol.BTCUSDT, undefined);
    const result = releasePreemptionGross(state, position, {
        exit_ts_ms: TS + 10,
        status: "FILLED",
        confirmed: true,
        filled_gross: 100,
    });
    assert.equal(result.applied, true);
    assert.equal(result.released_gross, 100);
});

test("applyPreemption rejects raw malformed allocator state before release or incoming re-admission", () => {
    const { state, position } = openVictim();
    const apply = (malformedState: typeof state) => applyPreemption({
        state: malformedState,
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 10 },
        policy: policy(),
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    });
    const malformedStates = [
        { ...state, wallet_jpy: Number.NaN },
        { ...state, equity_jpy: Number.POSITIVE_INFINITY },
        { ...state, available_margin: -1 },
        { ...state, pending_gross: Number.NaN },
        { ...state, reserved_gross: Number.POSITIVE_INFINITY },
        { ...state, gross_by_strategy: { V12: -1 } },
        { ...state, gross_by_symbol: { BTCUSDT: Number.NaN } },
        { ...state, reservations: state.reservations.map((reservation) => ({ ...reservation, filled_gross: Number.POSITIVE_INFINITY })) },
        { ...state, ownership: state.ownership.map((ownership) => ({ ...ownership, gross: -1 })) },
    ];
    for (const malformedState of malformedStates) {
        const result = apply(malformedState);
        assert.equal(result.applied, false);
        assert.equal(result.reason, "DATA_MISSING");
        assert.equal(result.victim_release_applied, false);
        assert.equal(result.gross_release, null);
        assert.equal(result.incoming_admission, null);
        assert.equal(result.state_hash_before, result.state_hash_after);
        assert.deepEqual(result.state_after, result.state_before);
    }
});

test("release and apply fail closed for structurally invalid allocator containers without throwing", () => {
    const { state, position } = openVictim();
    const malformedStates: unknown[] = [
        null,
        { ...state, reservations: {} },
        { ...state, ownership: {} },
        { ...state, reservation_ids: {} },
        { ...state, gross_by_strategy: [] },
        { ...state, gross_by_symbol: null },
        { ...state, ownership_by_symbol: [] },
    ];
    const apply = (malformedState: unknown) => applyPreemption({
        state: malformedState as never,
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 10 },
        policy: policy(),
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    });
    for (const malformedState of malformedStates) {
        assert.doesNotThrow(() => {
            const result = releasePreemptionGross(malformedState as never, position, {
                exit_ts_ms: TS + 10,
                status: "FILLED",
                confirmed: true,
                filled_gross: 100,
            });
            assert.equal(result.applied, false);
            assert.equal(result.reason, "DATA_MISSING");
            assert.equal(result.released_gross, 0);
            assert.equal(result.state_hash_before, result.state_hash_after);
        });
        assert.doesNotThrow(() => {
            const result = apply(malformedState);
            assert.equal(result.applied, false);
            assert.equal(result.reason, "DATA_MISSING");
            assert.equal(result.victim_release_applied, false);
            assert.equal(result.gross_release, null);
            assert.equal(result.incoming_admission, null);
            assert.equal(result.state_hash_before, result.state_hash_after);
            assert.deepEqual(result.state_after, result.state_before);
        });
    }
});

test("release and apply fail closed for malformed cooldown containers and records without throwing", () => {
    const { state, position } = openVictim();
    const validRecord = {
        until_ts_ms: TS + 60_000,
        source_event_ts_ms: TS + 10,
        reason: "STOP",
    };
    const malformedCooldowns: unknown[] = [
        null,
        [],
        42,
        { "BTCUSDT|LONG|Q102": null },
        { "BTCUSDT|LONG|Q102": [] },
        { "BTCUSDT|LONG|Q102": { ...validRecord, until_ts_ms: Number.NaN } },
        { "BTCUSDT|LONG|Q102": { ...validRecord, source_event_ts_ms: Number.POSITIVE_INFINITY } },
        { "BTCUSDT|LONG|Q102": { ...validRecord, until_ts_ms: -1 } },
        { "BTCUSDT|LONG|Q102": { ...validRecord, source_event_ts_ms: -1 } },
        { "BTCUSDT|LONG|Q102": { ...validRecord, source_event_ts_ms: TS + 70_000 } },
        { "BTCUSDT|LONG|Q102": { ...validRecord, reason: " " } },
        { "BTCUSDT|BAD|Q102": validRecord },
        { "BTCUSDT|LONG|UNKNOWN": validRecord },
        { "BTCUSDT|LONG": validRecord },
        { "BTCUSDT|LONG|Q102|EXTRA": validRecord },
        { "BTC|USDT|LONG|Q102": validRecord },
    ];
    const apply = (cooldownState: unknown) => applyPreemption({
        state: { ...state, cooldown_by_symbol_side_strategy: cooldownState as never },
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit: { status: "FILLED", confirmed: true, filled_gross: 100, exit_ts_ms: TS + 10 },
        policy: policy(),
        ordering_events: [
            { timestamp: TS + 10, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "victim-1" },
            { timestamp: TS + 10, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-1" },
        ],
    });
    for (const cooldownState of malformedCooldowns) {
        const malformedState = { ...state, cooldown_by_symbol_side_strategy: cooldownState as never };
        assert.doesNotThrow(() => {
            const result = releasePreemptionGross(malformedState, position, {
                exit_ts_ms: TS + 10,
                status: "FILLED",
                confirmed: true,
                filled_gross: 100,
            });
            assert.equal(result.applied, false);
            assert.equal(result.reason, "DATA_MISSING");
            assert.equal(result.released_gross, 0);
            assert.equal(result.state_hash_before, result.state_hash_after);
        });
        assert.doesNotThrow(() => {
            const result = apply(cooldownState);
            assert.equal(result.applied, false);
            assert.equal(result.reason, "DATA_MISSING");
            assert.equal(result.victim_release_applied, false);
            assert.equal(result.gross_release, null);
            assert.equal(result.incoming_admission, null);
            assert.equal(result.state_hash_before, result.state_hash_after);
            assert.deepEqual(result.state_after, result.state_before);
        });
    }
});
