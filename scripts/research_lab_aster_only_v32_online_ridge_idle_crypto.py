from __future__ import annotations

import argparse
import bisect
import datetime as dt
import json
import math
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v31_v96_idle_crypto_fallback as v31

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V32_ONLINE_RIDGE_IDLE_CRYPTO"
INTEGRATED_START = dt.datetime(2025, 7, 1, tzinfo=UTC)
INTEGRATED_END = dt.datetime(2026, 7, 1, tzinfo=UTC)
DATA_END = dt.datetime(2026, 7, 25, tzinfo=UTC)
MODEL_WARMUP = dt.datetime(2025, 3, 1, tzinfo=UTC)
JULY_START = INTEGRATED_END
JULY_END = DATA_END
INTEGRATED_START_MS = int(INTEGRATED_START.timestamp() * 1000)
INTEGRATED_END_MS = int(INTEGRATED_END.timestamp() * 1000)
DATA_END_MS = int(DATA_END.timestamp() * 1000)
MODEL_WARMUP_MS = int(MODEL_WARMUP.timestamp() * 1000)
DIMENSION = 16
MODEL_LOOKBACKS = (30, 60, 120)
MODEL_HORIZONS = (1, 2, 4)
RIDGE_PENALTIES = (0.1, 1.0, 10.0)
ENTRY_THRESHOLDS_BPS = (20.0, 35.0, 50.0)
CONFIDENCE_RATIOS = (0.25, 0.50)
REGIMES = ("NONE", "BTC_STABLE", "CROSS_SECTION_DISPERSION")
MIN_TRAINING_SAMPLES = 300
CROSS_SECTION_DISPERSION_BPS = 75.0
BTC_STABLE_BPS = 150.0


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    lookback_days: int
    horizon_hours: int
    ridge_penalty: float


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    model_id: str
    lookback_days: int
    maximum_holding_hours: int
    ridge_penalty: float
    predicted_threshold_bps: float
    confidence_ratio: float
    regime: str
    risk_name: str


MODEL_SPECS: Tuple[ModelSpec, ...] = tuple(
    ModelSpec(
        f"LB{lookback}__H{horizon}__RIDGE{ridge:g}",
        lookback,
        horizon,
        ridge,
    )
    for lookback in MODEL_LOOKBACKS
    for horizon in MODEL_HORIZONS
    for ridge in RIDGE_PENALTIES
)

CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{model.model_id}__P{threshold:g}__C{confidence:g}__{regime}__{risk.name}",
        model.model_id,
        model.lookback_days,
        model.horizon_hours,
        model.ridge_penalty,
        threshold,
        confidence,
        regime,
        risk.name,
    )
    for model in MODEL_SPECS
    for threshold in ENTRY_THRESHOLDS_BPS
    for confidence in CONFIDENCE_RATIOS
    for regime in REGIMES
    for risk in v31.RISK_PROFILES
)


@dataclass
class SufficientStats:
    xtx: List[List[float]]
    xty: List[float]
    y2: float
    count: int


def empty_stats() -> SufficientStats:
    return SufficientStats(
        [[0.0 for _ in range(DIMENSION)] for _ in range(DIMENSION)],
        [0.0 for _ in range(DIMENSION)],
        0.0,
        0,
    )


def copy_stats(value: SufficientStats) -> SufficientStats:
    return SufficientStats([row[:] for row in value.xtx], value.xty[:], value.y2, value.count)


def add_sample(stats: SufficientStats, x: Sequence[float], y: float) -> None:
    stats.count += 1
    stats.y2 += y * y
    for i in range(DIMENSION):
        stats.xty[i] += x[i] * y
        xi = x[i]
        for j in range(DIMENSION):
            stats.xtx[i][j] += xi * x[j]


def add_stats(left: SufficientStats, right: SufficientStats) -> SufficientStats:
    result = copy_stats(left)
    result.count += right.count
    result.y2 += right.y2
    for i in range(DIMENSION):
        result.xty[i] += right.xty[i]
        for j in range(DIMENSION):
            result.xtx[i][j] += right.xtx[i][j]
    return result


