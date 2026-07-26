from __future__ import annotations

import argparse
import bisect
import datetime as dt
import json
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v31_v96_idle_crypto_fallback as v31
import research_lab_aster_only_v32_online_ridge_idle_crypto as v32

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V33_RESIDUAL_GROSS_OVERLAY"
INTEGRATED_START = v32.INTEGRATED_START
INTEGRATED_END = v32.INTEGRATED_END
DATA_END = v32.DATA_END
MODEL_WARMUP = v32.MODEL_WARMUP
INTEGRATED_START_MS = v32.INTEGRATED_START_MS
INTEGRATED_END_MS = v32.INTEGRATED_END_MS
DATA_END_MS = v32.DATA_END_MS
TOTAL_GROSS_CAP = 2.0
MIN_OVERLAY_GROSS = 0.15
MAX_OVERLAY_GROSS_OPTIONS = (0.25, 0.50, 0.75)
RULE_FAMILIES = (
    "FUNDING_SQUEEZE_CONT",
    "EXHAUSTION_FADE",
    "VOL_COMPRESSION_BREAK",
)
ONLINE_MODEL_IDS = tuple(
    spec.model_id
    for spec in v32.MODEL_SPECS
    if spec.lookback_days == 30
    and spec.ridge_penalty in {1.0, 10.0}
)
ONLINE_THRESHOLDS = (20.0, 35.0)
ONLINE_CONFIDENCE = (0.25, 0.50)
ONLINE_REGIMES = ("NONE", "BTC_STABLE")


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    source: str
    base_candidate_id: str
    model_id: str
    lookback_days: int
    maximum_holding_hours: int
    ridge_penalty: float
    predicted_threshold_bps: float
    confidence_ratio: float
    regime: str
    risk_name: str
    maximum_overlay_gross: float


RULE_BASES = tuple(candidate for candidate in v31.CANDIDATES if candidate.family in RULE_FAMILIES)
RULE_BASE_MAP = {candidate.candidate_id: candidate for candidate in RULE_BASES}
MODEL_SPEC_MAP = {spec.model_id: spec for spec in v32.MODEL_SPECS}

RULE_CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"RULE__{base.candidate_id}__G{gross:g}",
        "RULE",
        base.candidate_id,
        "",
        0,
        base.maximum_holding_hours,
        0.0,
        0.0,
        0.0,
        "",
        base.risk_name,
        gross,
    )
    for base in RULE_BASES
    for gross in MAX_OVERLAY_GROSS_OPTIONS
)

ONLINE_CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"ONLINE__{model_id}__P{threshold:g}__C{confidence:g}__{regime}__{risk.name}__G{gross:g}",
        "ONLINE",
        "",
        model_id,
        MODEL_SPEC_MAP[model_id].lookback_days,
        MODEL_SPEC_MAP[model_id].horizon_hours,
        MODEL_SPEC_MAP[model_id].ridge_penalty,
        threshold,
        confidence,
        regime,
        risk.name,
        gross,
    )
    for model_id in ONLINE_MODEL_IDS
    for threshold in ONLINE_THRESHOLDS
    for confidence in ONLINE_CONFIDENCE
    for regime in ONLINE_REGIMES
    for risk in v31.RISK_PROFILES
    for gross in MAX_OVERLAY_GROSS_OPTIONS
)

CANDIDATES = RULE_CANDIDATES + ONLINE_CANDIDATES


@dataclass(frozen=True)
class CapacitySegment:
    start: int
    end: int
    v96_gross: float
    stock_gross: float
    available_gross: float


class CapacitySchedule:
    def __init__(self, segments: Sequence[CapacitySegment]):
        self.segments = list(segments)
        self.starts = [segment.start for segment in self.segments]

    def minimum_available(self, start: int, end: int) -> float:
        if end <= start or not self.segments:
            return 0.0
        index = max(0, bisect.bisect_right(self.starts, start) - 1)
        minimum = TOTAL_GROSS_CAP
        covered = False
        while index < len(self.segments):
            segment = self.segments[index]
            if segment.start >= end:
                break
            if segment.end > start:
                covered = True
                minimum = min(minimum, segment.available_gross)
            index += 1
        return max(0.0, minimum) if covered else 0.0

    def diagnostics(self) -> dict:
        hours = defaultdict(float)
        minimum = TOTAL_GROSS_CAP
        maximum = 0.0
        for segment in self.segments:
            duration = max(0.0, (segment.end - segment.start) / v31.HOUR_MS)
            available = segment.available_gross
            minimum = min(minimum, available)
            maximum = max(maximum, available)
            if available < 0.15:
                bucket = "LT_0_15"
            elif available < 0.25:
                bucket = "0_15_TO_0_25"
            elif available < 0.50:
                bucket = "0_25_TO_0_50"
            elif available < 0.75:
                bucket = "0_50_TO_0_75"
            elif available < 1.0:
                bucket = "0_75_TO_1_00"
            else:
                bucket = "GE_1_00"
            hours[bucket] += duration
        return {
            "segments": len(self.segments),
            "minimumAvailableGross": minimum if self.segments else 0.0,
            "maximumAvailableGross": maximum,
            "hoursByAvailability": dict(sorted(hours.items())),
        }


