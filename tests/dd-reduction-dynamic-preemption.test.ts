import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyPreemption,
    eligiblePreemption,
    releasePreemptionGross,
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
        exit_ts_ms: TS + 10,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.mode, "WHOLE");
    assert.equal(result.requested_gross, 100);
    assert.equal(result.released_gross, 100);
    assert.equal(result.reason, null);
});

test("rejects protected victims and priority losers without changing allocator state", () => {
    const { position } = openVictim();
    const protectedResult = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: { ...position, protected: true },
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
    });
    assert.equal(protectedResult.eligible, false);
    assert.equal(protectedResult.reason, "VICTIM_PROTECTED");

    const loser = eligiblePreemption({
        incoming_candidate: candidate({ priority: 20 }),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
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
        exit_ts_ms: TS + 10,
    });
    assert.equal(winner.eligible, true);

    const loser = eligiblePreemption({
        incoming_candidate: candidate({ candidate_id: "zzz", priority: 10 }),
        victim_position: { ...position, candidate_id: "aaa", priority: 10 },
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
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
        exit_ts_ms: TS + 10,
    });
    assert.equal(partial.eligible, true);
    assert.equal(partial.mode, "PARTIAL");

    const unknown = eligiblePreemption({
        incoming_candidate: candidate(),
        victim_position: position,
        mode: "WHOLE",
        exit_ts_ms: TS + 10,
        exit_status: "UNKNOWN",
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
        exit_ts_ms: TS + 10,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "VICTIM_PROTECTED");
});
