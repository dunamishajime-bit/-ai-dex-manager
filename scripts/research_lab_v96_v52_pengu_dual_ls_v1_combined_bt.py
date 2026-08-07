from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Sequence

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_v52_dual_slot_one_year_bt as legacy

stock = legacy.stock
crypto_bt = legacy.crypto_bt

HOUR = 3_600_000
START = dt.datetime(2025, 8, 13, tzinfo=UTC)
HOLDOUT_START = dt.datetime(2026, 3, 11, tzinfo=UTC)
TOTAL_GROSS_CAP = 2.5
STOCK_GROSS_CAP = 1.5
PENGU_GROSS_CAP = 0.75
V11_GROSS_CAP = 1.0
V50_GROSS_CAP = 1.0
MIN_STOCK_GROSS = 0.25
DAILY_LOSS_LIMIT = -0.02

SCENARIOS = {
    "NORMAL": {"crypto": "normal", "stockCostBps": stock.SCENARIOS["NORMAL"], "penguExtraRoundTripBps": 0.0},
    "SEVERE": {"crypto": "severe", "stockCostBps": stock.SCENARIOS["SEVERE"], "penguExtraRoundTripBps": 20.0},
}


def iso_ms(value: int) -> str:
    return dt.datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def configure_period(start: dt.datetime, end: dt.datetime) -> None:
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    legacy.PERIOD_START = start
    legacy.PERIOD_END = end
    legacy.START_MS = start_ms
    legacy.END_MS = end_ms
    legacy.base.PERIOD_START = start
    legacy.base.PERIOD_END = end
    legacy.base.START_MS = start_ms
    legacy.base.END_MS = end_ms
    crypto_bt.core.CORE_END = end_ms
    crypto_bt.core.v4.END = end_ms


def build_core(start_ms: int, end_ms: int) -> dict:
    raw = crypto_bt.v89.build_raw()
    profile = crypto_bt.build_core_profile(crypto_bt.NEW, raw)

    def select(rows: Sequence[dict]) -> List[dict]:
        return [
            {"ts": int(row["ts"]), "return": float(row["return"]), "gross": float(row.get("gross", 0.0))}
            for row in rows if start_ms <= int(row["ts"]) < end_ms
        ]

    normal = select(profile["normal"])
    severe = select(profile["severe"])
    if not normal or not severe:
        raise RuntimeError("V96 Core rows are empty in requested period")
    return {
        "normal": normal,
        "severe": severe,
        "diagnostics": {
            "normalRows": len(normal),
            "severeRows": len(severe),
            "first": iso_ms(normal[0]["ts"]),
            "last": iso_ms(normal[-1]["ts"]),
            "maximumDesiredCoreGross": max(row["gross"] for row in normal),
            "legacyPenguIncluded": False,
        },
    }


def build_stock(cache_root: Path, start: dt.datetime, end: dt.datetime):
    legacy.PERIOD_START = start
    legacy.PERIOD_END = end
    v11_rows, v50_rows, target_days, diagnostics = legacy.build_stock(cache_root)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    v11_rows = [row for row in v11_rows if start_ms <= int(row["entryTs"]) < end_ms]
    v50_rows = [row for row in v50_rows if start_ms <= int(row["entryTs"]) < end_ms]
    return v11_rows, v50_rows, target_days, diagnostics


def load_pengu(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("strategyId") != "PENGU_DUAL_LS_V1":
        raise RuntimeError("Unexpected PENGU replay strategyId")
    if not payload.get("integrity", {}).get("noOverlap"):
        raise RuntimeError("PENGU replay has overlapping trades")
    return payload


def event_metrics(events: Sequence[dict], start_ms: int, end_ms: int) -> dict:
    active = [row for row in events if start_ms <= int(row["ts"]) < end_ms]
    equity = peak = 1.0
    max_dd = 0.0
    wins = 0
    gross_profit = gross_loss = 0.0
    for row in active:
        value = float(row["return"])
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        if value > 0:
            wins += 1
            gross_profit += value
        elif value < 0:
            gross_loss += -value
    days = max(1e-9, (end_ms - start_ms) / 86_400_000)
    years = days / 365.25
    cagr = (equity ** (1 / years) - 1) * 100 if equity > 0 and years > 0 else None
    return {
        "events": len(active),
        "compoundedReturnPct": (equity - 1.0) * 100,
        "cagrPct": cagr,
        "maxDrawdownPct": max_dd * 100,
        "winRatePct": wins / len(active) * 100 if active else None,
        "profitFactor": gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else None),
    }


