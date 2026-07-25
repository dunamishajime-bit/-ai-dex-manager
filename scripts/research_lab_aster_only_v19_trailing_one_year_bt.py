from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v17_july_holdout as v17
import research_lab_aster_only_v18_frozen_lead_audit as v18

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V19_TRAILING_ONE_YEAR_BACKTEST"
BT_START = dt.datetime(2025, 7, 25, tzinfo=UTC)
BT_END_EXCLUSIVE = dt.datetime(2026, 7, 25, tzinfo=UTC)
WARMUP_START = dt.datetime(2025, 6, 15, tzinfo=UTC)
BT_START_DAY = BT_START.date().isoformat()
BT_END_DAY_EXCLUSIVE = BT_END_EXCLUSIVE.date().isoformat()
CANDIDATE = v17.V15_CANDIDATE
SCENARIOS = v14.SCENARIOS


def rounded(value: Any):
    return v14.rounded(value)


def configure_exact_data_window() -> None:
    """Override frozen-source fetch bounds without changing strategy parameters."""
    modules = [
        getattr(v14.v11, "base", None),
        getattr(getattr(v14.v11, "v9", None), "base", None),
        getattr(getattr(v14.v11, "v10", None), "base", None),
        getattr(v14.funding_mod, "base", None),
    ]
    for module in modules:
        if module is None:
            continue
        if hasattr(module, "START_UTC"):
            module.START_UTC = WARMUP_START
        if hasattr(module, "END_UTC"):
            module.END_UTC = BT_END_EXCLUSIVE


def accepted(trades: Sequence[dict], cost_bps: float) -> List[Tuple[dict, float]]:
    rows: List[Tuple[dict, float]] = []
    for trade in trades:
        value = v14.net_trade_return(trade, cost_bps)
        if value is not None:
            rows.append((trade, value))
    return rows


def scenario_metrics(trades: Sequence[dict]) -> dict:
    return {name: v14.metrics(trades, cost) for name, cost in SCENARIOS.items()}


def monthly_metrics(trades: Sequence[dict]) -> dict:
    months: Dict[str, List[dict]] = defaultdict(list)
    for trade in trades:
        months[str(trade["day"])[:7]].append(trade)
    return {month: scenario_metrics(rows) for month, rows in sorted(months.items())}


def remove_best_trade(trades: Sequence[dict], cost_bps: float) -> List[dict]:
    rows = accepted(trades, cost_bps)
    if not rows:
        return list(trades)
    best_trade = max(rows, key=lambda row: row[1])[0]
    removed = False
    result = []
    for trade in trades:
        if not removed and trade is best_trade:
            removed = True
            continue
        result.append(trade)
    return result


