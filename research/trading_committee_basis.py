#!/usr/bin/env python3
"""Trading-committee backtest for executable Aster/Binance basis strategies.

The screen deliberately avoids last-trade latency arbitrage. Signals use Aster mark
price, Binance mark/contract price, settled funding information available at the
signal timestamp, and actual trade/liquidity gates. Execution is next 15-minute
bar on a two-venue market-neutral pair with total gross exposure of one.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import math

import numpy as np
import pandas as pd

from research import aster_binance_microstructure as m

OUT = Path("backtest_output_trading_committee")
OUT.mkdir(parents=True, exist_ok=True)

SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
    "XRPUSDT", "DOGEUSDT", "LINKUSDT", "PENGUUSDT",
]
DEV_END = pd.Timestamp("2025-07-01", tz="UTC")
VAL_END = pd.Timestamp("2026-01-01", tz="UTC")
FINAL_END = pd.Timestamp("2026-07-01", tz="UTC")
BASE_COST = 0.0006  # per side, per venue; pair gross is normalized to 1.0
ANNUAL_BARS = 365.25 * 24 * 4


@dataclass(frozen=True)
class Candidate:
    family: str
    lookback_days: int
    entry_z: float
    exit_z: float
    max_hold_hours: int

    @property
    def name(self) -> str:
        return (
            f"{self.family}_l{self.lookback_days}_e{self.entry_z:g}_"
            f"x{self.exit_z:g}_h{self.max_hold_hours}"
        )


def safe_cagr(total: float, periods: int) -> float:
    years = periods / ANNUAL_BARS
    if years <= 0 or total <= -1:
        return np.nan
    return (1.0 + total) ** (1.0 / years) - 1.0


def summarize(ret: pd.Series, start: pd.Timestamp, end: pd.Timestamp) -> dict:
    sample = ret.loc[(ret.index >= start) & (ret.index < end)].fillna(0.0)
    if sample.empty:
        return {
            "total_return": np.nan, "cagr": np.nan, "max_drawdown": np.nan,
            "sharpe": np.nan, "sortino": np.nan, "best_month": np.nan,
            "worst_month": np.nan, "positive_month_ratio": np.nan,
        }
    equity = (1.0 + sample).cumprod()
    total = float(equity.iloc[-1] - 1.0)
    vol = float(sample.std(ddof=0) * math.sqrt(ANNUAL_BARS))
    mean = float(sample.mean() * ANNUAL_BARS)
    downside = float(sample.clip(upper=0).std(ddof=0) * math.sqrt(ANNUAL_BARS))
    dd = equity / equity.cummax() - 1.0
    monthly = (1.0 + sample).resample("ME").prod() - 1.0
    return {
        "total_return": total,
        "cagr": safe_cagr(total, len(sample)),
        "max_drawdown": float(dd.min()),
        "sharpe": mean / vol if vol > 1e-12 else np.nan,
        "sortino": mean / downside if downside > 1e-12 else np.nan,
        "best_month": float(monthly.max()) if len(monthly) else np.nan,
        "worst_month": float(monthly.min()) if len(monthly) else np.nan,
        "positive_month_ratio": float((monthly > 0).mean()) if len(monthly) else np.nan,
    }


def resample_symbol(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    fields = {
        "a_open": "first", "a_high": "max", "a_low": "min", "a_close": "last",
        "b_open": "first", "b_high": "max", "b_low": "min", "b_close": "last",
        "a_mark": "last", "b_mark": "last",
        "a_quote_volume": "sum", "b_quote_volume": "sum",
        "a_trades": "sum", "b_trades": "sum",
        "a_flow": "mean", "b_flow": "mean",
        "a_funding": "last", "b_funding": "last",
    }
    available = {key: value for key, value in fields.items() if key in df.columns}
    out = df[list(available)].resample("15min").agg(available)
    required = ["a_open", "a_close", "b_open", "b_close", "a_mark"]
    out = out.dropna(subset=[c for c in required if c in out])
    if "b_mark" in out and out["b_mark"].notna().mean() >= 0.80:
        out["binance_fair"] = out["b_mark"]
        out["fair_source"] = "mark"
    else:
        out["binance_fair"] = out["b_close"]
        out["fair_source"] = "contract"
    out["premium_bps"] = 1e4 * np.log(out["a_mark"] / out["binance_fair"])
    out["funding_edge_long_aster"] = out["b_funding"] - out["a_funding"]
    out["symbol"] = symbol
    return out.replace([np.inf, -np.inf], np.nan)


def rolling_z(series: pd.Series, days: int) -> pd.Series:
    bars = days * 24 * 4
    minimum = max(7 * 24 * 4, bars // 3)
    mean = series.rolling(bars, min_periods=minimum).mean()
    std = series.rolling(bars, min_periods=minimum).std(ddof=0).replace(0, np.nan)
    return ((series - mean) / std).clip(-8, 8)


def feature_frame(df: pd.DataFrame, candidate: Candidate) -> pd.DataFrame:
    out = df.copy()
    out["premium_z"] = rolling_z(out["premium_bps"], candidate.lookback_days)
    out["funding_z"] = rolling_z(
        out["funding_edge_long_aster"], max(30, candidate.lookback_days * 2)
    )
    out["premium_turn_1h"] = out["premium_z"].diff(4)
    if candidate.family == "mean_reversion":
        score = -out["premium_z"]
    elif candidate.family == "carry_confirmed":
        score = -out["premium_z"]
        helpful = np.sign(score) * out["funding_edge_long_aster"] > 0
        score = score.where(helpful, 0.0)
    elif candidate.family == "turn_confirmed":
        score = -out["premium_z"]
        turning = (
            np.sign(out["premium_turn_1h"]) == -np.sign(out["premium_z"])
        ) & (out["premium_turn_1h"].abs() >= 0.10)
        score = score.where(turning, 0.0)
    elif candidate.family == "funding_carry":
        score = out["funding_z"].fillna(0.0) - 0.50 * out["premium_z"].fillna(0.0)
        helpful = np.sign(score) * out["funding_edge_long_aster"] > 0
        score = score.where(helpful & (out["funding_z"].abs() >= 1.0), 0.0)
    else:
        raise ValueError(candidate.family)
    out["score"] = score.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return out


def liquidity_gate(df: pd.DataFrame, symbol: str) -> pd.Series:
    development = df.loc[df.index < DEV_END, "a_quote_volume"].dropna()
    positive = development[development > 0]
    quantile = 0.60 if symbol == "PENGUUSDT" else 0.25
    cutoff = float(positive.quantile(quantile)) if len(positive) else np.inf
    gate = (
        (df["a_quote_volume"].fillna(0.0) >= cutoff)
        & (df["b_quote_volume"].fillna(0.0) > 0.0)
        & (df["a_trades"].fillna(0.0) > 0.0)
        & (df["b_trades"].fillna(0.0) > 0.0)
        & df[["a_open", "b_open", "a_mark", "binance_fair"]].notna().all(axis=1)
    )
    return gate


def build_positions(
    prepared: dict[str, pd.DataFrame], candidate: Candidate
) -> tuple[pd.DataFrame, list[dict]]:
    common = sorted(set.intersection(*(set(frame.index) for frame in prepared.values())))
    index = pd.DatetimeIndex(common)
    positions = pd.DataFrame(0.0, index=index, columns=sorted(prepared))
    gates = {symbol: liquidity_gate(frame.reindex(index), symbol) for symbol, frame in prepared.items()}
    trades: list[dict] = []
    hold_bars = candidate.max_hold_hours * 4
    i = 0
    while i < len(index) - hold_bars - 3:
        candidates = []
        for symbol, frame in prepared.items():
            aligned = frame.reindex(index)
            score = float(aligned["score"].iloc[i])
            if gates[symbol].iloc[i] and abs(score) >= candidate.entry_z:
                candidates.append((abs(score), symbol, score))
        if not candidates:
            i += 1
            continue
        _, symbol, score = max(candidates)
        frame = prepared[symbol].reindex(index)
        entry = i + 1
        if not gates[symbol].iloc[entry]:
            i += 1
            continue
        direction = 1.0 if score > 0 else -1.0
        z_entry = float(frame["premium_z"].iloc[i])
        exit_index = min(entry + hold_bars, len(index) - 2)
        reason = "time"
        for j in range(entry + 1, exit_index + 1):
            z_now = float(frame["premium_z"].iloc[j]) if pd.notna(frame["premium_z"].iloc[j]) else z_entry
            movement = direction * (z_now - z_entry)
            if candidate.family != "funding_carry" and abs(z_now) <= candidate.exit_z:
                exit_index, reason = j, "convergence"
                break
            if movement <= -1.25:
                exit_index, reason = j, "spread_stop"
                break
            if np.sign(frame["score"].iloc[j]) == -direction and abs(frame["score"].iloc[j]) >= 0.50:
                exit_index, reason = j, "signal_flip"
                break
        holding_gate = gates[symbol].iloc[entry:exit_index + 1]
        minimum_ratio = 0.90 if symbol == "PENGUUSDT" else 0.50
        if len(holding_gate) == 0 or float(holding_gate.mean()) < minimum_ratio:
            i += 1
            continue
        # Half notional on each venue => total gross exposure is one.
        positions.loc[index[entry:exit_index], symbol] = 0.5 * direction
        trades.append({
            "candidate": candidate.name,
            "symbol": symbol,
            "signal_time": index[i],
            "entry_time": index[entry],
            "exit_time": index[exit_index],
            "direction_aster": direction,
            "entry_score": score,
            "entry_premium_z": z_entry,
            "exit_reason": reason,
        })
        i = exit_index + 1
    return positions, trades


def simulate(
    base_data: dict[str, pd.DataFrame], candidate: Candidate, cost_per_side: float
) -> tuple[pd.Series, pd.DataFrame, pd.DataFrame]:
    prepared = {symbol: feature_frame(frame, candidate) for symbol, frame in base_data.items()}
    positions, records = build_positions(prepared, candidate)
    symbol_returns = pd.DataFrame(0.0, index=positions.index, columns=positions.columns)
    for symbol in positions.columns:
        frame = prepared[symbol].reindex(positions.index)
        p_a = positions[symbol]
        p_b = -p_a
        a_ret = (frame["a_open"].shift(-1) / frame["a_open"] - 1.0).fillna(0.0)
        b_ret = (frame["b_open"].shift(-1) / frame["b_open"] - 1.0).fillna(0.0)
        turnover = p_a.diff().abs().fillna(p_a.abs()) + p_b.diff().abs().fillna(p_b.abs())
        event_a = frame["a_funding"].notna() & frame["a_funding"].ne(frame["a_funding"].shift())
        event_b = frame["b_funding"].notna() & frame["b_funding"].ne(frame["b_funding"].shift())
        funding = (
            -p_a.shift(1).fillna(0.0) * frame["a_funding"].fillna(0.0) * event_a.astype(float)
            -p_b.shift(1).fillna(0.0) * frame["b_funding"].fillna(0.0) * event_b.astype(float)
        )
        symbol_returns[symbol] = p_a * a_ret + p_b * b_ret + funding - cost_per_side * turnover
    total = symbol_returns.sum(axis=1)
    trades = pd.DataFrame(records)
    if not trades.empty:
        trades["entry_time"] = pd.to_datetime(trades["entry_time"], utc=True)
        trades["exit_time"] = pd.to_datetime(trades["exit_time"], utc=True)
        pnl = []
        for row in trades.itertuples():
            pnl.append(float(symbol_returns.loc[row.entry_time:row.exit_time, row.symbol].sum()))
        trades["net_pnl"] = pnl
    return total, positions, trades


def candidates() -> list[Candidate]:
    out = []
    for family in ["mean_reversion", "carry_confirmed", "turn_confirmed", "funding_carry"]:
        for lookback in [7, 14, 30]:
            for entry in [1.5, 2.0, 2.5]:
                for exit_z in [0.25, 0.50]:
                    for hold in [4, 8, 16]:
                        out.append(Candidate(family, lookback, entry, exit_z, hold))
    return out


def candidate_score(dev: dict, val: dict, dev_trades: int, val_trades: int) -> float:
    if dev_trades < 8 or val_trades < 6:
        return -1e6
    values = [dev["total_return"], val["total_return"], dev["sharpe"], val["sharpe"]]
    if not all(np.isfinite(v) for v in values):
        return -1e6
    return (
        1.0 * dev["sharpe"]
        + 1.7 * val["sharpe"]
        + 2.0 * val["cagr"]
        + 0.8 * dev["cagr"]
        + 1.5 * val["max_drawdown"]
        + 0.5 * dev["max_drawdown"]
        + 0.05 * math.log1p(dev_trades + val_trades)
    )


def main() -> None:
    m.SYMBOLS = SYMBOLS
    data: dict[str, pd.DataFrame] = {}
    coverage = []
    for symbol in SYMBOLS:
        frame, row = m.load_symbol(symbol)
        coverage.append(row)
        if frame.empty:
            continue
        sampled = resample_symbol(frame, symbol)
        if len(sampled.loc[sampled.index < DEV_END]) < 60 * 24 * 4:
            continue
        data[symbol] = sampled
    pd.DataFrame(coverage).to_csv(OUT / "data_coverage.csv", index=False)
    if len(data) < 3:
        raise RuntimeError(f"Insufficient executable universe: {list(data)}")

    rows = []
    stored: dict[str, tuple[pd.Series, pd.DataFrame, pd.DataFrame, Candidate]] = {}
    for number, candidate in enumerate(candidates(), start=1):
        ret, pos, trades = simulate(data, candidate, BASE_COST)
        dev = summarize(ret, m.START, DEV_END)
        val = summarize(ret, DEV_END, VAL_END)
        holdout = summarize(ret, VAL_END, FINAL_END)
        dev_trades = int((trades["entry_time"] < DEV_END).sum()) if not trades.empty else 0
        val_trades = int(((trades["entry_time"] >= DEV_END) & (trades["entry_time"] < VAL_END)).sum()) if not trades.empty else 0
        holdout_trades = int((trades["entry_time"] >= VAL_END).sum()) if not trades.empty else 0
        score = candidate_score(dev, val, dev_trades, val_trades)
        row = {
            **asdict(candidate), "name": candidate.name, "selection_score": score,
            "dev_trades": dev_trades, "validation_trades": val_trades,
            "holdout_trades": holdout_trades,
            **{f"dev_{k}": v for k, v in dev.items()},
            **{f"validation_{k}": v for k, v in val.items()},
            **{f"holdout_{k}": v for k, v in holdout.items()},
        }
        rows.append(row)
        stored[candidate.name] = (ret, pos, trades, candidate)
        if number % 40 == 0:
            print(f"evaluated {number} candidates")
    results = pd.DataFrame(rows).sort_values("selection_score", ascending=False)
    results.to_csv(OUT / "candidate_results.csv", index=False)

    eligible = results[
        (results["dev_total_return"] > 0)
        & (results["validation_total_return"] > 0)
        & (results["dev_max_drawdown"] >= -0.30)
        & (results["validation_max_drawdown"] >= -0.30)
        & (results["dev_trades"] >= 8)
        & (results["validation_trades"] >= 6)
    ]
    preholdout_pass = not eligible.empty
    chosen_row = eligible.iloc[0] if preholdout_pass else results.iloc[0]
    chosen_name = str(chosen_row["name"])
    chosen_ret, chosen_pos, chosen_trades, chosen = stored[chosen_name]

    family_names = []
    for family in ["mean_reversion", "carry_confirmed", "turn_confirmed", "funding_carry"]:
        subset = eligible[eligible["family"] == family]
        if not subset.empty:
            family_names.append(str(subset.iloc[0]["name"]))
    family_names = family_names[:3]
    ensemble_ret = (
        pd.concat([stored[name][0].rename(name) for name in family_names], axis=1).mean(axis=1)
        if family_names else chosen_ret.copy()
    )

    holdout_best = summarize(chosen_ret, VAL_END, FINAL_END)
    holdout_ensemble = summarize(ensemble_ret, VAL_END, FINAL_END)
    selection_summary = pd.DataFrame([
        {"construction": "best_single", "members": chosen_name, **holdout_best},
        {"construction": "family_ensemble", "members": ",".join(family_names), **holdout_ensemble},
    ])
    selection_summary.to_csv(OUT / "final_holdout.csv", index=False)

    sensitivity_rows = []
    for cost_bps in [6, 10, 15]:
        ret, _, trades = simulate(data, chosen, cost_bps / 10000.0)
        metrics = summarize(ret, VAL_END, FINAL_END)
        sensitivity_rows.append({
            "candidate": chosen_name, "cost_bps_per_side_per_venue": cost_bps,
            "holdout_trades": int((trades["entry_time"] >= VAL_END).sum()) if not trades.empty else 0,
            **metrics,
        })
    sensitivity = pd.DataFrame(sensitivity_rows)
    sensitivity.to_csv(OUT / "cost_sensitivity.csv", index=False)

    neighborhood = results[
        (results["family"] == chosen.family)
        & (results["lookback_days"].isin([chosen.lookback_days]))
        & ((results["entry_z"] - chosen.entry_z).abs() <= 0.5)
        & (results["max_hold_hours"].isin(sorted(set([max(4, chosen.max_hold_hours // 2), chosen.max_hold_hours, min(16, chosen.max_hold_hours * 2)]))))
    ]
    neighbor_val_positive = float((neighborhood["validation_total_return"] > 0).mean()) if len(neighborhood) else 0.0
    neighbor_hold_positive = float((neighborhood["holdout_total_return"] > 0).mean()) if len(neighborhood) else 0.0
    neighborhood.to_csv(OUT / "neighborhood.csv", index=False)

    chosen_trades.to_csv(OUT / "chosen_trades.csv", index=False)
    chosen_pos.to_csv(OUT / "chosen_positions.csv")
    pd.DataFrame({"best_single": chosen_ret, "family_ensemble": ensemble_ret}).to_csv(OUT / "equity_returns.csv")

    holdout_symbol = {}
    if not chosen_trades.empty:
        hold = chosen_trades[chosen_trades["entry_time"] >= VAL_END]
        holdout_symbol = hold.groupby("symbol")["net_pnl"].sum().to_dict()
    positive_symbol_profit = sum(max(0.0, value) for value in holdout_symbol.values())
    top_symbol_share = (
        max([max(0.0, value) for value in holdout_symbol.values()] + [0.0]) / positive_symbol_profit
        if positive_symbol_profit > 0 else 1.0
    )
    hold_monthly = (1.0 + chosen_ret.loc[(chosen_ret.index >= VAL_END) & (chosen_ret.index < FINAL_END)]).resample("ME").prod() - 1.0
    positive_month_profit = float(hold_monthly.clip(lower=0).sum())
    top_month_share = float(hold_monthly.clip(lower=0).max() / positive_month_profit) if positive_month_profit > 0 else 1.0

    stress10 = sensitivity[sensitivity["cost_bps_per_side_per_venue"] == 10].iloc[0]
    approval = (
        preholdout_pass
        and holdout_best["cagr"] >= 0.25
        and holdout_best["max_drawdown"] >= -0.25
        and holdout_best["sharpe"] >= 1.20
        and stress10["total_return"] > 0
        and neighbor_val_positive >= 0.60
        and neighbor_hold_positive >= 0.60
        and top_symbol_share <= 0.35
        and top_month_share <= 0.35
        and int(chosen_row["holdout_trades"]) >= 10
    )

    scaled_rows = []
    for scale in [1.0, 1.5, 2.0]:
        scaled_rows.append({"scale": scale, **summarize(chosen_ret * scale, VAL_END, FINAL_END)})
    pd.DataFrame(scaled_rows).to_csv(OUT / "risk_scaling.csv", index=False)

    report = f"""# Trading Committee Basis Research

