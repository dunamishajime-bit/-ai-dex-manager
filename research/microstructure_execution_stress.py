#!/usr/bin/env python3
"""Execution-stress tests for the PENGU Aster/Binance price-gap signal.

The purpose is to challenge the very large bar-based result with delayed fills,
higher two-venue friction, and liquidity filters. Parameters are fixed from the
pre-holdout selection: absolute price-gap z >= 2.5 and 60-minute holding time.
"""
from __future__ import annotations

from pathlib import Path
import math

import numpy as np
import pandas as pd

from research import aster_binance_microstructure as m

# Cached funding timestamps contain mixed ISO precision across months.
_original_align = m.align_funding
def _normalized_align(frame, index, name):
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index, utc=True, format="mixed")
    normalized_index = pd.DatetimeIndex(pd.to_datetime(index, utc=True, format="mixed"))
    return _original_align(normalized, normalized_index, name)
m.align_funding = _normalized_align

from research import microstructure_validation as v

OUT = m.OUT
SYMBOL = "PENGUUSDT"
THRESHOLD = 2.5
HOLD_BARS = 12


def stats(ret: pd.Series) -> dict:
    sample = ret.loc[(ret.index >= m.HOLDOUT) & (ret.index < m.END)].fillna(0.0)
    base = m.summarize_returns(sample, m.HOLDOUT)
    weekly = (1.0 + sample).resample("W-SUN").prod() - 1.0
    base.update({
        "positive_week_ratio": float((weekly > 0).mean()) if len(weekly) else np.nan,
        "best_week": float(weekly.max()) if len(weekly) else np.nan,
        "worst_week": float(weekly.min()) if len(weekly) else np.nan,
        "weeks": int(len(weekly)),
    })
    return base


def positions(score: pd.Series, delay_bars: int, hold_bars: int, eligible: pd.Series) -> pd.Series:
    values = score.fillna(0.0).to_numpy(float)
    allow = eligible.fillna(False).to_numpy(bool)
    p = np.zeros(len(score), dtype=float)
    i = 0
    while i < len(values) - delay_bars - hold_bars - 1:
        if abs(values[i]) < THRESHOLD or not allow[i]:
            i += 1
            continue
        direction = 1.0 if values[i] > 0 else -1.0
        entry = i + delay_bars
        exit_index = entry + hold_bars
        p[entry:exit_index] = direction
        i = exit_index
    return pd.Series(p, index=score.index)


def hedged_returns(
    df: pd.DataFrame,
    score: pd.Series,
    delay_bars: int,
    cost_bps_per_side_per_venue: float,
    volume_quantile: float,
    use_close_execution: bool,
) -> tuple[pd.Series, pd.Series]:
    selection_volume = df.loc[df.index < m.HOLDOUT, "a_quote_volume"].dropna()
    cutoff = float(selection_volume.quantile(volume_quantile)) if len(selection_volume) else 0.0
    eligible = df["a_quote_volume"].fillna(0.0) >= cutoff
    p_a = positions(score, delay_bars, HOLD_BARS, eligible)
    p_b = -p_a
    field = "close" if use_close_execution else "open"
    a_px = df[f"a_{field}"].astype(float)
    b_px = df[f"b_{field}"].astype(float)
    a_ret = (a_px.shift(-1) / a_px - 1.0).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    b_ret = (b_px.shift(-1) / b_px - 1.0).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    turnover_a = p_a.diff().abs().fillna(p_a.abs())
    turnover_b = p_b.diff().abs().fillna(p_b.abs())
    cost = cost_bps_per_side_per_venue / 10000.0
    ret = p_a * a_ret + p_b * b_ret - cost * (turnover_a + turnover_b)
    return ret, p_a


