from __future__ import annotations

import datetime as dt
import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_feature_combo_v28 as v28
import research_lab_feature_overlay_v27 as v27
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_v35_core_pengu_v46_gross2 as pv46
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90

core = v69.core
DEV_END = core.v4.START_2026
PENGU_START = 1704067200000  # 2024-01-01 UTC
PENGU_OPERATIONAL_GROSS = 0.15


@dataclass(frozen=True)
class CoreCandidate:
    candidate_id: str
    vote_threshold: float = 0.50
    volume_floor: float = 0.70
    bear_confirm_bars: int = 4
    weight_tolerance: float = 0.05
    turnover_threshold: float = 0.20
    stale_bars: int = 12


@dataclass(frozen=True)
class PenguCandidate:
    candidate_id: str
    volume_floor: float = 0.80
    long_mom6_min: float = 1.00
    lagged_mom6_max: float = 0.00
    long_mom24_min: float = 0.00
    long_mom120_min: float = 2.00
    relative48_min: float = 1.00
    relative120_min: float = 0.00
    rsi_min: float = 45.00
    rsi_max: float = 72.00
    funding_cap: float = 0.0003


CORE_CANDIDATES = [
    CoreCandidate("CORE_BASE"),
    CoreCandidate("WB_FAST", weight_tolerance=0.025, turnover_threshold=0.10, stale_bars=6),
    CoreCandidate("WB_VERY_FAST", weight_tolerance=0.01, turnover_threshold=0.05, stale_bars=4),
    CoreCandidate("VOTE45", vote_threshold=0.45),
    CoreCandidate("VOTE40", vote_threshold=0.40),
    CoreCandidate("VOLUME60", volume_floor=0.60),
    CoreCandidate("VOLUME50", volume_floor=0.50),
    CoreCandidate("BEAR3", bear_confirm_bars=3),
    CoreCandidate("BEAR2", bear_confirm_bars=2),
    CoreCandidate(
        "BALANCED_FREQ_A",
        vote_threshold=0.45,
        volume_floor=0.60,
        bear_confirm_bars=3,
        weight_tolerance=0.025,
        turnover_threshold=0.10,
        stale_bars=6,
    ),
    CoreCandidate(
        "BALANCED_FREQ_B",
        vote_threshold=0.40,
        volume_floor=0.60,
        bear_confirm_bars=3,
        weight_tolerance=0.025,
        turnover_threshold=0.10,
        stale_bars=6,
    ),
]

PENGU_CANDIDATES = [
    PenguCandidate("PENGU_BASE"),
    PenguCandidate("PENGU_VOLUME70", volume_floor=0.70),
    PenguCandidate("PENGU_VOLUME60", volume_floor=0.60),
    PenguCandidate("PENGU_MOM_HALF", long_mom6_min=0.50, long_mom120_min=1.00, relative48_min=0.50),
    PenguCandidate("PENGU_CROSS_SOFT", lagged_mom6_max=0.50),
    PenguCandidate("PENGU_RSI_WIDE", rsi_min=42.00, rsi_max=76.00),
    PenguCandidate(
        "PENGU_BALANCED_A",
        volume_floor=0.70,
        long_mom6_min=0.50,
        lagged_mom6_max=0.50,
        long_mom120_min=1.00,
        relative48_min=0.50,
        rsi_min=42.00,
        rsi_max=76.00,
    ),
    PenguCandidate(
        "PENGU_BALANCED_B",
        volume_floor=0.60,
        long_mom6_min=0.50,
        lagged_mom6_max=0.50,
        long_mom120_min=1.00,
        relative48_min=0.50,
        rsi_min=40.00,
        rsi_max=78.00,
    ),
]


def signature(weights: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted(
        (symbol, 1 if float(weight) > 0 else -1)
        for symbol, weight in weights.items()
        if abs(float(weight)) > 1e-12
    ))


