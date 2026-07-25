from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15

STRATEGY_ID = "DISDEX_ASTER_ONLY_V16_RELATIVE_VALUE_PAIR_TOURNAMENT"
SYMBOLS = v14.SYMBOLS
SCENARIOS = v14.SCENARIOS
MAX_ROUND_TRIP_BPS = 60.0
MIN_NET_EDGE_BPS = 10.0
TAKE_PROFIT_PCT = 0.75
STOP_LOSS_PCT = 1.00
SPREAD_STOP_MULTIPLE = 1.50
CONVERGENCE_FRACTION = 0.50


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    entry_policy: str
    maximum_holding_hours: int
    exit_mode: str


FAMILY_THRESHOLDS = {
    "RAW_BASIS_PAIR": (80.0, 120.0, 160.0),
    "RESIDUAL_PAIR": (80.0, 120.0, 160.0),
    "ZSCORE_PAIR": (2.0, 3.0, 4.0),
    "BASIS_SHOCK_PAIR": (80.0, 120.0, 160.0),
    "FUNDING_ALIGNED_RESIDUAL_PAIR": (80.0, 120.0, 160.0),
}
ENTRY_POLICIES = ("FIRST_ELIGIBLE", "SLOT_1130", "SLOT_1230", "SLOT_1330")
EXIT_MODES = ("TIME", "CONVERGENCE_50")