def main() -> None:
    df = v.load_core(SYMBOL)
    if df.empty:
        raise RuntimeError("PENGU core data unavailable")
    score = -df["price_gap_z"]

    # Diagnostics for stale/low-activity candles.
    diag = {
        "symbol": SYMBOL,
        "rows": int(len(df)),
        "aster_zero_quote_volume_ratio": float((df["a_quote_volume"].fillna(0.0) <= 0).mean()),
        "aster_missing_quote_volume_ratio": float(df["a_quote_volume"].isna().mean()),
        "aster_zero_trades_ratio": float((df["a_trades"].fillna(0.0) <= 0).mean()) if "a_trades" in df else np.nan,
        "aster_missing_trades_ratio": float(df["a_trades"].isna().mean()) if "a_trades" in df else np.nan,
        "aster_median_quote_volume": float(df["a_quote_volume"].median()),
        "binance_median_quote_volume": float(df["b_quote_volume"].median()),
        "holdout_gap_std_bps": float(df.loc[df.index >= m.HOLDOUT, "price_gap_bps"].std(ddof=0)),
        "holdout_return_corr": float(np.log(df.loc[df.index >= m.HOLDOUT, "a_close"]).diff().corr(np.log(df.loc[df.index >= m.HOLDOUT, "b_close"]).diff())),
    }
    pd.DataFrame([diag]).to_csv(OUT / "pengu_execution_diagnostics.csv", index=False)

    rows = []
    return_series = []
    for use_close in [False, True]:
        for delay in [1, 2, 3, 6]:
            for cost_bps in [5, 10, 20, 50]:
                for volume_q in [0.0, 0.10, 0.25, 0.50]:
                    ret, p = hedged_returns(df, score, delay, cost_bps, volume_q, use_close)
                    result = stats(ret)
                    rows.append({
                        "execution_price": "next_close" if use_close else "bar_open",
                        "delay_minutes": delay * 5,
                        "cost_bps_per_side_per_venue": cost_bps,
                        "volume_quantile_filter": volume_q,
                        "active_bar_ratio": float((p != 0).mean()),
                        **result,
                    })
                    return_series.append(ret.rename(f"{'close' if use_close else 'open'}_d{delay}_c{cost_bps}_q{volume_q}"))
    frame = pd.DataFrame(rows)
    frame.to_csv(OUT / "pengu_execution_stress.csv", index=False)
    pd.concat(return_series, axis=1).to_csv(OUT / "pengu_execution_stress_returns.csv")

    # The robust core must survive at least a 10-minute delay and 10 bps per side
    # per venue (40 bps round trip across both venues), without relying on the
    # lowest-liquidity quartile.
    required = frame[
        (frame["execution_price"] == "bar_open")
        & (frame["delay_minutes"] == 10)
        & (frame["cost_bps_per_side_per_venue"] == 10)
        & (frame["volume_quantile_filter"] == 0.25)
    ].iloc[0]
    close_check = frame[
        (frame["execution_price"] == "next_close")
        & (frame["delay_minutes"] == 5)
        & (frame["cost_bps_per_side_per_venue"] == 10)
        & (frame["volume_quantile_filter"] == 0.25)
    ].iloc[0]
    passes = (
        required["total_return"] > 0
        and required["max_drawdown"] >= -0.30
        and close_check["total_return"] > 0
    )
    verdict = "EXECUTION-STRESS PASS" if passes else "EXECUTION-STRESS FAIL"

    report = f"""# PENGU Cross-Venue Execution Stress

## Verdict

**{verdict}.**

The bar-based headline is accepted only as a research hypothesis. The required case uses a 10-minute signal-to-fill delay, 10 bps per side on each venue, and excludes the lowest 25% of Aster quote-volume bars.

## Required case

- Total holdout return: {required['total_return'] * 100:.2f}%
- Annualized CAGR: {required['cagr'] * 100:.2f}%
- Maximum drawdown: {required['max_drawdown'] * 100:.2f}%
- Sharpe: {required['sharpe']:.2f}
- Positive weeks: {required['positive_week_ratio'] * 100:.1f}%

## Next-close check

- Total holdout return: {close_check['total_return'] * 100:.2f}%
- Annualized CAGR: {close_check['cagr'] * 100:.2f}%
- Maximum drawdown: {close_check['max_drawdown'] * 100:.2f}%
- Sharpe: {close_check['sharpe']:.2f}

## Data-quality diagnostics

- Holdout Aster/Binance return correlation: {diag['holdout_return_corr']:.3f}
- Holdout price-gap standard deviation: {diag['holdout_gap_std_bps']:.2f} bps
- Aster zero quote-volume bars: {diag['aster_zero_quote_volume_ratio'] * 100:.2f}%
- Aster missing quote-volume bars: {diag['aster_missing_quote_volume_ratio'] * 100:.2f}%
- Aster median 5-minute quote volume: {diag['aster_median_quote_volume']:.2f}
- Binance median 5-minute quote volume: {diag['binance_median_quote_volume']:.2f}

Even a pass cannot prove fillability because historical Aster top-of-book snapshots are unavailable. Prospective bid/ask recording remains mandatory.
"""
    (OUT / "execution_stress_report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
