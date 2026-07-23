from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_WALKFORWARD_RIDGE_TOURNAMENT_V8"
SYMBOLS = ("AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT")
FEATURE_NAMES = (
    "r1", "r3", "r5", "r10", "r20", "vol5", "vol20", "atr20",
    "closeLocation", "gap", "relative5", "relative20", "fundingLatestBps", "fundingMedian3Bps",
)
MIN_TRAIN_SAMPLES = 160


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    regularization: float
    target_type: str


CANDIDATES = tuple(
    [Candidate(f"RIDGE_ABS_LONG_L{value}", "RIDGE_ABSOLUTE_LONG", value, "ABSOLUTE") for value in (0.1, 1.0, 10.0)]
    + [Candidate(f"RIDGE_ABS_LS_L{value}", "RIDGE_ABSOLUTE_LONG_SHORT", value, "ABSOLUTE") for value in (0.1, 1.0, 10.0)]
    + [Candidate(f"RIDGE_RES_LS_L{value}", "RIDGE_RESIDUAL_LONG_SHORT", value, "RESIDUAL") for value in (0.1, 1.0, 10.0)]
    + [Candidate(f"RIDGE_SIGN_L{value}", "RIDGE_SIGNED_BASKET", value, "ABSOLUTE") for value in (0.1, 1.0, 10.0)]
)


@dataclass(frozen=True)
class Sample:
    decision_day: str
    entry_day: str
    exit_day: str
    symbol: str
    features: Tuple[float, ...]
    target: float
    residual_target: float


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def regular_days(bars: Dict[str, Dict[str, swing.DailyBar]]) -> List[str]:
    return sorted(set.intersection(*(set(bars.get(symbol, {})) for symbol in SYMBOLS)))


def returns(rows: Sequence[swing.DailyBar], lookback: int) -> Optional[float]:
    return swing.pct_change(rows, lookback)


def stdev_recent(rows: Sequence[swing.DailyBar], count: int) -> Optional[float]:
    if len(rows) <= count:
        return None
    values = [rows[index].close / rows[index - 1].close - 1.0 for index in range(len(rows) - count, len(rows))]
    return statistics.stdev(values) if len(values) >= 2 else None