def rounded(value: Any):
    return v31.rounded(value)


def calendar_days(start: dt.datetime, end: dt.datetime) -> List[str]:
    return v32.calendar_days(start, end)


def split_days(days: Sequence[str]) -> dict:
    return v32.split_days(days)


def configure_market() -> None:
    v32.configure_v31_for_market()


def configure_priority() -> None:
    v32.configure_v31_for_priority()


def v96_gross_rows(crypto: dict) -> List[Tuple[int, float]]:
    rows = []
    for row in crypto.get("normal", []):
        timestamp = int(row["ts"])
        if not (INTEGRATED_START_MS <= timestamp < INTEGRATED_END_MS):
            continue
        gross = max(0.0, min(TOTAL_GROSS_CAP, float(row.get("sourceGross", row.get("gross", 0.0)))))
        rows.append((timestamp, gross))
    rows.sort()
    if not rows or rows[0][0] > INTEGRATED_START_MS:
        rows.insert(0, (INTEGRATED_START_MS, 0.0))
    return rows


def gross_at(rows: Sequence[Tuple[int, float]], timestamp: int) -> float:
    times = [row[0] for row in rows]
    index = bisect.bisect_right(times, timestamp) - 1
    return rows[index][1] if index >= 0 else 0.0


def build_v96_only_schedule(rows: Sequence[Tuple[int, float]]) -> CapacitySchedule:
    breakpoints = sorted({INTEGRATED_START_MS, INTEGRATED_END_MS, *[timestamp for timestamp, _gross in rows]})
    segments = []
    for left, right in zip(breakpoints, breakpoints[1:]):
        if right <= INTEGRATED_START_MS or left >= INTEGRATED_END_MS:
            continue
        start = max(left, INTEGRATED_START_MS)
        end = min(right, INTEGRATED_END_MS)
        v96_gross = gross_at(rows, start)
        segments.append(CapacitySegment(start, end, v96_gross, 0.0, max(0.0, TOTAL_GROSS_CAP - v96_gross)))
    return CapacitySchedule(segments)


def select_stock_rows(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    integrated_days: Sequence[str],
    v96_schedule: CapacitySchedule,
) -> Tuple[List[dict], dict]:
    routed, routing = v31.v22.route(v11_rows, v19_rows, v31.STOCK_COSTS["NORMAL"], integrated_days, True)
    accepted = []
    rejected = Counter()
    for row in sorted(routed, key=lambda item: (int(item["entryTs"]), int(item["exitTs"]))):
        required = float(row.get("gross", 1.0))
        available = v96_schedule.minimum_available(int(row["entryTs"]), int(row["exitTs"]))
        if available + 1e-12 < required:
            rejected["V96_RESIDUAL_BELOW_STOCK_GROSS"] += 1
            continue
        accepted.append(dict(row))
    return accepted, {"routing": routing, "accepted": len(accepted), "rejected": dict(rejected)}


def stock_gross_at(intervals: Sequence[Tuple[int, int, float]], timestamp: int) -> float:
    return sum(gross for start, end, gross in intervals if start <= timestamp < end)


