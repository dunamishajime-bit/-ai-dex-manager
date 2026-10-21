#!/usr/bin/env python3
"""Strict independent revalidation of the PENGU Aster/Binance gap hypothesis.

This audit deliberately fixes the signal discovered before the holdout and then
adds execution constraints that the earlier bar test did not enforce:
- liquidity cutoffs are estimated from positive-volume selection bars only;
- signal, entry and exit bars must all contain real trades on both venues;
- an optional path constraint requires every held Aster bar to be active;
- gross exposure is reported at both 1.0x and the earlier 2.0x convention;
- adverse within-bar execution and weekly block-bootstrap uncertainty are shown.
"""
from __future__ import annotations

import math
from pathlib import Path

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
RNG = np.random.default_rng(20260715)


def execution_price(row: pd.Series, prefix: str, side: float, entry: bool, model: str) -> float:
    if model == "close":
        return float(row[f"{prefix}_close"])
    base = float(row[f"{prefix}_open"])
    if model == "open":
        return base
    if model != "adverse25":
        raise ValueError(model)
    high = float(row[f"{prefix}_high"])
    low = float(row[f"{prefix}_low"])
    adverse_sign = side if entry else -side
    px = base + adverse_sign * 0.25 * max(high - low, 0.0)
    return float(min(max(px, low), high))


def summarize(ret: pd.Series, trades: pd.DataFrame) -> dict:
    sample = ret.loc[(ret.index >= m.HOLDOUT) & (ret.index < m.END)].fillna(0.0)
    equity = (1.0 + sample).cumprod()
    total = float(equity.iloc[-1] - 1.0) if len(equity) else 0.0
    max_dd = float((equity / equity.cummax() - 1.0).min()) if len(equity) else 0.0
    days = max((sample.index[-1] - sample.index[0]).total_seconds() / 86400.0, 1.0) if len(sample) else 1.0
    cagr = (1.0 + total) ** (365.25 / days) - 1.0 if total > -1.0 else -1.0
    weekly = (1.0 + sample).resample("W-SUN").prod() - 1.0
    wstd = weekly.std(ddof=1)
    weekly_sharpe = float(weekly.mean() / wstd * math.sqrt(52.0)) if len(weekly) > 1 and wstd > 0 else np.nan
    monthly = (1.0 + sample).resample("ME").prod() - 1.0
    t = trades[trades["entry_time"] >= m.HOLDOUT].copy() if not trades.empty else trades.copy()
    trade_returns = t["net_return"].to_numpy(float) if len(t) else np.array([], dtype=float)
    win_rate = float((trade_returns > 0).mean()) if len(trade_returns) else np.nan
    median_trade = float(np.median(trade_returns)) if len(trade_returns) else np.nan
    mean_trade = float(np.mean(trade_returns)) if len(trade_returns) else np.nan
    total_trade_sum = float(trade_returns.sum()) if len(trade_returns) else 0.0
    top5_share = float(np.sort(trade_returns)[-5:].sum() / total_trade_sum) if len(trade_returns) >= 5 and total_trade_sum > 0 else np.nan
    return {
        "total_return": total,
        "annualized_cagr": cagr,
        "max_drawdown": max_dd,
        "weekly_sharpe": weekly_sharpe,
        "trades": int(len(t)),
        "win_rate": win_rate,
        "mean_trade": mean_trade,
        "median_trade": median_trade,
        "positive_week_ratio": float((weekly > 0).mean()) if len(weekly) else np.nan,
        "positive_month_ratio": float((monthly > 0).mean()) if len(monthly) else np.nan,
        "best_week": float(weekly.max()) if len(weekly) else np.nan,
        "worst_week": float(weekly.min()) if len(weekly) else np.nan,
        "top5_profit_share": top5_share,
    }


def weekly_bootstrap(ret: pd.Series, iterations: int = 20000) -> dict:
    sample = ret.loc[(ret.index >= m.HOLDOUT) & (ret.index < m.END)].fillna(0.0)
    weekly = ((1.0 + sample).resample("W-SUN").prod() - 1.0).to_numpy(float)
    if not len(weekly):
        return {"bootstrap_prob_positive": np.nan, "bootstrap_total_p025": np.nan, "bootstrap_total_p50": np.nan, "bootstrap_total_p975": np.nan}
    draws = RNG.choice(weekly, size=(iterations, len(weekly)), replace=True)
    totals = np.prod(1.0 + draws, axis=1) - 1.0
    return {
        "bootstrap_prob_positive": float((totals > 0).mean()),
        "bootstrap_total_p025": float(np.quantile(totals, 0.025)),
        "bootstrap_total_p50": float(np.quantile(totals, 0.50)),
        "bootstrap_total_p975": float(np.quantile(totals, 0.975)),
    }


