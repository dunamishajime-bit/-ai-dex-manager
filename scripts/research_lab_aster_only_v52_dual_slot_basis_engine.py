from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v50_post_open_basis_engine as v50

STRATEGY_ID = "DISDEX_ASTER_ONLY_V52_DUAL_SLOT_BASIS_ENGINE"
SCENARIOS = v14.SCENARIOS
DAILY_LOSS_LIMIT = -0.02
MINIMUM_ALLOCATED_GROSS = 0.25
V50_CANDIDATE_ID = "POST_EARLY3__B75__H3__BOTH__NONE"
GROSS_CAPS = (1.0, 1.5, 2.0)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def product(values: Iterable[float]) -> float:
    return v14.product(values)


def frozen_v50_candidate() -> v50.Candidate:
    matches = [candidate for candidate in v50.CANDIDATES if candidate.candidate_id == V50_CANDIDATE_ID]
    if len(matches) != 1:
        raise RuntimeError(f"expected one frozen V50 candidate, found {len(matches)}")
    return matches[0]


def unit_trade_value(row: dict, cost_bps: float) -> Optional[float]:
    if str(row["strategy"]) == "V11_EQ":
        value = v22.trade_value(row, cost_bps)
        gross = finite(row.get("gross"), 1.0)
        if value is None or gross <= 0:
            return None
        return value / gross
    value = v14.net_trade_return(row, cost_bps)
    if value is None:
        return None
    gross = finite(row.get("gross"), 1.0)
    return value / gross if gross > 0 else None


def realize(position: dict, events: List[dict], stats: Counter[str]) -> float:
    event = dict(position)
    events.append(event)
    stats[f"{event['strategy']}_EXITED"] += 1
    return finite(event["netReturn"])


def route(
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
    gross_cap: float,
    enabled: Sequence[str] = ("V11_EQ", "V50_POST_OPEN_BASIS"),
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    enabled_set = set(enabled)
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for row in list(v11_rows) + list(v50_rows):
        day = str(row["day"])
        if day in allowed and str(row["strategy"]) in enabled_set:
            by_day[day].append(row)

    events: List[dict] = []
    stats: Counter[str] = Counter()
    maximum_observed_gross = 0.0

    for day in sorted(allowed):
        active: List[dict] = []
        daily_net = 0.0
        day_locked = False

        for raw in sorted(by_day.get(day, []), key=lambda item: (int(item["entryTs"]), str(item["strategy"]))):
            entry_ts = int(raw["entryTs"])
            still_active: List[dict] = []
            for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]))):
                if int(position["exitTs"]) <= entry_ts:
                    value = realize(position, events, stats)
                    daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0
                    if daily_net <= DAILY_LOSS_LIMIT:
                        day_locked = True
                else:
                    still_active.append(position)
            active = still_active

            strategy = str(raw["strategy"])
            if day_locked:
                stats["DAILY_LOSS_BLOCKED"] += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                continue
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                continue

            unit_value = unit_trade_value(raw, cost_bps)
            if unit_value is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                continue

            active_gross = sum(finite(position["allocatedGross"]) for position in active)
            available_gross = max(0.0, gross_cap - active_gross)
            allocated_gross = min(1.0, available_gross)
            if allocated_gross + 1e-12 < MINIMUM_ALLOCATED_GROSS:
                stats["CAPACITY_BLOCKED"] += 1
                continue

            if allocated_gross < 1.0 - 1e-12:
                stats["SCALED_ENTRY"] += 1
            if active:
                stats[f"{strategy}_ENTERED_WHILE_OTHER_ACTIVE"] += 1

            position = {
                **raw,
                "route": strategy,
                "allocatedGross": allocated_gross,
                "netReturn": unit_value * allocated_gross,
            }
            active.append(position)
            stats[f"{strategy}_ENTERED"] += 1
            current_gross = sum(finite(item["allocatedGross"]) for item in active)
            maximum_observed_gross = max(maximum_observed_gross, current_gross)

        for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]))):
            value = realize(position, events, stats)
            daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0
            if daily_net <= DAILY_LOSS_LIMIT:
                day_locked = True

    events.sort(key=lambda row: (int(row["exitTs"]), int(row["entryTs"]), str(row["strategy"])))
    return events, {
        **dict(stats),
        "maximumObservedGross": round(maximum_observed_gross, 6),
        "configuredGrossCap": gross_cap,
    }