def subtract_stats(left: SufficientStats, right: SufficientStats) -> SufficientStats:
    result = copy_stats(left)
    result.count -= right.count
    result.y2 -= right.y2
    for i in range(DIMENSION):
        result.xty[i] -= right.xty[i]
        for j in range(DIMENSION):
            result.xtx[i][j] -= right.xtx[i][j]
    return result


def clip(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def rounded(value: Any):
    return v31.rounded(value)


def utc_day(timestamp: int) -> str:
    return dt.datetime.fromtimestamp(timestamp / 1000, tz=UTC).date().isoformat()


def configure_v31_for_market() -> None:
    v31.BT_START = MODEL_WARMUP
    v31.BT_END = DATA_END
    v31.WARMUP_START = MODEL_WARMUP
    v31.START_MS = MODEL_WARMUP_MS
    v31.END_MS = DATA_END_MS
    v31.WARMUP_MS = MODEL_WARMUP_MS


def configure_v31_for_priority() -> None:
    v31.BT_START = INTEGRATED_START
    v31.BT_END = INTEGRATED_END
    v31.WARMUP_START = MODEL_WARMUP
    v31.START_MS = INTEGRATED_START_MS
    v31.END_MS = INTEGRATED_END_MS
    v31.WARMUP_MS = MODEL_WARMUP_MS


def calendar_days(start: dt.datetime, end: dt.datetime) -> List[str]:
    result = []
    cursor = start.date()
    while cursor < end.date():
        result.append(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return result


def split_days(days: Sequence[str]) -> dict:
    count = len(days)
    development_end = int(count * 0.60)
    validation_end = int(count * 0.80)
    return {
        "DEVELOPMENT": list(days[:development_end]),
        "VALIDATION": list(days[development_end:validation_end]),
        "FINAL_REUSED": list(days[validation_end:]),
    }


def cross_section_z(rows: Dict[str, dict], field: str) -> Dict[str, float]:
    values = [(symbol, float(row[field])) for symbol, row in rows.items()]
    if len(values) < 3:
        return {symbol: 0.0 for symbol, _value in values}
    mean = statistics.mean(value for _symbol, value in values)
    sigma = statistics.pstdev(value for _symbol, value in values)
    if sigma <= 1e-12:
        return {symbol: 0.0 for symbol, _value in values}
    return {symbol: (value - mean) / sigma for symbol, value in values}


def feature_vectors(rows: Dict[str, dict]) -> Dict[str, List[float]]:
    z2 = cross_section_z(rows, "ret2hBps")
    z4 = cross_section_z(rows, "ret4hBps")
    btc = rows["BTCUSDT"]
    result: Dict[str, List[float]] = {}
    for symbol, row in rows.items():
        funding = row.get("fundingBps")
        volume_ratio = max(0.05, float(row.get("volumeRatio", 0.0)))
        vector = [
            1.0,
            clip(float(row["ret1hBps"]) / 100.0, -10.0, 10.0),
            clip(float(row["ret2hBps"]) / 100.0, -10.0, 10.0),
            clip(float(row["ret4hBps"]) / 200.0, -10.0, 10.0),
            clip(float(row["ret8hBps"]) / 300.0, -10.0, 10.0),
            clip(float(row["z4h"]), -8.0, 8.0),
            clip(math.log(volume_ratio), -4.0, 4.0),
            clip(float(row["volPercentile"]) / 100.0, 0.0, 1.0),
            clip(float(funding or 0.0), -10.0, 10.0),
            1.0 if funding is None else 0.0,
            clip(float(btc["ret1hBps"]) / 100.0, -10.0, 10.0),
            clip(float(btc["ret2hBps"]) / 100.0, -10.0, 10.0),
            clip(float(btc["ret4hBps"]) / 200.0, -10.0, 10.0),
            clip(float(z2.get(symbol, 0.0)), -6.0, 6.0),
            clip(float(z4.get(symbol, 0.0)), -6.0, 6.0),
            float(row["breakout24"]),
        ]
        if len(vector) != DIMENSION:
            raise AssertionError(len(vector))
        result[symbol] = vector
    return result


def build_daily_stats(
    slots: Sequence[int],
    features: Dict[int, Dict[str, dict]],
    bars: Dict[str, List[v31.Bar]],
) -> Tuple[Dict[int, Dict[str, SufficientStats]], dict]:
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    daily: Dict[int, Dict[str, SufficientStats]] = {
        horizon: defaultdict(empty_stats) for horizon in MODEL_HORIZONS
    }
    diagnostics = {"samples": {str(horizon): 0 for horizon in MODEL_HORIZONS}, "skipped": defaultdict(int)}
    for timestamp in slots:
        rows = features[timestamp]
        vectors = feature_vectors(rows)
        for symbol, x in vectors.items():
            index = index_maps[symbol].get(timestamp)
            if index is None:
                diagnostics["skipped"]["missingIndex"] += 1
                continue
            entry = bars[symbol][index].open
            if entry <= 0:
                diagnostics["skipped"]["invalidEntry"] += 1
                continue
            for horizon in MODEL_HORIZONS:
                bar_count = horizon * 2
                end_index = index + bar_count - 1
                if end_index >= len(bars[symbol]):
                    diagnostics["skipped"]["missingTarget"] += 1
                    continue
                exit_price = bars[symbol][end_index].close
                exit_timestamp = bars[symbol][end_index].ts + v31.BAR_MS
                target_bps = (exit_price / entry - 1.0) * 10_000.0
                target = clip(target_bps / 100.0, -20.0, 20.0)
                available_date = dt.datetime.fromtimestamp(exit_timestamp / 1000, tz=UTC).date() + dt.timedelta(days=1)
                available_day = available_date.isoformat()
                add_sample(daily[horizon][available_day], x, target)
                diagnostics["samples"][str(horizon)] += 1
    diagnostics["skipped"] = dict(diagnostics["skipped"])
    return daily, diagnostics


def build_prefix_stats(
    daily_stats: Dict[int, Dict[str, SufficientStats]],
    days: Sequence[str],
) -> Dict[int, List[SufficientStats]]:
    result: Dict[int, List[SufficientStats]] = {}
    for horizon in MODEL_HORIZONS:
        prefix = [empty_stats()]
        running = empty_stats()
        for day in days:
            running = add_stats(running, daily_stats[horizon].get(day, empty_stats()))
            prefix.append(running)
        result[horizon] = prefix
    return result


def solve_linear(matrix: Sequence[Sequence[float]], vector: Sequence[float]) -> Optional[List[float]]:
    size = len(vector)
    augmented = [list(matrix[row]) + [float(vector[row])] for row in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-10:
            return None
        if pivot != column:
            augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        for item in range(column, size + 1):
            augmented[column][item] /= divisor
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if abs(factor) < 1e-15:
                continue
            for item in range(column, size + 1):
                augmented[row][item] -= factor * augmented[column][item]
    return [augmented[row][size] for row in range(size)]


def fit_model(stats: SufficientStats, ridge_penalty: float) -> Optional[dict]:
    if stats.count < MIN_TRAINING_SAMPLES:
        return None
    matrix = [row[:] for row in stats.xtx]
    for index in range(1, DIMENSION):
        matrix[index][index] += ridge_penalty
    coefficients = solve_linear(matrix, stats.xty)
    if coefficients is None:
        return None
    beta_xty = sum(coefficients[index] * stats.xty[index] for index in range(DIMENSION))
    beta_xtx_beta = 0.0
    for i in range(DIMENSION):
        for j in range(DIMENSION):
            beta_xtx_beta += coefficients[i] * stats.xtx[i][j] * coefficients[j]
    sse = max(0.0, stats.y2 - 2.0 * beta_xty + beta_xtx_beta)
    rmse_bps = math.sqrt(sse / max(1, stats.count)) * 100.0
    return {"coefficients": coefficients, "rmseBps": rmse_bps, "samples": stats.count}


def aggregate_stats(
    spec: ModelSpec,
    day: str,
    day_index: Dict[str, int],
    prefix: Dict[int, List[SufficientStats]],
    days: Sequence[str],
) -> SufficientStats:
    end_position = day_index[day] + 1
    start_date = (dt.date.fromisoformat(day) - dt.timedelta(days=spec.lookback_days)).isoformat()
    start_position = bisect.bisect_left(days, start_date)
    return subtract_stats(prefix[spec.horizon_hours][end_position], prefix[spec.horizon_hours][start_position])


def build_predictions(
    spec: ModelSpec,
    slots: Sequence[int],
    features: Dict[int, Dict[str, dict]],
    prefix_days: Sequence[str],
    prefix: Dict[int, List[SufficientStats]],
) -> Tuple[Dict[int, List[dict]], dict]:
    day_index = {day: index for index, day in enumerate(prefix_days)}
    slots_by_day: Dict[str, List[int]] = defaultdict(list)
    for timestamp in slots:
        slots_by_day[utc_day(timestamp)].append(timestamp)
    predictions: Dict[int, List[dict]] = {}
    model_days = 0
    skipped_days = 0
    sample_counts = []
    rmses = []
    for day in sorted(slots_by_day):
        if day not in day_index:
            continue
        stats = aggregate_stats(spec, day, day_index, prefix, prefix_days)
        fitted = fit_model(stats, spec.ridge_penalty)
        if fitted is None:
            skipped_days += 1
            continue
        model_days += 1
        sample_counts.append(int(fitted["samples"]))
        rmses.append(float(fitted["rmseBps"]))
        coefficients = fitted["coefficients"]
        for timestamp in slots_by_day[day]:
            rows = features[timestamp]
            vectors = feature_vectors(rows)
            panel = []
            dispersion = statistics.pstdev(float(row["ret2hBps"]) for row in rows.values()) if len(rows) >= 3 else 0.0
            btc_return = float(rows["BTCUSDT"]["ret4hBps"])
            for symbol, vector in vectors.items():
                predicted_bps = sum(coefficients[index] * vector[index] for index in range(DIMENSION)) * 100.0
                panel.append({
                    "symbol": symbol,
                    "predictedBps": predicted_bps,
                    "rmseBps": fitted["rmseBps"],
                    "btcReturn4hBps": btc_return,
                    "dispersion2hBps": dispersion,
                })
            predictions[timestamp] = panel
    return predictions, {
        "modelDays": model_days,
        "skippedDays": skipped_days,
        "minimumSamples": min(sample_counts) if sample_counts else 0,
        "maximumSamples": max(sample_counts) if sample_counts else 0,
        "medianSamples": statistics.median(sample_counts) if sample_counts else 0,
        "medianRmseBps": statistics.median(rmses) if rmses else None,
    }


def regime_pass(candidate: Candidate, panel: Sequence[dict]) -> bool:
    if not panel:
        return False
    if candidate.regime == "NONE":
        return True
    if candidate.regime == "BTC_STABLE":
        return abs(float(panel[0]["btcReturn4hBps"])) <= BTC_STABLE_BPS
    if candidate.regime == "CROSS_SECTION_DISPERSION":
        return float(panel[0]["dispersion2hBps"]) >= CROSS_SECTION_DISPERSION_BPS
    raise ValueError(candidate.regime)


def build_candidate_trades(
    candidate: Candidate,
    predictions: Dict[int, List[dict]],
    selected_slots: Sequence[int],
    bars: Dict[str, List[v31.Bar]],
    funding: Dict[str, List[Tuple[int, float]]],
    blockers: Sequence[Tuple[int, int, str]],
) -> Tuple[List[dict], dict]:
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    trades = []
    rejected = defaultdict(int)
    active_until = -1
    for timestamp in selected_slots:
        if timestamp < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_exit = timestamp + candidate.maximum_holding_hours * v31.HOUR_MS
        if blockers and v31.overlaps(blockers, timestamp, maximum_exit):
            rejected["PRIORITY_OCCUPANCY"] += 1
            continue
        panel = predictions.get(timestamp, [])
        if not regime_pass(candidate, panel):
            rejected["REGIME"] += 1
            continue
        eligible = []
        for row in panel:
            predicted = float(row["predictedBps"])
            rmse = max(1e-9, float(row["rmseBps"]))
            ratio = abs(predicted) / rmse
            edge = abs(predicted) - 0.5 * rmse
            if abs(predicted) < candidate.predicted_threshold_bps:
                continue
            if ratio < candidate.confidence_ratio:
                continue
            if edge - v31.COSTS["NORMAL"] < 10.0:
                continue
            eligible.append((edge, abs(predicted), str(row["symbol"]), predicted, rmse, ratio))
        if not eligible:
            continue
        edge, _strength, symbol, predicted, rmse, ratio = sorted(eligible, key=lambda item: (-item[0], -item[1], item[2]))[0]
        side = 1 if predicted > 0 else -1
        trade = v31.simulate_trade(
            candidate,
            symbol,
            side,
            edge,
            {
                "modelId": candidate.model_id,
                "predictedBps": predicted,
                "trainingRmseBps": rmse,
                "confidenceRatio": ratio,
                "regime": candidate.regime,
            },
            timestamp,
            bars,
            funding,
            index_maps,
        )
        if trade is None:
            rejected["MISSING_FUTURE_BARS"] += 1
            continue
        trade["strategy"] = "V32_ONLINE_RIDGE_IDLE_CRYPTO"
        if blockers and v31.overlaps(blockers, int(trade["entryTs"]), int(trade["exitTs"])):
            rejected["ACTUAL_PRIORITY_OVERLAP"] += 1
            continue
        trades.append(trade)
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


def development_pass(result: dict) -> bool:
    normal, p95 = result["NORMAL"], result["P95"]
    return (
        normal["trades"] >= 40
        and normal["compoundedReturnPct"] >= 20.0
        and p95["compoundedReturnPct"] >= 10.0
        and (normal["profitFactor"] or 0.0) >= 1.30
        and normal["maxDrawdownPct"] >= -12.0
    )


def validation_pass(standalone: dict, unified: dict, baseline: dict) -> bool:
    normal, p95 = standalone["NORMAL"], standalone["P95"]
    return (
        normal["trades"] >= 10
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) >= 1.20
        and unified["NORMAL"]["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"]
        and unified["P95"]["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"]
    )


def selection_score(standalone: dict, unified: dict, baseline: dict) -> float:
    return (
        standalone["NORMAL"]["compoundedReturnPct"]
        + standalone["P95"]["compoundedReturnPct"]
        + unified["NORMAL"]["compoundedReturnPct"] - baseline["NORMAL"]["compoundedReturnPct"]
        + unified["P95"]["compoundedReturnPct"] - baseline["P95"]["compoundedReturnPct"]
        - 0.5 * abs(standalone["NORMAL"]["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    configure_v31_for_market()
    bars, funding, market_diagnostics = v31.load_market(cache_root / "crypto-market")
    slots, features, feature_diagnostics = v31.build_features(bars, funding)
    daily_stats, training_diagnostics = build_daily_stats(slots, features, bars)
    prefix_days = calendar_days(MODEL_WARMUP, DATA_END + dt.timedelta(days=2))
    prefix = build_prefix_stats(daily_stats, prefix_days)

    configure_v31_for_priority()
    crypto, v96_intervals, v96_diagnostics = v31.v96_state(cache_root / "v96")
    v11_rows, v19_rows, stock_intervals, stock_diagnostics = v31.stock_state(cache_root / "stock")
    priority_intervals = v31.merge_intervals([*v96_intervals, *stock_intervals])
    v96_evidence_timestamps = [int(row["ts"]) for row in [*crypto.get("normal", []), *crypto.get("severe", [])]]
    v96_evidence_end = max(v96_evidence_timestamps) if v96_evidence_timestamps else 0
    coverage_pass = v96_evidence_end >= int(dt.datetime(2026, 6, 30, tzinfo=UTC).timestamp() * 1000)

    integrated_days = calendar_days(INTEGRATED_START, INTEGRATED_END)
    july_days = calendar_days(JULY_START, JULY_END)
    splits = split_days(integrated_days)
    integrated_slots = [timestamp for timestamp in slots if INTEGRATED_START_MS <= timestamp < INTEGRATED_END_MS]
    july_slots = [timestamp for timestamp in slots if INTEGRATED_END_MS <= timestamp < DATA_END_MS]

    baseline = {}
    baseline_diagnostics = {}
    for scenario in v31.COSTS:
        baseline[scenario], baseline_diagnostics[scenario] = v31.unified_metrics(
            crypto, v11_rows, v19_rows, [], integrated_days, scenario, v96_intervals
        )

    development_survivors = []
    model_diagnostics = {}
    all_development_diagnostics = []
    by_model: Dict[str, List[Candidate]] = defaultdict(list)
    for candidate in CANDIDATES:
        by_model[candidate.model_id].append(candidate)

    for spec in MODEL_SPECS:
        predictions, prediction_diagnostics = build_predictions(spec, slots, features, prefix_days, prefix)
        model_diagnostics[spec.model_id] = prediction_diagnostics
        for candidate in by_model[spec.model_id]:
            integrated_trades, build_diagnostics = build_candidate_trades(
                candidate, predictions, integrated_slots, bars, funding, priority_intervals
            )
            development, _development_rejects = v31.standalone_scenarios(
                integrated_trades, splits["DEVELOPMENT"]
            )
            diagnostic = {
                "candidate": asdict(candidate),
                "rawIntegratedTrades": len(integrated_trades),
                "development": development,
                "buildDiagnostics": build_diagnostics,
            }
            all_development_diagnostics.append(diagnostic)
            if development_pass(development):
                development_survivors.append((candidate, integrated_trades, predictions, development, build_diagnostics))

    development_survivors.sort(
        key=lambda item: item[3]["NORMAL"]["compoundedReturnPct"] + item[3]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = []
    validation_diagnostics = []
    for candidate, integrated_trades, predictions, development, build_diagnostics in development_survivors[:60]:
        validation, validation_rejects = v31.standalone_scenarios(integrated_trades, splits["VALIDATION"])
        unified = {}
        unified_diagnostics = {}
        validation_baseline = {}
        for scenario in v31.COSTS:
            unified[scenario], unified_diagnostics[scenario] = v31.unified_metrics(
                crypto, v11_rows, v19_rows, integrated_trades, splits["VALIDATION"], scenario, v96_intervals
            )
            validation_baseline[scenario], _ = v31.unified_metrics(
                crypto, v11_rows, v19_rows, [], splits["VALIDATION"], scenario, v96_intervals
            )
        item = {
            "candidate": asdict(candidate),
            "development": development,
            "validation": validation,
            "validationUnified": unified,
            "validationBaseline": validation_baseline,
            "validationRejects": validation_rejects,
            "unifiedDiagnostics": unified_diagnostics,
            "rawIntegratedTrades": len(integrated_trades),
            "buildDiagnostics": build_diagnostics,
        }
        validation_diagnostics.append(item)
        if validation_pass(validation, unified, validation_baseline):
            validation_survivors.append((candidate, integrated_trades, predictions, item))

    validation_survivors.sort(
        key=lambda item: selection_score(item[3]["validation"], item[3]["validationUnified"], item[3]["validationBaseline"]),
        reverse=True,
    )
    winner = validation_survivors[0] if validation_survivors else None
    winner_payload = None
    status = "ASTER_ONLY_V32_NO_VALIDATED_ONLINE_RIDGE_FALLBACK"

    if winner is not None:
        candidate, integrated_trades, predictions, selected = winner
        full, full_rejects = v31.standalone_scenarios(integrated_trades, integrated_days)
        final, final_rejects = v31.standalone_scenarios(integrated_trades, splits["FINAL_REUSED"])
        july_trades, july_build_diagnostics = build_candidate_trades(
            candidate, predictions, july_slots, bars, funding, []
        )
        july, july_rejects = v31.standalone_scenarios(july_trades, july_days)
        unified_full = {}
        unified_full_diagnostics = {}
        for scenario in v31.COSTS:
            unified_full[scenario], unified_full_diagnostics[scenario] = v31.unified_metrics(
                crypto, v11_rows, v19_rows, integrated_trades, integrated_days, scenario, v96_intervals
            )
        normal_rows, _ = v31.accepted_rows(integrated_trades, v31.COSTS["NORMAL"], integrated_days)
        p95_rows, _ = v31.accepted_rows(integrated_trades, v31.COSTS["P95"], integrated_days)
        normal_rows, _ = v31.daily_loss_filter(normal_rows)
        p95_rows, _ = v31.daily_loss_filter(p95_rows)
        normal_without_month, normal_month = v31.remove_best_month(normal_rows)
        p95_without_month, p95_month = v31.remove_best_month(p95_rows)
        overlap_count = sum(
            v31.overlaps(priority_intervals, int(row["entryTs"]), int(row["exitTs"]))
            for row in integrated_trades
        )
        checks = {
            "v96IntegratedCoveragePass": coverage_pass,
            "normalReturnAtLeast50Pct": full["NORMAL"]["compoundedReturnPct"] >= 50.0,
            "p95ReturnAtLeast30Pct": full["P95"]["compoundedReturnPct"] >= 30.0,
            "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.50,
            "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
            "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
            "validationMinimumTenTrades": selected["validation"]["NORMAL"]["trades"] >= 10,
            "validationNormalAndP95Positive": selected["validation"]["NORMAL"]["compoundedReturnPct"] > 0 and selected["validation"]["P95"]["compoundedReturnPct"] > 0,
            "validationProfitFactorAtLeast1_2": (selected["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
            "finalNormalAndP95Positive": final["NORMAL"]["compoundedReturnPct"] > 0 and final["P95"]["compoundedReturnPct"] > 0,
            "julyCandidateOnlyMinimumThreeTrades": july["NORMAL"]["trades"] >= 3,
            "julyCandidateOnlyNormalAndP95Positive": july["NORMAL"]["compoundedReturnPct"] > 0 and july["P95"]["compoundedReturnPct"] > 0,
            "bestTradeRemovedNormalAndP95Positive": v31.metrics(v31.remove_best(normal_rows))["compoundedReturnPct"] > 0 and v31.metrics(v31.remove_best(p95_rows))["compoundedReturnPct"] > 0,
            "bestMonthRemovedNormalAndP95Positive": v31.metrics(normal_without_month)["compoundedReturnPct"] > 0 and v31.metrics(p95_without_month)["compoundedReturnPct"] > 0,
            "severeNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
            "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
            "unifiedNormalAboveBaseline": unified_full["NORMAL"]["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"],
            "unifiedP95AboveBaseline": unified_full["P95"]["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"],
            "unifiedDrawdownNotWorseByMoreThanTwoPoints": unified_full["NORMAL"]["maxDrawdownPct"] >= baseline["NORMAL"]["maxDrawdownPct"] - 2.0,
            "zeroPriorityOverlapIntegrated": overlap_count == 0,
        }
        accepted = all(checks.values())
        status = "ASTER_ONLY_V32_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V32_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "accepted": accepted,
            "checks": checks,
            "fullStandalone": full,
            "finalReusedStandalone": final,
            "julyCandidateOnlyAudit": july,
            "unifiedFull": unified_full,
            "baselineUnified": baseline,
            "selection": selected,
            "rawIntegratedTrades": len(integrated_trades),
            "rawJulyTrades": len(july_trades),
            "priorityOverlapCountIntegrated": overlap_count,
            "robustness": {
                "normalBestTradeRemoved": v31.metrics(v31.remove_best(normal_rows)),
                "p95BestTradeRemoved": v31.metrics(v31.remove_best(p95_rows)),
                "normalBestMonthRemoved": {"month": normal_month, "metrics": v31.metrics(normal_without_month)},
                "p95BestMonthRemoved": {"month": p95_month, "metrics": v31.metrics(p95_without_month)},
            },
            "rejects": {
                "full": full_rejects,
                "final": final_rejects,
                "july": july_rejects,
                "julyBuild": july_build_diagnostics,
            },
            "unifiedDiagnostics": unified_full_diagnostics,
        }

    all_development_diagnostics.sort(
        key=lambda item: item["development"]["NORMAL"]["compoundedReturnPct"] + item["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_diagnostics.sort(
        key=lambda item: selection_score(item["validation"], item["validationUnified"], item["validationBaseline"]),
        reverse=True,
    )

    return rounded({
        "version": 32,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "modelSpecCount": len(MODEL_SPECS),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baselineUnified": baseline,
        "baselineDiagnostics": baseline_diagnostics,
        "topDevelopmentDiagnostics": all_development_diagnostics[:12],
        "topValidationDiagnostics": validation_diagnostics[:12],
        "modelDiagnostics": model_diagnostics,
        "period": {
            "integratedStartInclusive": INTEGRATED_START.isoformat(),
            "integratedEndExclusive": INTEGRATED_END.isoformat(),
            "integratedCalendarDays": (INTEGRATED_END - INTEGRATED_START).days,
            "julyAuditStartInclusive": JULY_START.isoformat(),
            "julyAuditEndExclusive": JULY_END.isoformat(),
            "integratedDecisionSlots": len(integrated_slots),
            "julyDecisionSlots": len(july_slots),
            "developmentDays": len(splits["DEVELOPMENT"]),
            "validationDays": len(splits["VALIDATION"]),
            "finalDays": len(splits["FINAL_REUSED"]),
            "julyDays": len(july_days),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "universe": list(v31.UNIVERSE),
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "maximumHoldingHours": 4,
            "v96Priority": True,
            "v11EqPriority": True,
            "v19Priority": True,
            "forcedUtilization": False,
            "hyperliquidUsed": False,
            "julyUnifiedClaimAllowed": False,
        },
        "model": {
            "type": "CAUSAL_DAILY_REFIT_POOLED_RIDGE",
            "dimension": DIMENSION,
            "lookbackDays": list(MODEL_LOOKBACKS),
            "horizonHours": list(MODEL_HORIZONS),
            "ridgePenalties": list(RIDGE_PENALTIES),
            "minimumTrainingSamples": MIN_TRAINING_SAMPLES,
            "targetAvailabilityRule": "sample available on UTC day after target horizon completes",
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopSixty": True,
            "validationSelectsAtMostOne": True,
            "finalAndJulyUsedForSelection": False,
            "julyCandidateOnlyAudit": True,
            "productionPromotionAllowed": False,
        },
        "data": {
            "market": market_diagnostics,
            "features": feature_diagnostics,
            "training": training_diagnostics,
            "v96": v96_diagnostics,
            "v96EvidenceEndUtc": dt.datetime.fromtimestamp(v96_evidence_end / 1000, tz=UTC).isoformat() if v96_evidence_end else None,
            "v96IntegratedCoveragePass": coverage_pass,
            "stock": stock_diagnostics,
            "priorityIntervals": {
                "v96": len(v96_intervals),
                "stock": len(stock_intervals),
                "merged": len(priority_intervals),
            },
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V32 Online Ridge V96-Idle Crypto", "",
        f"Status: **{result['status']}**", "",
        f"Candidates: {result['candidateCount']}",
        f"Model specs: {result['modelSpecCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        f"V96 integrated coverage: {result['data']['v96IntegratedCoveragePass']}", "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Standalone Normal: {winner['fullStandalone']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Standalone P95: {winner['fullStandalone']['P95']['compoundedReturnPct']:.6f}%",
            f"Standalone DD: {winner['fullStandalone']['NORMAL']['maxDrawdownPct']:.6f}%",
            f"Unified Normal: {winner['unifiedFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Baseline Normal: {winner['baselineUnified']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"July candidate-only Normal: {winner['julyCandidateOnlyAudit']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Integrated priority overlaps: {winner['priorityOverlapCountIntegrated']}", "",
        ]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.", ""]
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
        "candidateCount": result["candidateCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "baselineUnified": result["baselineUnified"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
        "topValidationDiagnostics": result["topValidationDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
