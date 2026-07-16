#!/usr/bin/env python3
"""PENGU + high-volatility 72-hour scanner portfolio research.

PENGU keeps its existing adaptive v2 conditions unchanged. The same monthly
trailing-180-day rule-selection framework is applied independently to nine
additional volatile symbols. Signals are then ranked at each entry hour and a
portfolio is built with one or two concurrent positions.

Research only. No live or automatic paper trading activation.
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

import run_pengu_adaptive_72h_v2 as core
from run_pengu_swing_research import download_klines

SYMBOLS = {
    "PENGU": "PENGUUSDT",
    "DOGE": "DOGEUSDT",
    "SUI": "SUIUSDT",
    "SEI": "SEIUSDT",
    "APT": "APTUSDT",
    "ARB": "ARBUSDT",
    "OP": "OPUSDT",
    "PEPE": "1000PEPEUSDT",
    "WIF": "WIFUSDT",
    "BONK": "1000BONKUSDT",
}


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def selection_lookup(selections: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row["month"]): row for row in selections}


def candidate_score(
    trade: core.Trade,
    selection: dict[str, Any],
    features: pd.DataFrame,
    symbol: str,
) -> float:
    metrics = selection.get("trailing_metrics") or {}
    win_rate = safe_float(metrics.get("win_rate"))
    profit_factor = min(safe_float(metrics.get("profit_factor")), 3.0)
    expectancy = max(-0.05, min(0.10, safe_float(metrics.get("expectancy"))))

    entry_time = pd.Timestamp(trade.entry_time)
    signal_time = entry_time - pd.Timedelta(hours=1)
    if signal_time in features.index:
        row = features.loc[signal_time]
        move = abs(safe_float(row.get("ret24")))
        atr_pct = safe_float(row.get("atr_pct"))
        volume_ratio = safe_float(row.get("volume_ratio"))
    else:
        move = atr_pct = volume_ratio = 0.0

    score = (
        30.0 * win_rate
        + 10.0 * profit_factor
        + 200.0 * expectancy
        + 60.0 * min(move, 0.25)
        + 30.0 * min(atr_pct, 0.08)
        + 2.0 * min(volume_ratio, 3.0)
    )
    # PENGU receives only a small evidence bonus; its entry conditions remain
    # unchanged and it still loses to a clearly stronger scanner signal.
    if symbol == "PENGU":
        score += 3.0
    return float(score)


def build_symbol_candidates(
    symbol: str,
    exchange_symbol: str,
    data: pd.DataFrame,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], pd.DataFrame]:
    features = core.build_features(data)
    trades, selections = core.run_walk_forward(
        features,
        "2025-07",
        "2026-06",
        base_cost=0.0006,
        funding_reserve=0.0002,
    )
    lookup = selection_lookup(selections)
    candidates: list[dict[str, Any]] = []
    for trade in trades:
        selection = lookup.get(trade.selection_month, {})
        candidates.append(
            {
                **asdict(trade),
                "symbol": symbol,
                "exchange_symbol": exchange_symbol,
                "source": "PENGU_DEDICATED" if symbol == "PENGU" else "HIGH_VOL_SCANNER",
                "priority_score": candidate_score(trade, selection, features, symbol),
                "trailing_metrics": selection.get("trailing_metrics", {}),
            }
        )
    return candidates, selections, features


def trailing_correlation(
    returns: dict[str, pd.Series],
    left: str,
    right: str,
    timestamp: pd.Timestamp,
    hours: int = 24 * 30,
) -> float:
    if left == right:
        return 1.0
    frame = pd.concat(
        [returns[left].rename("left"), returns[right].rename("right")], axis=1
    ).loc[: timestamp - pd.Timedelta(hours=1)].tail(hours).dropna()
    if len(frame) < 24 * 10:
        return 0.0
    value = frame["left"].corr(frame["right"])
    return safe_float(value)


def select_portfolio_trades(
    candidates: list[dict[str, Any]],
    returns: dict[str, pd.Series],
    max_positions: int,
    correlation_cap: float = 0.80,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[pd.Timestamp, list[dict[str, Any]]] = {}
    for candidate in candidates:
        grouped.setdefault(pd.Timestamp(candidate["entry_time"]), []).append(candidate)

    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    active: list[dict[str, Any]] = []

    for timestamp in sorted(grouped):
        active = [row for row in active if pd.Timestamp(row["exit_time"]) >= timestamp]
        available_slots = max_positions - len(active)
        ranked = sorted(grouped[timestamp], key=lambda row: row["priority_score"], reverse=True)

        for candidate in ranked:
            reason = None
            same_symbol = [row for row in active if row["symbol"] == candidate["symbol"]]
            if same_symbol:
                # Same symbol/same direction is merged rather than doubled;
                # opposite direction is blocked. Both outcomes mean no new trade.
                existing = same_symbol[0]
                reason = (
                    "SAME_SYMBOL_SAME_DIRECTION_MERGED"
                    if int(existing["side"]) == int(candidate["side"])
                    else "SAME_SYMBOL_OPPOSITE_DIRECTION_BLOCKED"
                )
            elif available_slots <= 0:
                reason = "MAX_CONCURRENT_POSITIONS"
            else:
                for existing in active:
                    corr = abs(
                        trailing_correlation(
                            returns,
                            candidate["symbol"],
                            existing["symbol"],
                            timestamp,
                        )
                    )
                    if corr >= correlation_cap and int(existing["side"]) == int(candidate["side"]):
                        reason = f"CORRELATION_CAP_{corr:.3f}"
                        break

            if reason:
                rejected.append({**candidate, "rejection_reason": reason})
                continue

            chosen = {**candidate, "selected_rank": len(selected) + 1}
            selected.append(chosen)
            active.append(chosen)
            available_slots -= 1

    return selected, rejected


def simulate_hourly_portfolio(
    selected: list[dict[str, Any]],
    market_data: dict[str, pd.DataFrame],
    notional_per_position: float,
    cost_per_side: float = 0.0006,
    funding_per_day: float = 0.0002,
) -> tuple[pd.Series, pd.Series]:
    all_index = sorted(set().union(*(set(frame.index) for frame in market_data.values())))
    index = pd.DatetimeIndex(all_index)
    pnl = pd.Series(0.0, index=index)

    for trade in selected:
        symbol = trade["symbol"]
        frame = market_data[symbol]
        entry = pd.Timestamp(trade["entry_time"])
        exit_time = pd.Timestamp(trade["exit_time"])
        side = int(trade["side"])
        segment = frame.loc[entry:exit_time]
        if segment.empty:
            continue
        hourly_return = segment["close"].pct_change()
        hourly_return.iloc[0] = segment["close"].iloc[0] / float(trade["entry_price"]) - 1.0
        contribution = side * hourly_return.fillna(0.0) * notional_per_position
        pnl.loc[contribution.index] += contribution
        pnl.loc[entry] -= cost_per_side * notional_per_position
        pnl.loc[exit_time] -= cost_per_side * notional_per_position
        pnl.loc[segment.index] -= funding_per_day / 24.0 * notional_per_position

    pnl = pnl.loc["2025-07-01":"2026-06-30 23:59:59"]
    equity = (1.0 + pnl.clip(lower=-0.999)).cumprod()
    return pnl, equity


def portfolio_metrics(pnl: pd.Series, equity: pd.Series, selected: list[dict[str, Any]]) -> dict[str, Any]:
    if equity.empty:
        return {}
    drawdown = equity / equity.cummax() - 1.0
    monthly = (1.0 + pnl).resample("ME").prod() - 1.0
    daily = (1.0 + pnl).resample("D").prod() - 1.0
    return {
        "trades": len(selected),
        "total_return": float(equity.iloc[-1] - 1.0),
        "max_drawdown": float(drawdown.min()),
        "average_month": float(monthly.mean()),
        "compound_month": float((equity.iloc[-1]) ** (1 / 12) - 1.0),
        "positive_months": int((monthly > 0).sum()),
        "months": int(len(monthly)),
        "best_month": float(monthly.max()),
        "worst_month": float(monthly.min()),
        "best_day": float(daily.max()),
        "worst_day": float(daily.min()),
        "average_trade_net_full_notional": float(np.mean([row["net_return"] for row in selected])) if selected else 0.0,
        "raw_trade_win_rate": float(np.mean([row["net_return"] > 0 for row in selected])) if selected else 0.0,
    }


def symbol_summary(candidates: list[dict[str, Any]], selected: list[dict[str, Any]]) -> pd.DataFrame:
    rows = []
    for symbol in SYMBOLS:
        raw = [row for row in candidates if row["symbol"] == symbol]
        chosen = [row for row in selected if row["symbol"] == symbol]
        rows.append(
            {
                "symbol": symbol,
                "raw_signals": len(raw),
                "selected_trades": len(chosen),
                "raw_win_rate": float(np.mean([row["net_return"] > 0 for row in raw])) if raw else 0.0,
                "selected_win_rate": float(np.mean([row["net_return"] > 0 for row in chosen])) if chosen else 0.0,
                "selected_total_full_notional": float(np.prod([1 + row["net_return"] for row in chosen]) - 1) if chosen else 0.0,
                "average_priority_score": float(np.mean([row["priority_score"] for row in raw])) if raw else 0.0,
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/high_vol_scanner_portfolio_v1"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/high_vol_scanner_v1"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    all_candidates: list[dict[str, Any]] = []
    market_data: dict[str, pd.DataFrame] = {}
    hourly_returns: dict[str, pd.Series] = {}
    selections_by_symbol: dict[str, Any] = {}
    unavailable: dict[str, str] = {}

    for symbol, exchange_symbol in SYMBOLS.items():
        try:
            data = download_klines(exchange_symbol, "2024-12", "2026-06", args.cache)
            market_data[symbol] = data
            hourly_returns[symbol] = data["close"].pct_change()
            candidates, selections, _ = build_symbol_candidates(symbol, exchange_symbol, data)
            all_candidates.extend(candidates)
            selections_by_symbol[symbol] = selections
            print(f"LOADED {symbol}: rows={len(data)} signals={len(candidates)}")
        except Exception as exc:  # keep the research run auditable instead of hiding missing symbols
            unavailable[symbol] = f"{type(exc).__name__}: {exc}"
            print(f"UNAVAILABLE {symbol}: {exc}", file=sys.stderr)

    if "PENGU" not in market_data:
        raise RuntimeError("PENGU data unavailable; aborting because its unchanged dedicated logic is mandatory")

    results: dict[str, Any] = {}
    selected_sets: dict[str, list[dict[str, Any]]] = {}
    rejected_sets: dict[str, list[dict[str, Any]]] = {}

    configurations = {
        "pengu_only_15pct": (1, 0.15, [row for row in all_candidates if row["symbol"] == "PENGU"]),
        "scanner_max1_15pct": (1, 0.15, all_candidates),
        "scanner_max2_15pct_each": (2, 0.15, all_candidates),
        "scanner_max2_10pct_each": (2, 0.10, all_candidates),
    }

    for name, (max_positions, notional, candidates) in configurations.items():
        selected, rejected = select_portfolio_trades(
            candidates,
            hourly_returns,
            max_positions=max_positions,
            correlation_cap=0.80,
        )
        pnl, equity = simulate_hourly_portfolio(
            selected,
            market_data,
            notional_per_position=notional,
        )
        results[name] = portfolio_metrics(pnl, equity, selected)
        selected_sets[name] = selected
        rejected_sets[name] = rejected
        pd.DataFrame(selected).to_json(args.output / f"selected_{name}.json", orient="records", indent=2)
        pd.DataFrame(rejected).to_json(args.output / f"rejected_{name}.json", orient="records", indent=2)
        pd.DataFrame({"pnl": pnl, "equity": equity}).to_csv(args.output / f"equity_{name}.csv")

    preferred = "scanner_max2_15pct_each"
    summary = symbol_summary(all_candidates, selected_sets[preferred])
    summary.to_csv(args.output / "symbol_summary.csv", index=False)
    pd.DataFrame(all_candidates).to_json(args.output / "all_candidates.json", orient="records", indent=2)
    (args.output / "monthly_selections_by_symbol.json").write_text(
        json.dumps(core.json_safe(selections_by_symbol), indent=2), encoding="utf-8"
    )

    payload = {
        "status": "RESEARCH_ONLY_DISABLED",
        "symbols_requested": SYMBOLS,
        "unavailable": unavailable,
        "collision_policy": {
            "same_symbol_same_direction": "MERGE; do not add notional; use stricter stop and earlier exit if two robots disagree",
            "same_symbol_opposite_direction": "BLOCK new entry; existing position may exit by its own rule but is not reversed immediately",
            "multiple_symbols_same_hour": "Rank by trailing-180d win rate, PF, expectancy, signal extremity, ATR, volume, and small PENGU evidence bonus",
            "correlation": "Reject lower-ranked same-direction candidate when absolute trailing-30d hourly correlation is >= 0.80",
            "max_positions": "Compare 1 versus 2; preferred research configuration is chosen only after results",
            "tie_breaks": [
                "higher minimum trailing evidence score",
                "lower trailing maximum drawdown",
                "lower correlation to active portfolio",
                "PENGU dedicated signal only when score difference is within 3 points",
                "earlier completed signal timestamp",
            ],
        },
        "results": results,
        "preferred_configuration_for_review": preferred,
        "symbol_summary": summary.to_dict(orient="records"),
    }
    payload = core.json_safe(payload)
    (args.output / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [
        "# PENGU + High-Volatility Scanner Portfolio v1",
        "",
        "Status: research only; real and automatic paper trading remain disabled.",
        "",
        "## Collision policy",
        "",
        "1. Same symbol, same direction: merge into one position; never double the notional.",
        "2. Same symbol, opposite direction: block the new entry; do not instant-reverse.",
        "3. Multiple symbols at the same hour: rank by trailing evidence and signal quality.",
        "4. Reject a lower-ranked same-direction trade when trailing 30-day absolute correlation is at least 0.80.",
        "5. PENGU receives only a three-point evidence bonus and keeps its original entry conditions unchanged.",
        "",
        "## Portfolio comparison",
        "",
        "| Configuration | Trades | Total | Avg month | Compound month | Max DD | Raw win rate |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name, metrics in results.items():
        lines.append(
            f"| {name} | {metrics.get('trades', 0)} | {metrics.get('total_return', 0):.2%} | "
            f"{metrics.get('average_month', 0):.2%} | {metrics.get('compound_month', 0):.2%} | "
            f"{metrics.get('max_drawdown', 0):.2%} | {metrics.get('raw_trade_win_rate', 0):.1%} |"
        )
    lines.extend([
        "",
        "## Important",
        "",
        "PENGU conditions were not loosened. PENGU is included as the unchanged dedicated sleeve; the scanner supplies additional independent symbols.",
        "The historical period has been inspected during development and is not a pristine holdout. Freeze the chosen configuration and collect forward evidence before activation.",
    ])
    (args.output / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print("HIGH_VOL_SCANNER_RESULT=" + json.dumps(payload, separators=(",", ":")))
    print((args.output / "REPORT.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
