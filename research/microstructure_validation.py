#!/usr/bin/env python3
"""Robustness validation for the Aster/Binance microstructure screen.

This script reuses the cache produced by the main backtest. It tests whether the
headline result survives PENGU removal, price-gap removal, non-overlapping
execution, and a Binance-hedged spread construction.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from research import aster_binance_microstructure as m

OUT = m.OUT
HOLDOUT = m.HOLDOUT
END = m.END
START = m.START
COST_PER_SIDE_PER_VENUE = m.ASTER_TAKER_FEE + m.SLIPPAGE_PER_SIDE


def load_core(symbol: str) -> pd.DataFrame:
    a = m.fetch_klines(m.ASTER, "/fapi/v1/klines", symbol, START, END)
    am = m.fetch_klines(m.ASTER, "/fapi/v1/markPriceKlines", symbol, START, END)
    b = m.fetch_klines(m.BINANCE, "/fapi/v1/klines", symbol, START, END)
    af = m.fetch_funding(m.ASTER, symbol, START, END)
    bf = m.fetch_funding(m.BINANCE, symbol, START, END)
    if a.empty or b.empty:
        return pd.DataFrame()
    index = a.index.intersection(b.index)
    index = index[(index >= START) & (index < END)]
    df = pd.DataFrame(index=index)
    for prefix, frame in [("a", a), ("b", b)]:
        for column in ["open", "high", "low", "close", "quote_volume", "trades", "taker_buy_quote"]:
            if column in frame:
                df[f"{prefix}_{column}"] = frame[column].reindex(index)
        df[f"{prefix}_flow"] = m.safe_flow(frame).reindex(index)
    df["a_mark"] = am["close"].reindex(index).ffill() if not am.empty else np.nan
    df["b_mark"] = np.nan
    df["a_funding"] = m.align_funding(af, index, "a_funding")
    df["b_funding"] = m.align_funding(bf, index, "b_funding")
    df["long_liq"] = np.nan
    df["short_liq"] = np.nan
    return m.build_features(df)


def score_from(df: pd.DataFrame, features: list[str]) -> pd.Series:
    available = [name for name in features if name in df and df[name].notna().sum() >= 500]
    if not available:
        return pd.Series(0.0, index=df.index)
    panel = pd.concat([np.tanh(df[name] / 2.0).rename(name) for name in available], axis=1)
    return panel.mean(axis=1, skipna=True).fillna(0.0) * df["liquidity_multiplier"].fillna(1.0)


def weekly_stats(ret: pd.Series, start: pd.Timestamp) -> dict:
    sample = ret.loc[ret.index >= start].fillna(0.0)
    weekly = (1.0 + sample).resample("W-SUN").prod() - 1.0
    if weekly.empty:
        return {"positive_week_ratio": np.nan, "best_week": np.nan, "worst_week": np.nan, "weeks": 0}
    return {
        "positive_week_ratio": float((weekly > 0).mean()),
        "best_week": float(weekly.max()),
        "worst_week": float(weekly.min()),
        "weeks": int(len(weekly)),
    }


def evaluate_family(
    data: dict[str, pd.DataFrame],
    features: list[str],
    universe_name: str,
    family_name: str,
) -> tuple[dict, pd.Series]:
    scores = {symbol: score_from(frame, features) for symbol, frame in data.items()}
    chosen, _ = m.select_variant(data, scores, [0.20, 0.30, 0.40, 0.55])
    ret, _, trades = m.portfolio_result(data, scores, float(chosen["threshold"]), int(chosen["horizon"]))
    selection = m.summarize_returns(ret[(ret.index >= START) & (ret.index < HOLDOUT)], START)
    holdout = m.summarize_returns(ret[(ret.index >= HOLDOUT) & (ret.index < END)], HOLDOUT)
    row = {
        "universe": universe_name,
        "family": family_name,
        "features": ",".join(features),
        "threshold": chosen["threshold"],
        "horizon_minutes": int(chosen["horizon"]) * 5,
        "selection_trades": int((trades["entry_time"] < HOLDOUT).sum()) if not trades.empty else 0,
        "holdout_trades": int((trades["entry_time"] >= HOLDOUT).sum()) if not trades.empty else 0,
        **{f"selection_{key}": value for key, value in selection.items()},
        **{f"holdout_{key}": value for key, value in holdout.items()},
        **weekly_stats(ret, HOLDOUT),
    }
    return row, ret


def alignment_diagnostics(symbol: str, df: pd.DataFrame) -> list[dict]:
    a_ret = np.log(df["a_close"]).diff()
    b_ret = np.log(df["b_close"]).diff()
    rows = []
    for period_name, mask in [("selection", df.index < HOLDOUT), ("holdout", df.index >= HOLDOUT)]:
        gap = df.loc[mask, "price_gap_bps"].dropna()
        row = {
            "symbol": symbol,
            "period": period_name,
            "observations": int(len(gap)),
            "gap_mean_bps": float(gap.mean()),
            "gap_std_bps": float(gap.std(ddof=0)),
            "gap_p01_bps": float(gap.quantile(0.01)),
            "gap_p50_bps": float(gap.quantile(0.50)),
            "gap_p99_bps": float(gap.quantile(0.99)),
        }
        best_shift = None
        best_corr = -np.inf
        for shift in [-2, -1, 0, 1, 2]:
            corr = a_ret.loc[mask].corr(b_ret.shift(shift).loc[mask])
            row[f"return_corr_shift_{shift:+d}"] = float(corr)
            if np.isfinite(corr) and corr > best_corr:
                best_corr = corr
                best_shift = shift
        row["best_shift"] = best_shift
        row["best_shift_corr"] = float(best_corr)
        rows.append(row)
    return rows


def build_nonoverlap_positions(score: pd.Series, threshold: float, horizon: int) -> pd.Series:
    values = score.fillna(0.0).to_numpy(float)
    positions = np.zeros(len(score), dtype=float)
    i = 0
    while i < len(values) - horizon - 2:
        if abs(values[i]) < threshold:
            i += 1
            continue
        direction = 1.0 if values[i] > 0 else -1.0
        entry = i + 1
        exit_index = entry + horizon
        positions[entry:exit_index] = direction
        i = exit_index
    return pd.Series(positions, index=score.index)


def spread_returns(df: pd.DataFrame, score: pd.Series, threshold: float, horizon: int, hedged: bool) -> pd.Series:
    pos_a = build_nonoverlap_positions(score, threshold, horizon)
    a_open_ret = (df["a_open"].shift(-1) / df["a_open"] - 1.0).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    result = pos_a * a_open_ret
    turnover_a = pos_a.diff().abs().fillna(pos_a.abs())
    result -= COST_PER_SIDE_PER_VENUE * turnover_a
    if hedged:
        pos_b = -pos_a
        b_open_ret = (df["b_open"].shift(-1) / df["b_open"] - 1.0).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        turnover_b = pos_b.diff().abs().fillna(pos_b.abs())
        result += pos_b * b_open_ret
        # Conservative Binance taker/slippage assumption equal to Aster.
        result -= COST_PER_SIDE_PER_VENUE * turnover_b
    return result


def select_spread_variant(data: dict[str, pd.DataFrame], hedged: bool) -> tuple[dict, pd.Series]:
    rows = []
    stored = {}
    for horizon in [3, 6, 12]:
        for threshold in [1.5, 2.0, 2.5, 3.0]:
            matrix = []
            for symbol, frame in data.items():
                score = -frame["price_gap_z"]
                matrix.append(spread_returns(frame, score, threshold, horizon, hedged).rename(symbol))
            portfolio = pd.concat(matrix, axis=1).fillna(0.0).mean(axis=1)
            selection = m.summarize_returns(portfolio[(portfolio.index >= START) & (portfolio.index < HOLDOUT)], START)
            score_value = (
                np.nan_to_num(selection.get("sharpe"), nan=-5.0)
                + 1.5 * np.nan_to_num(selection.get("cagr"), nan=-1.0)
                + 1.2 * np.nan_to_num(selection.get("max_drawdown"), nan=-1.0)
            )
            key = (horizon, threshold)
            stored[key] = portfolio
            rows.append({"horizon": horizon, "threshold": threshold, "selection_score": float(score_value), **selection})
    chosen = max(rows, key=lambda row: row["selection_score"])
    return chosen, stored[(int(chosen["horizon"]), float(chosen["threshold"]))]


def main() -> None:
    data = {symbol: frame for symbol in m.SYMBOLS if not (frame := load_core(symbol)).empty}
    # Rebuild explicitly because assignment expressions inside comprehensions can be opaque.
    data = {}
    for symbol in m.SYMBOLS:
        frame = load_core(symbol)
        if not frame.empty:
            data[symbol] = frame
    if not data:
        raise RuntimeError("No cached core data available for validation")

    alignment_rows = []
    for symbol, frame in data.items():
        alignment_rows.extend(alignment_diagnostics(symbol, frame))
    pd.DataFrame(alignment_rows).to_csv(OUT / "gap_alignment_diagnostics.csv", index=False)

    base_features = ["sig_price_mr", "sig_funding_contra", "sig_flow_cont", "sig_lead_follow"]
    families = {
        "all_available": base_features,
        "price_only": ["sig_price_mr"],
        "without_price": ["sig_funding_contra", "sig_flow_cont", "sig_lead_follow"],
        "funding_only": ["sig_funding_contra"],
        "flow_only": ["sig_flow_cont"],
        "lead_only": ["sig_lead_follow"],
    }
    robustness_rows = []
    return_exports = []
    universes = {
        "all": data,
        "without_PENGU": {k: v for k, v in data.items() if k != "PENGUUSDT"},
        "PENGU_only": {k: v for k, v in data.items() if k == "PENGUUSDT"},
    }
    for universe_name, universe in universes.items():
        if not universe:
            continue
        selected_families = families if universe_name == "all" else {"all_available": families["all_available"]}
        for family_name, features in selected_families.items():
            row, ret = evaluate_family(universe, features, universe_name, family_name)
            robustness_rows.append(row)
            return_exports.append(ret.rename(f"{universe_name}_{family_name}"))
    robustness = pd.DataFrame(robustness_rows)
    robustness.to_csv(OUT / "robustness_ablations.csv", index=False)
    pd.concat(return_exports, axis=1).to_csv(OUT / "robustness_returns.csv")

    spread_rows = []
    spread_exports = []
    for universe_name, universe in universes.items():
        if not universe:
            continue
        for hedged in [False, True]:
            chosen, ret = select_spread_variant(universe, hedged)
            selection = m.summarize_returns(ret[(ret.index >= START) & (ret.index < HOLDOUT)], START)
            holdout = m.summarize_returns(ret[(ret.index >= HOLDOUT) & (ret.index < END)], HOLDOUT)
            spread_rows.append({
                "universe": universe_name,
                "construction": "Aster_minus_Binance" if hedged else "Aster_only",
                "threshold": chosen["threshold"],
                "horizon_minutes": int(chosen["horizon"]) * 5,
                **{f"selection_{key}": value for key, value in selection.items()},
                **{f"holdout_{key}": value for key, value in holdout.items()},
                **weekly_stats(ret, HOLDOUT),
            })
            spread_exports.append(ret.rename(f"{universe_name}_{'hedged' if hedged else 'aster_only'}"))
    spread_frame = pd.DataFrame(spread_rows)
    spread_frame.to_csv(OUT / "spread_construction_results.csv", index=False)
    pd.concat(spread_exports, axis=1).to_csv(OUT / "spread_returns.csv")

    # A strict research decision: a result must survive PENGU removal OR remain
    # positive in the market-neutral spread construction. Otherwise it is a
    # single-asset anomaly, not a deployable general microstructure engine.
    all_row = robustness[(robustness["universe"] == "all") & (robustness["family"] == "all_available")].iloc[0]
    no_pengu = robustness[robustness["universe"] == "without_PENGU"].iloc[0]
    pengu_hedged = spread_frame[(spread_frame["universe"] == "PENGU_only") & (spread_frame["construction"] == "Aster_minus_Binance")].iloc[0]
    robust_pass = (
        all_row["holdout_cagr"] > 0.40
        and all_row["holdout_max_drawdown"] > -0.30
        and (
            no_pengu["holdout_cagr"] > 0.0
            or pengu_hedged["holdout_cagr"] > 0.0
        )
    )
    verdict = "ROBUSTNESS PASS" if robust_pass else "ROBUSTNESS FAIL"

    report = f"""# Microstructure Robustness Validation

