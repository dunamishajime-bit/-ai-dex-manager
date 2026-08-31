from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from research_quality102_mtm_50 import partial_net_return, remaining_limit, solve_remaining_notional, patch_mtm_engine


def close(a, b, tol=1e-12):
    assert abs(a-b) <= tol, (a,b)


def test_partial_net_return_short():
    close(partial_net_return(side=-1, entry_price=100.0, mark_price=90.0, elapsed_hours=12.0, fee_per_side=0.0006, funding_per_day=0.0002), 0.0987)


def test_remaining_limit_satisfies_cap_after_realized_trim():
    E, O, r, B, cap = 100.0, 50.0, 0.10, 180.0, 2.0
    R = remaining_limit(equity=E, old_supp_notional=O, mark_net_return=r, existing_base_notional=B, cap=cap)
    Ea = E + (O-R)*r
    assert (B+R)/Ea <= cap + 1e-12


def test_crypto_cap_can_be_more_restrictive_than_total():
    R = solve_remaining_notional(equity=100.0, old_supp_notional=50.0, mark_net_return=0.05, total_base_notional=180.0, crypto_base_notional=180.0, total_cap=2.5, crypto_cap=2.0)
    Ea = 100.0 + (50.0-R)*0.05
    assert (180.0+R)/Ea <= 2.0 + 1e-12
    assert R < 50.0


def test_patch_replaces_zero_pnl_policy_and_adds_crypto_inclusive_audit():
    source = '''import math\n\ndef finite(value: Any, fallback: float = 0.0) -> float:\n    return float(value)\n\n    def observe_entry(entered_kind: str, ts: int) -> None:\n        pass\n\n    def reset_day(ts: int) -> None:\n        pass\n\n            "netUnitReturn": finite(row[supp_col]),\n                "netUnitReturn": finite(trade.get("netUnitReturn")),\n"entryPolicy": "BASE_IDLE_ONE_SLOT_BASE_PRIORITY_RESIDUAL_GROSS_SHRINK", "resizePnlAccounting": "ZERO_PNL_ON_TRIMMED_NOTIONAL"\n'''
    out = patch_mtm_engine(source)
    assert 'MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN' in out
    assert 'vg + pg + ug' in out
    assert 'CRYPTO_GROSS_CAP' in out
    assert 'ZERO_PNL_ON_TRIMMED_NOTIONAL' not in out


if __name__ == '__main__':
    test_partial_net_return_short()
    test_remaining_limit_satisfies_cap_after_realized_trim()
    test_crypto_cap_can_be_more_restrictive_than_total()
    test_patch_replaces_zero_pnl_policy_and_adds_crypto_inclusive_audit()
    print('PASS')
