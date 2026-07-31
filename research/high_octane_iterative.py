#!/usr/bin/env python3
"""Five-round high-octane crypto strategy research.

Each round is a distinct hypothesis. Selection uses 2021-2022 development and
2023 validation only. 2024-2026H1 is untouched holdout. Later rounds address
failure modes of earlier families, and round 5 uses only lagged pre-existing
sleeve performance for dynamic allocation.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from research import integrated_profit_portfolio as b

OUT = Path("backtest_output_high_octane")
DEV_START = b.START
DEV_END = b.DEV_END
VAL_END = b.VAL_END
FINAL_END = b.FINAL_END


@dataclass
class Trial:
    round_no: int
    family: str
    name: str
    params: dict
    target: pd.DataFrame


def monthly_stats(ret: pd.Series) -> dict:
    monthly = (1.0 + ret).resample("ME").prod() - 1.0
    daily = (1.0 + ret).resample("1D").prod() - 1.0
    return {
        "monthly_mean": float(monthly.mean()),
        "monthly_median": float(monthly.median()),
        "monthly_best": float(monthly.max()),
        "monthly_worst": float(monthly.min()),
        "monthly_positive_ratio": float((monthly > 0).mean()),
        "months_ge_10pct": int((monthly >= 0.10).sum()),
        "months_ge_20pct": int((monthly >= 0.20).sum()),
        "months_ge_50pct": int((monthly >= 0.50).sum()),
        "daily_best": float(daily.max()),
        "daily_worst": float(daily.min()),
        "daily_ge_10pct": int((daily >= 0.10).sum()),
        "monthly_count": int(len(monthly)),
    }


def report_stats(sim: b.Simulation, start: pd.Timestamp, end: pd.Timestamp) -> dict:
    base = b.summarize(sim, start, end)
    ret = b.cut(sim.returns, start, end)
    return {**base, **monthly_stats(ret)}


def bootstrap_risk(ret: pd.Series, n: int = 12000) -> dict:
    monthly = ((1.0 + ret).resample("ME").prod() - 1.0).dropna().to_numpy(float)
    if len(monthly) == 0:
        return {}
    rng = np.random.default_rng(20260716)
    paths = rng.choice(monthly, size=(n, len(monthly)), replace=True)
    eq = np.cumprod(1.0 + paths, axis=1)
    peak = np.maximum.accumulate(eq, axis=1)
    dd = np.min(eq / peak - 1.0, axis=1)
    final = eq[:, -1] - 1.0
    annual = eq[:, -1] ** (12.0 / len(monthly)) - 1.0
    return {
        "bootstrap_p_loss": float((final < 0).mean()),
        "bootstrap_p_dd50": float((dd <= -0.50).mean()),
        "bootstrap_p_dd70": float((dd <= -0.70).mean()),
        "bootstrap_annual_p10": float(np.quantile(annual, 0.10)),
        "bootstrap_annual_p50": float(np.quantile(annual, 0.50)),
        "bootstrap_annual_p90": float(np.quantile(annual, 0.90)),
    }


def selection_score(dev: dict, val: dict) -> float:
    gate = 0.0
    if dev["total_return"] <= 0 or val["total_return"] <= 0:
        gate -= 4.0
    if min(dev["monthly_median"], val["monthly_median"]) <= 0:
        gate -= 1.5
    if min(dev["max_drawdown"], val["max_drawdown"]) < -0.55:
        gate -= 3.0
    return (
        1.10 * min(dev["cagr"], val["cagr"])
        + 0.40 * (dev["cagr"] + val["cagr"])
        + 0.35 * min(dev["monthly_median"], val["monthly_median"]) * 12.0
        + 0.08 * min(dev["monthly_best"], val["monthly_best"])
        + 0.10 * np.nan_to_num(min(dev["sharpe"], val["sharpe"]), nan=-4.0)
        + 0.85 * min(dev["max_drawdown"], val["max_drawdown"])
        - 0.0008 * (dev["annual_turnover"] + val["annual_turnover"])
        + gate
    )


def evaluate_trials(trials: list[Trial], fx: dict, funding: pd.DataFrame):
    rows = []
    sims = {}
    for i, trial in enumerate(trials, start=1):
        sim = b.simulate(fx, trial.target, funding)
        sims[trial.name] = sim
        dev = report_stats(sim, DEV_START, DEV_END)
        val = report_stats(sim, DEV_END, VAL_END)
        rows.append({
            "round": trial.round_no, "family": trial.family, "name": trial.name,
            "params": json.dumps(trial.params, sort_keys=True),
            **{f"dev_{k}": v for k, v in dev.items()},
            **{f"val_{k}": v for k, v in val.items()},
            "selection_score": selection_score(dev, val),
        })
        if i % 25 == 0:
            print(f"Round {trial.round_no}: evaluated {i}/{len(trials)}")
    ranking = pd.DataFrame(rows).sort_values(["selection_score", "val_cagr"], ascending=False)
    best_name = str(ranking.iloc[0]["name"])
    best = next(t for t in trials if t.name == best_name)
    sim = sims[best_name]
    hold = report_stats(sim, VAL_END, FINAL_END)
    stress10 = report_stats(b.simulate(fx, best.target, funding, one_way_cost=0.0010, funding_multiplier=1.5), VAL_END, FINAL_END)
    delay = report_stats(b.simulate(fx, best.target, funding, delay_bars=2), VAL_END, FINAL_END)
    risk = bootstrap_risk(b.cut(sim.returns, VAL_END, FINAL_END))
    return ranking, best, sim, {"holdout": hold, "stress_10bps_funding_1p5x": stress10, "delay_8h": delay, "bootstrap": risk}


def scale_target(raw: pd.DataFrame, fx: dict, target_vol: float, max_gross: float, multiplier: float):
    return b.risk_scale_target(raw * multiplier, fx, target_vol, max_gross)


def round1_trials(fx: dict) -> list[Trial]:
    trend_specs = [b.TrendSpec("R1T1", (7, 21, 63), 0.10), b.TrendSpec("R1T2", (14, 42, 126), 0.12), b.TrendSpec("R1T3", (21, 63, 189), 0.15)]
    event_specs = [b.EventSpec("R1E1", 1.5, 0.5, 6), b.EventSpec("R1E2", 2.0, 0.75, 12), b.EventSpec("R1E3", 2.5, 1.0, 18)]
    trends = {s.name: b.trend_target(fx, s) for s in trend_specs}
    events = {s.name: b.event_target(fx, s) for s in event_specs}
    out = []
    n = 1
    for ts in trend_specs:
        for es in event_specs:
            for event_weight in [0.25, 0.40, 0.55]:
                for vol in [0.55, 0.75, 0.95]:
                    raw = (1.0 - event_weight) * trends[ts.name] + event_weight * events[es.name]
                    target = scale_target(raw, fx, vol, 3.0, 1.8)
                    out.append(Trial(1, "concentrated_trend_breakout", f"R1_{n:03d}", {"trend": ts.name, "event": es.name, "event_weight": event_weight, "target_vol": vol, "max_gross": 3.0}, target))
                    n += 1
    return out


def squeeze_target(fx: dict, lookback_days: int, squeeze_q: float, volume_z: float, hold_bars: int, mode: str):
    close, high, low, rv = fx["close"], fx["high"], fx["low"], fx["rv21"]
    short_rv = np.log(close).diff().rolling(3 * 6, min_periods=12).std()
    q = short_rv.rolling(90 * 6, min_periods=45 * 6).quantile(squeeze_q)
    squeezed = short_rv <= q
    prev_high = high.rolling(lookback_days * 6, min_periods=max(30, lookback_days * 3)).max().shift(1)
    prev_low = low.rolling(lookback_days * 6, min_periods=max(30, lookback_days * 3)).min().shift(1)
    up = squeezed.shift(1).fillna(False) & (close > prev_high) & (fx["volume_z"] >= volume_z)
    dn = squeezed.shift(1).fillna(False) & (close < prev_low) & (fx["volume_z"] >= volume_z)
    if mode == "regime":
        up = up.mul(fx["regime"].eq("bull"), axis=0)
        dn = dn.mul(fx["regime"].eq("bear"), axis=0)
    active = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    for j in range(len(close.columns)):
        cooldown = 0
        for i in range(200, len(close) - hold_bars - 2):
            if cooldown:
                cooldown -= 1
                continue
            if not fx["available"].iat[i, j]:
                continue
            direction = 1.0 if bool(up.iat[i, j]) else (-1.0 if bool(dn.iat[i, j]) else 0.0)
            if direction:
                active.iloc[i:i + hold_bars, j] = direction
                cooldown = hold_bars
    target = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    strength = fx["volume_z"].fillna(0.0) + fx["range_z"].fillna(0.0)
    for i in range(len(close)):
        names = list(active.columns[active.iloc[i] != 0])
        if not names:
            continue
        names = list(strength.iloc[i][names].sort_values(ascending=False).head(2).index)
        raw = active.iloc[i][names] / rv.iloc[i][names].clip(lower=0.18)
        if raw.abs().sum() > 0:
            raw = raw / raw.abs().sum()
        target.loc[target.index[i], names] = raw
    return target


def round2_trials(fx: dict) -> list[Trial]:
    out = []
    n = 1
    for lookback in [10, 20, 40]:
        for q in [0.15, 0.25]:
            for vz in [1.0, 1.75]:
                for hold in [6, 12, 24]:
                    for mode in ["all", "regime"]:
                        raw = squeeze_target(fx, lookback, q, vz, hold, mode)
                        for vol in [0.60, 0.90]:
                            target = scale_target(raw, fx, vol, 3.0, 2.2)
                            out.append(Trial(2, "volatility_squeeze_release", f"R2_{n:03d}", {"lookback_days": lookback, "squeeze_q": q, "volume_z": vz, "hold_bars": hold, "mode": mode, "target_vol": vol}, target))
                            n += 1
    return out


def round3_trials(fx: dict) -> list[Trial]:
    out = []
    n = 1
    for horizons in [(3, 10, 30), (7, 21, 63), (14, 42, 84), (21, 63, 126)]:
        for k in [1, 2]:
            for rebalance in [1, 3, 7]:
                for bull_short in [0.0, 0.25]:
                    spec = b.CrossSpec(f"R3C{n}", horizons, k, k, rebalance, bull_short)
                    raw = b.cross_target(fx, spec)
                    for vol in [0.60, 0.90]:
                        target = scale_target(raw, fx, vol, 3.0, 2.0)
                        out.append(Trial(3, "concentrated_relative_momentum", f"R3_{n:03d}_{int(vol*100)}", {"horizons": horizons, "k": k, "rebalance_days": rebalance, "bull_short": bull_short, "target_vol": vol}, target))
                    n += 1
    return out


def shock_target(fx: dict, ret_z: float, funding_z: float, hold_bars: int, mode: str, require_volume: bool):
    close = fx["close"]
    r = np.log(close).diff()
    mu = r.rolling(30 * 6, min_periods=15 * 6).mean()
    sd = r.rolling(30 * 6, min_periods=15 * 6).std()
    z = (r - mu) / sd.replace(0, np.nan)
    extreme_up = z >= ret_z
    extreme_dn = z <= -ret_z
    crowded_long = fx["funding_z"] >= funding_z
    crowded_short = fx["funding_z"] <= -funding_z
    if mode == "reversal":
        long_sig = extreme_dn & crowded_short
        short_sig = extreme_up & crowded_long
    elif mode == "continuation":
        long_sig = extreme_up & ~crowded_long
        short_sig = extreme_dn & ~crowded_short
    else:
        long_sig = extreme_up & crowded_short
        short_sig = extreme_dn & crowded_long
    if require_volume:
        long_sig &= fx["volume_z"] >= 1.0
        short_sig &= fx["volume_z"] >= 1.0
    active = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    for j in range(len(close.columns)):
        cooldown = 0
        for i in range(200, len(close) - hold_bars - 2):
            if cooldown:
                cooldown -= 1
                continue
            if not fx["available"].iat[i, j]:
                continue
            direction = 1.0 if bool(long_sig.iat[i, j]) else (-1.0 if bool(short_sig.iat[i, j]) else 0.0)
            if direction:
                active.iloc[i:i + hold_bars, j] = direction
                cooldown = hold_bars
    target = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    for i in range(len(close)):
        names = list(active.columns[active.iloc[i] != 0])
        if not names:
            continue
        names = list(z.iloc[i][names].abs().sort_values(ascending=False).head(2).index)
        raw = active.iloc[i][names] / fx["rv21"].iloc[i][names].clip(lower=0.18)
        if raw.abs().sum() > 0:
            raw = raw / raw.abs().sum()
        target.loc[target.index[i], names] = raw
    return target


def round4_trials(fx: dict) -> list[Trial]:
    out = []
    n = 1
    for rz in [2.0, 3.0, 4.0]:
        for fz in [1.0, 2.0]:
            for hold in [3, 6, 12, 24]:
                for mode in ["reversal", "continuation", "squeeze"]:
                    for require_volume in [False, True]:
                        raw = shock_target(fx, rz, fz, hold, mode, require_volume)
                        for vol in [0.60, 0.90]:
                            target = scale_target(raw, fx, vol, 3.0, 2.2)
                            out.append(Trial(4, "funding_shock_event", f"R4_{n:03d}_{int(vol*100)}", {"return_z": rz, "funding_z": fz, "hold_bars": hold, "mode": mode, "require_volume": require_volume, "target_vol": vol}, target))
                        n += 1
    return out


def meta_target(sleeve_targets: dict[str, pd.DataFrame], sleeve_returns: pd.DataFrame, lookback_days: int, top_k: int, rebalance_days: int, fx: dict, target_vol: float, max_gross: float):
    index = next(iter(sleeve_targets.values())).index
    score = sleeve_returns.rolling(lookback_days * 6, min_periods=max(12, lookback_days * 3)).mean()
    vol = sleeve_returns.rolling(lookback_days * 6, min_periods=max(12, lookback_days * 3)).std()
    score = score / vol.replace(0, np.nan)
    raw = pd.DataFrame(0.0, index=index, columns=next(iter(sleeve_targets.values())).columns)
    reb = rebalance_days * 6
    chosen = []
    for i in range(len(index)):
        if i % reb == 0:
            row = score.iloc[i].dropna().sort_values(ascending=False)
            chosen = list(row.head(top_k).index) if len(row) else []
        if chosen:
            raw.iloc[i] = sum(sleeve_targets[n].iloc[i] for n in chosen) / len(chosen)
    return scale_target(raw, fx, target_vol, max_gross, 1.8)


def round5_trials(fx: dict, funding: pd.DataFrame, best_targets: dict[str, pd.DataFrame]) -> list[Trial]:
    sleeve_returns = {name: b.simulate(fx, target, funding, risk_scale=0.75).returns for name, target in best_targets.items()}
    sleeve_returns = pd.DataFrame(sleeve_returns)
    out = []
    n = 1
    for lookback in [30, 60, 120]:
        for top_k in [1, 2, 3]:
            for reb in [3, 7, 14]:
                for vol in [0.60, 0.90]:
                    for gross in [2.0, 3.0]:
                        target = meta_target(best_targets, sleeve_returns, lookback, top_k, reb, fx, vol, gross)
                        out.append(Trial(5, "adaptive_meta_allocator", f"R5_{n:03d}", {"lookback_days": lookback, "top_k": top_k, "rebalance_days": reb, "target_vol": vol, "max_gross": gross}, target))
                        n += 1
    return out


def acceptance(diag: dict):
    h = diag["holdout"]
    s = diag["stress_10bps_funding_1p5x"]
    d = diag["delay_8h"]
    br = diag["bootstrap"]
    checks = {
        "holdout_cagr_ge_50pct": h["cagr"] >= 0.50,
        "median_month_ge_3pct": h["monthly_median"] >= 0.03,
        "positive_months_ge_55pct": h["monthly_positive_ratio"] >= 0.55,
        "max_dd_better_than_45pct": h["max_drawdown"] >= -0.45,
        "sharpe_ge_1": h["sharpe"] >= 1.0,
        "stress_cagr_ge_25pct": s["cagr"] >= 0.25,
        "delay_cagr_positive": d["cagr"] > 0.0,
        "bootstrap_p_dd70_lt_5pct": br.get("bootstrap_p_dd70", 1.0) < 0.05,
    }
    return all(checks.values()), [k for k, v in checks.items() if not v]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    b.base.SYMBOLS = b.UNIVERSE
    b.base.START_MONTH = b.START_MONTH
    b.base.END_MONTH = b.END_MONTH
    b.base.CACHE_DIR = b.PRICE_CACHE
    data = b.base.load_universe()
    panel = b.build_panel(data)
    index = panel["close"].index
    index = index[(index >= DEV_START) & (index < FINAL_END)]
    for key in panel:
        panel[key] = panel[key].loc[index]
    symbols = list(panel["close"].columns)
    funding_event, funding_latest, funding_coverage = b.load_funding(index, symbols)
    fx = b.build_features(panel, funding_latest)

    round_rows = []
    best_targets = {}
    reflections = []
    builders: list[Callable] = [round1_trials, round2_trials, round3_trials, round4_trials]
    for round_no, builder in enumerate(builders, start=1):
        print(f"=== ROUND {round_no} ===")
        ranking, best, sim, diag = evaluate_trials(builder(fx), fx, funding_event)
        accepted, failed = acceptance(diag)
        best_targets[f"round_{round_no}"] = best.target
        ranking.to_csv(OUT / f"round_{round_no}_ranking.csv", index=False)
        reason = "accepted" if accepted else "Rejected: " + ", ".join(failed) + ". Next round changes the source of edge rather than retuning this family."
        reflections.append({"round": round_no, "family": best.family, "best": best.name, "reflection": reason})
        round_rows.append({"round": round_no, "family": best.family, "best": best.name, "params": json.dumps(best.params, sort_keys=True), **{f"holdout_{k}": v for k, v in diag["holdout"].items()}, **{f"stress_{k}": v for k, v in diag["stress_10bps_funding_1p5x"].items()}, **{f"delay_{k}": v for k, v in diag["delay_8h"].items()}, **diag["bootstrap"], "accepted": accepted, "failed_checks": ";".join(failed)})

    print("=== ROUND 5 ===")
    ranking, best, sim, diag = evaluate_trials(round5_trials(fx, funding_event, best_targets), fx, funding_event)
    accepted, failed = acceptance(diag)
    ranking.to_csv(OUT / "round_5_ranking.csv", index=False)
    reflections.append({"round": 5, "family": best.family, "best": best.name, "reflection": "accepted" if accepted else "Rejected: " + ", ".join(failed) + ". Five-round search did not establish a durable 50% CAGR strategy."})
    round_rows.append({"round": 5, "family": best.family, "best": best.name, "params": json.dumps(best.params, sort_keys=True), **{f"holdout_{k}": v for k, v in diag["holdout"].items()}, **{f"stress_{k}": v for k, v in diag["stress_10bps_funding_1p5x"].items()}, **{f"delay_{k}": v for k, v in diag["delay_8h"].items()}, **diag["bootstrap"], "accepted": accepted, "failed_checks": ";".join(failed)})

    pd.DataFrame(round_rows).to_csv(OUT / "five_round_summary.csv", index=False)
    pd.DataFrame(reflections).to_csv(OUT / "five_round_reflections.csv", index=False)
    sim.returns.rename("strategy_return").to_csv(OUT / "round5_returns.csv")
    sim.positions.to_csv(OUT / "round5_positions.csv")
    with open(OUT / "funding_coverage.json", "w") as f:
        json.dump(funding_coverage, f, indent=2)

    lines = ["# Five-Round High-Octane Strategy Research", "", "Selection: 2021-2022 development + 2023 validation. Holdout: 2024-2026H1.", "Actual settled funding, next-4H-open execution, cost and delay stress included.", "", "## Acceptance gates", "CAGR >= 50%, median month >= 3%, positive months >= 55%, max DD >= -45%, Sharpe >= 1,", "10bps/funding stress CAGR >= 25%, 8h-delay positive, bootstrap P(DD <= -70%) < 5%.", "", "## Results", "| Round | Family | CAGR | Median month | Best month | Max DD | Sharpe | 10bps stress CAGR | Accepted |", "|---:|---|---:|---:|---:|---:|---:|---:|---|"]
    for row in round_rows:
        lines.append(f"| {row['round']} | {row['family']} | {row['holdout_cagr']:.2%} | {row['holdout_monthly_median']:.2%} | {row['holdout_monthly_best']:.2%} | {row['holdout_max_drawdown']:.2%} | {row['holdout_sharpe']:.2f} | {row['stress_cagr']:.2%} | {row['accepted']} |")
    lines += ["", "## Reflections"]
    for r in reflections:
        lines.append(f"- Round {r['round']} ({r['family']}): {r['reflection']}")
    lines += ["", "## Final verdict", "APPROVE FOR PAPER TEST ONLY" if any(r["accepted"] for r in round_rows) else "REJECT FOR DEPLOYMENT", "", "A high best month is not treated as a durable monthly return. No leverage rescue is allowed after holdout inspection."]
    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