## Verdict

**{verdict}.**

The first screen is not accepted merely because its annualized holdout number is high. This validation asks whether the result survives removal of PENGU and whether the PENGU price-gap signal remains profitable after adding a Binance hedge and two-venue execution costs.

## Headline controls

- Full universe, all available features: holdout CAGR {all_row['holdout_cagr'] * 100:.2f}%, max DD {all_row['holdout_max_drawdown'] * 100:.2f}%.
- Without PENGU: holdout CAGR {no_pengu['holdout_cagr'] * 100:.2f}%, max DD {no_pengu['holdout_max_drawdown'] * 100:.2f}%.
- PENGU hedged spread: holdout CAGR {pengu_hedged['holdout_cagr'] * 100:.2f}%, max DD {pengu_hedged['holdout_max_drawdown'] * 100:.2f}%.

Full ablations are in `robustness_ablations.csv`; market-neutral comparisons are in `spread_construction_results.csv`; timestamp alignment and gap distributions are in `gap_alignment_diagnostics.csv`.

## Interpretation rule

Aster-only PENGU profitability without profitability in the hedged spread can reflect directional market exposure rather than convergence of the cross-venue dislocation. Conversely, a positive hedged result is stronger evidence that the price ratio itself mean-reverts after costs.

The validation period is only three months. Even a robustness pass permits prospective paper trading only, not capital deployment.
"""
    (OUT / "validation_report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
