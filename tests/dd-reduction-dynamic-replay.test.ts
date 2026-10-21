import assert from "node:assert/strict";
import test from "node:test";
import { replayDynamicPortfolio, type DynamicReplayPolicy, type ReplayEvent } from "../lib/backtest/dd-reduction/dynamic-replay";
import { assertFixtureIdentity, FIXTURE_HASH, FIXTURE_SCHEMAS } from "../lib/backtest/dd-reduction/fixture-identity";

assertFixtureIdentity({ sourceHash: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH, reservation: null, fill: null, exit: null }, FIXTURE_SCHEMAS.event, "task5-replay-fixture");

const policy: DynamicReplayPolicy = {
    initial_wallet_jpy: 10_000,
    settlement_currency: "USDT",
    h1_interval_ms: 1_000,
    allocator: {
        total_gross_cap: 2_000,
        crypto_gross_cap: 2_000,
        reservation_ttl_ms: 60_000,
        require_protection: false,
    },
};

const candidate = {
    candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG",
    decision_ts_ms: 1_000, entry_valid_until_ms: 50_000, requested_gross: 1_000,
    quantity: 10, entry_price: 100, priority: 1, validity: "VALID", asset_class: "CRYPTO",
    evidence_level: "ORIGINAL_EVIDENCE", source_sha: "a".repeat(64),
    evidence: { level: "ORIGINAL_EVIDENCE", sourceKind: "RAW_CANDIDATE_DECISIONS", sourcePath: "fixture.jsonl", sourceSha256: "a".repeat(64), rowNumber: 1, sourceBytes: 1 },
} as const;

function event(eventId: string, kind: ReplayEvent["kind"], timestamp: number, extra: Partial<ReplayEvent> = {}): ReplayEvent {
    return { event_id: eventId, event_seq: Number(extra.event_seq ?? 0), timestamp_ms: timestamp, timestamp, kind, ...extra } as ReplayEvent;
}

test("single reducer separates entry, protection, exit, realized pnl, and MTM", () => {
    const result = replayDynamicPortfolio([
        event("deposit", "DEPOSIT", 0, { amount_jpy: 1_000 }),
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-1", observed_ts_ms: 1_001 } }),
        event("protect", "PROTECTION_REGISTRATION", 1_002, { reservation_id: "reservation:c1:1000", protection_id: "stop:c1" }),
        event("mark", "MARK", 2_000),
        event("exit", "NORMAL_EXIT", 3_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 100, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 2, funding_settlement: 3, exit_price: 110, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "exit-1", observed_ts_ms: 3_000 }, exit_reason: "TAKE_PROFIT", cooldown_until_ts_ms: 4_000, cooldown_source_event_ts_ms: 3_000 }),
    ], policy, [{ timestamp_ms: 2_000, symbol: "BTCUSDT", price: 110, fx_rate: 1, timeframe: "H1" }]);
    assert.equal(result.status, "PASS");
    assert.equal(result.accounting.accounting_reconciliation, "PASS");
    assert.equal(result.accounting.realized_pnl_jpy, 100);
    assert.equal(result.accounting.fees_jpy, 2);
    assert.equal(result.accounting.funding_jpy, 3);
    assert.equal(result.allocator_state.total_gross, 0);
    assert.equal(result.mtm_timeline.find((point) => point.timestamp_ms === 2_000)?.unrealized_pnl_jpy, 100);
    assert.equal(result.accounting.wallet_jpy, 11_101);
});

test("settlement pnl and JPY pnl use an explicit FX rate", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-2", observed_ts_ms: 1_001 } }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 10, settlement_currency: "USDT", fx_rate: 150, fee_settlement: 0, funding_settlement: 0, exit_price: 110, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "exit-2", observed_ts_ms: 2_000 }, exit_reason: "TIME_STOP" }),
    ], policy);
    assert.equal(result.status, "PASS");
    assert.equal(result.accounting.realized_pnl_jpy, 1_500);
    assert.equal(result.accounting.wallet_jpy, 11_500);
});

