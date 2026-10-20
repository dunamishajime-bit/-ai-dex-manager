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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000 }),
        event("protect", "PROTECTION_REGISTRATION", 1_002, { reservation_id: "reservation:c1:1000", protection_id: "stop:c1" }),
        event("mark", "MARK", 2_000),
        event("exit", "NORMAL_EXIT", 3_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 100, fx_rate: 1, fee_settlement: 2, funding_settlement: 3, exit_reason: "TAKE_PROFIT", cooldown_until_ts_ms: 4_000, cooldown_source_event_ts_ms: 3_000 }),
    ], policy, [{ timestamp_ms: 2_000, symbol: "BTCUSDT", price: 110 }]);
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
        event("fill", "ENTRY_FILL", 1_001, { reservation_id: "reservation:c1:1000", filled_gross: 1_000 }),
        event("exit", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:c1:1000", settlement_pnl: 10, fx_rate: 150, exit_reason: "TIME_STOP" }),
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
