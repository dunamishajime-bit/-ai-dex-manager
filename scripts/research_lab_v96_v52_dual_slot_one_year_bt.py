from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import research_lab_aster_only_v52_dual_slot_basis_engine as stock

portfolio = stock.v14.portfolio
base = portfolio.base
crypto_bt = base.crypto_bt

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_V96_V52_DUAL_SLOT_ONE_YEAR_PORTFOLIO"
VERSION = 53
CRYPTO_GROSS_CAP = 1.0
STOCK_GROSS_CAP = 1.5
TOTAL_GROSS_CAP = 2.5
V11_MAX_GROSS = 1.0
V50_MAX_GROSS = 1.0
DAILY_LOSS_LIMIT = -0.02
PERIOD_START = stock.v19.BT_START
PERIOD_END = stock.v19.BT_END_EXCLUSIVE
START_MS = int(PERIOD_START.timestamp() * 1000)
END_MS = int(PERIOD_END.timestamp() * 1000)

SCENARIOS = {
    "FORWARD_MEDIAN": {"crypto": "normal", "stockCostBps": stock.SCENARIOS["FORWARD_MEDIAN"]},
    "NORMAL": {"crypto": "normal", "stockCostBps": stock.SCENARIOS["NORMAL"]},
    "P95": {"crypto": "normal", "stockCostBps": stock.SCENARIOS["P95"]},
    "SEVERE": {"crypto": "severe", "stockCostBps": stock.SCENARIOS["SEVERE"]},
}


def rounded(value: Any):
    return stock.v14.rounded(value)


def build_crypto() -> dict:
    raw = crypto_bt.v89.build_raw()
    profile = crypto_bt.build_core_profile(crypto_bt.NEW, raw)
    trades = crypto_bt.v69.scale_trades(crypto_bt.v96.TARGET_V67_GROSS)
    trade_start = min(int(row["entry_ts"]) for row in trades)
    trade_end = max(int(row["exit_ts"]) for row in trades)
    pengu_rows = crypto_bt.core.fetch_klines(
        "PENGUUSDT",
        min(START_MS, trade_start) - 30 * crypto_bt.v69.DAY,
        max(END_MS, trade_end) + crypto_bt.v69.HOUR,
    )
    combined = crypto_bt.combined_series(profile, pengu_rows)

    def cap(rows: Sequence[dict]) -> List[dict]:
        result: List[dict] = []
        for row in rows:
            ts = int(row["ts"])
            if not START_MS <= ts < END_MS:
                continue
            raw_max = max(0.0, float(row.get("maxGross", row.get("gross", 0.0))))
            scale = min(1.0, CRYPTO_GROSS_CAP / raw_max) if raw_max > 0 else 1.0
            result.append({
                "ts": ts,
                "return": float(row["return"]) * scale,
                "gross": raw_max * scale,
                "sourceGross": raw_max,
                "scale": scale,
            })
        return result

    normal = cap(combined["normalRows"])
    severe = cap(combined["severeRows"])
    if not normal or not severe:
        raise RuntimeError("no Crypto V96 rows in fixed V52 period")
    return {
        "normal": normal,
        "severe": severe,
        "diagnostics": {
            "normalRows": len(normal),
            "severeRows": len(severe),
            "first": base.iso_ms(normal[0]["ts"]),
            "last": base.iso_ms(normal[-1]["ts"]),
            "sourceMaxGross": max(row["sourceGross"] for row in normal),
            "cappedMaxGross": max(row["gross"] for row in normal),
            "minimumScale": min(row["scale"] for row in normal),
        },
    }


def build_stock(cache_root: Path) -> Tuple[List[dict], List[dict], List[str], dict]:
    stock.v19.configure_exact_data_window()
    days, aligned, data_diag = stock.v19.v17.load_all(cache_root / "aligned")
    warmup = [
        day for day in days
        if stock.v19.WARMUP_START.date().isoformat() <= day < stock.v19.BT_END_DAY_EXCLUSIVE
    ]
    target = [
        day for day in warmup
        if stock.v19.BT_START_DAY <= day < stock.v19.BT_END_DAY_EXCLUSIVE
    ]
    v11_rows, v11_diag = stock.v22.build_v11eq(warmup, aligned)
    v50_rows = stock.v50.build_raw_trades(stock.frozen_v50_candidate(), target, aligned)
    return v11_rows, v50_rows, target, {
        "market": data_diag,
        "v11": v11_diag,
        "targetSessions": len(target),
        "v11RawTrades": len(v11_rows),
        "v50RawTrades": len(v50_rows),
    }