test("partial and unknown execution are fail-closed", () => {
    const partial = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("partial", "PARTIAL_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 500 }),
    ], policy);
    assert.equal(partial.status, "FAIL");
    assert.equal(partial.rejection, "PARTIAL_EXECUTION_UNSUPPORTED");
    const unknown = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("unknown", "EXECUTION_RECONCILIATION", 1_001, { reservation_id: "reservation:c1:1000" }),
    ], policy);
    assert.equal(unknown.status, "FAIL");
    assert.equal(unknown.rejection, "UNKNOWN_EXECUTION");
});

test("same-bar STOP/ENTRY without authoritative sequence fails closed", () => {
    const result = replayDynamicPortfolio([
        { ...event("stop", "STOP", 1_000), event_seq: null },
        { ...event("entry", "ENTRY", 1_000, { candidate }), event_seq: null },
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "SAME_BAR_ORDER_UNVERIFIABLE");
});

test("future exit cannot release an unfilled or future position", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 2_000, { candidate: { ...candidate, decision_ts_ms: 2_000, entry_valid_until_ms: 50_000 } }),
        event("exit", "NORMAL_EXIT", 1_000, { reservation_id: "reservation:c1:2000", settlement_pnl: 0, exit_reason: "TIME_STOP" }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.accounting.accounting_reconciliation, "PASS");
});

test("duplicate event ids fail before a second charge", () => {
    const deposit = event("deposit", "DEPOSIT", 0, { amount_jpy: 100, event_seq: 0 });
    const duplicate = event("deposit", "DEPOSIT", 1, { amount_jpy: 100, event_seq: 1, event_id: "deposit" });
    const result = replayDynamicPortfolio([deposit, duplicate], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DUPLICATE_EVENT");
    assert.equal(result.accounting.wallet_jpy, 10_100);
});

test("exit settlement fields are required and are never zero-filled", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-3", observed_ts_ms: 1_001 } }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", exit_price: 110, exit_reason: "TIME_STOP" }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.accounting.wallet_jpy, 10_000);
});

test("an exit cannot release a pending reservation", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("exit", "NORMAL_EXIT", 1_001, {
            reservation_id: "reservation:c1:1000", settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1,
            fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, exit_reason: "TIME_STOP",
        }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.accounting.wallet_jpy, 10_000);
});

test("a protection stop requires active protection and execution evidence", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-4", observed_ts_ms: 1_001 } }),
        event("stop", "PROTECTION_STOP", 2_000, {
            reservation_id: "reservation:c1:1000", protection_id: "stop:c1", settlement_pnl: -10,
            settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, exit_reason: "STOP",
        }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("future entry and exit references fail closed before any wallet charge", () => {
    const result = replayDynamicPortfolio([
        event("exit", "NORMAL_EXIT", 1_000, {
            reservation_id: "reservation:c1:2000", settlement_pnl: 10, settlement_currency: "USDT", fx_rate: 1,
            fee_settlement: 0, funding_settlement: 0, exit_price: 110, slippage_bps: 0, gap_bps: 0, exit_reason: "TIME_STOP",
        }),
        event("entry", "ENTRY", 2_000, { candidate: { ...candidate, decision_ts_ms: 2_000 } }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "FUTURE_EVENT_REFERENCE");
    assert.equal(result.accounting.wallet_jpy, 10_000);
});

test("non-finite mark price or FX fails closed", () => {
    const result = replayDynamicPortfolio([
        event("mark", "MARK", 2_000),
    ], policy, [{ timestamp_ms: 2_000, symbol: "BTCUSDT", price: Number.NaN, fx_rate: 1 }]);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("preemption reuses the Task 4 lifecycle and admits only after confirmed whole release", () => {
    const incoming = { ...candidate, candidate_id: "incoming", symbol: "ETHUSDT", decision_ts_ms: 2_000, priority: 0 };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-preempt", observed_ts_ms: 1_001 } }),
        event("preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming,
            victim_position: { position_id: "victim-1", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: { source: "fixture", evidence_id: "exit-preempt", observed_ts_ms: 2_000 }, filled_gross: 1_000,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            cooldown_until_ts_ms: 3_000, cooldown_source_event_ts_ms: 2_000,
            ordering_events: [
                { timestamp: 2_000, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "c1" },
                { timestamp: 2_000, kind: "ENTRY", event_seq: 2, candidate_id: "incoming" },
            ],
        }),
    ], policy);
    assert.equal(result.status, "PASS");
    assert.equal(result.preemption_ledger.length, 1);
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "c1")?.status, "RELEASED");
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "incoming")?.status, "PENDING");
});