def simulate(
    df: pd.DataFrame,
    score: pd.Series,
    delay_bars: int,
    cost_bps: float,
    positive_volume_quantile: float,
    execution_model: str,
    require_path_active: bool,
    gross_exposure: float,
) -> tuple[pd.Series, pd.DataFrame]:
    selection = df.loc[df.index < m.HOLDOUT]
    positive_volume = selection.loc[
        (selection["a_quote_volume"] > 0) & (selection["a_trades"] > 0), "a_quote_volume"
    ].dropna()
    cutoff = float(positive_volume.quantile(positive_volume_quantile)) if len(positive_volume) else np.inf

    finite_cols = [
        "a_open", "a_high", "a_low", "a_close", "b_open", "b_high", "b_low", "b_close",
        "a_quote_volume", "b_quote_volume", "a_trades", "b_trades",
    ]
    finite = df[finite_cols].replace([np.inf, -np.inf], np.nan).notna().all(axis=1)
    active = (
        finite
        & (df["a_quote_volume"] >= cutoff)
        & (df["a_trades"] > 0)
        & (df["b_quote_volume"] > 0)
        & (df["b_trades"] > 0)
    )

    values = score.fillna(0.0).to_numpy(float)
    allow = active.to_numpy(bool)
    returns = pd.Series(0.0, index=df.index)
    rows: list[dict] = []
    leg_weight = gross_exposure / 2.0
    cost = cost_bps / 10000.0
    i = 0
    while i < len(df) - delay_bars - HOLD_BARS - 1:
        if abs(values[i]) < THRESHOLD or not allow[i]:
            i += 1
            continue
        entry_i = i + delay_bars
        exit_i = entry_i + HOLD_BARS
        if not allow[entry_i] or not allow[exit_i]:
            i += 1
            continue
        if require_path_active and not bool(np.all(allow[entry_i:exit_i + 1])):
            i += 1
            continue

        side_a = 1.0 if values[i] > 0 else -1.0
        side_b = -side_a
        entry_row = df.iloc[entry_i]
        exit_row = df.iloc[exit_i]
        a_entry = execution_price(entry_row, "a", side_a, True, execution_model)
        a_exit = execution_price(exit_row, "a", side_a, False, execution_model)
        b_entry = execution_price(entry_row, "b", side_b, True, execution_model)
        b_exit = execution_price(exit_row, "b", side_b, False, execution_model)
        if min(a_entry, a_exit, b_entry, b_exit) <= 0:
            i += 1
            continue

        gross_ret = leg_weight * (side_a * (a_exit / a_entry - 1.0) + side_b * (b_exit / b_entry - 1.0))
        # Entry and exit on two venues: four charged sides, scaled by leg weight.
        friction = 4.0 * leg_weight * cost
        # Small conservative reserve for possible funding crossing / residual operational costs.
        operational_reserve = 0.0002 * gross_exposure
        net_ret = max(gross_ret - friction - operational_reserve, -0.95)
        returns.iloc[exit_i] += net_ret

        min_aster_volume = float(min(entry_row["a_quote_volume"], exit_row["a_quote_volume"]))
        capacity_1pct = min_aster_volume * 0.01 / max(leg_weight, 1e-12)
        rows.append({
            "signal_time": df.index[i], "entry_time": df.index[entry_i], "exit_time": df.index[exit_i],
            "side_a": side_a, "score": values[i], "a_entry": a_entry, "a_exit": a_exit,
            "b_entry": b_entry, "b_exit": b_exit, "gross_return": gross_ret,
            "friction": friction + operational_reserve, "net_return": net_ret,
            "entry_a_quote_volume": float(entry_row["a_quote_volume"]),
            "exit_a_quote_volume": float(exit_row["a_quote_volume"]),
            "capacity_usd_at_1pct_participation": capacity_1pct,
        })
        i = exit_i + 1
    return returns, pd.DataFrame(rows)