def build_capacity_schedule(
    rows: Sequence[Tuple[int, float]],
    stock_rows: Sequence[dict],
) -> Tuple[CapacitySchedule, List[Tuple[int, int, float]]]:
    stock_intervals = [
        (int(row["entryTs"]), int(row["exitTs"]), float(row.get("gross", 1.0)))
        for row in stock_rows
    ]
    breakpoints = {INTEGRATED_START_MS, INTEGRATED_END_MS}
    breakpoints.update(timestamp for timestamp, _gross in rows)
    for start, end, _gross in stock_intervals:
        breakpoints.add(max(INTEGRATED_START_MS, start))
        breakpoints.add(min(INTEGRATED_END_MS, end))
    ordered = sorted(point for point in breakpoints if INTEGRATED_START_MS <= point <= INTEGRATED_END_MS)
    segments = []
    for left, right in zip(ordered, ordered[1:]):
        if right <= left:
            continue
        v96_gross = gross_at(rows, left)
        stock_gross = stock_gross_at(stock_intervals, left)
        available = max(0.0, TOTAL_GROSS_CAP - v96_gross - stock_gross)
        segments.append(CapacitySegment(left, right, v96_gross, stock_gross, available))
    return CapacitySchedule(segments), stock_intervals


def scale_trade(trade: dict, gross: float, strategy: str) -> dict:
    result = dict(trade)
    result["strategy"] = strategy
    result["gross"] = gross
    result["priceReturn"] = float(result.get("priceReturn", 0.0)) * gross
    result["fundingReturn"] = float(result.get("fundingReturn", 0.0)) * gross
    result["grossReturn"] = float(result.get("grossReturn", 0.0)) * gross
    result["availableGrossAtEntry"] = gross
    return result


