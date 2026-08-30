from __future__ import annotations

import math

from scripts.quality102_trim_cost import solve_post_cost_resize


def _assert_finite_result(result: dict) -> None:
    for key, value in result.items():
        if isinstance(value, (int, float)):
            assert math.isfinite(float(value)), (key, value)


def test_no_resize_has_zero_execution_cost() -> None:
    result = solve_post_cost_resize(
        old_notional_jpy=20_000.0,
        equity_jpy=100_000.0,
        base_total_gross=1.0,
        base_crypto_gross=0.75,
        total_gross_cap=2.5,
        crypto_gross_cap=2.0,
        quality_gross_cap=0.5,
        trim_cost_bps=100.0,
    )
    _assert_finite_result(result)
    assert result['notionalAfterJpy'] == 20_000.0
    assert result['trimmedNotionalJpy'] == 0.0
    assert result['trimExecutionCostJpy'] == 0.0
    assert result['postCostEquityJpy'] == 100_000.0


def test_crypto_headroom_can_force_more_trim_than_total_headroom() -> None:
    result = solve_post_cost_resize(
        old_notional_jpy=50_000.0,
        equity_jpy=100_000.0,
        base_total_gross=2.0,
        base_crypto_gross=1.9,
        total_gross_cap=2.5,
        crypto_gross_cap=2.0,
        quality_gross_cap=0.5,
        trim_cost_bps=0.0,
    )
    _assert_finite_result(result)
    assert abs(result['notionalAfterJpy'] - 10_000.0) < 1e-8
    assert abs(result['postCostCryptoGross'] - 2.0) < 1e-10
    assert result['postCostTotalGross'] < 2.5


def test_positive_trim_cost_is_charged_once_on_trimmed_notional() -> None:
    result = solve_post_cost_resize(
        old_notional_jpy=50_000.0,
        equity_jpy=100_000.0,
        base_total_gross=2.0,
        base_crypto_gross=1.9,
        total_gross_cap=2.5,
        crypto_gross_cap=2.0,
        quality_gross_cap=0.5,
        trim_cost_bps=100.0,
    )
    _assert_finite_result(result)
    assert result['trimmedNotionalJpy'] > 40_000.0
    assert abs(result['trimExecutionCostJpy'] - result['trimmedNotionalJpy'] * 0.01) < 1e-8
    assert abs(result['postCostEquityJpy'] - (100_000.0 - result['trimExecutionCostJpy'])) < 1e-8
    assert result['postCostCryptoGross'] <= 2.0 + 1e-10
    assert result['postCostTotalGross'] <= 2.5 + 1e-10
    assert result['postCostQualityGross'] <= 0.5 + 1e-10


def test_invalid_cost_fails_closed() -> None:
    for bad in (-1.0, float('nan'), float('inf')):
        try:
            solve_post_cost_resize(
                old_notional_jpy=50_000.0,
                equity_jpy=100_000.0,
                base_total_gross=1.0,
                base_crypto_gross=1.0,
                total_gross_cap=2.5,
                crypto_gross_cap=2.0,
                quality_gross_cap=0.5,
                trim_cost_bps=bad,
            )
        except ValueError:
            pass
        else:
            raise AssertionError(f'invalid trim cost must fail closed: {bad!r}')


if __name__ == '__main__':
    test_no_resize_has_zero_execution_cost()
    test_crypto_headroom_can_force_more_trim_than_total_headroom()
    test_positive_trim_cost_is_charged_once_on_trimmed_notional()
    test_invalid_cost_fails_closed()
    print('quality102 trim cost tests: PASS')