CANDIDATES = tuple(
    Candidate(
        candidate_id=f"{family}__T{threshold:g}__{policy}__H{hours}__{exit_mode}",
        family=family,
        threshold=threshold,
        entry_policy=policy,
        maximum_holding_hours=hours,
        exit_mode=exit_mode,
    )
    for family, thresholds in FAMILY_THRESHOLDS.items()
    for threshold in thresholds
    for policy in ENTRY_POLICIES
    for hours in (1, 2)
    for exit_mode in EXIT_MODES
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def metric_value(family: str, points: Sequence[dict], slot: int) -> float:
    current = points[slot]
    previous = points[slot - 1]
    if family == "RAW_BASIS_PAIR":
        return finite(current["basisBps"])
    if family in {"RESIDUAL_PAIR", "FUNDING_ALIGNED_RESIDUAL_PAIR"}:
        return finite(current["residualBps"])
    if family == "ZSCORE_PAIR":
        return finite(current["zscore"])
    if family == "BASIS_SHOCK_PAIR":
        return finite(current["basisBps"]) - finite(previous["basisBps"])
    raise ValueError(family)


def economic_spread_bps(family: str, low_points: Sequence[dict], high_points: Sequence[dict], slot: int) -> float:
    if family == "ZSCORE_PAIR":
        return finite(high_points[slot]["residualBps"]) - finite(low_points[slot]["residualBps"])
    return metric_value(family, high_points, slot) - metric_value(family, low_points, slot)


def receives_long_funding(funding_bps: Optional[float]) -> bool:
    return funding_bps is not None and finite(funding_bps) < 0


def receives_short_funding(funding_bps: Optional[float]) -> bool:
    return funding_bps is not None and finite(funding_bps) > 0


def pair_signal(candidate: Candidate, day_feature: dict, slot: int) -> Optional[dict]:
    rows = []
    for symbol in SYMBOLS:
        symbol_row = day_feature["symbols"][symbol]
        points = symbol_row["points"]
        if not points[slot]["historyReady"]:
            return None
        value = metric_value(candidate.family, points, slot)
        funding_bps = v14.latest_funding_bps(symbol_row["fundingPoints"], int(points[slot]["ts"]))
        rows.append({
            "symbol": symbol,
            "value": value,
            "points": points,
            "fundingPoints": symbol_row["fundingPoints"],
            "fundingBps": funding_bps,
        })
    low = min(rows, key=lambda row: (row["value"], row["symbol"]))
    high = max(rows, key=lambda row: (row["value"], row["symbol"]))
    if low["symbol"] == high["symbol"]:
        return None
    metric_spread = finite(high["value"]) - finite(low["value"])
    if metric_spread < candidate.threshold:
        return None
    if candidate.family == "FUNDING_ALIGNED_RESIDUAL_PAIR":
        if not receives_long_funding(low["fundingBps"]) or not receives_short_funding(high["fundingBps"]):
            return None
    economic_spread = economic_spread_bps(candidate.family, low["points"], high["points"], slot)
    if economic_spread <= 0:
        return None
    return {
        "low": low,
        "high": high,
        "slot": slot,
        "metricSpread": metric_spread,
        "economicSpreadBps": economic_spread,
        "edgeProxyBps": 0.5 * economic_spread,
    }


def select_pair(candidate: Candidate, day_feature: dict) -> Optional[dict]:
    for slot in v15.slot_indices(candidate.entry_policy):
        signal = pair_signal(candidate, day_feature, slot)
        if signal is not None:
            return signal
    return None


def build_trade(candidate: Candidate, day: str, day_feature: dict) -> Optional[dict]:
    signal = select_pair(candidate, day_feature)
    if signal is None:
        return None
    low = signal["low"]
    high = signal["high"]
    slot = int(signal["slot"])
    low_points = low["points"]
    high_points = high["points"]
    entry_low = low_points[slot]
    entry_high = high_points[slot]
    final_index = min(len(low_points) - 1, slot + candidate.maximum_holding_hours)
    chosen_index = final_index
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    entry_metric_spread = finite(signal["metricSpread"])

    for index in range(slot + 1, final_index + 1):
        low_point = low_points[index]
        high_point = high_points[index]
        pair_return = (
            0.5 * (finite(low_point["price"]) / finite(entry_low["price"]) - 1.0)
            - 0.5 * (finite(high_point["price"]) / finite(entry_high["price"]) - 1.0)
        )
        current_metric_spread = metric_value(candidate.family, high_points, index) - metric_value(candidate.family, low_points, index)
        if pair_return >= TAKE_PROFIT_PCT / 100.0:
            chosen_index = index
            exit_reason = "PAIR_TAKE_PROFIT"
            break
        if pair_return <= -STOP_LOSS_PCT / 100.0:
            chosen_index = index
            exit_reason = "PAIR_PRICE_STOP"
            break
        if current_metric_spread >= SPREAD_STOP_MULTIPLE * entry_metric_spread:
            chosen_index = index
            exit_reason = "PAIR_SPREAD_STOP"
            break
        if candidate.exit_mode == "CONVERGENCE_50" and (
            current_metric_spread <= CONVERGENCE_FRACTION * entry_metric_spread
            or current_metric_spread <= 0
        ):
            chosen_index = index
            exit_reason = "PAIR_SPREAD_CONVERGED"
            break

    exit_low = low_points[chosen_index]
    exit_high = high_points[chosen_index]
    entry_ts = int(entry_low["ts"])
    exit_ts = int(exit_low["ts"])
    price_return = (
        0.5 * (finite(exit_low["price"]) / finite(entry_low["price"]) - 1.0)
        - 0.5 * (finite(exit_high["price"]) / finite(entry_high["price"]) - 1.0)
    )
    low_funding = 0.5 * (-1.0) * v14.funding_mod.funding_between(low["fundingPoints"], entry_ts, exit_ts)
    high_funding = 0.5 * (1.0) * v14.funding_mod.funding_between(high["fundingPoints"], entry_ts, exit_ts)
    funding_return = low_funding + high_funding
    return {
        "strategy": "ASTER_ONLY_V16_PAIR",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": f"{low['symbol']}/{high['symbol']}",
        "longSymbol": low["symbol"],
        "shortSymbol": high["symbol"],
        "side": 0,
        "entrySlot": entry_low["label"],
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "edgeProxyBps": finite(signal["edgeProxyBps"]),
        "entryMetricSpread": entry_metric_spread,
        "entryEconomicSpreadBps": finite(signal["economicSpreadBps"]),
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "exitReason": exit_reason,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day])) is not None]