## Decision

**{'APPROVE FOR FORWARD PAPER TRADING' if approval else 'REJECT FOR DEPLOYMENT'}.**

## Data and process

- Requested universe: {', '.join(SYMBOLS)}
- Executable historical universe: {', '.join(sorted(data))}
- Development: {m.START.date()} to {(DEV_END - pd.Timedelta(days=1)).date()}
- Validation: {DEV_END.date()} to {(VAL_END - pd.Timedelta(days=1)).date()}
- Untouched final holdout: {VAL_END.date()} to {(FINAL_END - pd.Timedelta(days=1)).date()}
- Candidate count: {len(results)}
- Pre-holdout candidates passing basic gates: {len(eligible)}
- Pair gross exposure: 1.0 (0.5 Aster, 0.5 opposite Binance)
- Base cost: 6 bps per side per venue

## Pre-holdout selected model

- Candidate: {chosen_name}
- Family: {chosen.family}
- Lookback: {chosen.lookback_days} days
- Entry threshold: {chosen.entry_z:.2f}
- Exit threshold: {chosen.exit_z:.2f}
- Maximum hold: {chosen.max_hold_hours} hours
- Development total: {chosen_row['dev_total_return'] * 100:.2f}%
- Development Sharpe: {chosen_row['dev_sharpe']:.2f}
- Validation total: {chosen_row['validation_total_return'] * 100:.2f}%
- Validation Sharpe: {chosen_row['validation_sharpe']:.2f}