def component_target(
    component: v4.Component,
    ts: int,
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    volume_floor: float,
) -> Dict[str, float]:
    btc_index = indexes["BTC"].get(ts)
    if btc_index is None:
        return {}
    btc = bars["BTC"]
    regime_bars = component.regime_days * 2
    momentum_bars = component.momentum_days * 2
    btc_average = v4.sma(btc, btc_index, regime_bars)
    btc_momentum = v4.momentum(btc, btc_index, momentum_bars)
    if btc_average is None or btc_momentum is None:
        return {}
    if not (float(btc[btc_index]["close"]) > btc_average and btc_momentum > 0):
        return {}

    candidates: List[Tuple[str, float]] = []
    breadth = 0
    for symbol in ("ETH", "BNB", "SOL"):
        index = indexes[symbol].get(ts)
        if index is None:
            continue
        rows = bars[symbol]
        average = v4.sma(rows, index, 44)
        symbol_momentum = v4.momentum(rows, index, momentum_bars)
        volatility = v4.realized_annual_vol(rows, index, momentum_bars)
        volume = v4.volume_ratio(rows, index)
        if average is None or symbol_momentum is None or volatility is None or volume is None:
            continue
        if float(rows[index]["close"]) > average and symbol_momentum > 0:
            breadth += 1
            if volume >= volume_floor:
                relative = symbol_momentum - btc_momentum
                score = symbol_momentum + relative * 0.3 - (volatility / math.sqrt(36.5)) * 0.18 + min(2.0, volume)
                candidates.append((symbol, score))
    if breadth < 1 or not candidates:
        return {}
    selected = sorted(candidates, key=lambda item: item[1], reverse=True)[: component.top_k]
    each = v4.BASE_ALLOCATION / len(selected)
    return {symbol: each for symbol, _score in selected}


def projected_members(
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    volume_floor: float,
) -> Dict[int, List[Dict[str, float]]]:
    current: List[Dict[str, float]] = [{} for _ in v20.COMPONENTS]
    pending: List[Optional[Dict[str, float]]] = [None for _ in v20.COMPONENTS]
    result: Dict[int, List[Dict[str, float]]] = {}
    for ts in times:
        for index, value in enumerate(pending):
            if value is not None:
                current[index] = value
                pending[index] = None
        projected: List[Dict[str, float]] = []
        for index, component in enumerate(v20.COMPONENTS):
            candidate = component_target(component, ts, bars, indexes, volume_floor)
            rebalance_bars = max(1, round(component.rebalance_days * 2))
            scheduled = round((ts - v4.START_2023) / (12 * v4.HOUR)) % rebalance_bars == 0
            regime_exit = v4.gross_exposure(current[index]) > 0 and v4.gross_exposure(candidate) == 0
            if scheduled or regime_exit:
                pending[index] = candidate
                projected.append(candidate)
            else:
                projected.append(current[index])
        result[ts] = projected
    return result


def raw_targets_for(candidate: CoreCandidate, raw: dict) -> Dict[int, Dict[str, float]]:
    times = raw["times"]
    bars = raw["bars"]
    indexes = raw["indexes"]
    funding = raw["funding"]
    projected = projected_members(times, bars, indexes, candidate.volume_floor)
    overlay = v4.Overlay(
        f"FREQ_VOTE_{candidate.vote_threshold}",
        candidate.vote_threshold,
        0,
        45,
        1.1,
        None,
    )
    base = {ts: v4.overlay_target(overlay, ts, projected[ts], bars, indexes) for ts in times}
    bear = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    first, second = v28.COMBOS["VWM25_SKEW125"]
    adjusted: Dict[int, Dict[str, float]] = {}
    for position, ts in enumerate(times):
        target = v27.apply_variant(first, base.get(ts, {}), ts, position, times, bars, indexes, funding)
        target = v27.apply_variant(second, target, ts, position, times, bars, indexes, funding)
        adjusted[ts] = target
    confirmed_bear = v6.confirmed_bear_series(bear, times, candidate.bear_confirm_bars)
    return {
        ts: adjusted.get(ts, {}) if v4.gross_exposure(adjusted.get(ts, {})) > 0.05 else confirmed_bear.get(ts, {})
        for ts in times
    }


def count_core_frequency(targets: Dict[int, Dict[str, float]], times: List[int], stabilization: dict) -> dict:
    active_buckets = 0
    episode_starts = 0
    direction_changes = 0
    previous: Dict[str, float] = {}
    for ts in times:
        current = targets.get(ts, {})
        if current:
            active_buckets += 1
        if not previous and current:
            episode_starts += 1
        if signature(current) != signature(previous):
            direction_changes += 1
        previous = current
    order_events = int(stabilization.get("signatureChangesImmediate", 0)) + int(stabilization.get("acceptedWeightRebalances", 0))
    return {
        "activeBuckets": active_buckets,
        "episodeStarts": episode_starts,
        "signatureChanges": direction_changes,
        "orderEvents": order_events,
        "ignoredWeightChanges": int(stabilization.get("ignoredWeightChanges", 0)),
        "acceptedWeightRebalances": int(stabilization.get("acceptedWeightRebalances", 0)),
        "turnoverReductionPct": float(stabilization.get("turnoverReductionPct", 0.0)),
    }