def metric_set(trades: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    subset = [trade for trade in trades if trade["day"] in allowed]
    return {name: v14.metrics(subset, cost) for name, cost in SCENARIOS.items()}


def score(result: dict) -> float:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return (
        normal["compoundedReturnPct"]
        + p95["compoundedReturnPct"]
        + 0.25 * normal["netBpsPerCapitalHour"]
        - 0.50 * abs(normal["maxDrawdownPct"])
    )


def development_pass(result: dict) -> bool:
    return bool(
        result["NORMAL"]["trades"] >= 10
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["P95"]["compoundedReturnPct"] > 0
        and (result["P95"]["profitFactor"] or 0.0) > 1.05
    )


def validation_pass(result: dict) -> bool:
    return bool(
        result["NORMAL"]["trades"] >= 5
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["P95"]["compoundedReturnPct"] > 0
        and (result["NORMAL"]["profitFactor"] or 0.0) > 1.10
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    days, aligned, data_diag = v14.load_aligned(cache_root)
    features = v15.build_slot_features(days, aligned)
    splits = v14.split_days(days)
    bench = v15.benchmark()
    all_trades = {candidate.candidate_id: build_trades(candidate, days, features) for candidate in CANDIDATES}

    development = []
    for candidate in CANDIDATES:
        result = metric_set(all_trades[candidate.candidate_id], splits["DEVELOPMENT"])
        development.append({
            "candidate": asdict(candidate),
            "result": result,
            "score": score(result),
            "passed": development_pass(result),
        })
    eligible = [row for row in development if row["passed"]]
    top = sorted(eligible or development, key=lambda row: (row["score"], row["candidate"]["candidate_id"]), reverse=True)[:20]

    validation = []
    for row in top:
        candidate_id = row["candidate"]["candidate_id"]
        result = metric_set(all_trades[candidate_id], splits["VALIDATION"])
        validation.append({
            "candidate": row["candidate"],
            "development": row["result"],
            "developmentScore": row["score"],
            "validation": result,
            "validationScore": score(result),
            "passed": validation_pass(result),
        })
    validation_eligible = [row for row in validation if row["passed"]]
    selected = max(validation_eligible, key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"]), default=None)

    winner = None
    status = "NO_VALIDATION_PASSING_ASTER_ONLY_V16_PAIR"
    if selected is not None:
        candidate_id = selected["candidate"]["candidate_id"]
        final_result = metric_set(all_trades[candidate_id], splits["FINAL_REUSED"])
        full_result = metric_set(all_trades[candidate_id], splits["FULL"])
        normal_dominates = full_result["NORMAL"]["compoundedReturnPct"] >= bench["results"]["NORMAL"]["compoundedReturnPct"]
        p95_dominates = full_result["P95"]["compoundedReturnPct"] >= bench["results"]["P95"]["compoundedReturnPct"]
        final_positive = final_result["NORMAL"]["compoundedReturnPct"] > 0 and final_result["P95"]["compoundedReturnPct"] > 0
        severe_nonnegative = full_result["SEVERE"]["compoundedReturnPct"] >= 0
        efficiency_ratio = (
            full_result["NORMAL"]["netBpsPerCapitalHour"] / bench["results"]["NORMAL"]["netBpsPerCapitalHour"]
            if bench["results"]["NORMAL"]["netBpsPerCapitalHour"] > 0 else 999.0
        )
        target_met = normal_dominates and p95_dominates and final_positive and severe_nonnegative and efficiency_ratio >= 1.0
        status = (
            "ASTER_ONLY_V16_PAIR_TARGET_MET_REUSED_HISTORY_FORWARD_REQUIRED"
            if target_met else
            "ASTER_ONLY_V16_PAIR_VALIDATION_LEAD_DOES_NOT_FULLY_REPLACE_V13D"
        )
        winner = {
            **selected,
            "finalReused": final_result,
            "full": full_result,
            "comparison": {
                "normalProfitAtLeastV13D": normal_dominates,
                "p95ProfitAtLeastV13D": p95_dominates,
                "finalReusedNormalAndP95Positive": final_positive,
                "severeNonnegativeByObservableCostGate": severe_nonnegative,
                "normalCapitalEfficiencyRatioVsTwoVenueV13D": efficiency_ratio,
                "historicalProfitTargetMet": target_met,
            },
        }

    return v14.rounded({
        "version": 16,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusive": v14.base.PERIOD_START.isoformat(),
            "endExclusive": v14.base.PERIOD_END.isoformat(),
            "alignedSessions": len(days),
            "firstSession": days[0] if days else None,
            "lastSession": days[-1] if days else None,
        },
        "candidateCount": len(CANDIDATES),
        "familyCount": len(FAMILY_THRESHOLDS),
        "rules": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "twoAsterLegs": True,
            "longGross": 0.5,
            "shortGross": 0.5,
            "totalGross": 1.0,
            "entrySlotsNy": ["11:30", "12:30", "13:30"],
            "maximumHoldingHours": [1, 2],
            "exitModes": list(EXIT_MODES),
            "maximumObservableRoundTripCostBps": MAX_ROUND_TRIP_BPS,
            "minimumObservableNetEdgeBps": MIN_NET_EDGE_BPS,
            "severeCostAction": "FAIL_CLOSED_NO_ENTRY",
        },
        "splits": {key: {"sessions": len(value), "first": value[0] if value else None, "last": value[-1] if value else None} for key, value in splits.items()},
        "data": data_diag,
        "v13dBenchmark": bench,
        "developmentTop": top,
        "validationRows": validation,
        "winner": winner,
        "selectionDiscipline": {
            "familiesAndThresholdsPredeclared": True,
            "developmentSelectsTop20Only": True,
            "validationSelectsWinner": True,
            "finalReusedPeriodEvaluatedOnce": True,
            "independentHoldoutClaim": False,
            "furtherThresholdRetuningOnSameHistoryAllowed": False,
            "productionPromotionAllowed": False,
            "forwardShadowRequired": True,
        },
        "limitations": [
            "Cash references are Yahoo 60-minute bars rather than Pyth tick history.",
            "Aster inputs are 30-minute candles without exact spread, depth, queue and fill reconstruction.",
            "Two Aster legs still consume margin, although collateral remains in one account and total Gross is capped at 1.0.",
            "The final chronological segment is reused history and is not an independent Holdout.",
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
        "# Aster-only V16 Relative-Value Pair Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Aligned sessions: {result['period']['alignedSessions']}",
        f"Candidates: {result['candidateCount']} across {result['familyCount']} families",
        "",
        "## V13D benchmark",
    ]
    for name, row in result["v13dBenchmark"]["results"].items():
        lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / {row['trades']} trades / {row['netBpsPerCapitalHour']:.4f} bps per two-venue capital-hour")
    lines += ["", "## Selected V16 pair"]
    winner = result.get("winner")
    if winner is None:
        lines.append("No pair candidate passed chronological Validation.")
    else:
        lines.append(f"- Candidate: `{winner['candidate']['candidate_id']}`")
        for name, row in winner["full"].items():
            lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} pairs / hold {row['averageHoldingHours']:.2f}h")
        lines.append("")
        for key, value in winner["comparison"].items():
            lines.append(f"- {key}: {value}")
    lines += ["", "Research only; untouched Aster order-book plus Pyth/IEX Forward Shadow evidence remains mandatory.", ""]
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
    print(json.dumps({"status": result["status"], "period": result["period"], "winner": result.get("winner")}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