def position_id(raw: dict) -> str:
    return f"{raw['strategy']}:{raw['symbol']}:{int(raw['entryTs'])}:{int(raw['exitTs'])}"


def simulate(
    crypto_rows: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    stock_cost_bps: float,
    allowed_days: Sequence[str],
) -> dict:
    allowed = set(allowed_days)
    timeline: List[dict] = [
        {
            "kind": "CRYPTO",
            "ts": int(row["ts"]),
            "return": float(row["return"]),
            "gross": float(row.get("gross", 0.0)),
            "priority": 2,
        }
        for row in crypto_rows
    ]
    for raw in list(v11_rows) + list(v50_rows):
        if str(raw["day"]) in allowed:
            timeline.append({
                "kind": "STOCK_ENTRY",
                "ts": int(raw["entryTs"]),
                "trade": raw,
                "priority": 1,
            })
    timeline.sort(key=lambda row: (
        int(row["ts"]),
        int(row["priority"]),
        str(row.get("trade", {}).get("strategy", "")),
    ))

    active: Dict[str, dict] = {}
    events: List[dict] = []
    stats: Counter[str] = Counter()
    current_day = locked_day = None
    day_return = 0.0
    current_crypto_gross = 0.0
    max_crypto_gross = max_stock_gross = max_total_gross = 0.0
    index = 0

    def observe_gross() -> None:
        nonlocal max_crypto_gross, max_stock_gross, max_total_gross
        active_stock_gross = sum(float(item["allocatedGross"]) for item in active.values())
        max_crypto_gross = max(max_crypto_gross, current_crypto_gross)
        max_stock_gross = max(max_stock_gross, active_stock_gross)
        max_total_gross = max(max_total_gross, current_crypto_gross + active_stock_gross)

    while index < len(timeline):
        row = timeline[index]
        ts = int(row["ts"])
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day, locked_day, day_return = day, None, 0.0

        kind = str(row["kind"])
        if kind == "STOCK_ENTRY":
            raw = row["trade"]
            strategy = str(raw["strategy"])
            if locked_day == day:
                stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active.values()):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                index += 1
                continue

            unit_value = stock.unit_trade_value(raw, stock_cost_bps)
            if unit_value is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                index += 1
                continue

            active_stock_gross = sum(float(position["allocatedGross"]) for position in active.values())
            available = max(0.0, STOCK_GROSS_CAP - active_stock_gross)
            strategy_cap = V11_MAX_GROSS if strategy == "V11_EQ" else V50_MAX_GROSS
            allocated = min(strategy_cap, available)
            if allocated + 1e-12 < stock.MINIMUM_ALLOCATED_GROSS:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                index += 1
                continue

            pid = position_id(raw)
            position = {
                **raw,
                "positionId": pid,
                "allocatedGross": allocated,
                "netReturn": float(unit_value) * allocated,
            }
            active[pid] = position
            timeline.append({
                "kind": "STOCK_EXIT",
                "ts": int(raw["exitTs"]),
                "position": position,
                "priority": 3,
            })
            timeline[index + 1:] = sorted(
                timeline[index + 1:],
                key=lambda item: (
                    int(item["ts"]),
                    int(item["priority"]),
                    str(item.get("trade", item.get("position", {})).get("strategy", "")),
                ),
            )
            stats[f"{strategy}_ENTERED"] += 1
            if allocated < strategy_cap - 1e-12:
                stats[f"{strategy}_SCALED_ENTRY"] += 1
            if len(active) > 1:
                stats[f"{strategy}_ENTERED_WHILE_OTHER_ACTIVE"] += 1
            observe_gross()
            index += 1
            continue

        if kind == "CRYPTO":
            current_crypto_gross = float(row.get("gross", 0.0))
            observe_gross()
            if locked_day == day:
                stats["CRYPTO_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            event = {
                "ts": ts,
                "return": float(row["return"]),
                "strategy": "CRYPTO_V96",
                "symbol": None,
                "priority": int(row["priority"]),
            }
        else:
            position = row["position"]
            active.pop(str(position["positionId"]), None)
            observe_gross()
            if locked_day == day:
                stats["STOCK_EXIT_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            event = {
                "ts": ts,
                "return": float(position["netReturn"]),
                "strategy": str(position["strategy"]),
                "symbol": str(position["symbol"]),
                "priority": int(row["priority"]),
                "allocatedGross": float(position["allocatedGross"]),
            }
            stats[f"{position['strategy']}_EXITED"] += 1

        events.append(event)
        day_return = (1.0 + day_return) * (1.0 + float(event["return"])) - 1.0
        if day_return <= DAILY_LOSS_LIMIT:
            locked_day = day
            stats["PORTFOLIO_DAILY_LOSS_LOCKS"] += 1
        index += 1

    result = base.metrics(events)
    stock_events = [row for row in events if row["strategy"] in {"V11_EQ", "V50_POST_OPEN_BASIS"}]
    result.update({
        "cryptoEvents": sum(row["strategy"] == "CRYPTO_V96" for row in events),
        "stockTrades": len(stock_events),
        "acceptedV11Trades": sum(row["strategy"] == "V11_EQ" for row in stock_events),
        "acceptedV50Trades": sum(row["strategy"] == "V50_POST_OPEN_BASIS" for row in stock_events),
        "averageStockAllocatedGross": (
            sum(float(row["allocatedGross"]) for row in stock_events) / len(stock_events)
            if stock_events else 0.0
        ),
        "observedMaximumCryptoGross": max_crypto_gross,
        "observedMaximumStockGross": max_stock_gross,
        "observedMaximumTotalGross": max_total_gross,
        "routingDiagnostics": dict(stats),
        "bySleeve": {
            "CRYPTO_V96": base.metrics([row for row in events if row["strategy"] == "CRYPTO_V96"]),
            "V11_EQ": base.metrics([row for row in events if row["strategy"] == "V11_EQ"]),
            "V50_POST_OPEN_BASIS": base.metrics([
                row for row in events if row["strategy"] == "V50_POST_OPEN_BASIS"
            ]),
        },
    })
    return result


