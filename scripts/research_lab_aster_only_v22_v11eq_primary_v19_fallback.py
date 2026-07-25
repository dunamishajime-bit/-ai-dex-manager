from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20

STRATEGY_ID = "DISDEX_ASTER_ONLY_V22_V11EQ_PRIMARY_V19_FALLBACK_AUDIT"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
MAX_COST_BPS = 60.0
MIN_EDGE_BPS = 10.0


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def product(values: Iterable[float]) -> float:
    return v14.product(values)


def build_v11eq(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> Tuple[List[dict], dict]:
    candidate = v14.v11.Candidate(
        "BOTH__FLAT__CONVERGENCE__ABS_TOP1", "BOTH", "FLAT", "CONVERGENCE", "ABS_TOP1"
    )
    scores = v14.v11.rolling_scores(days, aligned)
    rows, rejects = [], Counter()
    for day in days:
        trade = v14.v11.build_trade(candidate, day, aligned, scores)
        if trade is None:
            continue
        leg = trade["legs"][0]
        symbol = str(leg["symbol"])
        entry_basis = {
            item: (finite(aligned[item][day]["perp"]["entry"]) / finite(aligned[item][day]["cash"]["entry"]) - 1.0) * 10_000.0
            for item in v14.SYMBOLS
        }
        actual = finite(entry_basis[symbol])
        signal = finite(leg["entryBasisBps"])
        top1 = max(entry_basis, key=lambda item: abs(entry_basis[item]))
        clock_ms = abs(
            int(aligned[symbol][day]["cash"]["entryTs"])
            - int(aligned[symbol][day]["perp"]["entryTs"])
        )
        adverse = max(0.0, abs(actual) - abs(signal))
        reasons = []
        if abs(actual) < 50.0:
            reasons.append("ENTRY_BASIS_BELOW_50")
        if top1 != symbol:
            reasons.append("NO_LONGER_TOP1")
        if clock_ms > 1500:
            reasons.append("CLOCK_OVER_1500MS")
        if adverse > 10.0:
            reasons.append("ADVERSE_BASIS_OVER_10BPS")
        if reasons:
            rejects.update(reasons)
            continue
        entry_ts, exit_ts = int(leg["entryTs"]), int(leg["exitTs"])
        rows.append({
            "strategy": "V11_EQ",
            "day": day,
            "symbol": symbol,
            "side": int(leg["side"]),
            "gross": finite(trade["gross"], 1.0),
            "entryTs": entry_ts,
            "exitTs": exit_ts,
            "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
            "grossReturn": finite(trade["grossReturn"]),
            "edgeProxyBps": abs(actual) - 15.0,
            "maximumAllowedCostBps": min(MAX_COST_BPS, 0.75 * abs(actual)),
            "entryBasisBps": actual,
            "exitReason": str(leg["exitReason"]),
        })
    return rows, {"acceptedInvariantRows": len(rows), "rejectReasons": dict(rejects)}


def build_fallback(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    features = v15.build_slot_features(days, aligned)
    return [
        {**row, "strategy": "V19_FALLBACK"}
        for row in v15.build_trades(v19.CANDIDATE, days, features)
    ]


def trade_value(row: dict, cost_bps: float) -> Optional[float]:
    if cost_bps > MAX_COST_BPS:
        return None
    if row["strategy"] == "V11_EQ":
        if cost_bps > finite(row["maximumAllowedCostBps"]):
            return None
        if finite(row["edgeProxyBps"]) - cost_bps < MIN_EDGE_BPS:
            return None
        return finite(row["grossReturn"]) - finite(row["gross"], 1.0) * cost_bps / 10_000.0
    return v14.net_trade_return(row, cost_bps)


def route(
    v11_rows: Sequence[dict], fallback_rows: Sequence[dict], cost_bps: float,
    days: Sequence[str], allow_fallback: bool,
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by11 = {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed}
    by19 = {str(row["day"]): row for row in fallback_rows if str(row["day"]) in allowed}
    events, stats = [], Counter()
    for day in sorted(allowed):
        primary = by11.get(day)
        if primary is not None:
            value = trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1
        if allow_fallback and day in by19:
            fallback = by19[day]
            value = trade_value(fallback, cost_bps)
            if value is not None:
                events.append({**fallback, "netReturn": value, "route": "V19_FALLBACK"})
                stats["V19_FALLBACK_SELECTED"] += 1
            else:
                stats["V19_FALLBACK_COST_GATE_REJECTED"] += 1
    return sorted(events, key=lambda row: int(row["exitTs"])), dict(stats)


def metrics(events: Sequence[dict]) -> dict:
    values = [finite(row["netReturn"]) for row in events]
    hours = sum(finite(row["holdingHours"]) for row in events)
    gains = defaultdict(float)
    total_gain = 0.0
    for row, value in zip(events, values):
        if value > 0:
            gains[str(row["symbol"])] += value
            total_gain += value
    return {
        "trades": len(values),
        "compoundedReturnPct": product(values) * 100.0,
        "profitFactor": v14.profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradeBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "medianTradeBps": statistics.median(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": v14.max_drawdown(values) * 100.0,
        "capitalHours": hours,
        "netBpsPerCapitalHour": sum(values) * 10_000.0 / hours if hours > 0 else 0.0,
        "maximumPositiveProfitSymbolShare": max(gains.values()) / total_gain if gains and total_gain > 0 else 0.0,
        "routeCounts": dict(sorted(Counter(str(row["route"]) for row in events).items())),
        "symbolCounts": dict(sorted(Counter(str(row["symbol"]) for row in events).items())),
    }


def scenario_set(v11_rows: Sequence[dict], fallback_rows: Sequence[dict], days: Sequence[str], allow_fallback: bool) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(v11_rows, fallback_rows, cost, days, allow_fallback)
        results[name] = metrics(events)
        routing[name] = stats
    return results, routing


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda i: finite(events[i]["netReturn"]))
    return [row for i, row in enumerate(events) if i != index]


def remove_best_month(events: Sequence[dict]) -> Tuple[List[dict], Optional[str]]:
    if not events:
        return [], None
    monthly = defaultdict(float)
    for row in events:
        monthly[str(row["day"])[:7]] += finite(row["netReturn"])
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [row for row in events if str(row["day"])[:7] != month], month


def audit(
    v11_rows: Sequence[dict], fallback_rows: Sequence[dict], target: Sequence[str],
    development: Sequence[str], validation: Sequence[str], final: Sequence[str],
    holdout: Sequence[str], allow_fallback: bool,
) -> dict:
    full, routing = scenario_set(v11_rows, fallback_rows, target, allow_fallback)
    dev, _ = scenario_set(v11_rows, fallback_rows, development, allow_fallback)
    val, _ = scenario_set(v11_rows, fallback_rows, validation, allow_fallback)
    fin, _ = scenario_set(v11_rows, fallback_rows, final, allow_fallback)
    hol, _ = scenario_set(v11_rows, fallback_rows, holdout, allow_fallback)
    normal_events, _ = route(v11_rows, fallback_rows, SCENARIOS["NORMAL"], target, allow_fallback)
    p95_events, _ = route(v11_rows, fallback_rows, SCENARIOS["P95"], target, allow_fallback)
    normal_month_events, normal_month = remove_best_month(normal_events)
    p95_month_events, p95_month = remove_best_month(p95_events)
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalReusedNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalReturnAtLeast50Pct": normal["compoundedReturnPct"] >= 50.0,
        "p95ReturnAtLeast30Pct": p95["compoundedReturnPct"] >= 30.0,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": metrics(remove_best(normal_events))["compoundedReturnPct"] > 0 and metrics(remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": metrics(normal_month_events)["compoundedReturnPct"] > 0 and metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full, "development": dev, "validation": val, "finalReused": fin,
        "holdout": hol, "routing": routing, "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": metrics(remove_best(normal_events)),
            "p95BestTradeRemoved": metrics(remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": metrics(p95_month_events)},
        },
    }


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root)
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    v11_rows, v11_diag = build_v11eq(warmup, aligned)
    fallback_rows = build_fallback(warmup, aligned)
    args = (v11_rows, fallback_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
    v11_only = audit(*args, False)
    routed = audit(*args, True)
    status = "ASTER_ONLY_V22_ROUTER_STRICT_PASS_SHADOW_ONLY" if routed["allStrictHurdlesPassed"] else "ASTER_ONLY_V22_ROUTER_DID_NOT_PASS_STRICT_HURDLES"
    return v14.rounded({
        "version": 22,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
            "firstSession": target[0],
            "lastSession": target[-1],
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "primary": "V11_EQ at 10:30 New York",
            "fallback": "V19 fixed Z2 12:30 two-hour fade only when V11_EQ is not accepted",
            "maximumOneStockPositionPerDay": True,
            "maximumGross": 1.0,
            "v96CapitalPriorityRequiredBeforeProduction": True,
        },
        "strictHurdles": v20.STRICT_HURDLES,
        "v11EqOnly": v11_only,
        "v11EqPlusV19Fallback": routed,
        "data": {"aligned": diagnostics, "v11Eq": v11_diag, "rawV11EqRows": len(v11_rows), "rawV19FallbackRows": len(fallback_rows)},
        "selectionDiscipline": {
            "v11EqParametersChanged": False,
            "v19ParametersChanged": False,
            "routerRulePredeclared": True,
            "julyHoldoutExcludedFromSelection": True,
            "holdoutRetuningAllowed": False,
            "productionPromotionAllowed": False,
        },
        "limitations": [
            "Observable historical proxy: exact historical spread, depth, queue and fills are unavailable.",
            "Cash data are Yahoo 60-minute bars rather than Pyth ticks.",
            "V11-EQ and V19 were developed using overlapping earlier history.",
            "The July Holdout is short.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False,
            "productionChanged": False, "liveChanged": False, "vpsChanged": False,
            "cryptoV96Changed": False, "v11EqChanged": False, "v13dProductionChanged": False,
        },
    })


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = ["# Aster-only V22 V11-EQ Primary / V19 Fallback", "", f"Status: **{result['status']}**", ""]
    for key in ("v11EqOnly", "v11EqPlusV19Fallback"):
        normal, p95 = result[key]["full"]["NORMAL"], result[key]["full"]["P95"]
        lines += [f"## {key}", "", f"- Normal {normal['compoundedReturnPct']:.6f}% / PF {normal['profitFactor']} / {normal['trades']} trades / DD {normal['maxDrawdownPct']:.6f}%", f"- P95 {p95['compoundedReturnPct']:.6f}% / PF {p95['profitFactor']} / {p95['trades']} trades", f"- all strict hurdles: {result[key]['allStrictHurdlesPassed']}", ""]
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"status": result["status"], "v11EqOnly": result["v11EqOnly"], "router": result["v11EqPlusV19Fallback"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
