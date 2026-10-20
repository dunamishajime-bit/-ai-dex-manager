import assert from "node:assert/strict";
import { test } from "node:test";

import {
    classifyOrderingEvidence,
    orderDynamicEvents,
    type DynamicOrderingEvent,
} from "../lib/backtest/dd-reduction/dynamic-ordering";
import {
    hashAllocatorState,
    isCooldownActiveAt,
} from "../lib/backtest/dd-reduction/dynamic-state";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const TS = 1_700_000_000_000;

function assertDynamicOrderingFixtureIdentity(): void {
    assertFixtureIdentity(
        { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
        ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
        "dynamic-ordering.fixture",
    );
}

function event(overrides: Partial<DynamicOrderingEvent> = {}): DynamicOrderingEvent {
    return {
        candidate_id: "candidate-1",
        event_id: "event-1",
        timestamp_ms: TS,
        kind: "ENTRY",
        event_seq: 1,
        priority: 1,
        rank: 1,
        ...overrides,
    };
}

test("orders same-timestamp events by authoritative event_seq before input order", () => {
    assertDynamicOrderingFixtureIdentity();
    const events = [
        event({ candidate_id: "entry", event_id: "entry-event", kind: "ENTRY", event_seq: 20 }),
        event({ candidate_id: "stop", event_id: "stop-event", kind: "PROTECTION_STOP", event_seq: 10 }),
    ];

    const ordered = orderDynamicEvents(events);

    assert.deepEqual(ordered.map((item) => item.candidate_id), ["stop", "entry"]);
    assert.equal(classifyOrderingEvidence(events).formalParityEligible, true);
});

test("uses priority, rank, and candidate ID as a deterministic noncanonical fallback", () => {
    const events = [
        event({ candidate_id: "zeta", event_id: null, event_seq: null, priority: 2, rank: 4 }),
        event({ candidate_id: "alpha", event_id: null, event_seq: null, priority: 1, rank: 9 }),
        event({ candidate_id: "beta", event_id: null, event_seq: null, priority: 1, rank: 2 }),
    ];

    const ordered = orderDynamicEvents(events);
    const evidence = classifyOrderingEvidence(events);

    assert.deepEqual(ordered.map((item) => item.candidate_id), ["beta", "alpha", "zeta"]);
    assert.equal(evidence.ordering, "NONCANONICAL_ORDERING");
    assert.equal(evidence.formalParityEligible, false);
});

test("keeps unresolved same-timestamp STOP and ENTRY precedence fail-closed", () => {
    const events = [
        event({ candidate_id: "entry", event_id: "entry-event", kind: "ENTRY", event_seq: null, priority: null, rank: null }),
        event({ candidate_id: "stop", event_id: "stop-event", kind: "PROTECTION_STOP", event_seq: null, priority: null, rank: null }),
    ];

    const evidence = classifyOrderingEvidence(events);
    const ordered = orderDynamicEvents(events);

    assert.deepEqual(ordered.map((item) => item.candidate_id), ["stop", "entry"]);
    assert.equal(evidence.ordering, "NONCANONICAL_ORDERING");
    assert.ok(evidence.reasons.includes("SAME_TIMESTAMP_ORDER_UNVERIFIABLE"));
    assert.equal(evidence.formalParityEligible, false);
});

test("hashes equivalent allocator state objects canonically while preserving array order", () => {
    const first = {
        equity_jpy: -0,
        gross_by_symbol: { ETHUSDT: 2, BTCUSDT: 1 },
        open_position_ids: ["position-a", "position-b"],
        unavailable: Number.POSITIVE_INFINITY,
    };
    const equivalent = {
        unavailable: Number.NaN,
        open_position_ids: ["position-a", "position-b"],
        gross_by_symbol: { BTCUSDT: 1, ETHUSDT: 2 },
        equity_jpy: 0,
    };
    const reordered = { ...equivalent, open_position_ids: ["position-b", "position-a"] };

    assert.equal(hashAllocatorState(first), hashAllocatorState(equivalent));
    assert.notEqual(hashAllocatorState(first), hashAllocatorState(reordered));
    assert.match(hashAllocatorState(first), /^[a-f0-9]{64}$/);
});

test("does not let a future STOP create cooldown for an earlier candidate decision", () => {
    assert.equal(isCooldownActiveAt({ candidateDecisionTsMs: TS, cooldownUntilTsMs: TS + 60_000, sourceEventTsMs: TS - 1 }), true);
    assert.equal(isCooldownActiveAt({ candidateDecisionTsMs: TS, cooldownUntilTsMs: TS + 60_000, sourceEventTsMs: TS + 1 }), false);
});
