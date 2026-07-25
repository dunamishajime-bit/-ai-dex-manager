from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v17_july_holdout as v17

STRATEGY_ID = "DISDEX_ASTER_ONLY_V18_FROZEN_V15_LEAD_AUDIT"
CANDIDATE = v17.V15_CANDIDATE
SCENARIOS = v14.SCENARIOS
V13D_NORMAL_RETURN_PCT = 2.979561
V13D_P95_RETURN_PCT = 1.855422
V13D_NORMAL_BPS_PER_CAPITAL_HOUR = 2.969653


def rounded(value: Any):
    return v14.rounded(value)


def accepted(trades: Sequence[dict], cost_bps: float) -> List[Tuple[dict, float]]:
    result = []
    for trade in trades:
        value = v14.net_trade_return(trade, cost_bps)
        if value is not None:
            result.append((trade, value))
    return result


def metrics(trades: Sequence[dict]) -> dict:
    return {name: v14.metrics(trades, cost) for name, cost in SCENARIOS.items()}


def remove_best_trade(trades: Sequence[dict], cost_bps: float) -> List[dict]:
    rows = accepted(trades, cost_bps)
    if not rows:
        return list(trades)
    best = max(rows, key=lambda row: row[1])[0]
    removed = False
    result = []
    for trade in trades:
        if not removed and trade is best:
            removed = True
            continue
        result.append(trade)
    return result


def remove_best_month(trades: Sequence[dict], cost_bps: float) -> Tuple[List[dict], str | None]:
    rows = accepted(trades, cost_bps)
    if not rows:
        return list(trades), None
    monthly: Dict[str, float] = defaultdict(float)
    for trade, value in rows:
        monthly[str(trade["day"])[:7]] += value
    best_month = max(monthly, key=lambda month: (monthly[month], month))
    return [trade for trade in trades if str(trade["day"])[:7] != best_month], best_month