def metrics(events: Sequence[dict], routing: Optional[dict] = None) -> dict:
    values = [finite(row["netReturn"]) for row in events]
    gains: Dict[str, float] = defaultdict(float)
    total_gain = 0.0
    for row, value in zip(events, values):
        if value > 0:
            gains[str(row["symbol"])] += value
            total_gain += value
    capital_hours = sum(
        finite(row.get("allocatedGross"), finite(row.get("gross"), 1.0)) * finite(row.get("holdingHours"))
        for row in events
    )
    return {
        "trades": len(values),
        "compoundedReturnPct": product(values) * 100.0,
        "profitFactor": v14.profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradeBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "medianTradeBps": statistics.median(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": v14.max_drawdown(values) * 100.0,
        "capitalHours": capital_hours,
        "netBpsPerCapitalHour": sum(values) * 10_000.0 / capital_hours if capital_hours > 0 else 0.0,
        "maximumPositiveProfitSymbolShare": max(gains.values()) / total_gain if gains and total_gain > 0 else 0.0,
        "routeCounts": dict(sorted(Counter(str(row["strategy"]) for row in events).items())),
        "symbolCounts": dict(sorted(Counter(str(row["symbol"]) for row in events).items())),
        "averageAllocatedGross": statistics.mean(finite(row.get("allocatedGross"), 1.0) for row in events) if events else 0.0,
        "routing": routing or {},
    }


def scenario_set(
    v11_rows: Sequence[dict], v50_rows: Sequence[dict], days: Sequence[str], gross_cap: float,
    enabled: Sequence[str] = ("V11_EQ", "V50_POST_OPEN_BASIS"),
) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(v11_rows, v50_rows, cost, days, gross_cap, enabled)
        results[name] = metrics(events, stats)
        routing[name] = stats
    return results, routing


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda i: finite(events[i]["netReturn"]))
    return [row for i, row in enumerate(events) if i != index]


def remove_best_month(events: Sequence[dict]) -> List[dict]:
    monthly: Dict[str, float] = defaultdict(float)
    for row in events:
        monthly[str(row["day"])[:7]] += finite(row["netReturn"])
    if not monthly:
        return []
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [row for row in events if str(row["day"])[:7] != month]


def audit(
    v11_rows: Sequence[dict], v50_rows: Sequence[dict], target: Sequence[str], development: Sequence[str],
    validation: Sequence[str], final: Sequence[str], holdout: Sequence[str], gross_cap: float,
    enabled: Sequence[str] = ("V11_EQ", "V50_POST_OPEN_BASIS"),
) -> dict:
    full, routing = scenario_set(v11_rows, v50_rows, target, gross_cap, enabled)
    dev, _ = scenario_set(v11_rows, v50_rows, development, gross_cap, enabled)
    val, _ = scenario_set(v11_rows, v50_rows, validation, gross_cap, enabled)
    fin, _ = scenario_set(v11_rows, v50_rows, final, gross_cap, enabled)
    hol, _ = scenario_set(v11_rows, v50_rows, holdout, gross_cap, enabled)
    normal_events, normal_stats = route(v11_rows, v50_rows, SCENARIOS["NORMAL"], target, gross_cap, enabled)
    p95_events, p95_stats = route(v11_rows, v50_rows, SCENARIOS["P95"], target, gross_cap, enabled)
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "normalAtLeast100Pct": normal["compoundedReturnPct"] >= 100.0,
        "p95AtLeast85Pct": p95["compoundedReturnPct"] >= 85.0,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "validationMinimumEightTrades": val["NORMAL"]["trades"] >= 8,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumThreeTrades": hol["NORMAL"]["trades"] >= 3,
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": metrics(remove_best(normal_events))["compoundedReturnPct"] > 0 and metrics(remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": metrics(remove_best_month(normal_events))["compoundedReturnPct"] > 0 and metrics(remove_best_month(p95_events))["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
        "grossCapRespectedNormal": finite(normal_stats.get("maximumObservedGross")) <= gross_cap + 1e-9,
        "grossCapRespectedP95": finite(p95_stats.get("maximumObservedGross")) <= gross_cap + 1e-9,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "checks": checks,
        "allRaisedHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": metrics(remove_best(normal_events)),
            "p95BestTradeRemoved": metrics(remove_best(p95_events)),
            "normalBestMonthRemoved": metrics(remove_best_month(normal_events)),
            "p95BestMonthRemoved": metrics(remove_best_month(p95_events)),
        },
    }