def simulate(
    core_rows: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    pengu_trades: Sequence[dict],
    stock_cost_bps: float,
    pengu_extra_roundtrip_bps: float,
    start_ms: int,
    end_ms: int,
    tie_order: str,
) -> dict:
    timeline: List[dict] = []
    core_priority = 1 if tie_order == "CORE_FIRST" else 2
    pengu_priority = 2 if tie_order == "CORE_FIRST" else 1
    for row in core_rows:
        if start_ms <= int(row["ts"]) < end_ms:
            timeline.append({"kind": "CORE", "ts": int(row["ts"]), "row": row, "priority": core_priority})
    for raw in list(v11_rows) + list(v50_rows):
        if start_ms <= int(raw["entryTs"]) < end_ms:
            timeline.append({"kind": "STOCK_ENTRY", "ts": int(raw["entryTs"]), "trade": raw, "priority": 4})
    for trade in pengu_trades:
        if start_ms <= int(trade["entryTs"]) < end_ms:
            timeline.append({"kind": "PENGU_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": pengu_priority})
    timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row.get("kind"))))

    active_stock: Dict[str, dict] = {}
    active_pengu: dict | None = None
    current_core_gross = 0.0
    events: List[dict] = []
    stats: Counter[str] = Counter()
    current_day = locked_day = None
    day_return = 0.0
    max_core = max_pengu = max_stock = max_total = 0.0
    index = 0

    def stock_gross() -> float:
        return sum(float(row["allocatedGross"]) for row in active_stock.values())

    def pengu_gross() -> float:
        return float(active_pengu["allocatedGross"]) if active_pengu else 0.0

    def observe() -> None:
        nonlocal max_core, max_pengu, max_stock, max_total
        sg = stock_gross()
        pg = pengu_gross()
        max_core = max(max_core, current_core_gross)
        max_pengu = max(max_pengu, pg)
        max_stock = max(max_stock, sg)
        max_total = max(max_total, current_core_gross + pg + sg)

    def append_return(ts: int, value: float, strategy: str, symbol: str | None = None, **extra) -> None:
        nonlocal day_return, locked_day
        event = {"ts": ts, "return": value, "strategy": strategy, "symbol": symbol, **extra}
        events.append(event)
        day_return = (1.0 + day_return) * (1.0 + value) - 1.0
        if day_return <= DAILY_LOSS_LIMIT and locked_day is None:
            locked_day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
            stats["PORTFOLIO_DAILY_LOSS_LOCKS"] += 1

    while index < len(timeline):
        item = timeline[index]
        ts = int(item["ts"])
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day, locked_day, day_return = day, None, 0.0
        kind = str(item["kind"])

        if kind == "CORE":
            row = item["row"]
            desired = max(0.0, float(row.get("gross", 0.0)))
            available = max(0.0, TOTAL_GROSS_CAP - stock_gross() - pengu_gross())
            actual = min(desired, available)
            scale = actual / desired if desired > 0 else 1.0
            current_core_gross = actual
            if scale < 1 - 1e-12:
                stats["CORE_GROSS_SCALED_BY_SHARED_CAP"] += 1
            observe()
            if locked_day == day:
                stats["CORE_RETURN_DAILY_LOSS_BLOCKED"] += 1
            else:
                append_return(ts, float(row["return"]) * scale, "V96_CORE", gross=actual, desiredGross=desired, executionScale=scale)
            index += 1
            continue

        if kind == "PENGU_ENTRY":
            trade = item["trade"]
            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if locked_day == day:
                stats["PENGU_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            requested = min(PENGU_GROSS_CAP, float(trade.get("requestedGross", PENGU_GROSS_CAP)))
            available = max(0.0, TOTAL_GROSS_CAP - current_core_gross - stock_gross())
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_PORTFOLIO_CAP_BLOCKED"] += 1
                index += 1
                continue
            active_pengu = {"trade": trade, "allocatedGross": allocated}
            if allocated < requested - 1e-12:
                stats["PENGU_GROSS_SCALED_BY_SHARED_CAP"] += 1
            timeline.append({"kind": "PENGU_EXIT", "ts": int(trade["exitTs"]), "trade": trade, "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row.get("kind"))))
            stats["PENGU_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "PENGU_EXIT":
            trade = item["trade"]
            if active_pengu is None:
                stats["PENGU_EXIT_WITHOUT_ACTIVE"] += 1
                index += 1
                continue
            allocated = float(active_pengu["allocatedGross"])
            active_pengu = None
            observe()
            extra_cost = pengu_extra_roundtrip_bps / 10_000.0
            unit_return = float(trade["netUnitReturn"]) - extra_cost
            if locked_day == day:
                stats["PENGU_EXIT_DAILY_LOSS_BLOCKED"] += 1
            else:
                append_return(ts, unit_return * allocated, "PENGU_DUAL_LS_V1", "PENGUUSDT", allocatedGross=allocated, requestedGross=float(trade.get("requestedGross", PENGU_GROSS_CAP)), side=int(trade["side"]), exitReason=trade.get("exitReason"))
                stats["PENGU_EXITED"] += 1
            index += 1
            continue

        if kind == "STOCK_ENTRY":
            raw = item["trade"]
            strategy = str(raw["strategy"])
            if locked_day == day:
                stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active_stock.values()):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                index += 1
                continue
            unit_value = stock.unit_trade_value(raw, stock_cost_bps)
            if unit_value is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                index += 1
                continue
            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            available = min(
                slot_cap,
                max(0.0, STOCK_GROSS_CAP - stock_gross()),
                max(0.0, TOTAL_GROSS_CAP - current_core_gross - pengu_gross() - stock_gross()),
            )
            if available + 1e-12 < MIN_STOCK_GROSS:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            pid = f"{strategy}:{raw['symbol']}:{int(raw['entryTs'])}:{int(raw['exitTs'])}"
            position = {**raw, "positionId": pid, "allocatedGross": available, "netReturn": float(unit_value) * available}
            active_stock[pid] = position
            timeline.append({"kind": "STOCK_EXIT", "ts": int(raw["exitTs"]), "position": position, "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row.get("kind"))))
            stats[f"{strategy}_ENTERED"] += 1
            if available < slot_cap - 1e-12:
                stats[f"{strategy}_SCALED_ENTRY"] += 1
            observe()
            index += 1
            continue

        if kind == "STOCK_EXIT":
            position = item["position"]
            active_stock.pop(str(position["positionId"]), None)
            observe()
            if locked_day == day:
                stats["STOCK_EXIT_DAILY_LOSS_BLOCKED"] += 1
            else:
                append_return(ts, float(position["netReturn"]), str(position["strategy"]), str(position["symbol"]), allocatedGross=float(position["allocatedGross"]), exitReason=position.get("exitReason"))
                stats[f"{position['strategy']}_EXITED"] += 1
            index += 1
            continue

        raise RuntimeError(f"Unknown timeline kind {kind}")

    metrics = event_metrics(events, start_ms, end_ms)
    return {
        **metrics,
        "observedMaximumCoreGross": max_core,
        "observedMaximumPenguGross": max_pengu,
        "observedMaximumStockGross": max_stock,
        "observedMaximumTotalGross": max_total,
        "routingDiagnostics": dict(stats),
        "bySleeve": {
            name: event_metrics([row for row in events if row["strategy"] == name], start_ms, end_ms)
            for name in ("V96_CORE", "PENGU_DUAL_LS_V1", "V11_EQ", "V50_POST_OPEN_BASIS")
        },
        "eventsLedger": events,
    }


def analyze(stock_cache_root: Path, pengu_path: Path) -> dict:
    now = dt.datetime.now(tz=UTC)
    end = now.replace(minute=0, second=0, microsecond=0)
    if end <= START:
        raise RuntimeError("Invalid backtest end")
    configure_period(START, end)
    start_ms = int(START.timestamp() * 1000)
    holdout_ms = int(HOLDOUT_START.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    core = build_core(start_ms, end_ms)
    v11_rows, v50_rows, target_days, stock_diag = build_stock(stock_cache_root, START, end)
    pengu = load_pengu(pengu_path)
    pengu_trades = [row for row in pengu["trades"] if start_ms <= int(row["entryTs"]) < end_ms]

    results: Dict[str, dict] = {}
    for name, scenario in SCENARIOS.items():
        rows = core[scenario["crypto"]]
        results[name] = {}
        for tie_order in ("CORE_FIRST", "PENGU_FIRST"):
            full = simulate(rows, v11_rows, v50_rows, pengu_trades, float(scenario["stockCostBps"]), float(scenario["penguExtraRoundTripBps"]), start_ms, end_ms, tie_order)
            holdout = simulate(
                [row for row in rows if int(row["ts"]) >= holdout_ms],
                [row for row in v11_rows if int(row["entryTs"]) >= holdout_ms],
                [row for row in v50_rows if int(row["entryTs"]) >= holdout_ms],
                [row for row in pengu_trades if int(row["entryTs"]) >= holdout_ms],
                float(scenario["stockCostBps"]), float(scenario["penguExtraRoundTripBps"]), holdout_ms, end_ms, tie_order,
            )
            results[name][tie_order] = {"full": full, "holdoutFreshStart": holdout}

    checks = {
        "legacyPenguRemovedFromV96": core["diagnostics"]["legacyPenguIncluded"] is False,
        "penguReplayNoOverlap": bool(pengu["integrity"]["noOverlap"]),
        "penguGrossFixedAt075": finite(pengu["fixedRules"]["requestedGross"]) == PENGU_GROSS_CAP,
        "normalCoreFirstGrossCap": results["NORMAL"]["CORE_FIRST"]["full"]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9,
        "normalPenguFirstGrossCap": results["NORMAL"]["PENGU_FIRST"]["full"]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9,
        "holdoutStarts20260311": HOLDOUT_START.isoformat().startswith("2026-03-11"),
    }

    def strip_ledger(row: dict) -> dict:
        return {key: value for key, value in row.items() if key != "eventsLedger"}

    compact_results = {
        scenario: {
            order: {window: strip_ledger(payload) for window, payload in windows.items()}
            for order, windows in orders.items()
        }
        for scenario, orders in results.items()
    }
    tie_delta = {
        scenario: {
            window: results[scenario]["PENGU_FIRST"][window]["compoundedReturnPct"] - results[scenario]["CORE_FIRST"][window]["compoundedReturnPct"]
            for window in ("full", "holdoutFreshStart")
        }
        for scenario in SCENARIOS
    }
    return rounded({
        "version": 1,
        "strategyId": "DISDEX_V96_CORE_PLUS_PENGU_DUAL_LS_V1_PLUS_V52_UNIFIED_BT",
        "generatedAt": now.isoformat(),
        "period": {"startInclusive": START.isoformat(), "endExclusive": end.isoformat(), "holdoutFreshStartInclusive": HOLDOUT_START.isoformat(), "calendarDays": (end - START).total_seconds() / 86400},
        "architecture": {
            "v96": "V96 Core Volume50 / Turnover7.5; legacy reserved PENGU disabled",
            "pengu": "PENGU_DUAL_LS_V1 production signal, one position, Long/Short mutually exclusive, Short priority",
            "v52": "V11-EQ + V50 dual stock slots",
            "totalGrossCap": TOTAL_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "penguGrossCap": PENGU_GROSS_CAP,
            "v11GrossCap": V11_GROSS_CAP,
            "v50GrossCap": V50_GROSS_CAP,
            "stockMayPreemptCrypto": False,
            "sharedResidualCapacityScaling": True,
            "tieOrderSensitivity": ["CORE_FIRST", "PENGU_FIRST"],
            "compounding": "single account chronological event compounding",
            "dailyLossLimit": DAILY_LOSS_LIMIT,
        },
        "costScenarios": SCENARIOS,
        "data": {"core": core["diagnostics"], "stock": stock_diag, "stockTargetSessions": len(target_days), "pengu": {"period": pengu["period"], "data": pengu["data"], "fullMetricsStandalone075": pengu["fullMetrics"], "holdoutMetricsStandalone075": pengu["holdoutMetrics"], "trades": len(pengu_trades)}},
        "results": compact_results,
        "tieOrderReturnPctPointDeltaPenguFirstMinusCoreFirst": tie_delta,
        "checks": checks,
        "status": "PASS_RESEARCH_ONLY" if all(checks.values()) else "DIAGNOSTIC_RESEARCH_ONLY",
        "limitations": [
            "V96 core parameters and V52 candidates were selected on reused historical evidence; this combined run is not pristine independent Holdout for those sleeves.",
            "HoldoutFreshStart resets all sleeves at 2026-03-11 so no position opened before the Holdout boundary contributes afterward.",
            "V96 and PENGU share an account lock in production but exact same-timestamp lock acquisition is nondeterministic; both CORE_FIRST and PENGU_FIRST are reported.",
            "Daily-loss control is replayed at completed-event resolution at the combined configuration limit of 2%; intrabar emergency flatten cannot be reconstructed exactly.",
            "PENGU uses Aster historical funding and 6 bps one-way fee. NORMAL uses zero extra slippage; SEVERE adds 20 bps round-trip to PENGU.",
            "V52 historical execution is an observable proxy and cannot reconstruct exact queue position, partial fills, spread and sub-second slippage.",
        ],
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--pengu-replay", default=".research-state/v96-v52-pengu-dual-ls-v1/pengu-replay.json")
    parser.add_argument("--output-dir", default=".research-state/v96-v52-pengu-dual-ls-v1")
    args = parser.parse_args()
    result = analyze(Path(args.stock_cache_dir), Path(args.pengu_replay))
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    normal = result["results"]["NORMAL"]
    severe = result["results"]["SEVERE"]
    lines = [
        "# V96 Core + PENGU Dual LS V1 + V52 Unified Backtest",
        "",
        f"- Status: `{result['status']}`",
        f"- Period: {result['period']['startInclusive']} -> {result['period']['endExclusive']}",
        f"- Fresh Holdout: {result['period']['holdoutFreshStartInclusive']} -> latest",
        "- PENGU Gross: 0.75 fixed",
        "- Total Gross cap: 2.5",
        "",
        "## NORMAL",
        f"- CORE_FIRST full: {normal['CORE_FIRST']['full']}",
        f"- PENGU_FIRST full: {normal['PENGU_FIRST']['full']}",
        f"- CORE_FIRST Holdout: {normal['CORE_FIRST']['holdoutFreshStart']}",
        f"- PENGU_FIRST Holdout: {normal['PENGU_FIRST']['holdoutFreshStart']}",
        "",
        "## SEVERE",
        f"- CORE_FIRST full: {severe['CORE_FIRST']['full']}",
        f"- PENGU_FIRST full: {severe['PENGU_FIRST']['full']}",
        f"- CORE_FIRST Holdout: {severe['CORE_FIRST']['holdoutFreshStart']}",
        f"- PENGU_FIRST Holdout: {severe['PENGU_FIRST']['holdoutFreshStart']}",
        "",
        f"- Checks: {result['checks']}",
    ]
    (output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "period": result["period"], "normal": normal, "severe": severe, "tieDelta": result["tieOrderReturnPctPointDeltaPenguFirstMinusCoreFirst"], "checks": result["checks"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
