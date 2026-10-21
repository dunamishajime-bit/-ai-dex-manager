from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
STOCK_ROOT = REPO_ROOT / ".stock-research"
sys.path.insert(0, str(STOCK_ROOT / "scripts"))

import research_lab_v96_v52_dual_slot_one_year_bt as legacy

stock = legacy.stock

START = dt.datetime(2025, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)

TOTAL_GROSS_CAP = 2.5
CRYPTO_GROSS_CAP = 1.5
STOCK_GROSS_CAP = 1.5
PENGU_MAX_GROSS = 0.75
PENGU_PORTFOLIO_GROSS_CAP = 1.5
V11_GROSS_CAP = 1.0
V50_GROSS_CAP = 1.0
FIRST_STOCK_MIN_GROSS = 0.5
SECOND_STOCK_MIN_GROSS = 0.25
STOCK_DAILY_LOSS_LIMIT = -0.035
CRYPTO_DAILY_LOSS_LIMIT = -0.05

V12_MULTIPLIERS = (0.25, 0.50, 0.75, 1.00)
V12_ENTRY_POLICIES = ("ALL", "US_RTH_OFF", "JST_00_08", "JST_08_16", "JST_16_24")
PRIORITY_ORDERS = ("CRYPTO_FIRST", "STOCK_FIRST")
SCENARIOS = {
    "NORMAL": {"ledgerMode": "normal", "stockCostBps": float(stock.SCENARIOS["NORMAL"])},
    "SEVERE": {"ledgerMode": "stress", "stockCostBps": float(stock.SCENARIOS["SEVERE"])},
}


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def configure_stock_period() -> None:
    legacy.PERIOD_START = START
    legacy.PERIOD_END = END
    legacy.START_MS = START_MS
    legacy.END_MS = END_MS
    legacy.base.PERIOD_START = START
    legacy.base.PERIOD_END = END
    legacy.base.START_MS = START_MS
    legacy.base.END_MS = END_MS


def build_stock(cache_root: Path):
    configure_stock_period()
    v11_rows, v50_rows, target_days, diagnostics = legacy.build_stock(cache_root)
    v11 = [row for row in v11_rows if START_MS <= int(row["entryTs"]) < END_MS]
    v50 = [row for row in v50_rows if START_MS <= int(row["entryTs"]) < END_MS]
    return v11, v50, target_days, diagnostics


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def month_keys(start: dt.datetime, end: dt.datetime) -> List[str]:
    current = dt.datetime(start.year, start.month, 1, tzinfo=UTC)
    keys: List[str] = []
    while current < end:
        keys.append(current.strftime("%Y-%m"))
        current = dt.datetime(current.year + (current.month == 12), 1 if current.month == 12 else current.month + 1, 1, tzinfo=UTC)
    return keys


def pf_without_best(values: Sequence[float]) -> float | None:
    if not values:
        return None
    remaining = list(values)
    remaining.pop(remaining.index(max(remaining)))
    gains = sum(value for value in remaining if value > 0)
    losses = -sum(value for value in remaining if value < 0)
    return gains / losses if losses > 0 else (999.0 if gains > 0 else None)