def analyze(cache_root: Path) -> dict:
    v19.configure_exact_data_window()
    days, aligned, data_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v20.HOLDOUT_START_DAY]
    splits = v14.split_days(pre_holdout)

    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    candidate = frozen_v50_candidate()
    v50_rows = v50.build_raw_trades(candidate, target, aligned)
    args = (v11_rows, v50_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)

    comparisons = {
        "V11_ONLY": audit(*args, 1.0, ("V11_EQ",)),
        "V50_ONLY": audit(*args, 1.0, ("V50_POST_OPEN_BASIS",)),
        "UNIFIED_GROSS_1_0": audit(*args, 1.0),
        "DUAL_SLOT_GROSS_1_5": audit(*args, 1.5),
        "DUAL_SLOT_GROSS_2_0": audit(*args, 2.0),
    }
    dual = comparisons["DUAL_SLOT_GROSS_2_0"]
    status = (
        "ASTER_ONLY_V52_DUAL_SLOT_RAISED_HURDLES_PASS_SHADOW_ONLY"
        if dual["allRaisedHurdlesPassed"]
        else "ASTER_ONLY_V52_DUAL_SLOT_DID_NOT_PASS_RAISED_HURDLES"
    )
    return v14.rounded({
        "version": 52,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
        },
        "frozenComponents": {
            "v11Candidate": "BOTH__FLAT__CONVERGENCE__ABS_TOP1",
            "v50Candidate": V50_CANDIDATE_ID,
            "v11MaximumGross": 1.0,
            "v50MaximumGross": 1.0,
            "minimumPartialGross": MINIMUM_ALLOCATED_GROSS,
            "sameSymbolConcurrentEntryAllowed": False,
            "forcedReplacementAllowed": False,
        },
        "comparisons": comparisons,
        "architecture": {
            "venue": "ASTER_ONLY",
            "allocator": "SYMMETRIC_FIRST_FILLED_POSITION_PRESERVED_REMAINING_GROSS_TO_NEXT_SIGNAL",
            "v11EntryNy": "10:30",
            "v50EntryNy": ["11:30", "12:30", "13:30"],
            "reverseOrderSupportedByAllocator": True,
            "reverseOrderObservedUnderFrozenSchedule": False,
            "cryptoV96Included": False,
            "hyperliquidUsed": False,
            "dailyLossLimit": DAILY_LOSS_LIMIT,
        },
        "data": data_diag,
        "v11Diagnostics": v11_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v50Changed": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V52 Dual-Slot Basis Engine",
        "",
        f"Status: **{result['status']}**",
        "",
        "| Architecture | Normal | P95 | PF | DD | Trades | Max Gross |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name, audit_row in result["comparisons"].items():
        normal, p95 = audit_row["full"]["NORMAL"], audit_row["full"]["P95"]
        lines.append(
            f"| {name} | {normal['compoundedReturnPct']:.6f}% | {p95['compoundedReturnPct']:.6f}% | "
            f"{normal['profitFactor']} | {normal['maxDrawdownPct']:.6f}% | {normal['trades']} | "
            f"{normal['routing'].get('maximumObservedGross', 0)} |"
        )
    dual = result["comparisons"]["DUAL_SLOT_GROSS_2_0"]
    lines += ["", "## Dual-slot chronological evidence", ""]
    for segment in ("development", "validation", "finalReused", "holdout"):
        row = dual[segment]
        lines.append(
            f"- {segment}: Normal {row['NORMAL']['compoundedReturnPct']:.6f}% / "
            f"P95 {row['P95']['compoundedReturnPct']:.6f}% / {row['NORMAL']['trades']} trades"
        )
    lines += ["", "## Raised checks", ""]
    for key, value in dual["checks"].items():
        lines.append(f"- {key}: {value}")
    lines += [
        "",
        "Stock-only historical research. Crypto V96 capital reservation is not included and must be tested separately before runtime use.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="../.cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default="../.research-state/aster-only-v52-dual-slot")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({"status": result["status"], "comparisons": result["comparisons"]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