def symbol_base_features(
    symbol: str,
    day: str,
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[dict]:
    rows = swing.history(bars.get(symbol, {}), day, 50)
    if len(rows) < 41 or rows[-1].day != day:
        return None
    times = funding_mod.session_times(sessions, symbol, day)
    if times is None:
        return None
    fund = funding_mod.funding_snapshot(funding.get(symbol, []), times[1])
    if fund is None:
        return None
    r1 = returns(rows, 1)
    r3 = returns(rows, 3)
    r5 = returns(rows, 5)
    r10 = returns(rows, 10)
    r20 = returns(rows, 20)
    vol5 = stdev_recent(rows, 5)
    vol20 = stdev_recent(rows, 20)
    atr20 = swing.mean_tr(rows, 20)
    if None in (r1, r3, r5, r10, r20, vol5, vol20, atr20):
        return None
    bar = rows[-1]
    prior = rows[-2]
    location = (bar.close - bar.low) / (bar.high - bar.low) if bar.high > bar.low else 0.5
    gap = bar.open / prior.close - 1.0 if prior.close > 0 else 0.0
    return {
        "symbol": symbol,
        "day": day,
        "r1": r1,
        "r3": r3,
        "r5": r5,
        "r10": r10,
        "r20": r20,
        "vol5": vol5,
        "vol20": vol20,
        "atr20": atr20 / 100.0,
        "closeLocation": location,
        "gap": gap,
        "fundingLatestBps": fund["latest"] * 10_000.0,
        "fundingMedian3Bps": fund["median3"] * 10_000.0,
    }


def feature_map(
    day: str,
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[Dict[str, Tuple[float, ...]]]:
    states = [
        item for item in (
            symbol_base_features(symbol, day, bars, sessions, funding) for symbol in SYMBOLS
        ) if item is not None
    ]
    if len(states) != len(SYMBOLS):
        return None
    median5 = statistics.median(item["r5"] for item in states)
    median20 = statistics.median(item["r20"] for item in states)
    result = {}
    for item in states:
        result[item["symbol"]] = (
            item["r1"], item["r3"], item["r5"], item["r10"], item["r20"],
            item["vol5"], item["vol20"], item["atr20"], item["closeLocation"], item["gap"],
            item["r5"] - median5, item["r20"] - median20,
            item["fundingLatestBps"] / 100.0, item["fundingMedian3Bps"] / 100.0,
        )
    return result


def target_return(
    symbol: str,
    entry_day: str,
    exit_day: str,
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[float]:
    entry = bars.get(symbol, {}).get(entry_day)
    exit_bar = bars.get(symbol, {}).get(exit_day)
    entry_times = funding_mod.session_times(sessions, symbol, entry_day)
    exit_times = funding_mod.session_times(sessions, symbol, exit_day)
    if entry is None or exit_bar is None or entry.open <= 0 or entry_times is None or exit_times is None:
        return None
    price = exit_bar.open / entry.open - 1.0
    funding_cost = funding_mod.funding_between(funding.get(symbol, []), entry_times[0], exit_times[0])
    return price - funding_cost


def build_samples(
    days: Sequence[str],
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Tuple[List[Sample], Dict[str, Dict[str, Tuple[float, ...]]]]:
    features_by_day: Dict[str, Dict[str, Tuple[float, ...]]] = {}
    raw_rows = []
    for index, decision_day in enumerate(days[:-2]):
        entry_day = days[index + 1]
        exit_day = days[index + 2]
        features = feature_map(decision_day, bars, sessions, funding)
        if features is None:
            continue
        targets = {}
        for symbol in SYMBOLS:
            target = target_return(symbol, entry_day, exit_day, bars, sessions, funding)
            if target is None:
                break
            targets[symbol] = target
        if len(targets) != len(SYMBOLS):
            continue
        cross_mean = statistics.mean(targets.values())
        features_by_day[decision_day] = features
        for symbol in SYMBOLS:
            raw_rows.append(Sample(decision_day, entry_day, exit_day, symbol, features[symbol], targets[symbol], targets[symbol] - cross_mean))
    return raw_rows, features_by_day


def solve_linear(matrix: List[List[float]], vector: List[float]) -> List[float]:
    n = len(vector)
    augmented = [list(matrix[row]) + [vector[row]] for row in range(n)]
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            augmented[pivot][column] = 1e-12
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(n):
            if row == column:
                continue
            factor = augmented[row][column]
            if abs(factor) <= 1e-18:
                continue
            augmented[row] = [value - factor * pivot_value for value, pivot_value in zip(augmented[row], augmented[column])]
    return [augmented[row][-1] for row in range(n)]


def fit_ridge(samples: Sequence[Sample], target_type: str, regularization: float) -> Optional[dict]:
    if len(samples) < MIN_TRAIN_SAMPLES:
        return None
    columns = list(zip(*(sample.features for sample in samples)))
    means = [statistics.mean(column) for column in columns]
    scales = [statistics.pstdev(column) or 1.0 for column in columns]
    x_rows = [
        [1.0] + [(value - mean) / scale for value, mean, scale in zip(sample.features, means, scales)]
        for sample in samples
    ]
    y = [sample.target if target_type == "ABSOLUTE" else sample.residual_target for sample in samples]
    p = len(x_rows[0])
    xtx = [[0.0 for _ in range(p)] for _ in range(p)]
    xty = [0.0 for _ in range(p)]
    for row, target in zip(x_rows, y):
        for i in range(p):
            xty[i] += row[i] * target
            for j in range(p):
                xtx[i][j] += row[i] * row[j]
    for index in range(1, p):
        xtx[index][index] += regularization
    beta = solve_linear(xtx, xty)
    return {"means": means, "scales": scales, "beta": beta}


def predict(model: dict, features: Tuple[float, ...]) -> float:
    row = [1.0] + [(value - mean) / scale for value, mean, scale in zip(features, model["means"], model["scales"])]
    return sum(coef * value for coef, value in zip(model["beta"], row))


def candidate_weights(candidate: Candidate, predictions: Dict[str, float]) -> Dict[str, float]:
    ordered = sorted(predictions.items(), key=lambda item: item[1])
    if candidate.family == "RIDGE_ABSOLUTE_LONG":
        symbol, value = ordered[-1]
        return {symbol: 1.0} if value > 0 else {}
    if candidate.family in {"RIDGE_ABSOLUTE_LONG_SHORT", "RIDGE_RESIDUAL_LONG_SHORT"}:
        short_symbol, short_value = ordered[0]
        long_symbol, long_value = ordered[-1]
        return {long_symbol: 0.5, short_symbol: -0.5} if long_value > short_value else {}
    if candidate.family == "RIDGE_SIGNED_BASKET":
        active = [(symbol, value) for symbol, value in predictions.items() if abs(value) > 1e-6]
        total = sum(abs(value) for _symbol, value in active)
        return {symbol: value / total for symbol, value in active} if total > 0 else {}
    return {}


def build_predictions(samples: Sequence[Sample], features_by_day: Dict[str, Dict[str, Tuple[float, ...]]], candidate: Candidate) -> Dict[str, Dict[str, float]]:
    result = {}
    for day in sorted(features_by_day):
        training = [sample for sample in samples if sample.exit_day <= day]
        model = fit_ridge(training, candidate.target_type, candidate.regularization)
        if model is None:
            continue
        result[day] = {symbol: predict(model, features) for symbol, features in features_by_day[day].items()}
    return result


def replay(
    candidate: Candidate,
    scenario: base.CostScenario,
    samples: Sequence[Sample],
    features_by_day: Dict[str, Dict[str, Tuple[float, ...]]],
) -> List[dict]:
    target_lookup = {(sample.decision_day, sample.symbol): sample.target for sample in samples}
    entry_lookup = {sample.decision_day: (sample.entry_day, sample.exit_day) for sample in samples}
    predictions_by_day = build_predictions(samples, features_by_day, candidate)
    previous: Dict[str, float] = {}
    rows = []
    for day in sorted(predictions_by_day):
        if day not in entry_lookup:
            continue
        weights = candidate_weights(candidate, predictions_by_day[day])
        turnover = sum(abs(weights.get(symbol, 0.0) - previous.get(symbol, 0.0)) for symbol in set(weights) | set(previous))
        gross_return = sum(weight * target_lookup[(day, symbol)] for symbol, weight in weights.items())
        cost = turnover * scenario.turnover_bps / 10_000.0
        entry_day, exit_day = entry_lookup[day]
        rows.append({
            "candidateId": candidate.candidate_id,
            "family": candidate.family,
            "decisionDay": day,
            "day": entry_day,
            "exitDay": exit_day,
            "weights": weights,
            "gross": sum(abs(value) for value in weights.values()),
            "turnover": turnover,
            "prediction": predictions_by_day[day],
            "grossReturn": gross_return,
            "executionCost": cost,
            "return": gross_return - cost,
        })
        previous = weights
    return rows


def product_return(values: Iterable[float]) -> float:
    return base.product_return(values)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    drawdown = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        drawdown = min(drawdown, equity / peak - 1.0)
    return drawdown


def metrics(rows: Sequence[dict], multiplier: float = 1.0) -> dict:
    ordered = sorted(rows, key=lambda row: row["day"])
    values = [multiplier * finite(row["return"]) for row in ordered]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    compounded = product_return(values)
    if ordered:
        start = dt.date.fromisoformat(ordered[0]["day"])
        end = dt.date.fromisoformat(ordered[-1]["exitDay"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    positive = sum(wins)
    negative = -sum(losses)
    return {
        "days": len(values),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": positive / negative if negative > 1e-15 else None,
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageDayPct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "averageGross": statistics.mean(row["gross"] for row in ordered) if ordered else 0.0,
        "totalTurnover": sum(row["turnover"] for row in ordered) * multiplier,
    }


def subset(rows: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    start, end = interval
    return [row for row in rows if start <= row["day"] <= end]


def removals(rows: Sequence[dict], multiplier: float = 1.0) -> dict:
    if not rows:
        return {"bestDayRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [multiplier * finite(row["return"]) for row in rows]
    best = max(range(len(values)), key=values.__getitem__)
    months: Dict[str, List[float]] = defaultdict(list)
    for row, value in zip(rows, values):
        months[row["day"][:7]].append(value)
    best_month = max(months, key=lambda key: product_return(months[key]))
    return {"bestDayRemovedPct": product_return(value for index, value in enumerate(values) if index != best) * 100.0, "bestMonth": best_month, "bestMonthRemovedPct": product_return(value for row, value in zip(rows, values) if row["day"][:7] != best_month) * 100.0}


def score(median: dict, normal: dict, severe: dict) -> float:
    return median["compoundedReturnPct"] + 0.5 * normal["compoundedReturnPct"] + 0.25 * severe["compoundedReturnPct"] + 2.0 * ((median.get("profitFactor") or 0.0) - 1.0) + 0.10 * median["maxDrawdownPct"]


def validation_pass(result: dict) -> bool:
    return bool(result["FORWARD_MEDIAN"]["days"] >= 10 and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0 and result["NORMAL"]["compoundedReturnPct"] > 0 and result["SEVERE"]["compoundedReturnPct"] > 0 and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05)


def holdout_pass(result: dict) -> bool:
    return bool(result["FORWARD_MEDIAN"]["days"] >= 10 and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0 and result["NORMAL"]["compoundedReturnPct"] > 0 and result["SEVERE"]["compoundedReturnPct"] > 0 and (result["NORMAL"].get("profitFactor") or 0) > 1.0)


def combine(rows_by_candidate: Dict[str, List[dict]], ids: Sequence[str]) -> List[dict]:
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for candidate_id in ids:
        for row in rows_by_candidate.get(candidate_id, []):
            by_day[row["day"]].append(row)
    return [{"candidateId": "VALIDATION_SELECTED_RIDGE_ENSEMBLE", "family": "ENSEMBLE", "decisionDay": day, "day": day, "exitDay": max(item["exitDay"] for item in items), "weights": {}, "gross": statistics.mean(item["gross"] for item in items), "turnover": statistics.mean(item["turnover"] for item in items), "return": statistics.mean(finite(item["return"]) for item in items)} for day, items in sorted(by_day.items())]


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(price_cache: Path, funding_cache: Path) -> dict:
    raw = base.load_all(price_cache)
    sessions = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items() if symbol in SYMBOLS}
    bars = swing.daily_bars(sessions)
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    days = regular_days(bars)
    samples, features_by_day = build_samples(days, bars, sessions, funding)
    prediction_days = sorted(day for day in features_by_day if sum(sample.exit_day <= day for sample in samples) >= MIN_TRAIN_SAMPLES)
    if len(prediction_days) < 100:
        raise RuntimeError(f"insufficient walk-forward prediction days: {len(prediction_days)}")
    splits = base.chronological_splits(prediction_days)

    all_rows = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_rows[scenario.name][candidate.candidate_id] = replay(candidate, scenario, samples, features_by_day)

    families = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {scenario.name: metrics(subset(all_rows[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])) for scenario in base.SCENARIOS}
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"])})
        winner = max(rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {scenario.name: metrics(subset(all_rows[scenario.name][winner_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        families[family] = {"developmentCandidates": rows, "winnerId": winner_id, "winnerValidation": validation, "validationPass": validation_pass(validation)}

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {scenario.name: metrics(subset(all_rows[scenario.name][candidate_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": candidate_id, "members": [candidate_id], "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})
    if len(passing) >= 2:
        validation = {scenario.name: metrics(subset(combine(all_rows[scenario.name], passing), splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": "VALIDATION_SELECTED_RIDGE_ENSEMBLE", "members": sorted(passing), "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {"portfolioId": selected_option["portfolioId"], "members": selected_option["members"], "validation": selected_option["validation"], "gross1": {}, "normalizedGross2": {}}
        for scenario in base.SCENARIOS:
            rows = all_rows[scenario.name][selected_option["members"][0]] if len(selected_option["members"]) == 1 else combine(all_rows[scenario.name], selected_option["members"])
            selected["gross1"][scenario.name] = {"full": metrics(rows), "development": metrics(subset(rows, splits["DEVELOPMENT"])), "validation": metrics(subset(rows, splits["VALIDATION"])), "holdout": metrics(subset(rows, splits["HOLDOUT"])), "removals": removals(rows), "rows": rows}
            selected["normalizedGross2"][scenario.name] = {"full": metrics(rows, 2.0), "holdout": metrics(subset(rows, splits["HOLDOUT"]), 2.0), "removals": removals(rows, 2.0)}
        selected["holdoutPassGross1"] = holdout_pass({name: item["holdout"] for name, item in selected["gross1"].items()})
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(selected["holdoutPassGross1"] and normal2["compoundedReturnPct"] >= 50 and normal2["cagrPct"] >= 50 and severe2["compoundedReturnPct"] > 0 and normal2["maxDrawdownPct"] >= -50)

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_WALKFORWARD_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_WALKFORWARD_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "WALKFORWARD_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_WALKFORWARD_FAMILY"

    return rounded({"version": 8, "strategyId": STRATEGY_ID, "status": status, "generatedAt": dt.datetime.now(UTC).isoformat(), "universe": list(SYMBOLS), "features": list(FEATURE_NAMES), "candidateCount": len(CANDIDATES), "familyCount": len(set(candidate.family for candidate in CANDIDATES)), "sampleCount": len(samples), "predictionDays": len(prediction_days), "firstPredictionDay": prediction_days[0], "lastPredictionDay": prediction_days[-1], "minimumTrainSamples": MIN_TRAIN_SAMPLES, "splits": splits, "families": families, "validationPassingWinnerIds": passing, "portfolioOptions": options, "selected": selected, "selectionDiscipline": {"modelFit": "expanding walk-forward using only samples with exitDay <= prediction day", "regularizationSelection": "DEVELOPMENT only", "portfolioSelection": "VALIDATION only", "finalEvaluation": "reused historical HOLDOUT once", "holdoutRetuningAllowed": False}, "classificationLimit": "Dates and listings were inspected by earlier Stock research; positive results remain reused historical evidence.", "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False}, "limitations": ["Five mature current listings create survivorship and concentration risk.", "Ridge is a linear model and does not reconstruct historical order-book or event gates.", "Targets include next-open price return and actual Funding between regular-session opens.", "Gross 2.0 is normalized sensitivity only, not an allocation approval."]})


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-walkforward-ridge-tournament-v8.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# V96 Stock Walk-forward Ridge Tournament V8", "", f"- Status: **{result['status']}**", f"- Prediction window: {result['firstPredictionDay']}–{result['lastPredictionDay']} ({result['predictionDays']} days)", f"- Training samples: {result['sampleCount']}", f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}", "- Production / LIVE / VPS / orders changed: **NO**", "", "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |", "| --- | --- | ---: | ---: | ---: | ---: | --- |"]
    for family, item in result["families"].items():
        winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
        lines.append(f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {winner['development']['SEVERE']['compoundedReturnPct']}% | {item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | {'YES' if item['validationPass'] else 'NO'} |")
    selected = result.get("selected")
    if selected:
        lines.extend(["", "## Selected reused-historical model", "", f"Portfolio: **{selected['portfolioId']}**", f"Gross 1 Holdout pass: **{'YES' if selected['holdoutPassGross1'] else 'NO'}**", f"Normalized Gross 2 crypto-like threshold: **{'YES' if selected['cryptoLikeNormalizedGross2'] else 'NO'}**", "", "| Scenario | G1 Full | G1 CAGR | G1 DD | G1 Holdout | G2 Full | G2 CAGR | G2 DD | G2 Holdout |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            g1 = selected["gross1"][name]
            g2 = selected["normalizedGross2"][name]
            lines.append(f"| {name} | {g1['full']['compoundedReturnPct']}% | {g1['full']['cagrPct']}% | {g1['full']['maxDrawdownPct']}% | {g1['holdout']['compoundedReturnPct']}% | {g2['full']['compoundedReturnPct']}% | {g2['full']['cagrPct']}% | {g2['full']['maxDrawdownPct']}% | {g2['holdout']['compoundedReturnPct']}% |")
    (output_dir / "v96-stock-walkforward-ridge-tournament-v8.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 12
    assert len(set(candidate.family for candidate in CANDIDATES)) == 4
    matrix = [[2.0, 0.0], [0.0, 4.0]]
    result = solve_linear(matrix, [4.0, 8.0])
    assert max(abs(a - b) for a, b in zip(result, [2.0, 2.0])) < 1e-9


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--price-cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-walkforward-ridge-tournament-v8")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock walk-forward ridge tournament V8 self-test: PASS")
        return 0
    result = analyze(Path(args.price_cache_dir).resolve(), Path(args.funding_cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"], "predictionDays": result["predictionDays"], "validationPassingWinnerIds": result["validationPassingWinnerIds"], "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