def remove_best_month(trades: Sequence[dict], cost_bps: float) -> Tuple[List[dict], str | None]:
    rows = accepted(trades, cost_bps)
    if not rows:
        return list(trades), None
    values: Dict[str, float] = defaultdict(float)
    for trade, value in rows:
        values[str(trade["day"])[:7]] += value
    best_month = max(values, key=lambda month: (values[month], month))
    return [trade for trade in trades if str(trade["day"])[:7] != best_month], best_month


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    configure_exact_data_window()

    days, aligned, diagnostics = v17.load_all(cache_root)
    warmup_days = [day for day in days if WARMUP_START.date().isoformat() <= day < BT_END_DAY_EXCLUSIVE]
    target_days = [day for day in warmup_days if BT_START_DAY <= day < BT_END_DAY_EXCLUSIVE]
    if len(warmup_days) < v14.LOOKBACK_DAYS + 20:
        raise RuntimeError(f"Insufficient history: {len(warmup_days)} aligned sessions")
    if not target_days:
        raise RuntimeError("No aligned sessions in exact trailing-year window")

    features = v15.build_slot_features(warmup_days, aligned)
    raw_trades = v15.build_trades(CANDIDATE, warmup_days, features)
    trades = [trade for trade in raw_trades if BT_START_DAY <= str(trade["day"]) < BT_END_DAY_EXCLUSIVE]
    results = scenario_metrics(trades)
    monthly = monthly_metrics(trades)

    normal_best_removed = scenario_metrics(remove_best_trade(trades, SCENARIOS["NORMAL"]))
    p95_best_removed = scenario_metrics(remove_best_trade(trades, SCENARIOS["P95"]))
    normal_month_rows, normal_best_month = remove_best_month(trades, SCENARIOS["NORMAL"])
    p95_month_rows, p95_best_month = remove_best_month(trades, SCENARIOS["P95"])
    normal_month_removed = scenario_metrics(normal_month_rows)
    p95_month_removed = scenario_metrics(p95_month_rows)

    leave_one_out = {
        symbol: scenario_metrics([trade for trade in trades if trade["symbol"] != symbol])
        for symbol in v14.SYMBOLS
    }
    long_only = scenario_metrics([trade for trade in trades if int(trade["side"]) > 0])
    short_only = scenario_metrics([trade for trade in trades if int(trade["side"]) < 0])

    normal = results["NORMAL"]
    p95 = results["P95"]
    checks = {
        "exact365DayWindow": (BT_END_EXCLUSIVE - BT_START).days == 365,
        "minimumTwentyTrades": normal["trades"] >= 20,
        "normalPositive": normal["compoundedReturnPct"] > 0,
        "p95Positive": p95["compoundedReturnPct"] > 0,
        "normalProfitFactorAbove1_3": (normal["profitFactor"] or 0.0) > 1.30,
        "normalDrawdownAboveMinus10Pct": normal["maxDrawdownPct"] >= -10.0,
        "bestTradeRemovedNormalAndP95Positive": (
            normal_best_removed["NORMAL"]["compoundedReturnPct"] > 0
            and normal_best_removed["P95"]["compoundedReturnPct"] > 0
            and p95_best_removed["NORMAL"]["compoundedReturnPct"] > 0
            and p95_best_removed["P95"]["compoundedReturnPct"] > 0
        ),
        "bestMonthRemovedNormalAndP95Positive": (
            normal_month_removed["NORMAL"]["compoundedReturnPct"] > 0
            and normal_month_removed["P95"]["compoundedReturnPct"] > 0
            and p95_month_removed["NORMAL"]["compoundedReturnPct"] > 0
            and p95_month_removed["P95"]["compoundedReturnPct"] > 0
        ),
        "allLeaveOneSymbolOutNormalAndP95Positive": all(
            row["NORMAL"]["compoundedReturnPct"] > 0 and row["P95"]["compoundedReturnPct"] > 0
            for row in leave_one_out.values()
        ),
        "severeFailClosedNonnegative": results["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    passed = all(checks.values())

    return rounded({
        "version": 19,
        "strategyId": STRATEGY_ID,
        "status": "ASTER_ONLY_V19_TRAILING_YEAR_PASS_SHADOW_ONLY" if passed else "ASTER_ONLY_V19_TRAILING_YEAR_DID_NOT_PASS",
        "candidate": {
            **CANDIDATE.__dict__,
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "gross": 1.0,
            "entryNy": "12:30",
            "maximumHoldingHours": 2,
            "takeProfitPct": v15.TAKE_PROFIT_PCT,
            "stopLossPct": v15.STOP_LOSS_PCT,
        },
        "period": {
            "startInclusiveUtc": BT_START.isoformat(),
            "endExclusiveUtc": BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": (BT_END_EXCLUSIVE - BT_START).days,
            "firstAlignedSession": target_days[0],
            "lastAlignedSession": target_days[-1],
            "alignedSessions": len(target_days),
            "warmupStartUtc": WARMUP_START.isoformat(),
            "warmupSessions": len(warmup_days) - len(target_days),
        },
        "results": results,
        "monthly": monthly,
        "robustness": {
            "normalBestTradeRemoved": normal_best_removed,
            "p95BestTradeRemoved": p95_best_removed,
            "normalBestMonthRemoved": {"month": normal_best_month, "metrics": normal_month_removed},
            "p95BestMonthRemoved": {"month": p95_best_month, "metrics": p95_month_removed},
            "leaveOneSymbolOut": leave_one_out,
            "longOnly": long_only,
            "shortOnly": short_only,
        },
        "checks": checks,
        "allChecksPassed": passed,
        "tradeAudit": trades,
        "data": diagnostics,
        "method": {
            "candidateRetuned": False,
            "thresholdsChanged": False,
            "lookbackSessions": v14.LOOKBACK_DAYS,
            "cashSource": "Yahoo Finance public 60-minute chart history",
            "asterSource": "AsterDEX 30-minute Perp and Funding history",
            "normalRoundTripCostBps": SCENARIOS["NORMAL"],
            "p95RoundTripCostBps": SCENARIOS["P95"],
            "severeRoundTripCostBps": SCENARIOS["SEVERE"],
        },
        "limitations": [
            "Cash history is Yahoo 60-minute data rather than Pyth tick data.",
            "Aster history is candle-based and cannot reconstruct exact spread, depth, queue or post-only fills.",
            "The candidate was selected using earlier overlapping history, so this exact-year replay is not an independent Holdout.",
            "Historical performance does not guarantee future returns.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    normal = result["results"]["NORMAL"]
    p95 = result["results"]["P95"]
    lines = [
        "# Aster-only V19 Exact Trailing One-Year Backtest",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Period: {result['period']['startInclusiveUtc']} to {result['period']['endExclusiveUtc']} ({result['period']['calendarDays']} days)",
        f"Candidate: `{result['candidate']['candidate_id']}`",
        "",
        f"- Normal: {normal['compoundedReturnPct']:.6f}% / PF {normal['profitFactor']} / {normal['trades']} trades / DD {normal['maxDrawdownPct']:.6f}%",
        f"- P95: {p95['compoundedReturnPct']:.6f}% / PF {p95['profitFactor']} / {p95['trades']} trades / DD {p95['maxDrawdownPct']:.6f}%",
        f"- Normal capital efficiency: {normal['netBpsPerCapitalHour']:.6f} bps/hour",
        "",
        "## Monthly Normal returns",
        "",
    ]
    for month, scenarios in result["monthly"].items():
        row = scenarios["NORMAL"]
        lines.append(f"- {month}: {row['compoundedReturnPct']:.6f}% / {row['trades']} trades / DD {row['maxDrawdownPct']:.6f}%")
    lines += ["", "## Checks", ""]
    for key, value in result["checks"].items():
        lines.append(f"- {key}: {value}")
    lines += ["", "Research only. No Production, LIVE, VPS or order state was changed.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "normal": result["results"]["NORMAL"],
        "p95": result["results"]["P95"],
        "checks": result["checks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