test("preemption admission preserves incoming candidate expiry for later fill validation", () => {
    const incoming = { ...candidate, candidate_id: "incoming-expiring", symbol: "ETHUSDT", decision_ts_ms: 2_000, entry_valid_until_ms: 2_500, priority: 0 };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-preempt-admission", observed_ts_ms: 1_001 } }),
        event("preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming,
            victim_position: { position_id: "victim-admission", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: { source: "fixture", evidence_id: "exit-preempt-admission", observed_ts_ms: 2_000 }, filled_gross: 1_000,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            ordering_events: [
                { timestamp: 2_000, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "c1" },
                { timestamp: 2_000, kind: "ENTRY", event_seq: 2, candidate_id: "incoming-expiring" },
            ],
        }),
        event("incoming-fill", "ENTRY_FILL", 3_000, { reservation_id: "reservation:incoming-expiring:2000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-incoming-expired", observed_ts_ms: 3_000 } }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "incoming-expiring")?.status, "PENDING");
});

test("preemption rejects an expired incoming candidate before releasing the victim", () => {
    const incoming = { ...candidate, candidate_id: "expired-incoming", symbol: "ETHUSDT", decision_ts_ms: 2_000, entry_valid_until_ms: 1_500, priority: 0 };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-preempt-expired", observed_ts_ms: 1_001 } }),
        event("preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming,
            victim_position: { position_id: "victim-expired", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: { source: "fixture", evidence_id: "exit-preempt-expired", observed_ts_ms: 2_000 }, filled_gross: 1_000,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            ordering_events: [
                { timestamp: 2_000, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "c1" },
                { timestamp: 2_000, kind: "ENTRY", event_seq: 2, candidate_id: "expired-incoming" },
            ],
        }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "ALLOCATOR_REJECTED");
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "c1")?.status, "FILLED");
    assert.equal(result.charge_ledger.length, 0);
});

test("duplicate execution evidence across event IDs fails closed", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "reused-evidence", observed_ts_ms: 1_001 } }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "reused-evidence", observed_ts_ms: 2_000 }, exit_reason: "TIME_STOP" }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.charge_ledger.length, 0);
});

test("victim release with rejected incoming is an explicit completed preemption outcome", () => {
    const incoming = { ...candidate, candidate_id: "invalid-incoming", symbol: "ETHUSDT", decision_ts_ms: 2_000, priority: 0, validity: "INVALID" };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-preempt-rejected", observed_ts_ms: 1_001 } }),
        event("preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming,
            victim_position: { position_id: "victim-rejected", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: { source: "fixture", evidence_id: "exit-preempt-rejected", observed_ts_ms: 2_000 }, filled_gross: 1_000,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            ordering_events: [
                { timestamp: 2_000, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "c1" },
                { timestamp: 2_000, kind: "ENTRY", event_seq: 2, candidate_id: "invalid-incoming" },
            ],
        }),
    ], policy);
    assert.equal(result.status, "PASS");
    assert.equal(result.rejection, null);
    assert.equal(result.preemption_ledger[0]?.lifecycle, "VICTIM_RELEASED_INCOMING_REJECTED");
    assert.equal(result.preemption_ledger[0]?.accepted, true);
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "c1")?.status, "RELEASED");
    assert.equal(result.allocator_state.reservations.some((item) => item.candidate_id === "invalid-incoming"), false);
    assert.equal(result.charge_ledger.length, 1);
    assert.equal(result.accounting.wallet_jpy, 9_990);
});

test("an explicitly mislabeled OOS event fails closed at the boundary", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate, data_split: "OOS" }),
    ], { ...policy, oos_start_ts_ms: 2_000 });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.oos_boundary.classification, "EXPLICIT");
});

test("OOS interval is inclusive at both boundaries and rejects post-OOS events", () => {
    const bounded = { ...policy, oos_start_ts_ms: 2_000, oos_end_ts_ms: 3_000 };
    const result = replayDynamicPortfolio([
        event("is", "DEPOSIT", 1_999, { amount_jpy: 1, data_split: "IS" }),
        event("oos-start", "DEPOSIT", 2_000, { amount_jpy: 1, data_split: "OOS" }),
        event("oos-end", "DEPOSIT", 3_000, { amount_jpy: 1, data_split: "OOS" }),
        event("after-oos", "DEPOSIT", 3_001, { amount_jpy: 1, data_split: "OOS" }),
    ], bounded);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.deepEqual(result.processed_event_ids, []);
    assert.equal(result.accounting.wallet_jpy, 10_000);
});

