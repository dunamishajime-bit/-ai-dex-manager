"""Research-only V12 Top2 residual-gross ablation.

The frozen V12 ledger is the source of truth for signal/exit outcomes.  This
runner changes only portfolio admission and allocation; PENGU and stock rows
are replayed unchanged.  It never imports credentials or an order adapter.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

UTC = dt.timezone.utc
START = dt.datetime(2025, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
TOTAL_CAP = 2.5
CRYPTO_CAP = 1.5
STOCK_CAP = 1.5
PENGU_CAP = 0.75
V12_POSITION_CAP = 1.0
CRYPTO_DAILY_LOSS_LIMIT = -0.05
STOCK_DAILY_LOSS_LIMIT = -0.035
REPO_ROOT = Path(__file__).resolve().parent.parent
STOCK_ROOT = REPO_ROOT / ".stock-research"
sys.path.insert(0, str(STOCK_ROOT / "scripts"))
import research_lab_v96_v52_dual_slot_one_year_bt as legacy


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"EXPECTED_JSON_OBJECT:{path}")
    return value


def pf(values: Sequence[float]) -> float | None:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses else (999.0 if gains else None)


def pf_without_best(values: Sequence[float]) -> float | None:
    if not values:
        return None
    remaining = list(values)
    remaining.pop(remaining.index(max(remaining)))
    return pf(remaining)


def configure_stock_period() -> None:
    legacy.PERIOD_START = START
    legacy.PERIOD_END = END
    legacy.START_MS = START_MS
    legacy.END_MS = END_MS
    legacy.base.PERIOD_START = START
    legacy.base.PERIOD_END = END
    legacy.base.START_MS = START_MS
    legacy.base.END_MS = END_MS


def load_stock(cache_root: Path):
    configure_stock_period()
    v11, v50, days, diagnostics = legacy.build_stock(cache_root)
    return (
        [row for row in v11 if START_MS <= int(row["entryTs"]) < END_MS],
        [row for row in v50 if START_MS <= int(row["entryTs"]) < END_MS],
        days,
        diagnostics,
    )


def event_metrics(events: Sequence[dict], equity_path: Sequence[dict], ending_equity: float) -> dict:
    returns = [finite(row.get("eventReturn")) for row in events]
    peak = 1.0
    max_dd = 0.0
    for row in equity_path:
        equity = finite(row.get("equity"), 1.0)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "trades": len(events),
        "endingEquity": ending_equity,
        "returnPct": (ending_equity - 1.0) * 100.0,
        "profitFactor": pf(returns),
        "profitFactorWithoutBest": pf_without_best(returns),
        "maxDrawdownPctClosedEvent": max_dd * 100.0,
        "winRatePct": sum(value > 0 for value in returns) / len(returns) * 100.0 if returns else None,
        "bySleeve": {
            sleeve: {
                "trades": sum(row["strategy"] == sleeve for row in events),
                "contributionPctOfInitialEquity": sum(finite(row.get("pnl")) for row in events if row["strategy"] == sleeve) * 100.0,
            }
            for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V11_EQ", "V50_POST_OPEN_BASIS")
        },
    }


def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], *, v12_aggregate_cap: float, v12_max_positions: int, stock_cost_bps: float) -> dict:
    timeline: List[dict] = []
    for trade in v12_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "V12_ENTRY", "ts": int(trade["entryTs"]), "priority": 3, "trade": trade})
    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "PENGU_ENTRY", "ts": int(trade["entryTs"]), "priority": 2, "trade": trade})
    for trade in list(v11_rows) + list(v50_rows):
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "STOCK_ENTRY", "ts": int(trade["entryTs"]), "priority": 1, "trade": trade})
    timeline.sort(key=lambda item: (item["ts"], item["priority"], str(item["kind"])))
    active_v12: Dict[str, dict] = {}
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    equity = 1.0
    equity_path = [{"ts": START_MS, "equity": equity}]
    events: List[dict] = []
    diagnostics = defaultdict(int)
    current_day: str | None = None
    day_start_equity = 1.0
    crypto_day_pnl = stock_day_pnl = 0.0
    crypto_latched = stock_latched = False
    maxima = {"v12": 0.0, "pengu": 0.0, "stock": 0.0, "crypto": 0.0, "total": 0.0}

    def gross() -> tuple[float, float, float]:
        v12 = sum(finite(row["allocatedGross"]) for row in active_v12.values())
        pengu = finite(active_pengu.get("allocatedGross")) if active_pengu else 0.0
        stock_gross = sum(finite(row["allocatedGross"]) for row in active_stock.values())
        return v12, pengu, stock_gross

    def observe() -> None:
        v12, pengu, stock_gross = gross()
        maxima["v12"] = max(maxima["v12"], v12)
        maxima["pengu"] = max(maxima["pengu"], pengu)
        maxima["stock"] = max(maxima["stock"], stock_gross)
        maxima["crypto"] = max(maxima["crypto"], v12 + pengu)
        maxima["total"] = max(maxima["total"], v12 + pengu + stock_gross)

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            crypto_day_pnl = stock_day_pnl = 0.0
            crypto_latched = stock_latched = False

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        equity = max(0.001, equity + pnl)
        event_return = pnl / before
        events.append({"ts": ts, "strategy": strategy, "symbol": position.get("symbol"), "pnl": pnl, "eventReturn": event_return, "allocatedGross": position.get("allocatedGross")})
        equity_path.append({"ts": ts, "equity": equity})
        if strategy in ("V12", "PENGU_DUAL_LS_V2"):
            crypto_day_pnl += pnl
            if crypto_day_pnl / max(0.001, day_start_equity) <= CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched = True
        else:
            stock_day_pnl += pnl
            if stock_day_pnl / max(0.001, day_start_equity) <= STOCK_DAILY_LOSS_LIMIT:
                stock_latched = True

    def sort_future(from_index: int) -> None:
        timeline[from_index + 1:] = sorted(timeline[from_index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))

    index = 0
    while index < len(timeline):
        item = timeline[index]
        ts = int(item["ts"])
        reset_day(ts)
        kind = item["kind"]
        if kind == "V12_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                diagnostics["V12_DAILY_LOSS_BLOCKED"] += 1
            elif len(active_v12) >= v12_max_positions:
                diagnostics["V12_MAX_POSITIONS_BLOCKED"] += 1
            else:
                v12_gross, pengu_gross, stock_gross = gross()
                requested = min(V12_POSITION_CAP, max(0.0, finite(trade.get("requestedGross"))))
                available = min(v12_aggregate_cap - v12_gross, CRYPTO_CAP - pengu_gross - v12_gross, TOTAL_CAP - pengu_gross - v12_gross - stock_gross)
                allocated = min(requested, max(0.0, available))
                if allocated <= 1e-12:
                    diagnostics["V12_RESIDUAL_BLOCKED"] += 1
                else:
                    position_id = f"{trade.get('symbol')}:{trade.get('entryTs')}:{trade.get('exitTs')}"
                    active_v12[position_id] = {"symbol": trade.get("symbol"), "allocatedGross": allocated, "entryNotional": equity * allocated, "netUnitReturn": finite(trade.get("netUnitReturn"))}
                    timeline.append({"kind": "V12_EXIT", "ts": int(trade["exitTs"]), "priority": 0, "positionId": position_id})
                    sort_future(index)
                    diagnostics["V12_ENTERED"] += 1
                    if allocated < requested - 1e-12:
                        diagnostics["V12_SCALED"] += 1
                    observe()
        elif kind == "V12_EXIT":
            position = active_v12.pop(str(item["positionId"]), None)
            if position:
                realize(ts, position, "V12")
                diagnostics["V12_EXITED"] += 1
                observe()
        elif kind == "PENGU_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                diagnostics["PENGU_DAILY_LOSS_BLOCKED"] += 1
            elif active_pengu is not None:
                diagnostics["PENGU_SLOT_OCCUPIED"] += 1
            else:
                v12_gross, _, stock_gross = gross()
                requested = min(PENGU_CAP, max(0.0, finite(trade.get("requestedGross"))))
                available = min(CRYPTO_CAP - v12_gross, TOTAL_CAP - v12_gross - stock_gross)
                allocated = min(requested, max(0.0, available))
                if allocated > 1e-12:
                    active_pengu = {"symbol": "PENGUUSDT", "allocatedGross": allocated, "entryNotional": equity * allocated, "netUnitReturn": finite(trade.get("netUnitReturn"))}
                    timeline.append({"kind": "PENGU_EXIT", "ts": int(trade["exitTs"]), "priority": 0})
                    sort_future(index)
                    diagnostics["PENGU_ENTERED"] += 1
                    observe()
                else:
                    diagnostics["PENGU_CAPACITY_BLOCKED"] += 1
        elif kind == "PENGU_EXIT":
            if active_pengu:
                realize(ts, active_pengu, "PENGU_DUAL_LS_V2")
                active_pengu = None
                diagnostics["PENGU_EXITED"] += 1
                observe()
        elif kind == "STOCK_ENTRY":
            trade = item["trade"]
            strategy = str(trade["strategy"])
            if stock_latched:
                diagnostics["STOCK_DAILY_LOSS_BLOCKED"] += 1
            elif any(row["strategy"] == strategy for row in active_stock.values()) or any(row["symbol"] == str(trade["symbol"]) for row in active_stock.values()):
                diagnostics["STOCK_SLOT_OCCUPIED"] += 1
            else:
                unit = legacy.stock.unit_trade_value(trade, stock_cost_bps)
                if unit is None:
                    diagnostics["STOCK_COST_EDGE_REJECTED"] += 1
                else:
                    v12_gross, pengu_gross, stock_gross = gross()
                    cap = 1.0
                    available = min(cap, STOCK_CAP - stock_gross, TOTAL_CAP - v12_gross - pengu_gross - stock_gross)
                    if available > 1e-12:
                        position_id = f"{strategy}:{trade['symbol']}:{trade['entryTs']}:{trade['exitTs']}"
                        active_stock[position_id] = {"strategy": strategy, "symbol": str(trade["symbol"]), "allocatedGross": available, "entryNotional": equity * available, "netUnitReturn": finite(unit)}
                        timeline.append({"kind": "STOCK_EXIT", "ts": int(trade["exitTs"]), "priority": 0, "positionId": position_id})
                        sort_future(index)
                        diagnostics[f"{strategy}_ENTERED"] += 1
                        observe()
                    else:
                        diagnostics["STOCK_CAPACITY_BLOCKED"] += 1
        elif kind == "STOCK_EXIT":
            position = active_stock.pop(str(item["positionId"]), None)
            if position:
                realize(ts, position, str(position["strategy"]))
                diagnostics[f"{position['strategy']}_EXITED"] += 1
                observe()
        else:
            raise RuntimeError(f"UNKNOWN_EVENT:{kind}")
        index += 1
    metrics = event_metrics(events, equity_path, equity)
    return {**metrics, "observedMaximumV12Gross": maxima["v12"], "observedMaximumPenguGross": maxima["pengu"], "observedMaximumCryptoGross": maxima["crypto"], "observedMaximumStockGross": maxima["stock"], "observedMaximumTotalGross": maxima["total"], "routingDiagnostics": dict(diagnostics)}


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output: Path) -> dict:
    v12 = load_json(v12_path)
    pengu = load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("UNEXPECTED_V12_LEDGER_SCHEMA")
    v11, v50, target_days, stock_diagnostics = load_stock(stock_cache)
    variants = [
        {"variantId": "CURRENT_ONE_SLOT", "v12AggregateGrossCap": 1.0, "v12MaximumPositions": 1},
        {"variantId": "TOP2_AGGREGATE_1.00", "v12AggregateGrossCap": 1.0, "v12MaximumPositions": 2},
        {"variantId": "TOP2_AGGREGATE_1.25", "v12AggregateGrossCap": 1.25, "v12MaximumPositions": 2},
        {"variantId": "TOP2_AGGREGATE_1.50", "v12AggregateGrossCap": 1.5, "v12MaximumPositions": 2},
    ]
    results: Dict[str, dict] = {}
    for scenario, mode in (("NORMAL", "normal"), ("STRESS", "stress")):
        results[scenario] = {}
        v12_trades = v12["modes"]["ALL"][mode]["trades"]
        pengu_trades = pengu["modes"][mode]["trades"]
        stock_cost = float(legacy.stock.SCENARIOS["NORMAL" if scenario == "NORMAL" else "SEVERE"])
        for variant in variants:
            results[scenario][variant["variantId"]] = simulate(v12_trades, pengu_trades, v11, v50, v12_aggregate_cap=variant["v12AggregateGrossCap"], v12_max_positions=variant["v12MaximumPositions"], stock_cost_bps=stock_cost)
    summary = []
    for variant in variants:
        normal = results["NORMAL"][variant["variantId"]]
        stress = results["STRESS"][variant["variantId"]]
        summary.append({**variant, "normalReturnPct": normal["returnPct"], "normalPf": normal["profitFactor"], "normalDdPct": normal["maxDrawdownPctClosedEvent"], "stressReturnPct": stress["returnPct"], "stressPf": stress["profitFactor"], "stressDdPct": stress["maxDrawdownPctClosedEvent"], "maxObservedTotalGross": max(normal["observedMaximumTotalGross"], stress["observedMaximumTotalGross"]), "v12NormalTrades": normal["bySleeve"]["V12"]["trades"], "v12StressTrades": stress["bySleeve"]["V12"]["trades"]})
    checks = {
        "variantCount4": len(variants) == 4,
        "allNormalGrossWithinCaps": all(results["NORMAL"][v["variantId"]]["observedMaximumTotalGross"] <= TOTAL_CAP + 1e-9 for v in variants),
        "allStressGrossWithinCaps": all(results["STRESS"][v["variantId"]]["observedMaximumTotalGross"] <= TOTAL_CAP + 1e-9 for v in variants),
        "ordersNeverSent": True,
        "liveUnchanged": True,
    }
    result = {
        "schema": "v12-top2-residual-gross-bt/v1",
        "status": "PASS_RESEARCH_ONLY" if all(checks.values()) else "DIAGNOSTIC_RESEARCH_ONLY",
        "generatedAt": dt.datetime.now(tz=UTC).isoformat(),
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat(), "calendarDays": (END - START).days},
        "architecture": {"v12AggregateGrossCapsCompared": [1.0, 1.25, 1.5], "v12PerPositionGrossCap": 1.0, "v12MaximumPositions": 2, "penguMaximumGross": 0.75, "cryptoGrossCap": 1.5, "stockGrossCap": 1.5, "totalGrossCap": 2.5, "rank1First": True, "rank2RequiresResidual": True, "mtmDriftDoesNotForceClose": True},
        "candidateStream": {"source": v12.get("source"), "policy": "ALL", "rank2CandidateAvailableOnlyWhenFrozenLedgerContainsOverlap": True, "note": "This ablation replays the frozen V12 ledger; it does not invent future or shadow trades."},
        "data": {"v12TradeCount": len(v12["modes"]["ALL"]["normal"]["trades"]), "penguTradeCount": len(pengu["modes"]["normal"]["trades"]), "stockTargetSessions": len(target_days), "stockDiagnostics": stock_diagnostics},
        "variantSummary": summary,
        "results": results,
        "checks": checks,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False, "liveEligible": False},
        "limitations": ["The frozen V12 research ledger contains realized strategy candidates only; no synthetic rank2 signals are introduced.", "Drawdown is closed-event equity because synchronized intratrade MTM for all sleeves is not present in the ledger.", "This period overlaps prior research and is not an untouched holdout."],
    }
    output.mkdir(parents=True, exist_ok=True)
    output.joinpath("result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with output.joinpath("variant-summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary[0].keys()))
        writer.writeheader()
        writer.writerows(summary)
    lines = ["# V12 Top2 Residual Gross offline ablation", "", f"Period: `{START.isoformat()}` to `{END.isoformat()}`", "", "| Variant | Normal Return | Normal PF | Stress Return | Stress PF | Stress DD | V12 trades (N/S) |", "|---|---:|---:|---:|---:|---:|---:|"]
    for row in summary:
        lines.append(f"| {row['variantId']} | {row['normalReturnPct']:.2f}% | {finite(row['normalPf']):.3f} | {row['stressReturnPct']:.2f}% | {finite(row['stressPf']):.3f} | {row['stressDdPct']:.2f}% | {row['v12NormalTrades']} / {row['v12StressTrades']} |")
    lines += ["", "The result is research-only. No VPS, LIVE flag, kill switch, order, position, or production state is changed.", "", "## Limitations", ""] + [f"- {item}" for item in result["limitations"]]
    output.joinpath("report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-v52-pengu-v2-combined/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-v52-pengu-v2-combined/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v12-top2-residual-gross")
    args = parser.parse_args()
    result = analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    print(json.dumps({"status": result["status"], "variantSummary": result["variantSummary"], "checks": result["checks"], "safety": result["safety"]}, indent=2))


if __name__ == "__main__":
    main()
