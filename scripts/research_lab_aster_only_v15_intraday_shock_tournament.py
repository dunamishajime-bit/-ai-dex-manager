from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import run_aster_only_v14_with_frozen_v13d_benchmark as frozen

STRATEGY_ID = "DISDEX_ASTER_ONLY_V15_INTRADAY_BASIS_SHOCK_TOURNAMENT"
SYMBOLS = v14.SYMBOLS
LOOKBACK_DAYS = 20
MIN_NET_EDGE_BPS = 10.0
MAX_ROUND_TRIP_BPS = 60.0
TAKE_PROFIT_PCT = 0.75
STOP_LOSS_PCT = 1.00
SCENARIOS = v14.SCENARIOS


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    entry_policy: str
    maximum_holding_hours: int
    previous_symbol_cooldown: bool


FAMILY_THRESHOLDS = {
    "INTRADAY_SHOCK_FADE": (20.0, 35.0, 50.0),
    "TIME_SLOT_RESIDUAL_FADE": (40.0, 60.0, 80.0),
    "TIME_SLOT_ZSCORE_FADE": (1.5, 2.0, 2.5),
    "CROSS_SECTIONAL_EXTREME_FADE": (30.0, 50.0, 70.0),
    "BASIS_ACCELERATION_FADE": (15.0, 25.0, 40.0),
    "BASIS_REJECTION_FADE": (10.0, 20.0, 30.0),
    "FUNDING_SUPPORTED_SLOT_FADE": (40.0, 60.0, 80.0),
}
ENTRY_POLICIES = ("FIRST_ELIGIBLE", "SLOT_1130", "SLOT_1230", "SLOT_1330")

