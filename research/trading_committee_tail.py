#!/usr/bin/env python3
"""Second-round committee test: low-turnover tail basis events.

The first committee screen showed that ordinary convergence and carry signals did
not overcome two-venue costs. This test enters only when both the mark-premium
z-score and the executable contract-price gap are large, then waits for a
meaningful fraction of the gap to close.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import math

import numpy as np
import pandas as pd

from research import aster_binance_microstructure as m
from research import trading_committee_basis as base

OUT = Path("backtest_output_trading_committee_tail")
OUT.mkdir(parents=True, exist_ok=True)
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "LINKUSDT", "PENGUUSDT"]
DEV_END = pd.Timestamp("2025-07-01", tz="UTC")
VAL_END = pd.Timestamp("2026-01-01", tz="UTC")
FINAL_END = pd.Timestamp("2026-07-01", tz="UTC")
BASE_COST = 0.0006
ANNUAL_BARS = 365.25 * 24 * 4


@dataclass(frozen=True)
class TailCandidate:
    family: str
    lookback_days: int
    entry_z: float
    min_gap_bps: float
    max_hold_hours: int
    remaining_fraction: float = 0.40

    @property
    def name(self) -> str:
        return f"{self.family}_l{self.lookback_days}_z{self.entry_z:g}_g{self.min_gap_bps:g}_h{self.max_hold_hours}"


def summarize(ret: pd.Series, start: pd.Timestamp, end: pd.Timestamp) -> dict:
    return base.summarize(ret, start, end)


def prepare(df: pd.DataFrame, candidate: TailCandidate) -> pd.DataFrame:
    out = df.copy()
    out["premium_z"] = base.rolling_z(out["premium_bps"], candidate.lookback_days)
    out["contract_gap_bps"] = 1e4 * np.log(out["a_close"] / out["b_close"])
    out["turn_1h"] = out["premium_z"].diff(4)
    direction = -np.sign(out["premium_z"])
    aligned_gap = np.sign(out["contract_gap_bps"]) == np.sign(out["premium_z"])
    eligible = (
        (out["premium_z"].abs() >= candidate.entry_z)
        & (out["contract_gap_bps"].abs() >= candidate.min_gap_bps)
        & aligned_gap
    )
    if candidate.family == "tail_turn":
        eligible &= (np.sign(out["turn_1h"]) == -np.sign(out["premium_z"])) & (out["turn_1h"].abs() >= 0.15)
    elif candidate.family == "tail_carry":
        eligible &= direction * out["funding_edge_long_aster"] > 0
    elif candidate.family == "tail_turn_carry":
        eligible &= (
            (np.sign(out["turn_1h"]) == -np.sign(out["premium_z"]))
            & (out["turn_1h"].abs() >= 0.15)
            & (direction * out["funding_edge_long_aster"] > 0)
        )
    elif candidate.family != "tail_mean_reversion":
        raise ValueError(candidate.family)
    out["direction"] = direction.where(eligible, 0.0)
    out["opportunity"] = (out["premium_z"].abs() * out["contract_gap_bps"].abs()).where(eligible, 0.0)
    return out.replace([np.inf, -np.inf], np.nan)


def candidates() -> list[TailCandidate]:
    out = []
    for family in ["tail_mean_reversion", "tail_turn", "tail_carry", "tail_turn_carry"]:
        for lookback in [14, 30]:
            for z in [3.0, 4.0, 5.0]:
                for gap in [20.0, 40.0, 80.0]:
                    for hold in [24, 48]:
                        out.append(TailCandidate(family, lookback, z, gap, hold))
    return out


def build_positions(data: dict[str, pd.DataFrame], candidate: TailCandidate) -> tuple[pd.DataFrame, list[dict]]:
    prepared = {symbol: prepare(frame, candidate) for symbol, frame in data.items()}
    common = sorted(set.intersection(*(set(frame.index) for frame in prepared.values())))
    index = pd.DatetimeIndex(common)
    aligned = {symbol: frame.reindex(index) for symbol, frame in prepared.items()}
    gates = {symbol: base.liquidity_gate(frame, symbol) for symbol, frame in aligned.items()}
    positions = pd.DataFrame(0.0, index=index, columns=sorted(aligned))
    trades = []
    max_bars = candidate.max_hold_hours * 4
    i = 0
    while i < len(index) - max_bars - 3:
        opportunities = []
        for symbol, frame in aligned.items():
            value = float(frame["opportunity"].iat[i]) if pd.notna(frame["opportunity"].iat[i]) else 0.0
            direction = float(frame["direction"].iat[i]) if pd.notna(frame["direction"].iat[i]) else 0.0
            if gates[symbol].iat[i] and direction != 0 and value > 0:
                opportunities.append((value, symbol, direction))
        if not opportunities:
            i += 1
            continue
        _, symbol, direction = max(opportunities)
        frame = aligned[symbol]
        entry = i + 1
        if not gates[symbol].iat[entry]:
            i += 1
            continue
        entry_gap = 1e4 * math.log(float(frame["a_open"].iat[entry]) / float(frame["b_open"].iat[entry]))
        if np.sign(entry_gap) != -np.sign(direction) or abs(entry_gap) < candidate.min_gap_bps * 0.75:
            i += 1
            continue
        exit_index = min(entry + max_bars, len(index) - 2)
        reason = "time"
        target_abs = abs(entry_gap) * candidate.remaining_fraction
        stop_distance = max(20.0, abs(entry_gap) * 0.60)
        for j in range(entry + 1, exit_index + 1):
            gap_now = 1e4 * math.log(float(frame["a_close"].iat[j]) / float(frame["b_close"].iat[j]))
            favorable = direction * (gap_now - entry_gap)
            if abs(gap_now) <= target_abs or np.sign(gap_now) != np.sign(entry_gap):
                exit_index, reason = j, "gap_capture"
                break
            if favorable <= -stop_distance:
                exit_index, reason = j, "gap_stop"
                break
        holding_gate = gates[symbol].iloc[entry:exit_index + 1]
        minimum_ratio = 0.95 if symbol == "PENGUUSDT" else 0.70
        if len(holding_gate) == 0 or float(holding_gate.mean()) < minimum_ratio:
            i += 1
            continue
        positions.loc[index[entry:exit_index], symbol] = 0.5 * direction
        trades.append({
            "candidate": candidate.name,
            "symbol": symbol,
            "signal_time": index[i],
            "entry_time": index[entry],
            "exit_time": index[exit_index],
            "direction_aster": direction,
            "entry_gap_bps": entry_gap,
            "exit_reason": reason,
        })
        i = exit_index + 1
    return positions, trades


def simulate(data: dict[str, pd.DataFrame], candidate: TailCandidate, cost: float) -> tuple[pd.Series, pd.DataFrame, pd.DataFrame]:
    positions, records = build_positions(data, candidate)
    symbol_returns = pd.DataFrame(0.0, index=positions.index, columns=positions.columns)
    for symbol in positions.columns:
        frame = data[symbol].reindex(positions.index)
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
        symbol_returns[symbol] = p_a * a_ret + p_b * b_ret + funding - cost * turnover
    ret = symbol_returns.sum(axis=1)
    trades = pd.DataFrame(records)
    if not trades.empty:
        trades["entry_time"] = pd.to_datetime(trades["entry_time"], utc=True)
        trades["exit_time"] = pd.to_datetime(trades["exit_time"], utc=True)
        trades["net_pnl"] = [
            float(symbol_returns.loc[row.entry_time:row.exit_time, row.symbol].sum())
            for row in trades.itertuples()
        ]
    return ret, positions, trades


def score(dev: dict, val: dict, dt: int, vt: int) -> float:
    if dt < 4 or vt < 4 or not np.isfinite(dev["sharpe"]) or not np.isfinite(val["sharpe"]):
        return -1e6
    return dev["sharpe"] + 1.8 * val["sharpe"] + 2.0 * val["cagr"] + val["max_drawdown"] + 0.05 * math.log1p(dt + vt)


def main() -> None:
    m.SYMBOLS = SYMBOLS
    data = {}
    coverage = []
    for symbol in SYMBOLS:
        raw, row = m.load_symbol(symbol)
        coverage.append(row)
        if raw.empty:
            continue
        sampled = base.resample_symbol(raw, symbol)
        if len(sampled.loc[sampled.index < DEV_END]) >= 60 * 24 * 4:
            data[symbol] = sampled
    pd.DataFrame(coverage).to_csv(OUT / "data_coverage.csv", index=False)
    if len(data) < 3:
        raise RuntimeError(f"insufficient universe: {list(data)}")

    rows = []
    stored = {}
    for n, candidate in enumerate(candidates(), 1):
        ret, pos, trades = simulate(data, candidate, BASE_COST)
        dev = summarize(ret, m.START, DEV_END)
        val = summarize(ret, DEV_END, VAL_END)
        hold = summarize(ret, VAL_END, FINAL_END)
        dt = int((trades["entry_time"] < DEV_END).sum()) if not trades.empty else 0
        vt = int(((trades["entry_time"] >= DEV_END) & (trades["entry_time"] < VAL_END)).sum()) if not trades.empty else 0
        ht = int((trades["entry_time"] >= VAL_END).sum()) if not trades.empty else 0
        rows.append({
            **asdict(candidate), "name": candidate.name, "selection_score": score(dev, val, dt, vt),
            "dev_trades": dt, "validation_trades": vt, "holdout_trades": ht,
            **{f"dev_{k}": v for k, v in dev.items()},
            **{f"validation_{k}": v for k, v in val.items()},
            **{f"holdout_{k}": v for k, v in hold.items()},
        })
        stored[candidate.name] = (ret, pos, trades, candidate)
        if n % 40 == 0:
            print(f"evaluated {n} tail candidates")
    results = pd.DataFrame(rows).sort_values("selection_score", ascending=False)
    results.to_csv(OUT / "candidate_results.csv", index=False)
    eligible = results[
        (results["dev_total_return"] > 0)
        & (results["validation_total_return"] > 0)
        & (results["dev_trades"] >= 4)
        & (results["validation_trades"] >= 4)
        & (results["dev_max_drawdown"] >= -0.25)
        & (results["validation_max_drawdown"] >= -0.25)
    ]
    preholdout = not eligible.empty
    chosen_row = eligible.iloc[0] if preholdout else results.iloc[0]
    name = str(chosen_row["name"])
    ret, pos, trades, chosen = stored[name]

    sensitivity = []
    for bps in [0, 6, 10, 15]:
        r, _, t = simulate(data, chosen, bps / 10000.0)
        sensitivity.append({
            "cost_bps_per_side_per_venue": bps,
            "holdout_trades": int((t["entry_time"] >= VAL_END).sum()) if not t.empty else 0,
            **summarize(r, VAL_END, FINAL_END),
        })
    sensitivity = pd.DataFrame(sensitivity)
    sensitivity.to_csv(OUT / "cost_sensitivity.csv", index=False)

    neighborhood = results[
        (results["family"] == chosen.family)
        & (results["lookback_days"] == chosen.lookback_days)
        & ((results["entry_z"] - chosen.entry_z).abs() <= 1.0)
        & (results["min_gap_bps"].isin([20.0, 40.0, 80.0]))
    ]
    neighbor_val = float((neighborhood["validation_total_return"] > 0).mean()) if len(neighborhood) else 0.0
    neighbor_hold = float((neighborhood["holdout_total_return"] > 0).mean()) if len(neighborhood) else 0.0
    neighborhood.to_csv(OUT / "neighborhood.csv", index=False)
    trades.to_csv(OUT / "chosen_trades.csv", index=False)
    pos.to_csv(OUT / "chosen_positions.csv")
    pd.DataFrame({"return": ret}).to_csv(OUT / "returns.csv")

    hold = summarize(ret, VAL_END, FINAL_END)
    stress = sensitivity[sensitivity["cost_bps_per_side_per_venue"] == 10].iloc[0]
    hold_trades = trades[trades["entry_time"] >= VAL_END] if not trades.empty else pd.DataFrame()
    by_symbol = hold_trades.groupby("symbol")["net_pnl"].sum() if not hold_trades.empty else pd.Series(dtype=float)
    positive = by_symbol.clip(lower=0)
    top_symbol = float(positive.max() / positive.sum()) if positive.sum() > 0 else 1.0
    monthly = (1 + ret.loc[(ret.index >= VAL_END) & (ret.index < FINAL_END)]).resample("ME").prod() - 1
    pos_month = monthly.clip(lower=0)
    top_month = float(pos_month.max() / pos_month.sum()) if pos_month.sum() > 0 else 1.0
    approved = (
        preholdout
        and hold["cagr"] >= 0.25
        and hold["max_drawdown"] >= -0.25
        and hold["sharpe"] >= 1.20
        and stress["total_return"] > 0
        and neighbor_val >= 0.60
        and neighbor_hold >= 0.60
        and top_symbol <= 0.35
        and top_month <= 0.35
        and int(chosen_row["holdout_trades"]) >= 6
    )

    report = f"""# Trading Committee Tail-Basis Research