def event_metrics(events: Sequence[dict], equity_path: Sequence[dict], ending_equity: float) -> dict:
    returns = [finite(event.get("eventReturn")) for event in events]
    gains = sum(value for value in returns if value > 0)
    losses = -sum(value for value in returns if value < 0)
    peak = 1.0
    max_dd = 0.0
    for row in equity_path:
        equity = finite(row.get("equity"), 1.0)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    by_month: Dict[str, List[float]] = defaultdict(list)
    for event in events:
        key = dt.datetime.fromtimestamp(int(event["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        by_month[key].append(finite(event.get("eventReturn")))
    monthly: Dict[str, float] = {}
    for key in month_keys(START, END):
        equity = 1.0
        for value in by_month.get(key, []):
            equity *= max(0.001, 1.0 + value)
        monthly[key] = (equity - 1.0) * 100.0
    worst_month_key = min(monthly, key=monthly.get) if monthly else None
    years = (END_MS - START_MS) / (365.25 * 86_400_000)
    by_sleeve: Dict[str, dict] = {}
    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V11_EQ", "V50_POST_OPEN_BASIS"):
        rows = [event for event in events if event["strategy"] == sleeve]
        by_sleeve[sleeve] = {
            "events": len(rows),
            "contributionPctOfInitialEquity": sum(finite(row.get("pnl")) for row in rows) * 100.0,
            "wins": sum(finite(row.get("pnl")) > 0 for row in rows),
        }
    return {
        "events": len(events),
        "endingEquity": ending_equity,
        "compoundedReturnPct": (ending_equity - 1.0) * 100.0,
        "cagrPct": (ending_equity ** (1.0 / years) - 1.0) * 100.0 if ending_equity > 0 else -100.0,
        "profitFactor": gains / losses if losses > 0 else (999.0 if gains > 0 else None),
        "profitFactorWithoutBest": pf_without_best(returns),
        "maxDrawdownPctClosedEvent": max_dd * 100.0,
        "winRatePct": sum(value > 0 for value in returns) / len(returns) * 100.0 if returns else None,
        "positiveMonthRatePct": sum(value > 0 for value in monthly.values()) / len(monthly) * 100.0 if monthly else None,
        "worstMonth": {"month": worst_month_key, "returnPct": monthly.get(worst_month_key) if worst_month_key else None},
        "monthlyReturnPct": monthly,
        "bySleeve": by_sleeve,
    }


def simulate(
    v12_trades: Sequence[dict],
    pengu_trades: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    v12_multiplier: float,
    stock_cost_bps: float,
    priority_order: str,
) -> dict:
    if priority_order not in PRIORITY_ORDERS:
        raise RuntimeError(f"Unknown priority order: {priority_order}")
    entry_priority = {
        "CRYPTO_FIRST": {"PENGU_ENTRY": 1, "V12_ENTRY": 2, "STOCK_ENTRY": 3},
        "STOCK_FIRST": {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3},
    }[priority_order]
    timeline: List[dict] = []
    if v12_multiplier > 0:
        for trade in v12_trades:
            if START_MS <= int(trade["entryTs"]) < END_MS:
                timeline.append({"kind": "V12_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["V12_ENTRY"]})
    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "PENGU_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["PENGU_ENTRY"]})
    for trade in list(v11_rows) + list(v50_rows):
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "STOCK_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["STOCK_ENTRY"]})
    timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"]), str(row.get("trade", {}).get("strategy", ""))))

    active_v12: dict | None = None
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    events: List[dict] = []
    equity_path: List[dict] = [{"ts": START_MS, "equity": 1.0}]
    stats: Counter[str] = Counter()
    equity = 1.0
    current_day: str | None = None
    day_start_equity = 1.0
    stock_day_pnl = crypto_day_pnl = 0.0
    stock_latched = crypto_latched = False
    max_v12 = max_pengu = max_stock = max_crypto = max_total = 0.0

    def v12_gross() -> float:
        return finite(active_v12.get("allocatedGross")) if active_v12 else 0.0

    def pengu_gross() -> float:
        return finite(active_pengu.get("allocatedGross")) if active_pengu else 0.0

    def stock_gross() -> float:
        return sum(finite(position.get("allocatedGross")) for position in active_stock.values())

    def observe() -> None:
        nonlocal max_v12, max_pengu, max_stock, max_crypto, max_total
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        max_v12 = max(max_v12, vg)
        max_pengu = max(max_pengu, pg)
        max_stock = max(max_stock, sg)
        max_crypto = max(max_crypto, vg + pg)
        max_total = max(max_total, vg + pg + sg)

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            stock_day_pnl = 0.0
            crypto_day_pnl = 0.0
            stock_latched = False
            crypto_latched = False

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        equity = max(0.001, equity + pnl)
        event_return = pnl / before
        events.append({
            "ts": ts,
            "strategy": strategy,
            "symbol": position.get("symbol"),
            "pnl": pnl,
            "eventReturn": event_return,
            "allocatedGross": finite(position.get("allocatedGross")),
            "requestedGross": finite(position.get("requestedGross")),
            "exitReason": position.get("exitReason"),
        })
        equity_path.append({"ts": ts, "equity": equity})
        if strategy in ("V12", "PENGU_DUAL_LS_V2"):
            crypto_day_pnl += pnl
            if not crypto_latched and crypto_day_pnl / max(0.001, day_start_equity) <= CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched = True
                stats["CRYPTO_DAILY_LOSS_LATCHES"] += 1
        else:
            stock_day_pnl += pnl
            if not stock_latched and stock_day_pnl / max(0.001, day_start_equity) <= STOCK_DAILY_LOSS_LIMIT:
                stock_latched = True
                stats["STOCK_DAILY_LOSS_LATCHES"] += 1

    index = 0
    while index < len(timeline):
        item = timeline[index]
        ts = int(item["ts"])
        reset_day(ts)
        kind = str(item["kind"])

        if kind == "V12_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["V12_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if active_v12 is not None:
                stats["V12_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            requested = max(0.0, finite(trade.get("requestedGross")) * v12_multiplier)
            available = min(
                max(0.0, CRYPTO_GROSS_CAP - pengu_gross()),
                max(0.0, TOTAL_GROSS_CAP - pengu_gross() - stock_gross()),
            )
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["V12_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            active_v12 = {
                "symbol": trade.get("symbol"),
                "allocatedGross": allocated,
                "requestedGross": requested,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < requested - 1e-12:
                stats["V12_GROSS_SCALED"] += 1
            timeline.append({"kind": "V12_EXIT", "ts": int(trade["exitTs"]), "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats["V12_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "V12_EXIT":
            if active_v12 is None:
                stats["V12_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_v12
                active_v12 = None
                realize(ts, position, "V12")
                stats["V12_EXITED"] += 1
                observe()
            index += 1
            continue

        if kind == "PENGU_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["PENGU_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
            other_gross = v12_gross() + stock_gross()
            available = min(
                max(0.0, CRYPTO_GROSS_CAP - v12_gross()),
                max(0.0, TOTAL_GROSS_CAP - other_gross),
                max(0.0, PENGU_PORTFOLIO_GROSS_CAP - other_gross),
            )
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_PORTFOLIO_CAP_BLOCKED"] += 1
                index += 1
                continue
            active_pengu = {
                "symbol": "PENGUUSDT",
                "allocatedGross": allocated,
                "requestedGross": requested,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < requested - 1e-12:
                stats["PENGU_GROSS_SCALED"] += 1
            timeline.append({"kind": "PENGU_EXIT", "ts": int(trade["exitTs"]), "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats["PENGU_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "PENGU_EXIT":
            if active_pengu is None:
                stats["PENGU_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_pengu
                active_pengu = None
                realize(ts, position, "PENGU_DUAL_LS_V2")
                stats["PENGU_EXITED"] += 1
                observe()
            index += 1
            continue

        if kind == "STOCK_ENTRY":
            trade = item["trade"]
            strategy = str(trade["strategy"])
            if stock_latched:
                stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):
                stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                index += 1
                continue
            unit_return = stock.unit_trade_value(trade, stock_cost_bps)
            if unit_return is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                index += 1
                continue
            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            available = min(
                slot_cap,
                max(0.0, STOCK_GROSS_CAP - stock_gross()),
                max(0.0, TOTAL_GROSS_CAP - v12_gross() - pengu_gross() - stock_gross()),
            )
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            if available + 1e-12 < minimum:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            allocated = available
            pid = f"{strategy}:{trade['symbol']}:{int(trade['entryTs'])}:{int(trade['exitTs'])}"
            active_stock[pid] = {
                "strategy": strategy,
                "symbol": str(trade["symbol"]),
                "allocatedGross": allocated,
                "requestedGross": slot_cap,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(unit_return),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < slot_cap - 1e-12:
                stats[f"{strategy}_GROSS_SCALED"] += 1
            timeline.append({"kind": "STOCK_EXIT", "ts": int(trade["exitTs"]), "priority": 0, "positionId": pid})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats[f"{strategy}_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "STOCK_EXIT":
            position = active_stock.pop(str(item["positionId"]), None)
            if position is None:
                stats["STOCK_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                realize(ts, position, str(position["strategy"]))
                stats[f"{position['strategy']}_EXITED"] += 1
                observe()
            index += 1
            continue

        raise RuntimeError(f"Unknown event kind: {kind}")

    metrics = event_metrics(events, equity_path, equity)
    return rounded({
        **metrics,
        "observedMaximumV12Gross": max_v12,
        "observedMaximumPenguGross": max_pengu,
        "observedMaximumCryptoGross": max_crypto,
        "observedMaximumStockGross": max_stock,
        "observedMaximumTotalGross": max_total,
        "routingDiagnostics": dict(stats),
    })


def variant_rows(results: dict) -> List[dict]:
    rows: List[dict] = []
    baseline_normal = results["NORMAL"]["BASELINE_PENGU_STOCK"]["CRYPTO_FIRST"]
    baseline_severe = results["SEVERE"]["BASELINE_PENGU_STOCK"]["CRYPTO_FIRST"]
    for variant_id in results["NORMAL"]:
        config = results["NORMAL"][variant_id]["config"]
        normal = results["NORMAL"][variant_id]
        severe = results["SEVERE"][variant_id]
        normal_returns = [normal[order]["compoundedReturnPct"] for order in PRIORITY_ORDERS]
        severe_returns = [severe[order]["compoundedReturnPct"] for order in PRIORITY_ORDERS]
        severe_pfs = [finite(severe[order]["profitFactor"]) for order in PRIORITY_ORDERS]
        severe_pfwb = [finite(severe[order]["profitFactorWithoutBest"]) for order in PRIORITY_ORDERS]
        severe_dd = [finite(severe[order]["maxDrawdownPctClosedEvent"]) for order in PRIORITY_ORDERS]
        max_total = max(normal[order]["observedMaximumTotalGross"] for order in PRIORITY_ORDERS)
        row = {
            "variantId": variant_id,
            **config,
            "normalReturnPct": normal["CRYPTO_FIRST"]["compoundedReturnPct"],
            "normalPf": normal["CRYPTO_FIRST"]["profitFactor"],
            "normalPfWithoutBest": normal["CRYPTO_FIRST"]["profitFactorWithoutBest"],
            "normalDdPct": normal["CRYPTO_FIRST"]["maxDrawdownPctClosedEvent"],
            "severeReturnPct": severe["CRYPTO_FIRST"]["compoundedReturnPct"],
            "severePf": severe["CRYPTO_FIRST"]["profitFactor"],
            "severePfWithoutBest": severe["CRYPTO_FIRST"]["profitFactorWithoutBest"],
            "severeDdPct": severe["CRYPTO_FIRST"]["maxDrawdownPctClosedEvent"],
            "worstPriorityNormalReturnPct": min(normal_returns),
            "worstPrioritySevereReturnPct": min(severe_returns),
            "worstPrioritySeverePf": min(severe_pfs),
            "worstPrioritySeverePfWithoutBest": min(severe_pfwb),
            "worstPrioritySevereDdPct": min(severe_dd),
            "normalPriorityDeltaPctPoint": abs(normal_returns[0] - normal_returns[1]),
            "normalGainVsBaselinePctPoint": normal["CRYPTO_FIRST"]["compoundedReturnPct"] - baseline_normal["compoundedReturnPct"],
            "severeGainVsBaselinePctPoint": severe["CRYPTO_FIRST"]["compoundedReturnPct"] - baseline_severe["compoundedReturnPct"],
            "maxObservedTotalGross": max_total,
        }
        row["gatePass"] = bool(
            config["v12Multiplier"] > 0
            and row["normalGainVsBaselinePctPoint"] > 0
            and row["severeGainVsBaselinePctPoint"] > 0
            and row["worstPrioritySeverePf"] >= 1.20
            and row["worstPrioritySeverePfWithoutBest"] >= 1.0
            and row["worstPrioritySevereDdPct"] >= -25.0
            and max_total <= TOTAL_GROSS_CAP + 1e-9
        )
        row["robustScore"] = row["worstPrioritySevereReturnPct"] + 0.35 * row["worstPrioritySevereDdPct"] - 0.25 * row["normalPriorityDeltaPctPoint"]
        rows.append(rounded(row))
    return sorted(rows, key=lambda row: (bool(row["gatePass"]), finite(row["robustScore"])), reverse=True)


def write_report(output: Path, result: dict) -> None:
    rows = result["variantSummary"]
    top = [row for row in rows if row["variantId"] != "BASELINE_PENGU_STOCK"][:10]
    recommended = result.get("provisionalRecommendation")
    lines = [
        "# V12 + PENGU V2 + V52 Stocks — latest one-year unified backtest",
        "",
        f"- Period: `{result['period']['startInclusive']}` to `{result['period']['endExclusive']}`",
        f"- Status: `{result['status']}`",
        f"- Provisional candidate: `{recommended['variantId'] if recommended else 'NONE'}`",
        "- V12 time controls gate new entries only; exits and venue-resident stops remain active 24/7.",
        "",
        "| Rank | Variant | V12 × | Entry policy | Normal return | Severe return | Severe PF | Severe PF w/o best | Severe DD | Gate |",
        "|---:|---|---:|---|---:|---:|---:|---:|---:|:---:|",
    ]
    for rank, row in enumerate(top, 1):
        lines.append(
            f"| {rank} | {row['variantId']} | {row['v12Multiplier']:.2f} | {row['entryPolicy']} | "
            f"{row['normalReturnPct']:.2f}% | {row['severeReturnPct']:.2f}% | {finite(row['severePf']):.3f} | "
            f"{finite(row['severePfWithoutBest']):.3f} | {row['severeDdPct']:.2f}% | {'PASS' if row['gatePass'] else 'FAIL'} |"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "The ranking is a one-year portfolio-routing comparison, not an independent untouched holdout. The selected row is therefore a shadow/paper candidate only; it is not marked LIVE eligible.",
        "",
        "## Key limitations",
        "",
    ]
    lines.extend(f"- {item}" for item in result["limitations"])
    output.joinpath("report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output: Path) -> dict:
    v12 = load_json(v12_path)
    pengu = load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("Unexpected V12 ledger schema")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU strategy")
    if v12["period"]["startInclusive"] != START.isoformat().replace("+00:00", ".000Z") or v12["period"]["endExclusive"] != END.isoformat().replace("+00:00", ".000Z"):
        raise RuntimeError("V12 ledger period mismatch")
    if pengu["period"] != v12["period"]:
        raise RuntimeError("PENGU/V12 period mismatch")
    v11_rows, v50_rows, target_days, stock_diagnostics = build_stock(stock_cache)
    variants = [{"variantId": "BASELINE_PENGU_STOCK", "v12Multiplier": 0.0, "entryPolicy": "NONE"}]
    variants.extend(
        {"variantId": f"V12_X{multiplier:.2f}_{policy}", "v12Multiplier": multiplier, "entryPolicy": policy}
        for policy in V12_ENTRY_POLICIES for multiplier in V12_MULTIPLIERS
    )
    results: Dict[str, dict] = {}
    for scenario, assumptions in SCENARIOS.items():
        mode = str(assumptions["ledgerMode"])
        results[scenario] = {}
        pengu_trades = pengu["modes"][mode]["trades"]
        for variant in variants:
            policy = str(variant["entryPolicy"])
            v12_trades = [] if policy == "NONE" else v12["modes"][policy][mode]["trades"]
            row: Dict[str, Any] = {"config": variant}
            for order in PRIORITY_ORDERS:
                row[order] = simulate(
                    v12_trades=v12_trades,
                    pengu_trades=pengu_trades,
                    v11_rows=v11_rows,
                    v50_rows=v50_rows,
                    v12_multiplier=finite(variant["v12Multiplier"]),
                    stock_cost_bps=finite(assumptions["stockCostBps"]),
                    priority_order=order,
                )
            results[scenario][str(variant["variantId"])] = row
    summary = variant_rows(results)
    eligible = [row for row in summary if row["gatePass"]]
    recommendation = eligible[0] if eligible else None
    checks = {
        "v12LineageNormal223Trades": int(v12["lineage"]["normal"]["tradeCount"]) == 223,
        "v12LineageNormalReturnParity": abs(finite(v12["lineage"]["normal"]["returnPct"]) - 110.517) <= 0.20,
        "v12LineageStressParity": abs(finite(v12["lineage"]["stress"]["returnPct"]) - 58.230) <= 0.30,
        "penguAsterProductionReplayPlausible": 25 <= int(pengu["modes"]["normal"]["metrics"]["trades"]) <= 40,
        "penguNoOverlap": bool(pengu["integrity"]["noOverlap"]),
        "variantCount21": len(variants) == 21,
        "allNormalGrossWithinCap": all(
            results["NORMAL"][variant["variantId"]][order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9
            for variant in variants for order in PRIORITY_ORDERS
        ),
        "allSevereGrossWithinCap": all(
            results["SEVERE"][variant["variantId"]][order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9
            for variant in variants for order in PRIORITY_ORDERS
        ),
    }
    result = rounded({
        "schema": "v12-v52-pengu-v2-combined-bt/v1",
        "strategyId": "V12_PLUS_PENGU_DUAL_LS_V2_PLUS_V52_STOCKS",
        "status": "PASS_RESEARCH_ONLY" if all(checks.values()) else "DIAGNOSTIC_RESEARCH_ONLY",
        "generatedAt": dt.datetime.now(tz=UTC).isoformat(),
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat(), "calendarDays": (END - START).days},
        "sourceLineage": {
            "deployedVpsSha": "6f4d06fd990e5e847895b59c4890bb80335ff03e",
            "v12Sha": "27f023a37d08b71c6e59b797fdc03c20d6032da2",
            "stockResearchSha": "04c1a369223bd27e9e42bc93604b3777b9230d92",
            "v11DependencySha": "0fad24c105a7f0f61af6042ba04a8b1386ffec7c",
            "v13DependencySha": "dbfd7e026a81343a23ab97d202761f7f9bbe5755",
        },
        "architecture": {
            "v96Included": False,
            "v12Multipliers": list(V12_MULTIPLIERS),
            "v12EntryPolicies": list(V12_ENTRY_POLICIES),
            "entryPolicyAffectsNewEntriesOnly": True,
            "residentStopsAndExitsAlwaysActive": True,
            "penguVersion": "PENGU_DUAL_LS_V2_FINAL",
            "v52Stocks": ["V11_EQ", "V50_POST_OPEN_BASIS"],
            "totalGrossCap": TOTAL_GROSS_CAP,
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "penguMaxGross": PENGU_MAX_GROSS,
            "penguPortfolioGrossCapIncludesOtherAsterPositions": PENGU_PORTFOLIO_GROSS_CAP,
            "stockDailyLossPct": abs(STOCK_DAILY_LOSS_LIMIT) * 100,
            "cryptoDailyLossPctConservativeModel": abs(CRYPTO_DAILY_LOSS_LIMIT) * 100,
            "prioritySensitivity": list(PRIORITY_ORDERS),
        },
        "costScenarios": {
            "NORMAL": {"v12": "5 bps fee/side, zero slippage", "pengu": "6 bps fee/side plus actual Aster funding", "stockRoundTripBps": SCENARIOS["NORMAL"]["stockCostBps"]},
            "SEVERE": {"v12": "10 bps fee + 5 bps slippage/side, 5% deterministic claimed-owner entry loss seed d, one 2h resident-stop update lag", "pengu": "normal plus 35 bps adverse/side, actual Aster funding", "stockRoundTripBps": SCENARIOS["SEVERE"]["stockCostBps"]},
        },
        "data": {
            "v12": {"source": v12["source"], "lineageNormal": {key: value for key, value in v12["lineage"]["normal"].items() if key != "trades"}, "lineageStress": {key: value for key, value in v12["lineage"]["stress"].items() if key != "trades"}},
            "pengu": {"source": pengu["source"], "data": pengu["data"], "researchCheckpoint": pengu["researchCheckpoint"], "normalMetrics": pengu["modes"]["normal"]["metrics"], "stressMetrics": pengu["modes"]["stress"]["metrics"]},
            "stocks": {"targetSessions": len(target_days), "v11RawTrades": len(v11_rows), "v50RawTrades": len(v50_rows), "diagnostics": stock_diagnostics},
        },
        "variantSummary": summary,
        "provisionalRecommendation": recommendation,
        "selectionRule": {
            "status": "PROVISIONAL_ONE_YEAR_ONLY",
            "gate": "positive normal and severe gain vs no-V12 baseline; worst-priority severe PF >=1.20; PF without best >=1.0; closed-event DD <=25%; gross cap respected",
            "ranking": "worst-priority severe return + 0.35*severe DD - 0.25*normal priority-order delta",
        },
        "results": results,
        "checks": checks,
        "limitations": [
            "The latest year overlaps strategy research and is not an untouched independent holdout; the recommendation is for shadow/paper validation only.",
            "Combined drawdown is measured on completed events because synchronized mark-to-market paths for all three sleeves are unavailable; intratrade drawdown can be worse.",
            "V52 stock execution is an observable historical proxy and cannot reconstruct queue position, partial fills, spread, or sub-second slippage.",
            "US_RTH_OFF uses New York weekday/time boundaries; US exchange holidays are not separately removed from the V12 time gate.",
            "The crypto 5% daily latch is modeled conservatively. The deployed PENGU runner only consumes a portfolio daily-loss file when that VPS environment path is configured.",
            "The shared kill switch and exogenous operational failures cannot be reconstructed from market history.",
        ],
        "dataQualityWarnings": [
            {
                "code": "PENGU_ASTER_FROZEN_RESEARCH_CHECKPOINT_DRIFT",
                "active": not bool(pengu["researchCheckpoint"]["matched"]),
                "detail": pengu["researchCheckpoint"]["interpretation"],
                "frozenReference": pengu["researchCheckpoint"]["frozenReference"],
                "currentProductionReplay": pengu["modes"]["normal"]["metrics"],
            }
        ],
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False, "liveEligible": False},
    })
    output.mkdir(parents=True, exist_ok=True)
    output.joinpath("result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with output.joinpath("variant-summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary[0].keys()))
        writer.writeheader()
        writer.writerows(summary)
    write_report(output, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-v52-pengu-v2-combined/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-v52-pengu-v2-combined/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v12-v52-pengu-v2-combined")
    args = parser.parse_args()
    result = analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "provisionalRecommendation": result["provisionalRecommendation"],
        "topFive": [row for row in result["variantSummary"] if row["variantId"] != "BASELINE_PENGU_STOCK"][:5],
        "checks": result["checks"],
        "safety": result["safety"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
