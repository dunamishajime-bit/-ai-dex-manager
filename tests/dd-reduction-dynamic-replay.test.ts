import assert from "node:assert/strict";
import test from "node:test";
import { replayDynamicPortfolio, type DynamicReplayPolicy, type ReplayEvent } from "../lib/backtest/dd-reduction/dynamic-replay";
import { assertFixtureIdentity, FIXTURE_HASH, FIXTURE_SCHEMAS } from "../lib/backtest/dd-reduction/fixture-identity";

assertFixtureIdentity({ sourceHash: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH, reservation: null, fill: null, exit: null }, FIXTURE_SCHEMAS.event, "task5-replay-fixture");

const policy: DynamicReplayPolicy = {
    initial_wallet_jpy: 10_000,
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
        event("protect", "PROTECTION_REGISTRATION", 1_002, { reservation_id: "reservation:c1:1000", protection_id: "stop:c1" }),
        event("mark", "MARK", 2_000),
        event("exit", "NORMAL_EXIT", 3_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 100, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 2, funding_settlement: 3, exit_price: 110, slippage_bps: 0, gap_bps: 0, exit_reason: "TAKE_PROFIT", cooldown_until_ts_ms: 4_000, cooldown_source_event_ts_ms: 3_000 }),
    ], policy, [{ timestamp_ms: 2_000, symbol: "BTCUSDT", price: 110, fx_rate: 1 }]);
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 10, settlement_currency: "USDT", fx_rate: 150, fee_settlement: 0, funding_settlement: 0, exit_price: 110, slippage_bps: 0, gap_bps: 0, exit_reason: "TIME_STOP" }),
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000, fill_price: 100, slippage_bps: 0, gap_bps: 0 }),
        event("preempt", "PREEMPTION_EXIT", 2_000, {
            reservation_id: "reservation:c1:1000", incoming_candidate: incoming,
            victim_position: { position_id: "victim-1", reservation_id: "reservation:c1:1000", candidate_id: "c1", strategy_id: "V12", symbol: "BTCUSDT", side: "LONG", gross: 1_000, quantity: 10, entry_price: 100, priority: 1, status: "OPEN" },
            mode: "WHOLE", exit_status: "FILLED", confirmed: true, execution_evidence: true, filled_gross: 1_000,
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

test("an explicitly mislabeled OOS event fails closed at the boundary", () => {
    const result = replayDynamicPortfolio([
        event("entry", "ENTRY", 1_000, { candidate, data_split: "OOS" }),
    ], { ...policy, oos_start_ts_ms: 2_000 });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
    assert.equal(result.oos_boundary.classification, "EXPLICIT");
});
