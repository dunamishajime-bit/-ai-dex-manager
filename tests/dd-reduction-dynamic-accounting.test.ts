import assert from "node:assert/strict";
import test from "node:test";
import { replayDynamicPortfolio, type DynamicReplayPolicy, type ReplayEvent } from "../lib/backtest/dd-reduction/dynamic-replay";
import { assertFixtureIdentity, FIXTURE_HASH, FIXTURE_SCHEMAS } from "../lib/backtest/dd-reduction/fixture-identity";

assertFixtureIdentity({ sourceHash: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH, reservation: null, fill: null, exit: null }, FIXTURE_SCHEMAS.event, "task5-accounting-fixture");

const policy: DynamicReplayPolicy = {
    initial_wallet_jpy: 10_000,
    settlement_currency: "USDT",
    h1_interval_ms: 1_000,
    allocator: { total_gross_cap: 2_000, crypto_gross_cap: 2_000, reservation_ttl_ms: 60_000 },
};
const source = "b".repeat(64);
const candidate = {
    candidate_id: "a1", strategy_id: "Q102", symbol: "ETHUSDT", side: "SHORT",
    decision_ts_ms: 1_000, entry_valid_until_ms: 50_000, requested_gross: 500,
    quantity: 5, entry_price: 100, priority: 1, validity: "VALID", asset_class: "CRYPTO",
    evidence_level: "CAUSALLY_REGENERATED", source_sha: source,
    evidence: { level: "CAUSALLY_REGENERATED", sourceKind: "STRATEGY_ADAPTER", sourcePath: "adapter.json", sourceSha256: source, rowNumber: 1, sourceBytes: 12 },
} as const;
function ev(id: string, kind: ReplayEvent["kind"], ts: number, extra: Partial<ReplayEvent> = {}): ReplayEvent {
    return { event_id: id, event_seq: Number(extra.event_seq ?? 0), timestamp_ms: ts, timestamp: ts, kind, ...extra } as ReplayEvent;
}

