from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_crypto_v11eq_v13d_one_year_bt as portfolio

base = portfolio.base
v11 = base.v11
funding_mod = v11.funding_mod
UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V14_V13D_REPLACEMENT_TOURNAMENT"
LOOKBACK_DAYS = 20
MIN_NET_EDGE_BPS = 10.0
MAX_OBSERVABLE_ROUND_TRIP_BPS = 60.0
STOP_MULTIPLE = 1.5
SYMBOLS = tuple(v11.SYMBOLS)

SCENARIOS = {
    "FORWARD_MEDIAN": 24.0,
    "NORMAL": 40.0,
    "P95": 44.0,
    "SEVERE": 100.0,
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    maximum_holding_hours: int
    previous_symbol_cooldown: bool


FAMILY_THRESHOLDS = {
    "ABS_RESIDUAL_FADE": (40.0, 60.0, 80.0),
    "ZSCORE_RESIDUAL_FADE": (1.5, 2.0, 2.5),
    "OPEN_OVERSHOOT_FADE": (15.0, 25.0, 40.0),
    "CONFIRMED_BASIS_FADE": (50.0, 75.0, 100.0),
    "FUNDING_SUPPORTED_RESIDUAL_FADE": (40.0, 60.0, 80.0),
}

CANDIDATES = tuple(
    Candidate(
        candidate_id=f"{family}__T{threshold:g}__H{hours}__{'COOLDOWN' if cooldown else 'NONE'}",
        family=family,
        threshold=threshold,
        maximum_holding_hours=hours,
        previous_symbol_cooldown=cooldown,
    )
    for family, thresholds in FAMILY_THRESHOLDS.items()
    for threshold in thresholds
    for hours in (1, 2, 3)
    for cooldown in (False, True)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    return value


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    drawdown = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        drawdown = min(drawdown, equity / peak - 1.0)
    return drawdown


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def latest_funding_bps(points: Sequence[Tuple[int, float]], timestamp: int) -> Optional[float]:
    latest = None
    for ts, rate in points:
        if int(ts) > timestamp:
            break
        latest = finite(rate) * 10_000.0
    return latest


def load_aligned(cache_root: Path) -> Tuple[List[str], Dict[str, Dict[str, dict]], dict]:
    cash, cash_diag = v11.load_cash_intraday(cache_root / "v11-cash")
    perp, perp_diag = v11.load_perp_intraday(cache_root / "v11-perp", cache_root / "v11-funding")
    days, aligned, alignment = v11.align_intraday(cash, perp)
    start = base.PERIOD_START.date().isoformat()
    end = base.PERIOD_END.date().isoformat()
    days = [day for day in days if start <= day < end]
    return days, aligned, {"cash": cash_diag, "perp": perp_diag, "alignment": alignment}


def build_features(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> Dict[str, Dict[str, dict]]:
    history: Dict[str, List[float]] = {symbol: [] for symbol in SYMBOLS}
    result: Dict[str, Dict[str, dict]] = {}
    for day in days:
        result[day] = {}
        for symbol in SYMBOLS:
            row = aligned[symbol][day]
            signal_basis = finite(row["basisBps"])
            cash_signal = finite(row["cash"]["signal"])
            perp_signal = finite(row["perp"]["signal"])
            cash_entry = finite(row["cash"]["entry"])
            perp_entry = finite(row["perp"]["entry"])
            entry_basis = (perp_entry / cash_entry - 1.0) * 10_000.0
            previous = history[symbol][-LOOKBACK_DAYS:]
            median = statistics.median(previous) if len(previous) >= LOOKBACK_DAYS else 0.0
            sigma = statistics.pstdev(previous) if len(previous) >= LOOKBACK_DAYS else 0.0
            residual = entry_basis - median
            signal_residual = signal_basis - median
            zscore = residual / sigma if sigma > 1e-9 else 0.0
            impulse = entry_basis - signal_basis
            tracking_error = (
                (perp_entry / perp_signal - 1.0) - (cash_entry / cash_signal - 1.0)
            ) * 10_000.0
            result[day][symbol] = {
                "row": row,
                "signalBasisBps": signal_basis,
                "entryBasisBps": entry_basis,
                "rollingMedianBasisBps": median,
                "rollingSigmaBasisBps": sigma,
                "entryResidualBps": residual,
                "signalResidualBps": signal_residual,
                "zscore": zscore,
                "openingImpulseBps": impulse,
                "trackingErrorBps": tracking_error,
                "fundingBps": latest_funding_bps(row["perp"]["fundingPoints"], int(row["entryTs"])),
                "historyReady": len(previous) >= LOOKBACK_DAYS,
            }
            history[symbol].append(signal_basis)
    return result


def family_signal(candidate: Candidate, feature: dict) -> Optional[Tuple[float, int, str, float]]:
    if not feature["historyReady"]:
        return None
    entry_basis = finite(feature["entryBasisBps"])
    signal_basis = finite(feature["signalBasisBps"])
    residual = finite(feature["entryResidualBps"])
    signal_residual = finite(feature["signalResidualBps"])
    impulse = finite(feature["openingImpulseBps"])
    funding_bps = feature.get("fundingBps")

    if candidate.family == "ABS_RESIDUAL_FADE":
        if abs(residual) < candidate.threshold:
            return None
        side = -1 if residual > 0 else 1
        return abs(residual), side, "RESIDUAL", max(10.0, abs(residual) - 10.0)

    if candidate.family == "ZSCORE_RESIDUAL_FADE":
        zscore = finite(feature["zscore"])
        if abs(zscore) < candidate.threshold or abs(residual) < 35.0:
            return None
        side = -1 if residual > 0 else 1
        return abs(zscore) * 100.0 + abs(residual), side, "RESIDUAL", max(10.0, abs(residual) - 10.0)

    if candidate.family == "OPEN_OVERSHOOT_FADE":
        if abs(entry_basis) < 50.0 or signal_basis * entry_basis <= 0:
            return None
        if abs(impulse) < candidate.threshold or impulse * entry_basis <= 0:
            return None
        side = -1 if entry_basis > 0 else 1
        return abs(impulse) + abs(entry_basis), side, "BASIS", max(15.0, abs(entry_basis) - 15.0)

    if candidate.family == "CONFIRMED_BASIS_FADE":
        if abs(signal_basis) < candidate.threshold or signal_basis * entry_basis <= 0:
            return None
        confirmation = abs(signal_basis) - abs(entry_basis)
        if confirmation < 5.0 or abs(entry_basis) < 35.0:
            return None
        side = -1 if entry_basis > 0 else 1
        return abs(entry_basis) + confirmation, side, "BASIS", max(15.0, abs(entry_basis) - 15.0)

    if candidate.family == "FUNDING_SUPPORTED_RESIDUAL_FADE":
        if abs(residual) < candidate.threshold or funding_bps is None:
            return None
        side = -1 if residual > 0 else 1
        # A short receives positive Funding and a long receives negative Funding.
        receives_funding = (side < 0 and finite(funding_bps) > 0) or (side > 0 and finite(funding_bps) < 0)
        if not receives_funding or abs(finite(funding_bps)) < 0.20:
            return None
        return abs(residual) + abs(finite(funding_bps)) * 5.0, side, "RESIDUAL", max(10.0, abs(residual) - 10.0)

    raise ValueError(candidate.family)


def select_feature(candidate: Candidate, day_features: Dict[str, dict], blocked_symbol: Optional[str]) -> Optional[Tuple[str, dict, Tuple[float, int, str, float]]]:
    eligible = []
    for symbol in SYMBOLS:
        if candidate.previous_symbol_cooldown and symbol == blocked_symbol:
            continue
        signal = family_signal(candidate, day_features[symbol])
        if signal is not None:
            eligible.append((signal[0], symbol, day_features[symbol], signal))
    if not eligible:
        return None
    _score, symbol, feature, signal = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, feature, signal


def build_trade(candidate: Candidate, day: str, day_features: Dict[str, dict], blocked_symbol: Optional[str]) -> Optional[dict]:
    selected = select_feature(candidate, day_features, blocked_symbol)
    if selected is None:
        return None
    symbol, feature, (_score, side, metric_mode, edge_proxy) = selected
    row = feature["row"]
    entry_basis = finite(feature["entryBasisBps"])
    median_basis = finite(feature["rollingMedianBasisBps"])
    entry_metric = entry_basis if metric_mode == "BASIS" else entry_basis - median_basis
    target = 15.0 if metric_mode == "BASIS" else 10.0
    checkpoints = list(row["checkpoints"])
    maximum_index = min(len(checkpoints) - 1, max(0, candidate.maximum_holding_hours - 1))
    chosen = checkpoints[maximum_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    exit_metric = finite(chosen["basisBps"]) if metric_mode == "BASIS" else finite(chosen["basisBps"]) - median_basis
    for checkpoint in checkpoints[: maximum_index + 1]:
        current_metric = finite(checkpoint["basisBps"]) if metric_mode == "BASIS" else finite(checkpoint["basisBps"]) - median_basis
        converged = abs(current_metric) <= target or current_metric * entry_metric <= 0
        stopped = abs(current_metric) >= STOP_MULTIPLE * abs(entry_metric)
        if converged or stopped:
            chosen = checkpoint
            exit_metric = current_metric
            exit_reason = "METRIC_CONVERGED" if converged else "METRIC_STOP"
            break
    entry_price = finite(row["entry"])
    exit_price = finite(chosen["exit"])
    entry_ts = int(row["entryTs"])
    exit_ts = int(chosen["exitTs"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * funding_mod.funding_between(row["perp"]["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "ASTER_ONLY_V14",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "entryPrice": entry_price,
        "exitPrice": exit_price,
        "entryBasisBps": entry_basis,
        "entryResidualBps": finite(feature["entryResidualBps"]),
        "entryMetricBps": entry_metric,
        "exitMetricBps": exit_metric,
        "edgeProxyBps": edge_proxy,
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "exitReason": exit_reason,
    }


def build_candidate_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, Dict[str, dict]]) -> List[dict]:
    trades = []
    previous_symbol = None
    for day in days:
        trade = build_trade(candidate, day, features[day], previous_symbol)
        if trade is None:
            continue
        trades.append(trade)
        previous_symbol = trade["symbol"]
    return trades


def net_trade_return(trade: dict, round_trip_bps: float) -> Optional[float]:
    if round_trip_bps > MAX_OBSERVABLE_ROUND_TRIP_BPS:
        return None
    if finite(trade["edgeProxyBps"]) - round_trip_bps < MIN_NET_EDGE_BPS:
        return None
    return finite(trade["grossReturn"]) - round_trip_bps / 10_000.0


def metrics(trades: Sequence[dict], round_trip_bps: float) -> dict:
    accepted = []
    rejected = Counter()
    for trade in trades:
        value = net_trade_return(trade, round_trip_bps)
        if value is None:
            if round_trip_bps > MAX_OBSERVABLE_ROUND_TRIP_BPS:
                rejected["COST_OVER_60BPS"] += 1
            else:
                rejected["NET_EDGE_BELOW_10BPS"] += 1
            continue
        accepted.append((trade, value))
    values = [value for _trade, value in accepted]
    capital_hours = sum(finite(trade["holdingHours"]) for trade, _value in accepted)
    net_bps_sum = sum(values) * 10_000.0
    return {
        "trades": len(values),
        "compoundedReturnPct": product(values) * 100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradeBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "medianTradeBps": statistics.median(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "averageHoldingHours": statistics.mean(finite(trade["holdingHours"]) for trade, _value in accepted) if accepted else 0.0,
        "capitalHours": capital_hours,
        "netBpsPerCapitalHour": net_bps_sum / capital_hours if capital_hours > 0 else 0.0,
        "fundingReturnSumPct": sum(finite(trade["fundingReturn"]) for trade, _value in accepted) * 100.0,
        "longTrades": sum(trade["side"] > 0 for trade, _value in accepted),
        "shortTrades": sum(trade["side"] < 0 for trade, _value in accepted),
        "symbolCounts": dict(sorted(Counter(trade["symbol"] for trade, _value in accepted).items())),
        "exitReasons": dict(sorted(Counter(trade["exitReason"] for trade, _value in accepted).items())),
        "rejections": dict(rejected),
    }


def v13d_metrics(rows: Sequence[dict], cycle_bps: float) -> dict:
    values = [(finite(row["grossBps"]) - cycle_bps) / 10_000.0 for row in rows]
    capital_hours = sum(max(0.0, (int(row["exitTs"]) - int(row["entryTs"])) / 3_600_000.0) * 2.0 for row in rows)
    return {
        "trades": len(values),
        "compoundedReturnPct": product(values) * 100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradeBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "averageHoldingHours": statistics.mean((int(row["exitTs"]) - int(row["entryTs"])) / 3_600_000.0 for row in rows) if rows else 0.0,
        "capitalHoursTwoVenue": capital_hours,
        "netBpsPerCapitalHour": sum(values) * 10_000.0 / capital_hours if capital_hours > 0 else 0.0,
    }


def split_days(days: Sequence[str]) -> dict:
    n = len(days)
    development_end = max(1, int(n * 0.50))
    validation_end = max(development_end + 1, int(n * 0.75))
    return {
        "DEVELOPMENT": list(days[:development_end]),
        "VALIDATION": list(days[development_end:validation_end]),
        "FINAL_REUSED": list(days[validation_end:]),
        "FULL": list(days),
    }


def in_days(trades: Sequence[dict], selected_days: Sequence[str]) -> List[dict]:
    allowed = set(selected_days)
    return [trade for trade in trades if trade["day"] in allowed]


def scenario_results(trades: Sequence[dict], selected_days: Sequence[str]) -> dict:
    subset = in_days(trades, selected_days)
    return {name: metrics(subset, cost) for name, cost in SCENARIOS.items()}


def selection_score(result: dict) -> float:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return (
        normal["compoundedReturnPct"]
        + p95["compoundedReturnPct"]
        + 0.20 * normal["netBpsPerCapitalHour"]
        - 0.50 * abs(normal["maxDrawdownPct"])
    )


def development_pass(result: dict) -> bool:
    return bool(
        result["NORMAL"]["trades"] >= 8
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["P95"]["compoundedReturnPct"] > 0
        and (result["P95"]["profitFactor"] or 0.0) > 1.05
    )


def validation_pass(result: dict) -> bool:
    return bool(
        result["NORMAL"]["trades"] >= 4
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["P95"]["compoundedReturnPct"] > 0
        and (result["NORMAL"]["profitFactor"] or 0.0) > 1.10
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def analyze(cache_root: Path) -> dict:
    base.verify_source(base.V11_ROOT, base.V11_SOURCE_SHA)
    base.verify_source(base.V13_ROOT, base.V13_SOURCE_SHA)
    days, aligned, data_diag = load_aligned(cache_root)
    features = build_features(days, aligned)
    splits = split_days(days)
    v13d_rows, v13d_diag = base.build_v13d(cache_root)
    v13d_rows = [row for row in v13d_rows if row["day"] in set(days)]
    benchmark_costs = {name: {"FORWARD_MEDIAN": 10.0, "NORMAL": 16.0, "P95": 26.0, "SEVERE": 45.0}[name] for name in SCENARIOS}
    benchmark = {name: v13d_metrics(v13d_rows, cost) for name, cost in benchmark_costs.items()}

    all_trades = {candidate.candidate_id: build_candidate_trades(candidate, days, features) for candidate in CANDIDATES}
    development_rows = []
    for candidate in CANDIDATES:
        result = scenario_results(all_trades[candidate.candidate_id], splits["DEVELOPMENT"])
        development_rows.append({
            "candidate": asdict(candidate),
            "result": result,
            "score": selection_score(result),
            "passed": development_pass(result),
        })
    development_eligible = [row for row in development_rows if row["passed"]]
    top_development = sorted(development_eligible or development_rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]), reverse=True)[:15]

    validation_rows = []
    for row in top_development:
        candidate_id = row["candidate"]["candidate_id"]
        result = scenario_results(all_trades[candidate_id], splits["VALIDATION"])
        validation_rows.append({
            "candidate": row["candidate"],
            "development": row["result"],
            "developmentScore": row["score"],
            "validation": result,
            "validationScore": selection_score(result),
            "passed": validation_pass(result),
        })
    validation_eligible = [row for row in validation_rows if row["passed"]]
    winner_row = max(validation_eligible, key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"]), default=None)

    winner = None
    status = "NO_VALIDATION_PASSING_ASTER_ONLY_V14_CANDIDATE"
    if winner_row is not None:
        candidate_id = winner_row["candidate"]["candidate_id"]
        final_result = scenario_results(all_trades[candidate_id], splits["FINAL_REUSED"])
        full_result = scenario_results(all_trades[candidate_id], splits["FULL"])
        normal_profit_dominates = full_result["NORMAL"]["compoundedReturnPct"] >= benchmark["NORMAL"]["compoundedReturnPct"]
        p95_profit_dominates = full_result["P95"]["compoundedReturnPct"] >= benchmark["P95"]["compoundedReturnPct"]
        final_positive = final_result["NORMAL"]["compoundedReturnPct"] > 0 and final_result["P95"]["compoundedReturnPct"] > 0
        severe_nonnegative = full_result["SEVERE"]["compoundedReturnPct"] >= 0
        capital_efficiency_ratio = (
            full_result["NORMAL"]["netBpsPerCapitalHour"] / benchmark["NORMAL"]["netBpsPerCapitalHour"]
            if benchmark["NORMAL"]["netBpsPerCapitalHour"] > 0 else 999.0
        )
        target_met = normal_profit_dominates and p95_profit_dominates and final_positive and severe_nonnegative and capital_efficiency_ratio >= 1.0
        status = (
            "ASTER_ONLY_V14_PROFIT_TARGET_MET_REUSED_HISTORY_FORWARD_REQUIRED"
            if target_met else
            "ASTER_ONLY_V14_VALIDATION_LEAD_DOES_NOT_FULLY_REPLACE_V13D"
        )
        winner = {
            **winner_row,
            "finalReused": final_result,
            "full": full_result,
            "comparison": {
                "normalProfitAtLeastV13D": normal_profit_dominates,
                "p95ProfitAtLeastV13D": p95_profit_dominates,
                "finalReusedNormalAndP95Positive": final_positive,
                "severeNonnegativeByObservableCostGate": severe_nonnegative,
                "normalCapitalEfficiencyRatioVsTwoVenueV13D": capital_efficiency_ratio,
                "historicalProfitTargetMet": target_met,
            },
        }

    return rounded({
        "version": 14,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusive": base.PERIOD_START.isoformat(),
            "endExclusive": base.PERIOD_END.isoformat(),
            "alignedSessions": len(days),
            "firstSession": days[0] if days else None,
            "lastSession": days[-1] if days else None,
        },
        "candidateCount": len(CANDIDATES),
        "familyCount": len(FAMILY_THRESHOLDS),
        "rules": {
            "venue": "ASTER_ONLY",
            "externalReference": "US_CASH_EQUITY_HISTORICAL_PROXY__PYTH_PLUS_IEX_LIVE_TARGET",
            "onePositionTotal": True,
            "maximumHoldingHours": [1, 2, 3],
            "maximumObservableRoundTripCostBps": MAX_OBSERVABLE_ROUND_TRIP_BPS,
            "minimumObservableNetEdgeBps": MIN_NET_EDGE_BPS,
            "severeCostAction": "FAIL_CLOSED_NO_ENTRY",
            "gross": 1.0,
            "hyperliquidUsed": False,
            "v11EqExactCandidateExcluded": True,
        },
        "splits": {key: {"sessions": len(value), "first": value[0] if value else None, "last": value[-1] if value else None} for key, value in splits.items()},
        "data": data_diag,
        "v13dBenchmark": {"diagnostics": v13d_diag, "results": benchmark, "twoVenueCapitalHoursIncluded": True},
        "developmentTop": top_development,
        "validationRows": validation_rows,
        "winner": winner,
        "selectionDiscipline": {
            "familiesAndThresholdsPredeclaredTogether": True,
            "developmentSelectsTop15Only": True,
            "validationSelectsWinner": True,
            "finalReusedPeriodEvaluatedOnce": True,
            "independentHoldoutClaim": False,
            "furtherThresholdRetuningOnSameHistoryAllowed": False,
            "productionPromotionAllowed": False,
            "forwardShadowRequired": True,
        },
        "limitations": [
            "Historical cash bars are Yahoo 60-minute public chart data, not Pyth tick history.",
            "Aster historical inputs are 30-minute candles and actual Funding, not order-book queue or exact post-only fills.",
            "The final chronological segment has been reused by prior V11 research and is not an independent Holdout.",
            "Scenario cost is treated as observable before entry; live spread, depth and fill evidence must confirm it.",
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
        "# Aster-only V14 V13D Replacement Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Aligned sessions: {result['period']['alignedSessions']}",
        f"Candidates: {result['candidateCount']} across {result['familyCount']} families",
        "",
        "## V13D benchmark",
        "",
    ]
    for name, row in result["v13dBenchmark"]["results"].items():
        lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} trades / {row['netBpsPerCapitalHour']:.4f} bps per two-venue capital-hour")
    lines += ["", "## Selected Aster-only lead", ""]
    winner = result.get("winner")
    if not winner:
        lines.append("No candidate passed chronological Validation.")
    else:
        candidate = winner["candidate"]
        lines.append(f"Candidate: `{candidate['candidate_id']}`")
        for name, row in winner["full"].items():
            lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} trades / avg hold {row['averageHoldingHours']:.2f}h")
        lines += ["", "Comparison:", ""]
        for key, value in winner["comparison"].items():
            lines.append(f"- {key}: {value}")
    lines += [
        "",
        "## Interpretation",
        "",
        "This result is research-only. The final chronological segment is reused history, and exact Aster queue/fill evidence is unavailable. A historical winner requires untouched Pyth/IEX plus Aster order-book Shadow evidence before any Production use.",
        "",
    ]
    return "\n".join(lines)


def self_test() -> None:
    assert len(CANDIDATES) == 90
    assert product([0.10, -0.05]) == 0.04500000000000015
    sample = [{"holdingHours": 1.0, "grossReturn": 0.02, "edgeProxyBps": 100.0, "fundingReturn": 0.0, "side": 1, "symbol": "TEST", "exitReason": "TIME"}]
    row = metrics(sample, 40.0)
    assert row["trades"] == 1
    assert round(row["averageTradeBps"], 6) == 160.0
    severe = metrics(sample, 100.0)
    assert severe["trades"] == 0 and severe["compoundedReturnPct"] == 0.0
    print("Aster-only V14 replacement tournament self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="../.cache/v96-crypto-v11-v13d-one-year")
    parser.add_argument("--output-dir", default="../.research-state/aster-only-v14-replacement")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
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