test("one-sided or contradictory OOS boundaries fail closed before reduction", () => {
    const unboundedOos = replayDynamicPortfolio([event("oos", "DEPOSIT", 1_000, { amount_jpy: 1, data_split: "OOS" })], policy);
    assert.equal(unboundedOos.status, "FAIL");
    assert.equal(unboundedOos.rejection, "DATA_MISSING");
    assert.deepEqual(unboundedOos.processed_event_ids, []);

    const oneSided = replayDynamicPortfolio([event("d", "DEPOSIT", 1_000, { amount_jpy: 1 })], { ...policy, oos_start_ts_ms: 2_000 });
    assert.equal(oneSided.status, "FAIL");
    assert.equal(oneSided.rejection, "DATA_MISSING");
    assert.deepEqual(oneSided.processed_event_ids, []);

    const endOnly = replayDynamicPortfolio([event("d", "DEPOSIT", 1_000, { amount_jpy: 1 })], { ...policy, oos_end_ts_ms: 3_000 });
    assert.equal(endOnly.status, "FAIL");
    assert.equal(endOnly.rejection, "DATA_MISSING");
    assert.deepEqual(endOnly.processed_event_ids, []);

    const contradictory = replayDynamicPortfolio([event("d", "DEPOSIT", 1_000, { amount_jpy: 1 })], { ...policy, oos_start_ts_ms: 3_000, oos_end_ts_ms: 2_000 });
    assert.equal(contradictory.status, "FAIL");
    assert.equal(contradictory.rejection, "DATA_MISSING");
    assert.deepEqual(contradictory.processed_event_ids, []);
});

test("IS-open lifecycle may carry into OOS without carrying candidate selection state", () => {
    const bounded = { ...policy, oos_start_ts_ms: 2_000, oos_end_ts_ms: 5_000 };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate, data_split: "IS" }),
        event("fill", "ENTRY_FILL", 2_000, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "oos-fill", observed_ts_ms: 2_000 }, data_split: "OOS" }),
        event("ownership", "OWNERSHIP_UPDATE", 2_001, { reservation_id: "reservation:c1:1000", data_split: "OOS" }),
        event("mark", "MARK", 3_000, { data_split: "OOS" }),
        event("exit", "NORMAL_EXIT", 4_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "oos-exit", observed_ts_ms: 4_000 }, exit_reason: "TIME_STOP", cooldown_until_ts_ms: 5_000, cooldown_source_event_ts_ms: 4_000, data_split: "OOS" }),
        event("cooldown", "COOLDOWN_UPDATE", 5_000, { reservation_id: "reservation:c1:1000", cooldown_until_ts_ms: 5_000, cooldown_source_event_ts_ms: 4_000, data_split: "OOS" }),
    ], bounded, [{ timestamp_ms: 3_000, symbol: "BTCUSDT", price: 100, fx_rate: 1, timeframe: "H1" }]);
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.processed_event_ids, ["entry", "fill", "ownership", "mark", "exit", "cooldown"]);
    assert.equal(result.allocator_state.reservations.find((item) => item.reservation_id === "reservation:c1:1000")?.status, "RELEASED");
    assert.equal(result.charge_ledger.length, 1);

    for (const kind of ["CANDIDATE_VALIDATION", "RESERVATION"] as const) {
        const leakage = replayDynamicPortfolio([
            event("is-entry", "ENTRY", 1_000, { candidate, data_split: "IS" }),
            event("oos-selection", kind, 2_000, { candidate: { ...candidate, candidate_id: `oos-${kind}` }, data_split: "OOS" }),
        ], bounded);
        assert.equal(leakage.status, "FAIL");
        assert.equal(leakage.rejection, "DATA_MISSING");
    }
});