test("accounting reconciliation is independent of the allocator state", () => {
    const result = replayDynamicPortfolio([
        ev("d", "DEPOSIT", 0, { amount_jpy: 1_000 }),
        ev("e", "ENTRY", 1_000, { candidate }),
        ev("f", "ENTRY_FILL", 1_001, { reservation_id: "reservation:a1:1000", filled_gross: 500, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-a1", observed_ts_ms: 1_001 } }),
        ev("x", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:a1:1000", settlement_pnl: -10, settlement_currency: "USDT", fx_rate: 2, fee_settlement: 1, funding_settlement: -2, exit_price: 102, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "exit-a1", observed_ts_ms: 2_000 }, exit_reason: "STOP" }),
    ], policy);
    assert.equal(result.accounting.expected_wallet_jpy, 10_974);
    assert.equal(result.accounting.wallet_jpy, 10_974);
    assert.equal(result.accounting.reconciliation_delta_jpy, 0);
    assert.equal(result.accounting.accounting_reconciliation, "PASS");
    assert.equal(result.allocator_state.wallet_jpy, result.accounting.wallet_jpy);
    assert.equal(result.allocator_state.equity_jpy, result.accounting.wallet_jpy);
    assert.equal(result.accounting.charge_reconciliation, "PASS");
});
test("MTM drawdown is separate from realized PnL and records peak/trough/recovery", () => {
    const result = replayDynamicPortfolio([
        ev("e", "ENTRY", 1_000, { candidate }),
        ev("f", "ENTRY_FILL", 1_001, { reservation_id: "reservation:a1:1000", filled_gross: 500, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-a2", observed_ts_ms: 1_001 } }),
        ev("m1", "MARK", 2_000),
        ev("m2", "MARK", 3_000),
        ev("x", "NORMAL_EXIT", 4_000, { reservation_id: "reservation:a1:1000", settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "exit-a2", observed_ts_ms: 4_000 }, exit_reason: "TIME_STOP" }),
    ], policy, [
        { timestamp_ms: 2_000, symbol: "ETHUSDT", price: 120, fx_rate: 1, timeframe: "H1" },
        { timestamp_ms: 3_000, symbol: "ETHUSDT", price: 80, fx_rate: 1, timeframe: "H1" },
    ]);
    assert.equal(result.accounting.realized_pnl_jpy, 0);
    assert.equal(result.mtm_timeline.find((point) => point.timestamp_ms === 2_000)?.unrealized_pnl_jpy, -100);
    assert.ok((result.maximum_mtm_dd?.drawdown_pct ?? 0) < 0);
    assert.ok(result.top5_dd_windows.length > 0);
});

test("fee and funding are not charged twice", () => {
    const result = replayDynamicPortfolio([
        ev("e", "ENTRY", 1_000, { candidate }),
        ev("f", "ENTRY_FILL", 1_001, { reservation_id: "reservation:a1:1000", filled_gross: 500, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-a3", observed_ts_ms: 1_001 } }),
        ev("fund", "FUNDING", 1_500, { funding_settlement: 2, settlement_pnl: 0, settlement_currency: "USDT", fee_settlement: 0, fx_rate: 100, charge_id: "fund-a1" }),
        ev("x", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:a1:1000", settlement_pnl: 0, settlement_currency: "USDT", fee_settlement: 1, funding_settlement: 0, fx_rate: 100, exit_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "exit-a3", observed_ts_ms: 2_000 }, exit_reason: "TIME_STOP" }),
    ], policy, [{ timestamp_ms: 1_500, symbol: "ETHUSDT", price: 100, fx_rate: 1, timeframe: "H1" }]);
    assert.equal(result.accounting.funding_jpy, 200);
    assert.equal(result.accounting.fees_jpy, 100);
    assert.equal(result.accounting.wallet_jpy, 10_100);
});

test("canonical settlement currency is required and mixed currencies fail closed", () => {
    const missingPolicyCurrency = replayDynamicPortfolio([
        ev("d", "DEPOSIT", 0, { amount_jpy: 1 }),
    ], { ...policy, settlement_currency: undefined });
    assert.equal(missingPolicyCurrency.status, "FAIL");
    assert.equal(missingPolicyCurrency.rejection, "DATA_MISSING");

    const mixed = replayDynamicPortfolio([
        ev("fund", "FUNDING", 1_000, { funding_settlement: 1, settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, charge_id: "fund-1" }),
    ], { ...policy, settlement_currency: "USDT" });
    assert.equal(mixed.status, "PASS");
    const mixedExit = replayDynamicPortfolio([
        ev("e", "ENTRY", 1_000, { candidate }),
        ev("f", "ENTRY_FILL", 1_001, { reservation_id: "reservation:a1:1000", filled_gross: 500, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-a4", observed_ts_ms: 1_001 } }),
        ev("x", "NORMAL_EXIT", 2_000, { reservation_id: "reservation:a1:1000", settlement_pnl: 0, settlement_currency: "BTC", fx_rate: 1, fee_settlement: 0, funding_settlement: 0, exit_price: 100, slippage_bps: 0, gap_bps: 0, exit_reason: "TIME_STOP" }),
    ], { ...policy, settlement_currency: "USDT" });
    assert.equal(mixedExit.status, "FAIL");
    assert.equal(mixedExit.rejection, "DATA_MISSING");
});

test("funding requires a canonical charge identity", () => {
    const result = replayDynamicPortfolio([
        ev("fund", "FUNDING", 1_000, { funding_settlement: 1, settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0 }),
    ], { ...policy, settlement_currency: "USDT" });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

test("funding charge identities cannot be reused across events", () => {
    const result = replayDynamicPortfolio([
        ev("fund-1", "FUNDING", 1_000, { funding_settlement: 1, settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, charge_id: "fund-1" }),
        ev("fund-2", "FUNDING", 2_000, { funding_settlement: 1, settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, charge_id: "fund-1" }),
    ], { ...policy, settlement_currency: "USDT" });
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DUPLICATE_CHARGE");
});

test("funding refreshes unrealized MTM for an existing open position", () => {
    const result = replayDynamicPortfolio([
        ev("e", "ENTRY", 1_000, { candidate }),
        ev("f", "ENTRY_FILL", 1_001, { reservation_id: "reservation:a1:1000", filled_gross: 500, fill_price: 100, slippage_bps: 0, gap_bps: 0, execution_evidence: { source: "fixture", evidence_id: "fill-a5", observed_ts_ms: 1_001 } }),
        ev("fund", "FUNDING", 2_000, { funding_settlement: 1, settlement_pnl: 0, settlement_currency: "USDT", fx_rate: 1, fee_settlement: 0, charge_id: "fund-1" }),
    ], { ...policy, settlement_currency: "USDT" }, [{ timestamp_ms: 2_000, symbol: "ETHUSDT", price: 120, fx_rate: 1, timeframe: "H1" }]);
    assert.equal(result.status, "PASS");
    assert.equal(result.allocator_state.equity_jpy, 9_901);
    assert.equal(result.mtm_timeline.at(-1)?.unrealized_pnl_jpy, -100);
});

test("H1 interval and canonical timeframe are mandatory", () => {
    const result = replayDynamicPortfolio([
        ev("m", "MARK", 2_000),
    ], { ...policy, settlement_currency: "USDT" }, [{ timestamp_ms: 2_000, symbol: "ETHUSDT", price: 100, fx_rate: 1 }]);
    assert.equal(result.status, "FAIL");
    assert.equal(result.rejection, "DATA_MISSING");
});

