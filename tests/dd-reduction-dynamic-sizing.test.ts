import assert from "node:assert/strict";
import { test } from "node:test";

import { sizeDynamicEntry, type DynamicSizingInput } from "../lib/backtest/dd-reduction/dynamic-sizing";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const TS = 1_700_000_000_000;

function input(overrides: Partial<DynamicSizingInput> = {}): DynamicSizingInput {
    return {
        decision_ts_ms: TS,
        wallet_jpy: 1_000,
        equity_jpy: 1_000,
        strategy_gross: 100,
        strategy_gross_cap: 1_000,
        available_margin: 500,
        pending_gross: 50,
        fee_bps: 10,
        funding_bps: 5,
        slippage_bps: 20,
        price: 100,
        gross_cap: 400,
        quantity_step: 0.1,
        min_qty: 0.1,
        min_notional: 10,
        margin_reserve: 0,
        ...overrides,
    };
}

test("sizes from decision-time wallet/equity, margin, pending exposure, strategy gross, and costs", () => {
    assertFixtureIdentity(
        { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
        ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
        "dynamic-sizing.fixture",
    );
    const result = sizeDynamicEntry(input());
    assert.equal(result.accepted, true);
    assert.equal(result.quantity, 3.9);
    assert.equal(result.gross, 390);
    assert.ok(Math.abs(result.raw_quantity - 3.986048829098156) < 1e-9);
    assert.equal(result.cost_rate_bps, 35);
    assert.equal(result.decision_ts_ms, TS);
});

test("rounds down to quantity step and rejects a result below min quantity or notional", () => {
    const rounded = sizeDynamicEntry(input({ available_margin: 123, pending_gross: 0, gross_cap: 123 }));
    assert.equal(rounded.accepted, true);
    assert.equal(rounded.quantity, 1.2);
    assert.ok(rounded.gross <= 123);

    const tooSmall = sizeDynamicEntry(input({ available_margin: 9, pending_gross: 0, gross_cap: 9, min_qty: 0, min_notional: 10 }));
    assert.equal(tooSmall.accepted, false);
    assert.equal(tooSmall.reason, "MIN_NOTIONAL");
});

test("rejects a rounded quantity that would exceed an explicit gross cap", () => {
    const result = sizeDynamicEntry(input({ available_margin: 1_000, pending_gross: 0, gross_cap: 105, quantity_step: 1 }));
    assert.equal(result.accepted, true);
    assert.equal(result.gross, 100);
    assert.ok(result.gross <= 105);

    const invalid = sizeDynamicEntry(input({ available_margin: 1_000, pending_gross: 0, gross_cap: 0.5, quantity_step: 1, min_qty: 1 }));
    assert.equal(invalid.accepted, false);
    assert.equal(invalid.reason, "MIN_QTY");
});

test("uses no future exit PnL or later wallet field", () => {
    const base = sizeDynamicEntry(input());
    const futurePnl = sizeDynamicEntry(input({
        future_exit_pnl: 9_999_999,
        later_wallet_jpy: 9_999_999,
    }));
    assert.deepEqual(futurePnl, base);
});

test("fails closed for missing or non-finite decision-time inputs and invalid step", () => {
    for (const overrides of [
        { wallet_jpy: Number.NaN },
        { equity_jpy: Number.POSITIVE_INFINITY },
        { available_margin: -1 },
        { quantity_step: 0 },
        { price: 0 },
    ]) {
        const result = sizeDynamicEntry(input(overrides));
        assert.equal(result.accepted, false);
        assert.equal(result.reason, "DATA_MISSING");
    }
});