def analyze(stock_cache_root: Path) -> dict:
    if (PERIOD_END - PERIOD_START).days != 365:
        raise RuntimeError("V52 period is not exactly 365 days")
    v11_rows, v50_rows, target, stock_diag = build_stock(stock_cache_root)
    crypto = build_crypto()

    results: Dict[str, dict] = {}
    for name, scenario in SCENARIOS.items():
        crypto_rows = crypto[scenario["crypto"]]
        stock_cost = float(scenario["stockCostBps"])
        results[name] = {
            "unifiedCompoundedPortfolio": simulate(
                crypto_rows, v11_rows, v50_rows, stock_cost, target
            ),
            "cryptoV96Only": simulate(crypto_rows, [], [], stock_cost, target),
            "stockV52Only": simulate([], v11_rows, v50_rows, stock_cost, target),
        }

    normal = results["NORMAL"]["unifiedCompoundedPortfolio"]
    severe = results["SEVERE"]["unifiedCompoundedPortfolio"]
    checks = {
        "periodExactly365Days": (PERIOD_END - PERIOD_START).days == 365,
        "cryptoGrossCapRespected": normal["observedMaximumCryptoGross"] <= CRYPTO_GROSS_CAP + 1e-9,
        "stockGrossCapRespected": normal["observedMaximumStockGross"] <= STOCK_GROSS_CAP + 1e-9,
        "totalGrossCapRespected": normal["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9,
        "v11MaximumGrossFixedAt1": V11_MAX_GROSS == 1.0,
        "v50MaximumGrossFixedAt1": V50_MAX_GROSS == 1.0,
        "normalPositive": normal["compoundedReturnPct"] > 0,
        "severePositive": severe["compoundedReturnPct"] > 0,
    }
    status = (
        "V96_V52_ONE_YEAR_COMPOUNDED_REPLAY_PASS_RESEARCH_ONLY"
        if all(checks.values())
        else "V96_V52_ONE_YEAR_COMPOUNDED_REPLAY_DIAGNOSTIC"
    )

    return rounded({
        "version": VERSION,
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "status": status,
        "period": {
            "startInclusive": PERIOD_START.isoformat(),
            "endExclusive": PERIOD_END.isoformat(),
            "calendarDays": 365,
            "stockSessions": len(target),
        },
        "architecture": {
            "cryptoStrategy": "V96 Core Volume50 / Turnover7.5 plus reserved PENGU",
            "stockStrategy": "V52 V11-EQ + V50 Dual Slot",
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "totalGrossCap": TOTAL_GROSS_CAP,
            "v11MaximumGross": V11_MAX_GROSS,
            "v50MaximumGross": V50_MAX_GROSS,
            "v50AllocationRule": "up to 1.0 when free; 0.5 when V11 already uses 1.0; otherwise remaining Stock Gross",
            "sameSymbolConcurrentEntryAllowed": False,
            "forcedReplacementAllowed": False,
            "sleeveLending": False,
            "compounding": "single account event-by-event chronological compounding",
            "dailyLossLimit": DAILY_LOSS_LIMIT,
            "dailyLossResolution": "completed event; triggering loss retained, later same-UTC-day events blocked",
        },
        "costScenarios": SCENARIOS,
        "data": {
            "crypto": crypto["diagnostics"],
            "stock": stock_diag,
        },
        "results": results,
        "checks": checks,
        "limitations": [
            "V11-EQ and V50 use reused historical stock/cash-perpetual evidence and are not an independent Holdout.",
            "Stock execution remains an observable historical proxy; exact spread, depth, queue position, partial fills and sub-second slippage are unavailable.",
            "Crypto V96 includes the fixed historical PENGU sequence; future reproducibility remains Forward-dependent.",
            "Daily-loss control is evaluated at completed-event resolution, not intrabar emergency-flatten resolution.",
            "Concurrent position returns are applied at their completed event timestamps using the same event-compounding convention as prior unified portfolio research.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "realPositionsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v50Changed": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# V96 + V52 Dual-Slot One-Year Compounded Portfolio Backtest",
        "",
        f"Status: **{result['status']}**",
        f"Period: {result['period']['startInclusive']} to {result['period']['endExclusive']}",
        "",
        "| Scenario | Unified Return | CAGR | DD | PF | V96 Only | V52 Only | V11 | V50 | Max Total Gross |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, node in result["results"].items():
        unified = node["unifiedCompoundedPortfolio"]
        crypto = node["cryptoV96Only"]
        stock_only = node["stockV52Only"]
        lines.append(
            f"| {name} | {unified['compoundedReturnPct']:.6f}% | {unified['cagrPct']:.6f}% | "
            f"{unified['maxDrawdownPct']:.6f}% | {unified['profitFactor']} | "
            f"{crypto['compoundedReturnPct']:.6f}% | {stock_only['compoundedReturnPct']:.6f}% | "
            f"{unified['acceptedV11Trades']} | {unified['acceptedV50Trades']} | "
            f"{unified['observedMaximumTotalGross']:.6f} |"
        )
    lines += [
        "",
        "- Crypto V96 Gross cap: 1.0",
        "- Stock V52 Gross cap: 1.5",
        "- V11 max Gross: 1.0",
        "- V50 max Gross: 1.0, but only remaining Stock Gross is allocated.",
        "- Total account Gross cap: 2.5",
        "- Single-account chronological compounding: YES",
        "- Production / LIVE / VPS / orders changed: NO",
    ]
    return "\n".join(lines) + "\n"


def self_test() -> None:
    assert (PERIOD_END - PERIOD_START).days == 365
    assert CRYPTO_GROSS_CAP + STOCK_GROSS_CAP == TOTAL_GROSS_CAP
    assert SCENARIOS["NORMAL"]["stockCostBps"] == 40.0
    assert SCENARIOS["P95"]["stockCostBps"] == 44.0
    assert SCENARIOS["SEVERE"]["stockCostBps"] == 100.0

    v11 = {
        "strategy": "V11_EQ", "day": "2026-01-05", "symbol": "AAA",
        "entryTs": 1000, "exitTs": 5000, "gross": 1.0,
        "grossReturn": 0.02, "fundingReturn": 0.0, "holdingHours": 1.0,
    }
    v50 = {
        "strategy": "V50_POST_OPEN_BASIS", "day": "2026-01-05", "symbol": "BBB",
        "entryTs": 2000, "exitTs": 4000, "gross": 1.0,
        "grossReturn": 0.02, "fundingReturn": 0.0, "holdingHours": 1.0,
    }
    original_unit = stock.unit_trade_value
    try:
        stock.unit_trade_value = lambda row, cost: 0.01
        result = simulate([], [v11], [v50], 0.0, ["2026-01-05"])
    finally:
        stock.unit_trade_value = original_unit
    assert result["acceptedV11Trades"] == 1
    assert result["acceptedV50Trades"] == 1
    assert result["observedMaximumStockGross"] == 1.5
    assert abs(result["averageStockAllocatedGross"] - 0.75) < 1e-12
    print("V96 + V52 dual-slot one-year self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default="../.cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default="../.research-state/v96-v52-dual-slot-one-year")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.stock_cache_dir).resolve())
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "normal": result["results"]["NORMAL"]["unifiedCompoundedPortfolio"],
        "severe": result["results"]["SEVERE"]["unifiedCompoundedPortfolio"],
        "checks": result["checks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