test("OOS preemption with an incoming candidate is rejected without victim release or admission", () => {
    const incoming = { ...candidate, candidate_id: "oos-incoming", symbol: "ETHUSDT", decision_ts_ms: 2_000, priority: 0 };
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate, data_split: "IS" }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-oos-preempt", observed_ts_ms: 1_001 }, data_split: "IS" }),
        event("oos-preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming, data_split: "OOS",
            victim_position: { position_id: "victim-oos", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: { source: "fixture", evidence_id: "exit-oos-preempt", observed_ts_ms: 2_000 }, filled_gross: 1_000,
            exit_price: 90, slippage_bps: 0, gap_bps: 0, settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0,
            ordering_events: [
                { timestamp: 2_000, kind: "PREEMPTION_EXIT", event_seq: 1, candidate_id: "c1" },
                { timestamp: 2_000, kind: "ENTRY", event_seq: 2, candidate_id: "oos-incoming" },
            ],
        }),
    ], { ...policy, oos_start_ts_ms: 2_000, oos_end_ts_ms: 3_000 });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.allocator_state.reservations.find((item) => item.candidate_id === "c1")?.status, "FILLED");
    assert.equal(result.allocator_state.reservations.some((item) => item.candidate_id === "oos-incoming"), false);
    assert.equal(result.charge_ledger.length, 0);
});

test("candidate validation and priority are validation-only before a single ENTRY reservation", () => {
    const result = replayDynamicPortfolio([
        event("validation", "CANDIDATE_VALIDATION", 1_000, { candidate }),
        event("priority", "CANDIDATE_PRIORITY", 1_001, { candidate }),
        event("entry", "ENTRY", 1_002, { candidate }),
    ], policy);
    assert.equal(result.status, "PASS");
    assert.equal(result.execution_ledger[0]?.allocator_after.reservations.length, 0);
    assert.equal(result.execution_ledger[1]?.allocator_after.reservations.length, 0);
    assert.equal(result.reservation_ledger.length, 1);
    assert.equal(result.allocator_state.reservations.length, 1);
});

test("unsupported fixed phases fail closed instead of becoming silent no-ops", () => {
    const result = replayDynamicPortfolio([
        event("sizing", "SIZING", 1_000, { candidate }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "UNSUPPORTED_PHASE");
});

test("ENTRY and ENTRY_FILL both enforce entry_valid_until_ms", () => {
    const expiredEntry = replayDynamicPortfolio([
        event("entry", "ENTRY", 2_000, { candidate: { ...candidate, entry_valid_until_ms: 1_500 } }),
    ], policy);
    assert.equal(expiredEntry.status, "FAIL");
    assert.equal(expiredEntry.rejection, "ALLOCATOR_REJECTED");

    const expiredFill = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate: { ...candidate, entry_valid_until_ms: 1_500 } }),
        Object.assign(event("fill", "ENTRY_FILL", 2_000, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }), { execution_evidence: { source: "fixture", evidence_id: "fill-expired", observed_ts_ms: 2_000 } }),
    ], policy);
    assert.equal(expiredFill.status, "FAIL");
    assert.equal(expiredFill.rejection, "DATA_MISSING");
});

test("non-zero slippage or gap is not silently ignored", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        Object.assign(event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 101, slippage_bps: 10, gap_bps: 0 }), { execution_evidence: { source: "fixture", evidence_id: "fill-slippage", observed_ts_ms: 1_001 } }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("ENTRY_FILL requires typed execution evidence", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("normal exits require typed execution evidence", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate }),
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-exit-evidence", observed_ts_ms: 1_001 } }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, exit_reason: "TIME_STOP" }),
    ], policy);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("OOS candidate selection is rejected rather than inheriting IS allocator state", () => {
    const result = replayDynamicPortfolio([
        event("is-entry", "ENTRY", 1_000, { candidate, data_split: "IS" }),
        event("oos-entry", "ENTRY", 2_000, { candidate: { ...candidate, candidate_id: "oos", decision_ts_ms: 2_000 }, data_split: "OOS" }),
    ], { ...policy, oos_start_ts_ms: 2_000 });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("prevalidation rejection does not report unreduced events as processed", () => {
    const result = replayDynamicPortfolio([
        event("unreduced", "DEPOSIT", 1_000, { amount_jpy: 1 }),
    ], { ...policy, settlement_currency: undefined });
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.processed_event_ids, []);
});
