#!/usr/bin/env python3
"""PENGU reserved-slot + high-vol scanner portfolio v2.

PENGU keeps every valid dedicated signal. One separate scanner slot selects the
best non-PENGU candidate. Scanner candidates must pass stricter trailing-only
health gates before ranking. Research only.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run_high_vol_scanner_portfolio_v1 as v1
import run_pengu_adaptive_72h_v2 as core
from run_pengu_swing_research import download_klines


def trailing_health_pass(candidate: dict[str, Any]) -> bool:
    metrics = candidate.get("trailing_metrics") or {}
    return (
        v1.safe_float(metrics.get("win_rate")) >= 0.58
        and v1.safe_float(metrics.get("profit_factor")) >= 1.30
        and v1.safe_float(metrics.get("expectancy")) > 0.0
        and v1.safe_float(metrics.get("max_drawdown"), -1.0) >= -0.30
        and int(metrics.get("trades", 0) or 0) >= 5
    )


def select_reserved_portfolio(
    pengu_candidates: list[dict[str, Any]],
    scanner_candidates: list[dict[str, Any]],
    returns: dict[str, pd.Series],
    correlation_cap: float = 0.80,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    # Dedicated PENGU slot: preserve every unchanged PENGU signal.
    selected.extend(sorted(pengu_candidates, key=lambda row: pd.Timestamp(row["entry_time"])))

    # One scanner slot. Rank only candidates that pass past-only health gates.
    healthy = [row for row in scanner_candidates if trailing_health_pass(row)]
    unhealthy = [row for row in scanner_candidates if not trailing_health_pass(row)]
    rejected.extend({**row, "rejection_reason": "TRAILING_HEALTH_GATE"} for row in unhealthy)

    grouped: dict[pd.Timestamp, list[dict[str, Any]]] = {}
    for row in healthy:
        grouped.setdefault(pd.Timestamp(row["entry_time"]), []).append(row)

    active_scanner: dict[str, Any] | None = None
    for timestamp in sorted(grouped):
        if active_scanner is not None and pd.Timestamp(active_scanner["exit_time"]) < timestamp:
            active_scanner = None

        ranked = sorted(grouped[timestamp], key=lambda row: row["priority_score"], reverse=True)
        for candidate in ranked:
            reason = None
            if active_scanner is not None:
                reason = "SCANNER_SLOT_OCCUPIED"
            else:
                active_pengu = [
                    row for row in pengu_candidates
                    if pd.Timestamp(row["entry_time"]) <= timestamp <= pd.Timestamp(row["exit_time"])
                ]
                for pengu in active_pengu:
                    corr = abs(
                        v1.trailing_correlation(
                            returns,
                            candidate["symbol"],
                            "PENGU",
                            timestamp,
                        )
                    )
                    if corr >= correlation_cap and int(candidate["side"]) == int(pengu["side"]):
                        reason = f"CORRELATED_WITH_PENGU_{corr:.3f}"
                        break

            if reason:
                rejected.append({**candidate, "rejection_reason": reason})
                continue

            active_scanner = candidate
            selected.append(candidate)
            break

        for lower in ranked[1:]:
            if not any(
                row.get("symbol") == lower.get("symbol")
                and row.get("entry_time") == lower.get("entry_time")
                for row in rejected
            ):
                rejected.append({**lower, "rejection_reason": "LOWER_RANKED_SAME_HOUR"})

    selected.sort(key=lambda row: pd.Timestamp(row["entry_time"]))
    return selected, rejected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/high_vol_scanner_portfolio_v2"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/high_vol_scanner_v1"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    all_candidates: list[dict[str, Any]] = []
    market_data: dict[str, pd.DataFrame] = {}
    returns: dict[str, pd.Series] = {}
    unavailable: dict[str, str] = {}

    for symbol, exchange_symbol in v1.SYMBOLS.items():
        try:
            data = download_klines(exchange_symbol, "2024-12", "2026-06", args.cache)
            market_data[symbol] = data
            returns[symbol] = data["close"].pct_change()
            candidates, _, _ = v1.build_symbol_candidates(symbol, exchange_symbol, data)
            all_candidates.extend(candidates)
            print(f"LOADED {symbol}: rows={len(data)} signals={len(candidates)}")
        except Exception as exc:
            unavailable[symbol] = f"{type(exc).__name__}: {exc}"
            print(f"UNAVAILABLE {symbol}: {exc}", file=sys.stderr)

    pengu = [row for row in all_candidates if row["symbol"] == "PENGU"]
    scanner = [row for row in all_candidates if row["symbol"] != "PENGU"]
    if not pengu:
        raise RuntimeError("No PENGU candidates; dedicated conditions must remain available")

    selected, rejected = select_reserved_portfolio(pengu, scanner, returns)

    configurations = {
        "pengu_only_15pct": (pengu, {"PENGU": 0.15}),
        "reserved_penguin_plus_scanner_10pct": (selected, {"PENGU": 0.15, "SCANNER": 0.10}),
        "reserved_penguin_plus_scanner_15pct": (selected, {"PENGU": 0.15, "SCANNER": 0.15}),
    }

    results: dict[str, Any] = {}
    for name, (trades, weights) in configurations.items():
        # Simulate PENGU and scanner contributions separately so the dedicated
        # PENGU slot stays fixed at 15% while the scanner slot can be 10/15%.
        pengu_trades = [row for row in trades if row["symbol"] == "PENGU"]
        scanner_trades = [row for row in trades if row["symbol"] != "PENGU"]
        p_pnl, _ = v1.simulate_hourly_portfolio(
            pengu_trades,
            market_data,
            notional_per_position=weights.get("PENGU", 0.0),
        )
        s_pnl, _ = v1.simulate_hourly_portfolio(
            scanner_trades,
            market_data,
            notional_per_position=weights.get("SCANNER", 0.0),
        )
        pnl = p_pnl.add(s_pnl, fill_value=0.0)
        equity = (1 + pnl.clip(lower=-0.999)).cumprod()
        results[name] = v1.portfolio_metrics(pnl, equity, trades)
        pd.DataFrame({"pnl": pnl, "equity": equity}).to_csv(args.output / f"equity_{name}.csv")

    summary = v1.symbol_summary(all_candidates, selected)
    summary.to_csv(args.output / "symbol_summary.csv", index=False)
    pd.DataFrame(selected).to_json(args.output / "selected_trades.json", orient="records", indent=2)
    pd.DataFrame(rejected).to_json(args.output / "rejected_trades.json", orient="records", indent=2)

    payload = {
        "status": "RESEARCH_ONLY_DISABLED",
        "unavailable": unavailable,
        "collision_policy": {
            "PENGU_slot": "Dedicated 15% slot; every unchanged PENGU signal is preserved",
            "scanner_slot": "One additional slot only; highest-ranked healthy non-PENGU signal",
            "same_symbol_same_direction": "Merge and do not add notional",
            "same_symbol_opposite_direction": "Block new entry; no instant reversal",
            "scanner_health_gate": "Trailing 180d win rate >=58%, PF >=1.30, expectancy >0, DD >=-30%, at least 5 trades",
            "correlation": "Reject same-direction scanner candidate when abs trailing-30d correlation with active PENGU >=0.80",
            "ranking": "Trailing win rate, PF, expectancy, current move extremity, ATR and volume",
        },
        "results": results,
        "symbol_summary": summary.to_dict(orient="records"),
        "selected_scanner_trades": len([row for row in selected if row["symbol"] != "PENGU"]),
        "pengu_trades_preserved": len(pengu),
    }
    payload = core.json_safe(payload)
    (args.output / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [
        "# PENGU Reserved Slot + High-Vol Scanner v2",
        "",
        "PENGU conditions are unchanged and all PENGU signals are preserved in a dedicated 15% slot.",
        "One additional scanner slot uses only non-PENGU candidates that pass stricter trailing-only health gates.",
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
        f"PENGU trades preserved: {len(pengu)}",
        f"Scanner trades selected: {len([row for row in selected if row['symbol'] != 'PENGU'])}",
        "",
        "Research only. The inspected historical period is not a pristine holdout; freeze the rule and collect forward evidence before activation.",
    ])
    (args.output / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print("HIGH_VOL_SCANNER_V2_RESULT=" + json.dumps(payload, separators=(",", ":")))
    print((args.output / "REPORT.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