## Decision

**{'APPROVE FOR FORWARD PAPER TRADING' if approved else 'REJECT FOR DEPLOYMENT'}.**

- Executable universe: {', '.join(sorted(data))}
- Candidate count: {len(results)}
- Pre-holdout candidates passing: {len(eligible)}
- Selected candidate: {name}
- Development return: {chosen_row['dev_total_return'] * 100:.2f}%
- Validation return: {chosen_row['validation_total_return'] * 100:.2f}%
- Final holdout return: {hold['total_return'] * 100:.2f}%
- Final holdout annualized: {hold['cagr'] * 100:.2f}%
- Final holdout drawdown: {hold['max_drawdown'] * 100:.2f}%
- Final holdout Sharpe: {hold['sharpe']:.2f}
- Final holdout trades: {int(chosen_row['holdout_trades'])}
- Zero-cost holdout return: {sensitivity.iloc[0]['total_return'] * 100:.2f}%
- 10 bps stress holdout return: {stress['total_return'] * 100:.2f}%
- Nearby variants positive in validation: {neighbor_val * 100:.1f}%
- Nearby variants positive in holdout: {neighbor_hold * 100:.1f}%
- Top profitable symbol share: {top_symbol * 100:.1f}%
- Top profitable month share: {top_month * 100:.1f}%

The tail screen tests whether fewer, wider dislocations can overcome the cost failure found in the ordinary basis screen. Leverage is not considered unless the unlevered strategy passes every gate.
"""
    (OUT / "report.md").write_text(report, encoding="utf-8")
    (OUT / "decision.json").write_text(json.dumps({
        "approved": approved, "selected": name, "preholdout_pass": preholdout,
        "holdout": hold, "neighbor_validation_positive": neighbor_val,
        "neighbor_holdout_positive": neighbor_hold, "top_symbol_share": top_symbol,
        "top_month_share": top_month,
    }, indent=2), encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