## Final holdout — best single

- Total return: {holdout_best['total_return'] * 100:.2f}%
- Annualized return: {holdout_best['cagr'] * 100:.2f}%
- Maximum drawdown: {holdout_best['max_drawdown'] * 100:.2f}%
- Sharpe: {holdout_best['sharpe']:.2f}
- Sortino: {holdout_best['sortino']:.2f}
- Best month: {holdout_best['best_month'] * 100:.2f}%
- Worst month: {holdout_best['worst_month'] * 100:.2f}%
- Trades: {int(chosen_row['holdout_trades'])}

## Final holdout — family ensemble

- Members: {', '.join(family_names) if family_names else chosen_name}
- Total return: {holdout_ensemble['total_return'] * 100:.2f}%
- Annualized return: {holdout_ensemble['cagr'] * 100:.2f}%
- Maximum drawdown: {holdout_ensemble['max_drawdown'] * 100:.2f}%
- Sharpe: {holdout_ensemble['sharpe']:.2f}

## Robustness

- Nearby variants positive in validation: {neighbor_val_positive * 100:.1f}%
- Nearby variants positive in holdout: {neighbor_hold_positive * 100:.1f}%
- Holdout return at 10 bps per side per venue: {stress10['total_return'] * 100:.2f}%
- Top profitable symbol share: {top_symbol_share * 100:.1f}%
- Top profitable month share: {top_month_share * 100:.1f}%

## Committee interpretation

This result is approved only when every gate is satisfied. Leverage is never used to rescue a negative or fragile unlevered edge. Liquidation/OI strategies remain forward-only until real-time depth and event histories are collected.
"""
    (OUT / "report.md").write_text(report, encoding="utf-8")
    (OUT / "decision.json").write_text(json.dumps({
        "approved": approval,
        "selected_candidate": chosen_name,
        "preholdout_pass": preholdout_pass,
        "neighbor_validation_positive": neighbor_val_positive,
        "neighbor_holdout_positive": neighbor_hold_positive,
        "top_symbol_share": top_symbol_share,
        "top_month_share": top_month_share,
        "holdout": holdout_best,
    }, indent=2), encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