def main() -> None:
    df = v.load_core(SYMBOL)
    if df.empty:
        raise RuntimeError("PENGU core data unavailable")
    score = -df["price_gap_z"]

    rows = []
    series = []
    trade_exports = []
    for model in ["close", "adverse25"]:
        for delay in [1, 2, 3]:
            for cost in [10, 15, 20]:
                for q in [0.25, 0.50]:
                    for path_active in [False, True]:
                        for gross in [1.0, 2.0]:
                            ret, trades = simulate(df, score, delay, cost, q, model, path_active, gross)
                            stats = summarize(ret, trades)
                            boot = weekly_bootstrap(ret)
                            holdout_trades = trades[trades["entry_time"] >= m.HOLDOUT] if not trades.empty else trades
                            capacity = holdout_trades["capacity_usd_at_1pct_participation"] if len(holdout_trades) else pd.Series(dtype=float)
                            name = f"{model}_d{delay}_c{cost}_q{q}_path{int(path_active)}_g{gross}"
                            rows.append({
                                "scenario": name,
                                "execution_model": model,
                                "delay_minutes": delay * 5,
                                "cost_bps_per_side_per_venue": cost,
                                "positive_volume_quantile": q,
                                "require_all_held_bars_active": path_active,
                                "gross_exposure": gross,
                                "median_capacity_usd_1pct": float(capacity.median()) if len(capacity) else np.nan,
                                "p10_capacity_usd_1pct": float(capacity.quantile(0.10)) if len(capacity) else np.nan,
                                **stats, **boot,
                            })
                            series.append(ret.rename(name))
                            if name in {
                                "close_d1_c10_q0.25_path0_g1.0",
                                "adverse25_d2_c15_q0.25_path1_g1.0",
                            }:
                                tagged = holdout_trades.copy()
                                tagged.insert(0, "scenario", name)
                                trade_exports.append(tagged)

    results = pd.DataFrame(rows)
    results.to_csv(OUT / "strict_revalidation_scenarios.csv", index=False)
    pd.concat(series, axis=1).to_csv(OUT / "strict_revalidation_returns.csv")
    if trade_exports:
        pd.concat(trade_exports, ignore_index=True).to_csv(OUT / "strict_revalidation_trades.csv", index=False)

    moderate = results[results["scenario"] == "close_d1_c10_q0.25_path0_g1.0"].iloc[0]
    strict = results[results["scenario"] == "adverse25_d2_c15_q0.25_path1_g1.0"].iloc[0]
    plausible = results[
        (results["gross_exposure"] == 1.0)
        & (results["cost_bps_per_side_per_venue"] >= 10)
        & (results["positive_volume_quantile"] >= 0.25)
    ]
    plausible_positive = float((plausible["total_return"] > 0).mean())
    passes = (
        strict["total_return"] > 0
        and strict["trades"] >= 30
        and strict["bootstrap_prob_positive"] >= 0.90
        and plausible_positive >= 0.60
    )
    verdict = "STRICT REVALIDATION PASS" if passes else "STRICT REVALIDATION FAIL"

    def line(label: str, r: pd.Series) -> str:
        return (
            f"| {label} | {int(r['trades'])} | {r['total_return']*100:.2f}% | "
            f"{r['max_drawdown']*100:.2f}% | {r['weekly_sharpe']:.2f} | "
            f"{r['bootstrap_prob_positive']*100:.1f}% | "
            f"[{r['bootstrap_total_p025']*100:.2f}%, {r['bootstrap_total_p975']*100:.2f}%] | "
            f"${r['median_capacity_usd_1pct']:.0f} |"
        )

    report = f"""# Strict PENGU Aster–Binance Revalidation

## Verdict

**{verdict}.**

This audit fixes the previously discovered signal (absolute gap z-score 2.5, 60-minute hold) and does not re-optimize it on the April–June 2026 holdout.

## Corrections versus the prior stress test

- Liquidity thresholds are calculated from **positive-volume selection bars only**. The former 25th percentile was zero and therefore filtered nothing.
- Signal, entry and exit bars must contain positive quote volume and trades on both venues.
- The strict case requires every Aster bar during the holding interval to be active.
- Pair exposure is normalized to **1.0x gross** (0.5x per venue); the previous headline used 2.0x gross.
- A 2 bps operational/funding reserve per 1.0x gross trade is added beyond explicit two-venue costs.
- Uncertainty is measured from the 14 weekly holdout observations using 20,000 bootstrap resamples.

## Fixed cases

| Case | Trades | Holdout return | Max DD | Weekly Sharpe | Bootstrap P(return>0) | 95% bootstrap total | Median account capacity at 1% Aster participation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{line('Moderate: next close, 5m delay, 10bps/side/venue, entry+exit active', moderate)}
{line('Strict: adverse 25% bar range, 10m delay, 15bps/side/venue, all held bars active', strict)}

## Parameter-region test

- Plausible 1.0x-gross scenarios tested: {len(plausible)}
- Fraction profitable: {plausible_positive*100:.1f}%
- Required robustness fraction: 60.0%

## Interpretation

A positive point estimate is not enough. The signal is considered deployable only if the strict case remains positive with at least 30 trades, has at least 90% bootstrap probability of a positive 14-week result, and most nearby plausible execution assumptions remain profitable.

Historical top-of-book and queue data are still unavailable, so even a pass would permit paper trading only.
"""
    (OUT / "strict_revalidation_report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