CANDIDATES = tuple(
    Candidate(
        candidate_id=f"{family}__T{threshold:g}__{policy}__H{hours}__{'COOLDOWN' if cooldown else 'NONE'}",
        family=family,
        threshold=threshold,
        entry_policy=policy,
        maximum_holding_hours=hours,
        previous_symbol_cooldown=cooldown,
    )
    for family, thresholds in FAMILY_THRESHOLDS.items()
    for threshold in thresholds
    for policy in ENTRY_POLICIES
    for hours in (1, 2)
    for cooldown in (False, True)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def points_for(row: dict) -> List[dict]:
    cash_entry = finite(row["cash"]["entry"])
    perp_entry = finite(row["perp"]["entry"])
    points = [{
        "ts": int(row["entryTs"]),
        "price": perp_entry,
        "basisBps": (perp_entry / cash_entry - 1.0) * 10_000.0,
        "label": "1030",
    }]
    labels = ("1130", "1230", "1330", "1430", "1530")
    for label, checkpoint in zip(labels, row["checkpoints"]):
        points.append({
            "ts": int(checkpoint["exitTs"]),
            "price": finite(checkpoint["exit"]),
            "basisBps": finite(checkpoint["basisBps"]),
            "label": label,
        })
    return points


def build_slot_features(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> Dict[str, dict]:
    history: Dict[str, Dict[int, List[float]]] = {
        symbol: {slot: [] for slot in range(6)} for symbol in SYMBOLS
    }
    result: Dict[str, dict] = {}
    for day in days:
        symbol_points = {symbol: points_for(aligned[symbol][day]) for symbol in SYMBOLS}
        cross_medians = {
            slot: statistics.median(symbol_points[symbol][slot]["basisBps"] for symbol in SYMBOLS)
            for slot in range(6)
        }
        result[day] = {"symbols": {}, "crossMedians": cross_medians}
        for symbol in SYMBOLS:
            rows = []
            for slot, point in enumerate(symbol_points[symbol]):
                previous = history[symbol][slot][-LOOKBACK_DAYS:]
                median = statistics.median(previous) if len(previous) >= LOOKBACK_DAYS else 0.0
                sigma = statistics.pstdev(previous) if len(previous) >= LOOKBACK_DAYS else 0.0
                residual = point["basisBps"] - median
                rows.append({
                    **point,
                    "rollingMedianBasisBps": median,
                    "rollingSigmaBasisBps": sigma,
                    "residualBps": residual,
                    "zscore": residual / sigma if sigma > 1e-9 else 0.0,
                    "crossResidualBps": point["basisBps"] - cross_medians[slot],
                    "historyReady": len(previous) >= LOOKBACK_DAYS,
                })
                history[symbol][slot].append(point["basisBps"])
            result[day]["symbols"][symbol] = {
                "points": rows,
                "fundingPoints": aligned[symbol][day]["perp"]["fundingPoints"],
            }
    return result


def slot_indices(policy: str) -> Sequence[int]:
    if policy == "FIRST_ELIGIBLE":
        return (1, 2, 3)
    return {"SLOT_1130": (1,), "SLOT_1230": (2,), "SLOT_1330": (3,)}[policy]


def receives_funding(side: int, funding_bps: Optional[float]) -> bool:
    if funding_bps is None:
        return False
    return (side < 0 and funding_bps > 0) or (side > 0 and funding_bps < 0)


def signal_for(candidate: Candidate, points: Sequence[dict], slot: int, funding_points: Sequence[Tuple[int, float]]) -> Optional[Tuple[float, int, float, dict]]:
    current = points[slot]
    previous = points[slot - 1]
    if not current["historyReady"]:
        return None
    basis = finite(current["basisBps"])
    previous_basis = finite(previous["basisBps"])
    shock = basis - previous_basis
    residual = finite(current["residualBps"])
    cross_residual = finite(current["crossResidualBps"])
    zscore = finite(current["zscore"])
    funding_bps = v14.latest_funding_bps(funding_points, int(current["ts"]))
    side = 0
    strength = edge_proxy = 0.0

    if candidate.family == "INTRADAY_SHOCK_FADE":
        if abs(shock) < candidate.threshold:
            return None
        side = -1 if shock > 0 else 1
        strength = abs(shock)
        edge_proxy = max(0.0, abs(shock) - 5.0)

    elif candidate.family == "TIME_SLOT_RESIDUAL_FADE":
        if abs(residual) < candidate.threshold:
            return None
        side = -1 if residual > 0 else 1
        strength = abs(residual)
        edge_proxy = max(0.0, abs(residual) - 10.0)

    elif candidate.family == "TIME_SLOT_ZSCORE_FADE":
        if abs(zscore) < candidate.threshold or abs(residual) < 35.0:
            return None
        side = -1 if residual > 0 else 1
        strength = abs(zscore) * 100.0 + abs(residual)
        edge_proxy = max(0.0, abs(residual) - 10.0)

    elif candidate.family == "CROSS_SECTIONAL_EXTREME_FADE":
        if abs(cross_residual) < candidate.threshold:
            return None
        side = -1 if cross_residual > 0 else 1
        strength = abs(cross_residual)
        edge_proxy = max(0.0, abs(cross_residual) - 10.0)

    elif candidate.family == "BASIS_ACCELERATION_FADE":
        acceleration = abs(basis) - abs(previous_basis)
        if basis * previous_basis <= 0 or abs(basis) < 50.0 or acceleration < candidate.threshold:
            return None
        side = -1 if basis > 0 else 1
        strength = abs(basis) + acceleration
        edge_proxy = max(0.0, abs(basis) - 15.0)

    elif candidate.family == "BASIS_REJECTION_FADE":
        reversion = abs(previous_basis) - abs(basis)
        if basis * previous_basis <= 0 or abs(previous_basis) < 50.0 or abs(basis) < 35.0 or reversion < candidate.threshold:
            return None
        side = -1 if basis > 0 else 1
        strength = abs(basis) + reversion
        edge_proxy = max(0.0, abs(basis) - 15.0)

    elif candidate.family == "FUNDING_SUPPORTED_SLOT_FADE":
        if abs(residual) < candidate.threshold:
            return None
        side = -1 if residual > 0 else 1
        if not receives_funding(side, funding_bps) or abs(finite(funding_bps)) < 0.20:
            return None
        strength = abs(residual) + abs(finite(funding_bps)) * 5.0
        edge_proxy = max(0.0, abs(residual) - 10.0)

    else:
        raise ValueError(candidate.family)

    return strength, side, edge_proxy, {
        "basisBps": basis,
        "previousBasisBps": previous_basis,
        "shockBps": shock,
        "residualBps": residual,
        "crossResidualBps": cross_residual,
        "zscore": zscore,
        "fundingBps": funding_bps,
    }


def select_entry(candidate: Candidate, day_feature: dict, blocked_symbol: Optional[str]) -> Optional[Tuple[str, int, int, float, dict]]:
    for slot in slot_indices(candidate.entry_policy):
        eligible = []
        for symbol in SYMBOLS:
            if candidate.previous_symbol_cooldown and symbol == blocked_symbol:
                continue
            symbol_row = day_feature["symbols"][symbol]
            signal = signal_for(candidate, symbol_row["points"], slot, symbol_row["fundingPoints"])
            if signal is not None:
                strength, side, edge_proxy, detail = signal
                eligible.append((strength, symbol, side, edge_proxy, detail))
        if eligible:
            _strength, symbol, side, edge_proxy, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
            return symbol, slot, side, edge_proxy, detail
    return None


def build_trade(candidate: Candidate, day: str, day_feature: dict, blocked_symbol: Optional[str]) -> Optional[dict]:
    selected = select_entry(candidate, day_feature, blocked_symbol)
    if selected is None:
        return None
    symbol, slot, side, edge_proxy, detail = selected
    symbol_row = day_feature["symbols"][symbol]
    points = symbol_row["points"]
    entry = points[slot]
    final_index = min(len(points) - 1, slot + candidate.maximum_holding_hours)
    chosen = points[final_index]
    reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[slot + 1: final_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= TAKE_PROFIT_PCT / 100.0:
            chosen = point
            reason = "PRICE_TAKE_PROFIT"
            break
        if price_return <= -STOP_LOSS_PCT / 100.0:
            chosen = point
            reason = "PRICE_STOP"
            break
    entry_ts = int(entry["ts"])
    exit_ts = int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(symbol_row["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "ASTER_ONLY_V15",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "entrySlot": entry["label"],
        "side": side,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "entryPrice": finite(entry["price"]),
        "exitPrice": finite(chosen["price"]),
        "edgeProxyBps": edge_proxy,
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "exitReason": reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    result = []
    previous_symbol = None
    for day in days:
        trade = build_trade(candidate, day, features[day], previous_symbol)
        if trade is None:
            continue
        result.append(trade)
        previous_symbol = trade["symbol"]
    return result


def metric_set(trades: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    selected = [trade for trade in trades if trade["day"] in allowed]
    return {name: v14.metrics(selected, cost) for name, cost in SCENARIOS.items()}


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


def benchmark() -> dict:
    rows, diagnostics = frozen.frozen_v13d(Path("."))
    costs = {"FORWARD_MEDIAN": 10.0, "NORMAL": 16.0, "P95": 26.0, "SEVERE": 45.0}
    return {
        "diagnostics": diagnostics,
        "results": {name: v14.v13d_metrics(rows, cost) for name, cost in costs.items()},
        "twoVenueCapitalHoursIncluded": True,
        "frozenSuccessfulArtifact": {
            "workflowRun": 30117325883,
            "artifactId": 8605974635,
            "artifactDigest": "sha256:6f2ff3b5fd6b3429da436d2bef1887f3fe407e424319212013655ce6ad7c60bc",
        },
    }


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    days, aligned, data_diag = v14.load_aligned(cache_root)
    features = build_slot_features(days, aligned)
    splits = v14.split_days(days)
    bench = benchmark()
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
    status = "NO_VALIDATION_PASSING_ASTER_ONLY_V15_CANDIDATE"
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
            "ASTER_ONLY_V15_PROFIT_TARGET_MET_REUSED_HISTORY_FORWARD_REQUIRED"
            if target_met else
            "ASTER_ONLY_V15_VALIDATION_LEAD_DOES_NOT_FULLY_REPLACE_V13D"
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

    return rounded({
        "version": 15,
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
            "entrySlotsNy": ["11:30", "12:30", "13:30"],
            "maximumHoldingHours": [1, 2],
            "onePositionPerDay": True,
            "takeProfitPct": TAKE_PROFIT_PCT,
            "stopLossPct": STOP_LOSS_PCT,
            "maximumObservableRoundTripCostBps": MAX_ROUND_TRIP_BPS,
            "minimumObservableNetEdgeBps": MIN_NET_EDGE_BPS,
            "severeCostAction": "FAIL_CLOSED_NO_ENTRY",
            "gross": 1.0,
        },
        "splits": {key: {"sessions": len(value), "first": value[0] if value else None, "last": value[-1] if value else None} for key, value in splits.items()},
        "data": data_diag,
        "v13dBenchmark": bench,
        "developmentTop": top,
        "validationRows": validation,
        "winner": winner,
        "selectionDiscipline": {
            "newEconomicFamiliesDeclaredBeforeV15Run": True,
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
            "Aster inputs are 30-minute candles and Funding, without order-book queue or exact post-only fills.",
            "The final chronological segment is reused history and cannot independently validate V15.",
            "The intraday slot expansion is a second research cycle motivated by V14 trade scarcity and remains exploratory.",
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
        "# Aster-only V15 Intraday Basis Shock Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Aligned sessions: {result['period']['alignedSessions']}",
        f"Candidates: {result['candidateCount']} across {result['familyCount']} families",
        "",
        "## V13D benchmark",
    ]
    for name, row in result["v13dBenchmark"]["results"].items():
        lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} trades")
    lines += ["", "## Selected V15 lead"]
    winner = result.get("winner")
    if winner is None:
        lines.append("No V15 candidate passed chronological Validation.")
    else:
        lines.append(f"- Candidate: `{winner['candidate']['candidate_id']}`")
        for name, row in winner["full"].items():
            lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} trades / hold {row['averageHoldingHours']:.2f}h")
        lines.append("")
        lines.append("Comparison:")
        for key, value in winner["comparison"].items():
            lines.append(f"- {key}: {value}")
    lines += [
        "",
        "This is reused-history research only. A historical target pass requires untouched Pyth/IEX plus Aster order-book Forward Shadow evidence before Production.",
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
        "period": result["period"],
        "v13dNormal": result["v13dBenchmark"]["results"]["NORMAL"],
        "winner": result.get("winner"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