def segment_metrics(trades: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    return metrics([trade for trade in trades if trade["day"] in allowed])


def positive_normal_p95(result: dict) -> bool:
    return result["NORMAL"]["compoundedReturnPct"] > 0 and result["P95"]["compoundedReturnPct"] > 0


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    days, aligned, diagnostics = v17.load_all(cache_root)
    pre_july_days = [day for day in days if day < v17.HOLDOUT_START]
    july_days = [day for day in days if v17.HOLDOUT_START <= day < v17.HOLDOUT_END_EXCLUSIVE]
    splits = v14.split_days(pre_july_days)
    features = v15.build_slot_features(days, aligned)
    all_trades = v15.build_trades(CANDIDATE, days, features)

    segments = {
        "DEVELOPMENT": segment_metrics(all_trades, splits["DEVELOPMENT"]),
        "VALIDATION": segment_metrics(all_trades, splits["VALIDATION"]),
        "FINAL_REUSED": segment_metrics(all_trades, splits["FINAL_REUSED"]),
        "JULY_HOLDOUT": segment_metrics(all_trades, july_days),
        "FULL": metrics(all_trades),
    }

    normal_best_removed = metrics(remove_best_trade(all_trades, SCENARIOS["NORMAL"]))
    p95_best_removed = metrics(remove_best_trade(all_trades, SCENARIOS["P95"]))
    normal_month_removed_trades, normal_best_month = remove_best_month(all_trades, SCENARIOS["NORMAL"])
    p95_month_removed_trades, p95_best_month = remove_best_month(all_trades, SCENARIOS["P95"])
    normal_month_removed = metrics(normal_month_removed_trades)
    p95_month_removed = metrics(p95_month_removed_trades)

    leave_one_out = {}
    for symbol in v14.SYMBOLS:
        subset = [trade for trade in all_trades if trade["symbol"] != symbol]
        leave_one_out[symbol] = metrics(subset)

    long_only = metrics([trade for trade in all_trades if int(trade["side"]) > 0])
    short_only = metrics([trade for trade in all_trades if int(trade["side"]) < 0])
    full_normal = segments["FULL"]["NORMAL"]
    full_p95 = segments["FULL"]["P95"]

    checks = {
        "developmentPositive": positive_normal_p95(segments["DEVELOPMENT"]),
        "validationPositive": positive_normal_p95(segments["VALIDATION"]),
        "finalReusedPositive": positive_normal_p95(segments["FINAL_REUSED"]),
        "julyHoldoutPositive": positive_normal_p95(segments["JULY_HOLDOUT"]),
        "fullNormalAtLeastV13D": full_normal["compoundedReturnPct"] >= V13D_NORMAL_RETURN_PCT,
        "fullP95AtLeastV13D": full_p95["compoundedReturnPct"] >= V13D_P95_RETURN_PCT,
        "fullNormalMinimumTrades": full_normal["trades"] >= 20,
        "fullNormalProfitFactor": (full_normal["profitFactor"] or 0.0) > 1.30,
        "fullNormalDrawdown": full_normal["maxDrawdownPct"] >= -10.0,
        "capitalEfficiencyAtLeastV13D": full_normal["netBpsPerCapitalHour"] > V13D_NORMAL_BPS_PER_CAPITAL_HOUR,
        "normalBestTradeRemovedPositive": positive_normal_p95(normal_best_removed),
        "p95BestTradeRemovedPositive": positive_normal_p95(p95_best_removed),
        "normalBestMonthRemovedPositive": positive_normal_p95(normal_month_removed),
        "p95BestMonthRemovedPositive": positive_normal_p95(p95_month_removed),
        "allLeaveOneOutPositive": all(positive_normal_p95(row) for row in leave_one_out.values()),
        "severeNonnegativeFailClosed": segments["FULL"]["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    passed = all(checks.values())
    status = "ASTER_ONLY_V18_SHADOW_CANDIDATE_FOUND" if passed else "ASTER_ONLY_V18_FROZEN_LEAD_FAILED_ROBUSTNESS_AUDIT"

    return rounded({
        "version": 18,
        "strategyId": STRATEGY_ID,
        "status": status,
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
            "firstSession": days[0] if days else None,
            "lastSession": days[-1] if days else None,
            "sessions": len(days),
            "preJulySessions": len(pre_july_days),
            "julySessions": len(july_days),
        },
        "segments": segments,
        "robustness": {
            "normalBestTradeRemoved": normal_best_removed,
            "p95BestTradeRemoved": p95_best_removed,
            "normalBestMonthRemoved": {"month": normal_best_month, "metrics": normal_month_removed},
            "p95BestMonthRemoved": {"month": p95_best_month, "metrics": p95_month_removed},
            "leaveOneSymbolOut": leave_one_out,
            "longOnly": long_only,
            "shortOnly": short_only,
        },
        "benchmark": {
            "v13dNormalReturnPct": V13D_NORMAL_RETURN_PCT,
            "v13dP95ReturnPct": V13D_P95_RETURN_PCT,
            "v13dNormalBpsPerTwoVenueCapitalHour": V13D_NORMAL_BPS_PER_CAPITAL_HOUR,
            "sourceWorkflowRun": 30117325883,
            "sourceArtifactId": 8605974635,
        },
        "checks": checks,
        "allChecksPassed": passed,
        "tradeAudit": all_trades,
        "data": diagnostics,
        "selectionDiscipline": {
            "candidateFrozenBeforeJulyHoldout": True,
            "parametersChangedByV18": False,
            "allPredeclaredChecksReported": True,
            "productionPromotionAllowed": False,
            "forwardOrderBookShadowRequired": True,
        },
        "limitations": [
            "Historical cash input is Yahoo 60-minute data rather than Pyth ticks.",
            "Aster history is candle-based and does not reconstruct exact order-book execution.",
            "The final pre-July segment has been used by related Stock research.",
            "The July Holdout contains only 15 sessions.",
            "Historical performance does not guarantee future profit.",
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
    lines = [
        "# Aster-only V18 Frozen V15 Lead Audit",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidate: `{result['candidate']['candidate_id']}`",
        "",
    ]
    for name, row in result["segments"].items():
        normal = row["NORMAL"]
        p95 = row["P95"]
        lines.append(f"- {name}: Normal {normal['compoundedReturnPct']:.4f}% ({normal['trades']} trades, DD {normal['maxDrawdownPct']:.4f}%) / P95 {p95['compoundedReturnPct']:.4f}%")
    lines += ["", "## Checks", ""]
    for key, value in result["checks"].items():
        lines.append(f"- {key}: {value}")
    lines += [
        "",
        "A pass is Shadow-only. It does not authorize real orders without untouched Pyth/IEX and Aster order-book Forward evidence.",
        "",
    ]
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
        "candidate": result["candidate"],
        "segments": result["segments"],
        "checks": result["checks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
