#!/usr/bin/env python3
"""PENGU + multi-asset adaptive 72h scanner research.

PENGU keeps the exact adaptive v2 conditions. Other high-volatility symbols use
that same regime/reversal structure with a deliberately smaller predeclared
rule grid. Candidate trades are ranked only when they share the same entry hour.
Open positions are never displaced.

Research only. Real and automatic paper trading remain disabled.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run_pengu_adaptive_72h_v2 as base

UNIVERSE = [
    "PENGUUSDT",
    "PEPEUSDT",
    "WIFUSDT",
    "BONKUSDT",
    "DOGEUSDT",
    "SUIUSDT",
    "SEIUSDT",
    "APTUSDT",
    "OPUSDT",
    "ARBUSDT",
]

GROUP = {
    "PENGUUSDT": "MEME",
    "PEPEUSDT": "MEME",
    "WIFUSDT": "MEME",
    "BONKUSDT": "MEME",
    "DOGEUSDT": "MEME",
    "SUIUSDT": "L1_L2",
    "SEIUSDT": "L1_L2",
    "APTUSDT": "L1_L2",
    "OPUSDT": "L1_L2",
    "ARBUSDT": "L1_L2",
}

STANDARD_WEIGHT = 0.15
MAX_CONCURRENT = 2
MAX_ABS_CORRELATION = 0.70
PENGU_TIE_BAND = 5.0


def compact_non_penguin_grid() -> list[base.Rule]:
    """72-rule grid for satellites; PENGU continues to use its original grid."""
    return [
        base.Rule(long_drop, long_rsi, short_rally, short_rsi, hard_stop)
        for long_drop in (0.08, 0.10, 0.12)
        for long_rsi in (35, 40)
        for short_rally in (0.05, 0.08, 0.10)
        for short_rsi in (60, 65)
        for hard_stop in (0.10, 0.15)
    ]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return float(max(low, min(high, value)))


def trailing_score(selection: dict[str, Any], feature_row: pd.Series, trade: base.Trade) -> dict[str, float]:
    metrics = selection.get("trailing_metrics") or {}
    observations = int(metrics.get("trades", 0) or 0)
    win_rate = float(metrics.get("win_rate", 0.0) or 0.0)
    wins = int(round(win_rate * observations))
    wilson = base.wilson_lower_bound(wins, observations, z=1.0) if observations else 0.0
    pf = float(metrics.get("profit_factor", 0.0) or 0.0)
    expectancy = float(metrics.get("expectancy", 0.0) or 0.0)

    ret24 = abs(float(feature_row.get("ret24", 0.0) or 0.0))
    atr_pct = max(float(feature_row.get("atr_pct", 0.0) or 0.0), 1e-9)
    volume_ratio = float(feature_row.get("volume_ratio", 0.0) or 0.0)
    rule = trade.rule
    threshold = float(rule["long_drop"] if trade.side == 1 else rule["short_rally"])
    excess_move = ret24 / max(threshold, 1e-9)
    normalized_move = ret24 / atr_pct

    components = {
        "reliability": 35.0 * clamp((wilson - 0.45) / 0.30),
        "profit_factor": 20.0 * clamp((pf - 1.0) / 2.0),
        "expectancy": 20.0 * clamp(expectancy / 0.06),
        "setup_extremity": 15.0 * clamp((0.60 * excess_move + 0.40 * normalized_move / 8.0 - 0.75) / 1.25),
        "liquidity": 10.0 * clamp(volume_ratio / 2.0),
    }
    components["total"] = float(sum(components.values()))
    return components


def enrich_trades(
    symbol: str,
    trades: list[base.Trade],
    stress_trades: list[base.Trade],
    selections: list[dict[str, Any]],
    features: pd.DataFrame,
) -> list[dict[str, Any]]:
    selection_map = {item["month"]: item for item in selections}
    stress_map = {trade.entry_time: trade.net_return for trade in stress_trades}
    events: list[dict[str, Any]] = []
    for trade in trades:
        entry_time = pd.Timestamp(trade.entry_time)
        signal_time = entry_time - pd.Timedelta(hours=1)
        if signal_time not in features.index:
            continue
        selection = selection_map.get(trade.selection_month, {})
        score = trailing_score(selection, features.loc[signal_time], trade)
        events.append(
            {
                "symbol": symbol,
                "group": GROUP[symbol],
                "entry_time": entry_time,
                "exit_time": pd.Timestamp(trade.exit_time),
                "side": int(trade.side),
                "net_return": float(trade.net_return),
                "stress_net_return": float(stress_map.get(trade.entry_time, trade.net_return)),
                "hold_hours": int(trade.hold_hours),
                "exit_reason": trade.exit_reason,
                "selection_month": trade.selection_month,
                "score": score["total"],
                "score_components": score,
                "rule": trade.rule,
            }
        )
    return events


def trailing_correlation(
    symbol_a: str,
    symbol_b: str,
    timestamp: pd.Timestamp,
    closes: dict[str, pd.Series],
) -> float:
    start = timestamp - pd.Timedelta(days=30)
    a = closes[symbol_a].loc[start:timestamp].pct_change()
    b = closes[symbol_b].loc[start:timestamp].pct_change()
    aligned = pd.concat([a, b], axis=1).dropna()
    if len(aligned) < 24 * 10:
        return 1.0
    value = aligned.iloc[:, 0].corr(aligned.iloc[:, 1])
    return float(abs(value)) if np.isfinite(value) else 1.0


def rank_same_hour(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not events:
        return []
    best = max(float(event["score"]) for event in events)
    return sorted(
        events,
        key=lambda event: (
            1 if event["symbol"] == "PENGUUSDT" and event["score"] >= best - PENGU_TIE_BAND else 0,
            float(event["score"]),
        ),
        reverse=True,
    )


def select_portfolio(
    candidate_events: list[dict[str, Any]],
    closes: dict[str, pd.Series],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    by_time: dict[pd.Timestamp, list[dict[str, Any]]] = {}
    for event in candidate_events:
        by_time.setdefault(event["entry_time"], []).append(event)

    active: list[dict[str, Any]] = []
    for timestamp in sorted(by_time):
        # Conservative: a position whose exit is stamped in this same hour still occupies a slot.
        active = [position for position in active if position["exit_time"] >= timestamp]
        same_hour_selected: list[dict[str, Any]] = []
        for event in rank_same_hour(by_time[timestamp]):
            reason = None
            comparison_set = active + same_hour_selected
            if any(position["symbol"] == event["symbol"] for position in comparison_set):
                reason = "DUPLICATE_SYMBOL"
            elif len(comparison_set) >= MAX_CONCURRENT:
                reason = "MAX_CONCURRENT"
            elif any(position["group"] == event["group"] for position in comparison_set):
                reason = "THEME_GROUP_DUPLICATE"
            else:
                for position in comparison_set:
                    corr = trailing_correlation(event["symbol"], position["symbol"], timestamp, closes)
                    if corr > MAX_ABS_CORRELATION:
                        reason = f"CORRELATION_{corr:.3f}"
                        break

            if reason is None:
                accepted = dict(event)
                accepted["portfolio_weight"] = STANDARD_WEIGHT
                same_hour_selected.append(accepted)
                selected.append(accepted)
            else:
                denied = dict(event)
                denied["rejection_reason"] = reason
                rejected.append(denied)
        active.extend(same_hour_selected)
    return selected, rejected


def portfolio_metrics(selected: list[dict[str, Any]], return_field: str = "net_return") -> dict[str, Any]:
    if not selected:
        return {
            "trades": 0,
            "total_return": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy_account": 0.0,
            "max_drawdown_realized_proxy": 0.0,
            "average_hold_hours": 0.0,
            "trades_per_month": 0.0,
            "best_month": 0.0,
            "worst_month": 0.0,
            "positive_months": 0,
            "active_months": 0,
        }
    rows = []
    for event in selected:
        contribution = float(event[return_field]) * float(event["portfolio_weight"])
        rows.append(
            {
                "exit_time": event["exit_time"],
                "contribution": contribution,
                "is_win": contribution > 0,
                "hold_hours": event["hold_hours"],
            }
        )
    frame = pd.DataFrame(rows).sort_values("exit_time")
    exit_returns = frame.groupby("exit_time")["contribution"].sum()
    equity = (1.0 + exit_returns).cumprod()
    drawdown = equity / equity.cummax() - 1.0
    winners = frame.loc[frame["contribution"] > 0, "contribution"]
    losers = frame.loc[frame["contribution"] <= 0, "contribution"]
    monthly = (1.0 + exit_returns).resample("ME").prod() - 1.0
    negative_sum = float(losers.sum())
    return {
        "trades": int(len(frame)),
        "total_return": float(equity.iloc[-1] - 1.0),
        "win_rate": float(frame["is_win"].mean()),
        "profit_factor": float(winners.sum() / -negative_sum) if negative_sum < 0 else 999.0,
        "expectancy_account": float(frame["contribution"].mean()),
        "max_drawdown_realized_proxy": float(drawdown.min()),
        "average_hold_hours": float(frame["hold_hours"].mean()),
        "trades_per_month": float(len(frame) / 12.0),
        "best_month": float(monthly.max()) if len(monthly) else 0.0,
        "worst_month": float(monthly.min()) if len(monthly) else 0.0,
        "positive_months": int((monthly > 0).sum()),
        "active_months": int((monthly.abs() > 1e-12).sum()),
    }


def subset_by_symbol(events: list[dict[str, Any]], symbols: set[str]) -> list[dict[str, Any]]:
    return [event for event in events if event["symbol"] in symbols]


def symbol_summary(events: list[dict[str, Any]]) -> pd.DataFrame:
    rows = []
    for symbol in UNIVERSE:
        sample = [event for event in events if event["symbol"] == symbol]
        if not sample:
            rows.append({"symbol": symbol, "candidate_trades": 0})
            continue
        returns = np.asarray([event["net_return"] for event in sample], dtype=float)
        winners = returns[returns > 0]
        losers = returns[returns <= 0]
        rows.append(
            {
                "symbol": symbol,
                "candidate_trades": len(sample),
                "win_rate": float((returns > 0).mean()),
                "profit_factor": float(winners.sum() / -losers.sum()) if losers.sum() < 0 else 999.0,
                "full_notional_compound_return": float(np.prod(1 + returns) - 1),
                "average_hold_hours": float(np.mean([event["hold_hours"] for event in sample])),
                "average_score": float(np.mean([event["score"] for event in sample])),
            }
        )
    return pd.DataFrame(rows)


def write_report(path: Path, payload: dict[str, Any]) -> None:
    pengu = payload["comparison"]["pengu_only"]
    scanner = payload["comparison"]["scanner_without_pengu"]
    integrated = payload["comparison"]["integrated"]
    stress = payload["comparison"]["integrated_stress"]
    rejects = payload["rejections"]
    lines = [
        "# PENGU + High-Volatility Multi-Asset Scanner v1",
        "",
        "Status: research only; real trading and automatic paper trading remain disabled.",
        "",
        "## Overlap decision rules",
        "",
        "1. PENGU entry conditions are unchanged from Adaptive 72h v2.",
        "2. Rank only signals sharing the same next-hour entry timestamp; existing positions are never replaced.",
        "3. Score = trailing reliability 35 + PF 20 + expectancy 20 + current setup extremity 15 + liquidity 10.",
        "4. If PENGU is within five score points of the best simultaneous candidate, PENGU wins the tie. Outside that band, the higher score wins.",
        "5. Maximum two concurrent positions, each at 15% notional.",
        "6. Maximum one simultaneous position from each theme group: MEME and L1/L2.",
        "7. Reject a second position when absolute trailing 30-day hourly correlation exceeds 0.70.",
        "8. A duplicated PENGU signal is one trade only; scanner sizing is never added on top of the standalone PENGU sleeve.",
        "9. A position whose exit is stamped in the candidate entry hour still occupies its slot, which is deliberately conservative.",
        "",
        "## Portfolio comparison — 15% per accepted trade",
        "",
        "| Portfolio | Trades | Win rate | PF | Total | Realized DD proxy | Avg hold | Trades/month | Best month | Worst month |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, metrics in [
        ("PENGU only", pengu),
        ("Scanner excluding PENGU", scanner),
        ("Integrated", integrated),
        ("Integrated stress", stress),
    ]:
        lines.append(
            f"| {name} | {metrics['trades']} | {metrics['win_rate']:.1%} | {metrics['profit_factor']:.2f} | "
            f"{metrics['total_return']:.2%} | {metrics['max_drawdown_realized_proxy']:.2%} | "
            f"{metrics['average_hold_hours']:.1f}h | {metrics['trades_per_month']:.2f} | "
            f"{metrics['best_month']:.2%} | {metrics['worst_month']:.2%} |"
        )
    lines.extend(
        [
            "",
            "## Candidate and rejection counts",
            "",
            f"- Raw candidates: {payload['candidate_count']}",
            f"- Integrated selected: {payload['selected_count']}",
            f"- Rejected by full slots: {rejects.get('MAX_CONCURRENT', 0)}",
            f"- Rejected by theme duplication: {rejects.get('THEME_GROUP_DUPLICATE', 0)}",
            f"- Rejected by correlation: {rejects.get('CORRELATION', 0)}",
            f"- Rejected duplicate symbol: {rejects.get('DUPLICATE_SYMBOL', 0)}",
            "",
            "## Interpretation limits",
            "",
            "- Historical data are Binance USD-M one-hour OHLCV proxies; Aster fills, spread and funding are not fully reproduced.",
            "- Drawdown is a realized-exit event proxy. It is not intrabar account equity drawdown.",
            "- This historical window has been reviewed during strategy development and is no longer a pristine holdout.",
            "- Results must remain disabled until frozen forward evidence reaches the required sample size.",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/multiasset_scanner_v1"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/multiasset_scanner_v1"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    original_grid = base.rule_grid
    all_events: list[dict[str, Any]] = []
    data_by_symbol: dict[str, pd.DataFrame] = {}
    closes: dict[str, pd.Series] = {}
    per_symbol_payload: dict[str, Any] = {}

    for symbol in UNIVERSE:
        data = base.download_klines(symbol, "2024-12", "2026-06", args.cache)
        features = base.build_features(data)
        data_by_symbol[symbol] = features
        closes[symbol] = features["close"]

        if symbol == "PENGUUSDT":
            base.rule_grid = original_grid
        else:
            base.rule_grid = compact_non_penguin_grid

        trades, selections = base.run_walk_forward(
            features,
            "2025-07",
            "2026-06",
            base_cost=0.0006,
            funding_reserve=0.0002,
        )
        stress_trades = base.rerun_selected_under_stress(
            features,
            selections,
            cost_per_side=0.0010,
            funding_reserve=0.0005,
        )
        events = enrich_trades(symbol, trades, stress_trades, selections, features)
        all_events.extend(events)
        per_symbol_payload[symbol] = {
            "candidate_metrics": base.trade_metrics(trades),
            "stress_metrics": base.trade_metrics(stress_trades),
            "candidate_count": len(events),
        }

    base.rule_grid = original_grid

    integrated_selected, integrated_rejected = select_portfolio(all_events, closes)
    pengu_candidates = subset_by_symbol(all_events, {"PENGUUSDT"})
    pengu_selected, _ = select_portfolio(pengu_candidates, closes)
    scanner_candidates = subset_by_symbol(all_events, set(UNIVERSE) - {"PENGUUSDT"})
    scanner_selected, _ = select_portfolio(scanner_candidates, closes)

    reason_counts: dict[str, int] = {}
    for event in integrated_rejected:
        reason = event["rejection_reason"]
        bucket = "CORRELATION" if reason.startswith("CORRELATION_") else reason
        reason_counts[bucket] = reason_counts.get(bucket, 0) + 1

    payload = {
        "status": "RESEARCH_ONLY_DISABLED",
        "universe": UNIVERSE,
        "candidate_count": len(all_events),
        "selected_count": len(integrated_selected),
        "comparison": {
            "pengu_only": portfolio_metrics(pengu_selected),
            "scanner_without_pengu": portfolio_metrics(scanner_selected),
            "integrated": portfolio_metrics(integrated_selected),
            "integrated_stress": portfolio_metrics(integrated_selected, return_field="stress_net_return"),
        },
        "rejections": reason_counts,
        "per_symbol": per_symbol_payload,
        "overlap_policy": {
            "max_concurrent": MAX_CONCURRENT,
            "weight_per_trade": STANDARD_WEIGHT,
            "max_abs_correlation": MAX_ABS_CORRELATION,
            "one_per_theme_group": True,
            "pengu_tie_band_points": PENGU_TIE_BAND,
            "replace_open_positions": False,
        },
    }
    payload = base.json_safe(payload)

    pd.DataFrame(all_events).to_json(args.output / "all_candidates.json", orient="records", date_format="iso", indent=2)
    pd.DataFrame(integrated_selected).to_json(args.output / "selected_trades.json", orient="records", date_format="iso", indent=2)
    pd.DataFrame(integrated_rejected).to_json(args.output / "rejected_candidates.json", orient="records", date_format="iso", indent=2)
    symbol_summary(all_events).to_csv(args.output / "symbol_summary.csv", index=False)
    (args.output / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_report(args.output / "REPORT.md", payload)

    print("MULTIASSET_SCANNER_RESULT=" + json.dumps(payload, separators=(",", ":")))
    print((args.output / "REPORT.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