def evaluate_core(candidate: CoreCandidate, raw: dict) -> dict:
    raw_targets = raw_targets_for(candidate, raw)
    stabilized, stabilization = v90.stabilize(
        raw_targets,
        raw["times"],
        v90.Config(candidate.weight_tolerance, candidate.turnover_threshold, candidate.stale_bars),
    )
    base_core = core.v32.core_series(stabilized, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(stabilized, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(raw["times"], stabilized, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    base_rows = core.core_rows(config, raw["times"], base_core, features)
    severe_rows = core.core_rows(config, raw["times"], severe_core, features)
    context = v89.context_for(stabilized, raw, base_core, features)
    normal, normal_diag = v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe, severe_diag = v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    return {
        "candidate": asdict(candidate),
        "frequency": count_core_frequency(stabilized, raw["times"], stabilization),
        "development": v69.metrics(normal, core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(severe, core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(normal, DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, DEV_END, core.CORE_END),
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def latest_funding(points: List[dict], ts: int) -> Optional[float]:
    latest: Optional[float] = None
    for row in points:
        if int(row["ts"]) > ts:
            break
        latest = float(row["rate"])
    return latest


def pengu_trades(candidate: PenguCandidate, pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[pv46.Trade]:
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_map) & set(b_map))
    p_close = [float(row["close"]) for row in pengu]
    p_volume = [float(row["volume"]) for row in pengu]
    b_close = [float(row["close"]) for row in btc]
    p_sma72 = pv46.rolling_mean(p_close, 72)
    p_sma168 = pv46.rolling_mean(p_close, 168)
    b_sma168 = pv46.rolling_mean(b_close, 168)
    p_mom6 = pv46.momentum(p_close, 6)
    p_mom24 = pv46.momentum(p_close, 24)
    p_mom48 = pv46.momentum(p_close, 48)
    p_mom120 = pv46.momentum(p_close, 120)
    b_mom48 = pv46.momentum(b_close, 48)
    b_mom72 = pv46.momentum(b_close, 72)
    b_mom120 = pv46.momentum(b_close, 120)
    p_rsi14 = pv46.rsi(p_close, 14)
    p_vol_ratio = pv46.volume_ratio(p_volume, 12, 72)
    trades: List[pv46.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // pv46.HOUR) % pv46.DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if pi < 220 or bi < 220 or pi + 25 >= len(pengu):
            continue
        p_now = p_close[pi]
        b_now = b_close[bi]
        vol = p_vol_ratio[pi]
        if vol is None or vol < candidate.volume_floor:
            continue
        prior_lows = [float(row["low"]) for row in pengu[pi - 24:pi]]
        short_signal = bool(
            prior_lows
            and p_mom6[pi] is not None
            and p_now < min(prior_lows)
            and p_mom6[pi] < 0.0
            and pv46.btc_risk(-1, b_now, b_sma168[bi], b_mom72[bi])
        )
        decision_close_ts = ts + pv46.HOUR - 1
        funding_now = latest_funding(funding, decision_close_ts)
        slope_index = pi - 48
        prior_mom_index = pi - 12
        long_signal = bool(
            not short_signal
            and funding_now is not None
            and funding_now <= candidate.funding_cap
            and p_sma72[pi] is not None
            and p_sma168[pi] is not None
            and slope_index >= 0
            and p_sma168[slope_index] is not None
            and p_mom6[pi] is not None
            and prior_mom_index >= 0
            and p_mom6[prior_mom_index] is not None
            and p_mom24[pi] is not None
            and p_mom48[pi] is not None
            and p_mom120[pi] is not None
            and b_mom48[bi] is not None
            and b_mom120[bi] is not None
            and p_rsi14[pi] is not None
            and p_now > p_sma72[pi]
            and p_now > p_sma168[pi]
            and p_sma168[pi] > p_sma168[slope_index]
            and p_mom6[pi] > candidate.long_mom6_min
            and p_mom6[prior_mom_index] <= candidate.lagged_mom6_max
            and p_mom24[pi] > candidate.long_mom24_min
            and p_mom120[pi] > candidate.long_mom120_min
            and p_mom48[pi] - b_mom48[bi] > candidate.relative48_min
            and p_mom120[pi] - b_mom120[bi] > candidate.relative120_min
            and candidate.rsi_min <= p_rsi14[pi] <= candidate.rsi_max
            and pv46.btc_risk(1, b_now, b_sma168[bi], b_mom72[bi])
        )
        side = -1 if short_signal else 1 if long_signal else 0
        if side == 0:
            continue
        entry_index = pi + 1
        exit_index = entry_index + 24
        entry_ts = int(pengu[entry_index]["ts"])
        exit_ts = int(pengu[exit_index]["ts"])
        entry_price = float(pengu[entry_index]["open"])
        exit_price = float(pengu[exit_index]["open"])
        gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * pv46.funding_between(funding, entry_ts, exit_ts)
        base_pct = gross_pct - paid_funding - 0.12 - 0.02
        severe_pct = gross_pct - paid_funding - 0.20 - 0.05
        trades.append(pv46.Trade(entry_ts, exit_ts, side, entry_price, exit_price, gross_pct, paid_funding, base_pct, severe_pct, ts))
        next_free = exit_ts
    return trades


def evaluate_pengu(candidate: PenguCandidate, pengu: List[dict], btc: List[dict], funding: List[dict]) -> dict:
    trades = pengu_trades(candidate, pengu, btc, funding)
    return {
        "candidate": asdict(candidate),
        "fullNormalizedGross1": pv46.trade_metrics(trades, PENGU_START, core.CORE_END, 1.0, severe=False),
        "fullNormalizedGross1Severe": pv46.trade_metrics(trades, PENGU_START, core.CORE_END, 1.0, severe=True),
        "reused2026H1NormalizedGross1": pv46.trade_metrics(trades, DEV_END, core.CORE_END, 1.0, severe=False),
        "reused2026H1NormalizedGross1Severe": pv46.trade_metrics(trades, DEV_END, core.CORE_END, 1.0, severe=True),
        "operationalGross015": pv46.trade_metrics(trades, PENGU_START, core.CORE_END, PENGU_OPERATIONAL_GROSS, severe=False),
        "operationalGross015Severe": pv46.trade_metrics(trades, PENGU_START, core.CORE_END, PENGU_OPERATIONAL_GROSS, severe=True),
    }


def core_pass(item: dict, baseline: dict) -> bool:
    frequency = item["frequency"]
    base_frequency = baseline["frequency"]
    return bool(
        frequency["orderEvents"] >= max(base_frequency["orderEvents"] + 5, math.ceil(base_frequency["orderEvents"] * 1.20))
        and item["development"]["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"]
        and item["developmentSevere"]["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"]
        and item["development"]["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 1.5
        and item["developmentSevere"]["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 2.0
        and item["reused2026H1"]["compoundedReturnPct"] > 0
        and item["reused2026H1Severe"]["compoundedReturnPct"] > 0
        and item["reused2026H1"]["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.80
        and item["reused2026H1Severe"]["compoundedReturnPct"] >= baseline["reused2026H1Severe"]["compoundedReturnPct"] * 0.80
    )


def pengu_pass(item: dict, baseline: dict) -> bool:
    full = item["fullNormalizedGross1"]
    severe = item["fullNormalizedGross1Severe"]
    base_full = baseline["fullNormalizedGross1"]
    base_severe = baseline["fullNormalizedGross1Severe"]
    hold = item["reused2026H1NormalizedGross1"]
    hold_severe = item["reused2026H1NormalizedGross1Severe"]
    return bool(
        full["trades"] >= base_full["trades"] + 3
        and full["compoundedReturnPct"] > base_full["compoundedReturnPct"]
        and severe["compoundedReturnPct"] >= base_severe["compoundedReturnPct"]
        and full["maxDrawdownPct"] >= base_full["maxDrawdownPct"] - 2.0
        and severe["maxDrawdownPct"] >= base_severe["maxDrawdownPct"] - 2.5
        and hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    core_results = [evaluate_core(candidate, raw) for candidate in CORE_CANDIDATES]
    core_baseline = next(item for item in core_results if item["candidate"]["candidate_id"] == "CORE_BASE")
    for item in core_results:
        item["passesFrequencyAndRobustness"] = core_pass(item, core_baseline) if item is not core_baseline else False
        item["frequencyUpliftPct"] = (
            (item["frequency"]["orderEvents"] / core_baseline["frequency"]["orderEvents"] - 1.0) * 100.0
            if core_baseline["frequency"]["orderEvents"] > 0 else 0.0
        )

    pengu = pv46.fetch_klines("PENGUUSDT", PENGU_START, core.CORE_END)
    btc = pv46.fetch_klines("BTCUSDT", PENGU_START, core.CORE_END)
    funding = pv46.fetch_funding("PENGUUSDT", PENGU_START, core.CORE_END)
    pengu_results = [evaluate_pengu(candidate, pengu, btc, funding) for candidate in PENGU_CANDIDATES]
    pengu_baseline = next(item for item in pengu_results if item["candidate"]["candidate_id"] == "PENGU_BASE")
    for item in pengu_results:
        item["passesFrequencyAndRobustness"] = pengu_pass(item, pengu_baseline) if item is not pengu_baseline else False
        baseline_trades = pengu_baseline["fullNormalizedGross1"]["trades"]
        item["frequencyUpliftPct"] = (
            (item["fullNormalizedGross1"]["trades"] / baseline_trades - 1.0) * 100.0
            if baseline_trades > 0 else 0.0
        )

    passed_core = [item["candidate"]["candidate_id"] for item in core_results if item["passesFrequencyAndRobustness"]]
    passed_pengu = [item["candidate"]["candidate_id"] for item in pengu_results if item["passesFrequencyAndRobustness"]]
    status = "ROBUST_FREQUENCY_UPLIFT_FOUND" if passed_core or passed_pengu else "NO_ROBUST_FREQUENCY_UPLIFT"
    result = rounded({
        "version": 1,
        "strategyId": "V96_FREQUENCY_UPLIFT_RESEARCH_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "passedCore": passed_core,
        "passedPengu": passed_pengu,
        "core": core_results,
        "pengu": pengu_results,
        "selectionPolicy": {
            "core": "At least 20% or five more order events, Development Normal and Severe not below baseline, limited DD deterioration, and positive retained 2026H1.",
            "pengu": "At least three more trades, higher Normal return, Severe not below baseline, limited DD deterioration, and positive 2026H1.",
            "combination": "Do not combine candidates unless they pass standalone. No same-history threshold optimization after this run.",
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "2026H1 has already been inspected and is reused evidence, not a pristine holdout.",
            "Core orderEvents are target-change/rebalance events, not exchange fill records.",
            "PENGU standalone quality is normalized to Gross 1.0; operational Gross 0.15 is reported separately.",
            "Any accepted change requires a new strategy ID and a fresh Forward clock.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-frequency-uplift.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    report = [
        "# V96 Frequency Uplift Backtest",
        "",
        f"- Status: **{status}**",
        f"- Passed Core: {', '.join(passed_core) if passed_core else 'NONE'}",
        f"- Passed PENGU: {', '.join(passed_pengu) if passed_pengu else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "## Core",
        "",
        "| Candidate | Order events | Uplift | Dev return | Dev severe | Dev DD | 2026H1 | 2026H1 severe | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in result["core"]:
        report.append(
            f"| {item['candidate']['candidate_id']} | {item['frequency']['orderEvents']} | {item['frequencyUpliftPct']}% | "
            f"{item['development']['compoundedReturnPct']}% | {item['developmentSevere']['compoundedReturnPct']}% | "
            f"{item['development']['maxDrawdownPct']}% | {item['reused2026H1']['compoundedReturnPct']}% | "
            f"{item['reused2026H1Severe']['compoundedReturnPct']}% | {'YES' if item['passesFrequencyAndRobustness'] else 'NO'} |"
        )
    report.extend([
        "",
        "## PENGU",
        "",
        "| Candidate | Trades | Uplift | Return G1 | Severe G1 | PF | Win rate | 2026H1 | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ])
    for item in result["pengu"]:
        full = item["fullNormalizedGross1"]
        severe = item["fullNormalizedGross1Severe"]
        hold = item["reused2026H1NormalizedGross1"]
        report.append(
            f"| {item['candidate']['candidate_id']} | {full['trades']} | {item['frequencyUpliftPct']}% | "
            f"{full['compoundedReturnPct']}% | {severe['compoundedReturnPct']}% | {full['profitFactor']} | "
            f"{full['winRatePct']}% | {hold['compoundedReturnPct']}% | {'YES' if item['passesFrequencyAndRobustness'] else 'NO'} |"
        )
    report.extend([
        "",
        "## Decision rule",
        "",
        "A higher order count alone is not enough. A candidate must improve frequency and retain Development/Severe/Holdout quality. Candidates that pass only after combining multiple relaxed gates are not promoted.",
    ])
    (state_dir / "v96-frequency-uplift.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
