#!/usr/bin/env python3
"""PENGU adaptive 72-hour reversal swing robot v2.

Research-only. At the start of each calendar month, choose one rule from a
small predeclared grid using only the preceding 180 days. Trade PENGU for a
maximum of 72 hours after an extreme 24-hour move and a one-hour reversal bar.

This is deliberately separate from the rejected cross-venue stale-price/basis
strategy. Real and paper trading remain disabled unless all evidence gates pass.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from run_pengu_swing_research import download_klines


@dataclass(frozen=True)
class Rule:
    long_drop: float
    long_rsi: int
    short_rally: float
    short_rsi: int
    hard_stop: float


@dataclass
class Trade:
    entry_time: str
    exit_time: str
    side: int
    entry_price: float
    exit_price: float
    gross_return: float
    net_return: float
    hold_hours: int
    exit_reason: str
    selection_month: str
    rule: dict[str, Any]


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    previous_close = df["close"].shift(1)
    true_range = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - previous_close).abs(),
            (df["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def build_features(data: pd.DataFrame) -> pd.DataFrame:
    out = data.copy()
    out["ret24"] = out["close"].pct_change(24)
    out["ret14d"] = out["close"].pct_change(24 * 14)
    out["rsi14"] = rsi(out["close"], 14)
    out["atr_pct"] = atr(out, 14) / out["close"]
    volume_median = out["quote_volume"].rolling(24, min_periods=12).median()
    out["volume_ratio"] = out["quote_volume"] / volume_median.replace(0, np.nan)
    out["bar_up"] = out["close"] > out["open"]
    out["bar_down"] = out["close"] < out["open"]
    return out


def rule_grid() -> list[Rule]:
    return [
        Rule(long_drop, long_rsi, short_rally, short_rsi, hard_stop)
        for long_drop in (0.08, 0.10, 0.12, 0.15)
        for long_rsi in (30, 35, 40)
        for short_rally in (0.05, 0.08, 0.10, 0.12)
        for short_rsi in (55, 60, 65)
        for hard_stop in (0.10, 0.15)
    ]


def backtest_range(
    features: pd.DataFrame,
    rule: Rule,
    start: pd.Timestamp,
    end: pd.Timestamp,
    selection_month: str,
    cost_per_side: float,
    funding_reserve_per_day: float,
) -> list[Trade]:
    sample = features.loc[start:end]
    if sample.empty:
        return []

    index = sample.index
    values = {column: sample[column].to_numpy() for column in sample.columns}
    trades: list[Trade] = []
    maximum_hold = 72
    i = 0

    while i < len(sample) - maximum_hold - 1:
        side = 0
        regime = values["ret14d"][i]
        valid_market = (
            np.isfinite(regime)
            and values["atr_pct"][i] >= 0.01
            and values["volume_ratio"][i] >= 0.50
        )
        if valid_market:
            if regime >= 0:
                if (
                    values["ret24"][i] <= -rule.long_drop
                    and values["rsi14"][i] <= rule.long_rsi
                    and bool(values["bar_up"][i])
                ):
                    side = 1
            else:
                if (
                    values["ret24"][i] >= rule.short_rally
                    and values["rsi14"][i] >= rule.short_rsi
                    and bool(values["bar_down"][i])
                ):
                    side = -1

        if side == 0:
            i += 1
            continue

        entry_i = i + 1
        entry_price = float(values["open"][entry_i])
        exit_i = entry_i + maximum_hold - 1
        exit_price = float(values["close"][exit_i])
        reason = "72h_time"

        stop_price = entry_price * (
            1 - rule.hard_stop if side == 1 else 1 + rule.hard_stop
        )
        if side == 1:
            hits = np.flatnonzero(values["low"][entry_i : exit_i + 1] <= stop_price)
        else:
            hits = np.flatnonzero(values["high"][entry_i : exit_i + 1] >= stop_price)
        if len(hits):
            exit_i = entry_i + int(hits[0])
            exit_price = stop_price
            reason = "hard_stop"

        hold_hours = exit_i - entry_i + 1
        gross_return = side * (exit_price / entry_price - 1.0)
        net_return = (
            gross_return
            - 2 * cost_per_side
            - funding_reserve_per_day * hold_hours / 24
        )
        trades.append(
            Trade(
                entry_time=str(index[entry_i]),
                exit_time=str(index[exit_i]),
                side=side,
                entry_price=entry_price,
                exit_price=float(exit_price),
                gross_return=float(gross_return),
                net_return=float(net_return),
                hold_hours=int(hold_hours),
                exit_reason=reason,
                selection_month=selection_month,
                rule=asdict(rule),
            )
        )
        i = exit_i + 1

    return trades


def trade_metrics(trades: list[Trade], scale: float = 1.0) -> dict[str, float | int]:
    if not trades:
        return {
            "trades": 0,
            "total_return": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy": 0.0,
            "max_drawdown": 0.0,
            "average_hold_hours": 0.0,
            "average_win": 0.0,
            "average_loss": 0.0,
            "best_trade": 0.0,
            "worst_trade": 0.0,
        }

    returns = np.asarray([trade.net_return * scale for trade in trades], dtype=float)
    equity = np.cumprod(1 + returns)
    drawdown = equity / np.maximum.accumulate(equity) - 1
    winners = returns[returns > 0]
    losers = returns[returns <= 0]
    negative_sum = float(losers.sum())
    return {
        "trades": int(len(trades)),
        "total_return": float(equity[-1] - 1),
        "win_rate": float((returns > 0).mean()),
        "profit_factor": float(winners.sum() / -negative_sum) if negative_sum < 0 else 999.0,
        "expectancy": float(returns.mean()),
        "max_drawdown": float(drawdown.min()),
        "average_hold_hours": float(np.mean([trade.hold_hours for trade in trades])),
        "average_win": float(winners.mean()) if len(winners) else 0.0,
        "average_loss": float(losers.mean()) if len(losers) else 0.0,
        "best_trade": float(returns.max()),
        "worst_trade": float(returns.min()),
    }


def wilson_lower_bound(wins: int, observations: int, z: float = 1.0) -> float:
    if observations <= 0:
        return 0.0
    probability = wins / observations
    numerator = (
        probability
        + z * z / (2 * observations)
        - z
        * math.sqrt(
            probability * (1 - probability) / observations
            + z * z / (4 * observations * observations)
        )
    )
    return numerator / (1 + z * z / observations)


def select_rule(
    features: pd.DataFrame,
    train_start: pd.Timestamp,
    train_end: pd.Timestamp,
    base_cost: float,
    funding_reserve: float,
) -> tuple[Rule | None, dict[str, Any]]:
    ranked: list[tuple[float, Rule, dict[str, float | int]]] = []
    for rule in rule_grid():
        trades = backtest_range(
            features,
            rule,
            train_start,
            train_end,
            selection_month="training",
            cost_per_side=base_cost,
            funding_reserve_per_day=funding_reserve,
        )
        metrics = trade_metrics(trades)
        if (
            metrics["trades"] >= 5
            and metrics["total_return"] > 0
            and metrics["win_rate"] >= 0.52
            and metrics["profit_factor"] >= 1.15
            and metrics["expectancy"] > 0
        ):
            wins = sum(trade.net_return > 0 for trade in trades)
            score = (
                wilson_lower_bound(wins, len(trades), z=1.0)
                + min(float(metrics["profit_factor"]), 3.0) * 0.03
                + float(metrics["expectancy"]) * 2
                - max(0.0, -float(metrics["max_drawdown"]) - 0.25)
            )
            ranked.append((score, rule, metrics))

    if not ranked:
        return None, {"eligible_rules": 0}
    ranked.sort(key=lambda item: item[0], reverse=True)
    score, rule, metrics = ranked[0]
    return rule, {
        "eligible_rules": len(ranked),
        "score": float(score),
        "trailing_metrics": metrics,
    }


def run_walk_forward(
    features: pd.DataFrame,
    start_month: str,
    end_month: str,
    base_cost: float,
    funding_reserve: float,
) -> tuple[list[Trade], list[dict[str, Any]]]:
    trades: list[Trade] = []
    selections: list[dict[str, Any]] = []
    for month in pd.period_range(start_month, end_month, freq="M"):
        month_start = pd.Timestamp(month.start_time, tz="UTC")
        month_end = pd.Timestamp(month.end_time, tz="UTC")
        trailing_start = month_start - pd.Timedelta(days=180)
        trailing_end = month_start - pd.Timedelta(hours=1)
        rule, selection = select_rule(
            features,
            trailing_start,
            trailing_end,
            base_cost,
            funding_reserve,
        )
        month_trades: list[Trade] = []
        if rule is not None:
            month_trades = backtest_range(
                features,
                rule,
                month_start,
                month_end,
                selection_month=str(month),
                cost_per_side=base_cost,
                funding_reserve_per_day=funding_reserve,
            )
            trades.extend(month_trades)
        selections.append(
            {
                "month": str(month),
                "rule": asdict(rule) if rule is not None else None,
                **selection,
                "month_metrics": trade_metrics(month_trades),
            }
        )
    return trades, selections


def rerun_selected_under_stress(
    features: pd.DataFrame,
    selections: list[dict[str, Any]],
    cost_per_side: float,
    funding_reserve: float,
) -> list[Trade]:
    trades: list[Trade] = []
    for selection in selections:
        if selection["rule"] is None:
            continue
        month = pd.Period(selection["month"], freq="M")
        rule = Rule(**selection["rule"])
        trades.extend(
            backtest_range(
                features,
                rule,
                pd.Timestamp(month.start_time, tz="UTC"),
                pd.Timestamp(month.end_time, tz="UTC"),
                selection_month=str(month),
                cost_per_side=cost_per_side,
                funding_reserve_per_day=funding_reserve,
            )
        )
    return trades


def subset(trades: list[Trade], start: str, end: str) -> list[Trade]:
    start_timestamp = pd.Timestamp(start, tz="UTC")
    end_timestamp = pd.Timestamp(end, tz="UTC")
    return [
        trade
        for trade in trades
        if start_timestamp <= pd.Timestamp(trade.entry_time) <= end_timestamp
    ]


def bootstrap(trades: list[Trade], samples: int = 20000, seed: int = 56) -> dict[str, float]:
    if not trades:
        return {"probability_positive": 0.0, "ci_025": 0.0, "ci_975": 0.0}
    rng = np.random.default_rng(seed)
    returns = np.asarray([trade.net_return for trade in trades], dtype=float)
    sampled = rng.choice(returns, size=(samples, len(returns)), replace=True)
    totals = np.prod(1 + sampled, axis=1) - 1
    return {
        "probability_positive": float((totals > 0).mean()),
        "ci_025": float(np.quantile(totals, 0.025)),
        "ci_975": float(np.quantile(totals, 0.975)),
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def write_report(path: Path, payload: dict[str, Any]) -> None:
    overall = payload["base"]["overall"]
    validation = payload["base"]["validation"]
    holdout = payload["base"]["holdout"]
    stress = payload["stress"]["overall"]
    standard = payload["sizing"]["standard_15pct"]
    attack = payload["sizing"]["attack_30pct"]
    decision = payload["decision"]
    lines = [
        "# PENGU Adaptive 72-Hour Swing Robot v2",
        "",
        "Status: research-only. Real trading and automatic paper execution remain disabled.",
        "",
        "## Logic",
        "",
        "- At each month start, evaluate only the preceding 180 days.",
        "- Positive 14-day PENGU regime: long only after an 8–15% 24-hour drop, oversold RSI and a bullish reversal hour.",
        "- Negative 14-day regime: short only after a 5–12% 24-hour rally, elevated RSI and a bearish reversal hour.",
        "- ATR must be at least 1%; quote volume must be at least 50% of its 24-hour median.",
        "- Enter at the next hourly open.",
        "- Hold up to 72 hours; hard stop is 10% or 15%, selected from trailing data.",
        "- No take-profit is used: the purpose is to capture the 2–3 day reversal rather than scalp a few hours.",
        "",
        "## Walk-forward results — full-notional research proxy",
        "",
        "| Period | Trades | Win rate | PF | Total return | Max DD | Avg hold |",
        "|---|---:|---:|---:|---:|---:|---:|",
        f"| Jul 2025–Jun 2026 | {overall['trades']} | {overall['win_rate']:.1%} | {overall['profit_factor']:.2f} | {overall['total_return']:.2%} | {overall['max_drawdown']:.2%} | {overall['average_hold_hours']:.1f}h |",
        f"| Jul–Dec 2025 | {validation['trades']} | {validation['win_rate']:.1%} | {validation['profit_factor']:.2f} | {validation['total_return']:.2%} | {validation['max_drawdown']:.2%} | {validation['average_hold_hours']:.1f}h |",
        f"| Jan–Jun 2026 | {holdout['trades']} | {holdout['win_rate']:.1%} | {holdout['profit_factor']:.2f} | {holdout['total_return']:.2%} | {holdout['max_drawdown']:.2%} | {holdout['average_hold_hours']:.1f}h |",
        "",
        "## Practical sleeve sizing",
        "",
        f"- Standard 15% notional proxy: total {standard['total_return']:.2%}, max DD {standard['max_drawdown']:.2%}.",
        f"- Attack 30% notional proxy: total {attack['total_return']:.2%}, max DD {attack['max_drawdown']:.2%}.",
        "- The full-notional result is a research diagnostic, not the proposed account allocation.",
        "",
        "## Cost stress",
        "",
        f"- 10 bps/side plus 5 bps/day reserve: total {stress['total_return']:.2%}, win rate {stress['win_rate']:.1%}, PF {stress['profit_factor']:.2f}, max DD {stress['max_drawdown']:.2%}.",
        "",
        "## Approval gate",
        "",
        f"**Approved for automatic forward paper: {decision['approved_for_forward_paper']}**",
    ]
    for name, passed in decision["checks"].items():
        lines.append(f"- {'PASS' if passed else 'FAIL'} — {name}")
    lines.extend(
        [
            "",
            "The 2026 holdout contains only four trades. The win rate is encouraging but statistically insufficient, so the robot is added as a disabled research sleeve only.",
            "",
            "The historical period was reviewed during development and is not a pristine untouched holdout. A frozen forward-paper period is required.",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/pengu_adaptive_72h_v2"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/pengu_swing_v1"))
    parser.add_argument("--pengu-file", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    if args.pengu_file:
        pengu = pd.read_csv(args.pengu_file, parse_dates=["timestamp"]).set_index("timestamp").sort_index()
    else:
        pengu = download_klines("PENGUUSDT", "2024-12", "2026-06", args.cache)
    features = build_features(pengu)

    base_trades, selections = run_walk_forward(
        features,
        "2025-07",
        "2026-06",
        base_cost=0.0006,
        funding_reserve=0.0002,
    )
    stress_trades = rerun_selected_under_stress(
        features,
        selections,
        cost_per_side=0.0010,
        funding_reserve=0.0005,
    )

    validation_trades = subset(base_trades, "2025-07-01", "2025-12-31 23:59:59")
    holdout_trades = subset(base_trades, "2026-01-01", "2026-06-30 23:59:59")
    holdout_bootstrap = bootstrap(holdout_trades)

    checks = {
        "overall_win_rate_at_least_65pct": trade_metrics(base_trades)["win_rate"] >= 0.65,
        "overall_profit_factor_at_least_1_50": trade_metrics(base_trades)["profit_factor"] >= 1.50,
        "average_hold_between_48_and_72h": 48 <= trade_metrics(base_trades)["average_hold_hours"] <= 72,
        "overall_maxdd_no_worse_than_minus20pct": trade_metrics(base_trades)["max_drawdown"] >= -0.20,
        "stress_result_positive": trade_metrics(stress_trades)["total_return"] > 0,
        "holdout_trades_at_least_12": len(holdout_trades) >= 12,
        "holdout_win_rate_at_least_58pct": trade_metrics(holdout_trades)["win_rate"] >= 0.58,
        "holdout_bootstrap_positive_at_least_90pct": holdout_bootstrap["probability_positive"] >= 0.90,
    }

    payload = {
        "status": "RESEARCH_ONLY_DISABLED",
        "base": {
            "overall": trade_metrics(base_trades),
            "validation": trade_metrics(validation_trades),
            "holdout": {**trade_metrics(holdout_trades), **holdout_bootstrap},
        },
        "stress": {"overall": trade_metrics(stress_trades)},
        "sizing": {
            "standard_15pct": trade_metrics(base_trades, scale=0.15),
            "attack_30pct": trade_metrics(base_trades, scale=0.30),
        },
        "decision": {
            "approved_for_forward_paper": all(checks.values()),
            "checks": checks,
        },
        "data": {
            "rows": int(len(pengu)),
            "start": str(pengu.index.min()),
            "end": str(pengu.index.max()),
        },
        "selections": selections,
    }
    payload = json_safe(payload)

    pd.DataFrame([asdict(trade) for trade in base_trades]).to_csv(args.output / "trades_base.csv", index=False)
    pd.DataFrame([asdict(trade) for trade in stress_trades]).to_csv(args.output / "trades_stress.csv", index=False)
    pd.DataFrame(selections).to_json(args.output / "monthly_selections.json", orient="records", indent=2)
    (args.output / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_report(args.output / "REPORT.md", payload)

    print("PENGU_ADAPTIVE_72H_RESULT=" + json.dumps(payload, separators=(",", ":")))
    print((args.output / "REPORT.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