def build_rule_trades(
    candidate: Candidate,
    slots: Sequence[int],
    features: Dict[int, Dict[str, dict]],
    bars: Dict[str, List[v31.Bar]],
    funding: Dict[str, List[Tuple[int, float]]],
    capacity: Optional[CapacitySchedule],
) -> Tuple[List[dict], dict]:
    base = RULE_BASE_MAP[candidate.base_candidate_id]
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    trades = []
    rejected = Counter()
    active_until = -1
    for timestamp in slots:
        if timestamp < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_end = timestamp + candidate.maximum_holding_hours * v31.HOUR_MS
        available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(timestamp, maximum_end),
        )
        if available + 1e-12 < MIN_OVERLAY_GROSS:
            rejected["RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        selected = v31.signal(base, features[timestamp])
        if selected is None:
            continue
        symbol, side, edge, detail = selected
        trade = v31.simulate_trade(base, symbol, side, edge, detail, timestamp, bars, funding, index_maps)
        if trade is None:
            rejected["MISSING_FUTURE_BARS"] += 1
            continue
        actual_available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(int(trade["entryTs"]), int(trade["exitTs"])),
        )
        if actual_available + 1e-12 < MIN_OVERLAY_GROSS:
            rejected["ACTUAL_RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        trades.append(scale_trade(trade, actual_available, "V33_RESIDUAL_RULE_OVERLAY"))
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


def regime_pass(candidate: Candidate, panel: Sequence[dict]) -> bool:
    if not panel:
        return False
    if candidate.regime == "NONE":
        return True
    if candidate.regime == "BTC_STABLE":
        return abs(float(panel[0]["btcReturn4hBps"])) <= v32.BTC_STABLE_BPS
    raise ValueError(candidate.regime)


def build_online_trades(
    candidate: Candidate,
    predictions: Dict[int, List[dict]],
    slots: Sequence[int],
    bars: Dict[str, List[v31.Bar]],
    funding: Dict[str, List[Tuple[int, float]]],
    capacity: Optional[CapacitySchedule],
) -> Tuple[List[dict], dict]:
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    trades = []
    rejected = Counter()
    active_until = -1
    for timestamp in slots:
        if timestamp < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_end = timestamp + candidate.maximum_holding_hours * v31.HOUR_MS
        available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(timestamp, maximum_end),
        )
        if available + 1e-12 < MIN_OVERLAY_GROSS:
            rejected["RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        panel = predictions.get(timestamp, [])
        if not regime_pass(candidate, panel):
            rejected["REGIME"] += 1
            continue
        eligible = []
        for row in panel:
            predicted = float(row["predictedBps"])
            rmse = max(1e-9, float(row["rmseBps"]))
            confidence = abs(predicted) / rmse
            edge = abs(predicted) - 0.5 * rmse
            if abs(predicted) < candidate.predicted_threshold_bps:
                continue
            if confidence < candidate.confidence_ratio:
                continue
            if edge - v31.COSTS["NORMAL"] < 10.0:
                continue
            eligible.append((edge, abs(predicted), str(row["symbol"]), predicted, rmse, confidence))
        if not eligible:
            continue
        edge, _strength, symbol, predicted, rmse, confidence = sorted(
            eligible, key=lambda item: (-item[0], -item[1], item[2])
        )[0]
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
                "confidenceRatio": confidence,
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
        actual_available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(int(trade["entryTs"]), int(trade["exitTs"])),
        )
        if actual_available + 1e-12 < MIN_OVERLAY_GROSS:
            rejected["ACTUAL_RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        trades.append(scale_trade(trade, actual_available, "V33_RESIDUAL_ONLINE_OVERLAY"))
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


def accepted_rows(
    trades: Sequence[dict],
    cost_bps: float,
    selected_days: Optional[Sequence[str]] = None,
) -> Tuple[List[dict], Counter]:
    allowed = None if selected_days is None else set(selected_days)
    rows = []
    rejected = Counter()
    for trade in trades:
        if allowed is not None and str(trade["day"]) not in allowed:
            continue
        if float(trade["edgeProxyBps"]) - cost_bps < 10.0:
            rejected["NET_EDGE_BELOW_10BPS"] += 1
            continue
        gross = float(trade.get("gross", 1.0))
        value = float(trade["grossReturn"]) - gross * cost_bps / 10_000.0
        rows.append({**trade, "netReturn": value, "return": value, "ts": int(trade["exitTs"]), "priority": 4})
    return rows, rejected


def standalone_scenarios(trades: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    result, diagnostics = {}, {}
    for scenario, cost in v31.COSTS.items():
        rows, rejected = accepted_rows(trades, cost, days)
        filtered, daily = v31.daily_loss_filter(rows)
        result[scenario] = v31.metrics(filtered)
        diagnostics[scenario] = {"costGate": dict(rejected), "daily": daily}
    return result, diagnostics


def stock_events(stock_rows: Sequence[dict], days: Sequence[str], scenario: str) -> List[dict]:
    allowed = set(days)
    events = []
    cost = v31.STOCK_COSTS[scenario]
    for row in stock_rows:
        if str(row["day"]) not in allowed:
            continue
        value = v31.v22.trade_value(row, cost)
        if value is None:
            continue
        events.append({**row, "return": value, "ts": int(row["exitTs"]), "priority": 3})
    return events


def unified_metrics(
    crypto: dict,
    stock_rows: Sequence[dict],
    overlay_rows: Sequence[dict],
    days: Sequence[str],
    scenario: str,
) -> Tuple[dict, dict]:
    overlay, overlay_rejects = accepted_rows(overlay_rows, v31.COSTS[scenario], days)
    events = [
        *v31.v96_events(crypto, scenario, days),
        *stock_events(stock_rows, days, scenario),
        *overlay,
    ]
    filtered, daily = v31.daily_loss_filter(events)
    return v31.metrics(filtered), {
        "v96Events": sum(row.get("strategy") == "CRYPTO_V96" for row in filtered),
        "stockEvents": sum(row.get("priority") == 3 for row in filtered),
        "overlayEvents": sum(row.get("priority") == 4 for row in filtered),
        "overlayRejects": dict(overlay_rejects),
        "daily": daily,
    }


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


def gross_cap_violations(
    capacity: CapacitySchedule,
    trades: Sequence[dict],
) -> Tuple[int, float]:
    violations = 0
    maximum_total = 0.0
    for trade in trades:
        start = int(trade["entryTs"])
        end = int(trade["exitTs"])
        gross = float(trade.get("gross", 0.0))
        available = capacity.minimum_available(start, end)
        total = TOTAL_GROSS_CAP - available + gross
        maximum_total = max(maximum_total, total)
        if gross > available + 1e-9 or total > TOTAL_GROSS_CAP + 1e-9:
            violations += 1
    return violations, maximum_total


def analyze(cache_root: Path) -> dict:
    configure_market()
    bars, funding, market_diagnostics = v31.load_market(cache_root / "crypto-market")
    slots, features, feature_diagnostics = v31.build_features(bars, funding)
    daily_stats, training_diagnostics = v32.build_daily_stats(slots, features, bars)
    prefix_days = v32.calendar_days(MODEL_WARMUP, DATA_END + dt.timedelta(days=2))
    prefix = v32.build_prefix_stats(daily_stats, prefix_days)

    configure_priority()
    crypto, _v96_intervals, v96_diagnostics = v31.v96_state(cache_root / "v96")
    v11_rows, v19_rows, _stock_intervals, stock_diagnostics = v31.stock_state(cache_root / "stock")
    integrated_days = calendar_days(INTEGRATED_START, INTEGRATED_END)
    july_days = calendar_days(INTEGRATED_END, DATA_END)
    splits = split_days(integrated_days)
    integrated_slots = [timestamp for timestamp in slots if INTEGRATED_START_MS <= timestamp < INTEGRATED_END_MS]
    july_slots = [timestamp for timestamp in slots if INTEGRATED_END_MS <= timestamp < DATA_END_MS]

    source_gross_rows = v96_gross_rows(crypto)
    v96_schedule = build_v96_only_schedule(source_gross_rows)
    accepted_stock_rows, stock_selection_diagnostics = select_stock_rows(
        v11_rows, v19_rows, integrated_days, v96_schedule
    )
    capacity, stock_intervals = build_capacity_schedule(source_gross_rows, accepted_stock_rows)
    v96_evidence_timestamps = [int(row["ts"]) for row in [*crypto.get("normal", []), *crypto.get("severe", [])]]
    v96_evidence_end = max(v96_evidence_timestamps) if v96_evidence_timestamps else 0
    coverage_pass = v96_evidence_end >= int(dt.datetime(2026, 6, 30, tzinfo=UTC).timestamp() * 1000)

    baseline, baseline_diagnostics = {}, {}
    for scenario in v31.COSTS:
        baseline[scenario], baseline_diagnostics[scenario] = unified_metrics(
            crypto, accepted_stock_rows, [], integrated_days, scenario
        )

    predictions_by_model = {}
    model_diagnostics = {}
    for model_id in ONLINE_MODEL_IDS:
        spec = MODEL_SPEC_MAP[model_id]
        predictions, diagnostics = v32.build_predictions(spec, slots, features, prefix_days, prefix)
        predictions_by_model[model_id] = predictions
        model_diagnostics[model_id] = diagnostics

    development_survivors = []
    all_development_diagnostics = []
    for candidate in CANDIDATES:
        if candidate.source == "RULE":
            trades, build_diagnostics = build_rule_trades(
                candidate, integrated_slots, features, bars, funding, capacity
            )
        else:
            trades, build_diagnostics = build_online_trades(
                candidate, predictions_by_model[candidate.model_id], integrated_slots,
                bars, funding, capacity
            )
        development, _ = standalone_scenarios(trades, splits["DEVELOPMENT"])
        diagnostic = {
            "candidate": asdict(candidate),
            "rawIntegratedTrades": len(trades),
            "development": development,
            "buildDiagnostics": build_diagnostics,
        }
        all_development_diagnostics.append(diagnostic)
        if development_pass(development):
            development_survivors.append((candidate, trades, development, build_diagnostics))

    development_survivors.sort(
        key=lambda item: item[2]["NORMAL"]["compoundedReturnPct"] + item[2]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = []
    validation_diagnostics = []
    for candidate, trades, development, build_diagnostics in development_survivors[:60]:
        validation, validation_rejects = standalone_scenarios(trades, splits["VALIDATION"])
        unified, unified_diagnostics = {}, {}
        validation_baseline = {}
        for scenario in v31.COSTS:
            unified[scenario], unified_diagnostics[scenario] = unified_metrics(
                crypto, accepted_stock_rows, trades, splits["VALIDATION"], scenario
            )
            validation_baseline[scenario], _ = unified_metrics(
                crypto, accepted_stock_rows, [], splits["VALIDATION"], scenario
            )
        item = {
            "candidate": asdict(candidate),
            "development": development,
            "validation": validation,
            "validationUnified": unified,
            "validationBaseline": validation_baseline,
            "validationRejects": validation_rejects,
            "unifiedDiagnostics": unified_diagnostics,
            "rawIntegratedTrades": len(trades),
            "buildDiagnostics": build_diagnostics,
        }
        validation_diagnostics.append(item)
        if validation_pass(validation, unified, validation_baseline):
            validation_survivors.append((candidate, trades, item))

    validation_survivors.sort(
        key=lambda item: selection_score(item[2]["validation"], item[2]["validationUnified"], item[2]["validationBaseline"]),
        reverse=True,
    )
    winner = validation_survivors[0] if validation_survivors else None
    winner_payload = None
    status = "ASTER_ONLY_V33_NO_VALIDATED_RESIDUAL_GROSS_OVERLAY"

    if winner is not None:
        candidate, trades, selected = winner
        full, full_rejects = standalone_scenarios(trades, integrated_days)
        final, final_rejects = standalone_scenarios(trades, splits["FINAL_REUSED"])
        if candidate.source == "RULE":
            july_trades, july_build = build_rule_trades(
                candidate, july_slots, features, bars, funding, None
            )
        else:
            july_trades, july_build = build_online_trades(
                candidate, predictions_by_model[candidate.model_id], july_slots,
                bars, funding, None
            )
        july, july_rejects = standalone_scenarios(july_trades, july_days)
        unified_full, unified_full_diagnostics = {}, {}
        for scenario in v31.COSTS:
            unified_full[scenario], unified_full_diagnostics[scenario] = unified_metrics(
                crypto, accepted_stock_rows, trades, integrated_days, scenario
            )
        normal_rows, _ = accepted_rows(trades, v31.COSTS["NORMAL"], integrated_days)
        p95_rows, _ = accepted_rows(trades, v31.COSTS["P95"], integrated_days)
        normal_rows, _ = v31.daily_loss_filter(normal_rows)
        p95_rows, _ = v31.daily_loss_filter(p95_rows)
        normal_without_month, normal_month = v31.remove_best_month(normal_rows)
        p95_without_month, p95_month = v31.remove_best_month(p95_rows)
        violations, maximum_total_gross = gross_cap_violations(capacity, trades)
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
            "zeroGrossCapViolations": violations == 0 and maximum_total_gross <= TOTAL_GROSS_CAP + 1e-9,
        }
        accepted = all(checks.values())
        status = "ASTER_ONLY_V33_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V33_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "accepted": accepted,
            "checks": checks,
            "fullStandaloneContribution": full,
            "finalReusedStandaloneContribution": final,
            "julyCandidateOnlyAudit": july,
            "unifiedFull": unified_full,
            "baselineUnified": baseline,
            "selection": selected,
            "rawIntegratedTrades": len(trades),
            "rawJulyTrades": len(july_trades),
            "grossCapViolations": violations,
            "maximumTotalGross": maximum_total_gross,
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
                "julyBuild": july_build,
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
        "version": 33,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "ruleCandidateCount": len(RULE_CANDIDATES),
        "onlineCandidateCount": len(ONLINE_CANDIDATES),
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
            "julyAuditStartInclusive": INTEGRATED_END.isoformat(),
            "julyAuditEndExclusive": DATA_END.isoformat(),
            "integratedDecisionSlots": len(integrated_slots),
            "julyDecisionSlots": len(july_slots),
            "developmentDays": len(splits["DEVELOPMENT"]),
            "validationDays": len(splits["VALIDATION"]),
            "finalDays": len(splits["FINAL_REUSED"]),
            "julyDays": len(july_days),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "totalGrossCap": TOTAL_GROSS_CAP,
            "overlayMaximumGrossOptions": list(MAX_OVERLAY_GROSS_OPTIONS),
            "overlayMinimumGross": MIN_OVERLAY_GROSS,
            "maximumOverlayPositions": 1,
            "v96FirstPriority": True,
            "stockSecondPriority": True,
            "overlayThirdPriority": True,
            "forcedUtilization": False,
            "hyperliquidUsed": False,
            "julyUnifiedClaimAllowed": False,
        },
        "capacity": {
            "v96Rows": len(source_gross_rows),
            "stockIntervals": len(stock_intervals),
            "stockSelection": stock_selection_diagnostics,
            "v96Only": v96_schedule.diagnostics(),
            "afterStock": capacity.diagnostics(),
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
        "# Aster-only V33 Residual-Gross Overlay", "",
        f"Status: **{result['status']}**", "",
        f"Candidates: {result['candidateCount']}",
        f"Rule candidates: {result['ruleCandidateCount']}",
        f"Online candidates: {result['onlineCandidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        f"V96 integrated coverage: {result['data']['v96IntegratedCoveragePass']}", "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Contribution Normal: {winner['fullStandaloneContribution']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Contribution P95: {winner['fullStandaloneContribution']['P95']['compoundedReturnPct']:.6f}%",
            f"Contribution DD: {winner['fullStandaloneContribution']['NORMAL']['maxDrawdownPct']:.6f}%",
            f"Unified Normal: {winner['unifiedFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Baseline Normal: {winner['baselineUnified']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"July candidate-only Normal: {winner['julyCandidateOnlyAudit']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Gross cap violations: {winner['grossCapViolations']}",
            f"Maximum total Gross: {winner['maximumTotalGross']:.6f}", "",
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
        "capacity": result["capacity"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
        "topValidationDiagnostics": result["topValidationDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
