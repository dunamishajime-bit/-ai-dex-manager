from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_strong_reserved_pengu_v96 as v96
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90
import research_lab_v96_core_volume_floor_validation as floorval
import research_lab_v96_frequency_uplift as freq

core = v69.core
HOUR = v69.HOUR
BUCKET = 12 * HOUR
DEV_END = core.v4.START_2026
BASE = freq.CoreCandidate(
    "V96_PRODUCTION_VOLUME50_TURNOVER075",
    volume_floor=0.50,
    turnover_threshold=0.075,
)
MONTHS = (core.CORE_END - core.CORE_START) / (365.25 / 12.0 * v69.DAY)


@dataclass(frozen=True)
class ExitConfig:
    config_id: str
    shrink: float
    activation_pct: float
    giveback_fraction: float
    trend_break_pct: float


@dataclass(frozen=True)
class TrailConfig:
    config_id: str
    shrink: float
    activation_pct: float
    retention_fraction: float


@dataclass(frozen=True)
class GrossConfig:
    config_id: str
    extra_boost: float
    mom20_min: float
    volume_ratio_min: float
    breadth_min: int = 3
    volume_breadth_min: int = 2
    max_drawdown: float = -0.03


EXIT_CONFIGS = (
    ExitConfig("EXIT25_A15_GB40_TB0", 0.25, 1.5, 0.40, 0.0),
    ExitConfig("EXIT25_A25_GB50_TBN05", 0.25, 2.5, 0.50, -0.5),
    ExitConfig("EXIT50_A15_GB40_TB0", 0.50, 1.5, 0.40, 0.0),
    ExitConfig("EXIT50_A25_GB50_TBN05", 0.50, 2.5, 0.50, -0.5),
)
TRAIL_CONFIGS = (
    TrailConfig("TRAIL25_A3_R60", 0.25, 3.0, 0.60),
    TrailConfig("TRAIL25_A5_R50", 0.25, 5.0, 0.50),
    TrailConfig("TRAIL50_A3_R60", 0.50, 3.0, 0.60),
    TrailConfig("TRAIL50_A5_R50", 0.50, 5.0, 0.50),
)
GROSS_CONFIGS = (
    GrossConfig("GROSS10_M15_V100", 0.10, 15.0, 1.00),
    GrossConfig("GROSS20_M20_V110", 0.20, 20.0, 1.10),
    GrossConfig("GROSS30_M25_V120", 0.30, 25.0, 1.20),
)
FEE_THRESHOLDS = (0.10, 0.125, 0.15)


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    return value


def iso_ms(value: int) -> str:
    return dt.datetime.fromtimestamp(value / 1000, tz=dt.timezone.utc).isoformat()


def build_raw_with_hourly() -> dict:
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    source = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars = {symbol: core.v4.resample_12h(source[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = core.v6.funding_buckets({symbol: source[symbol]["funding"] for symbol in core.v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
    raw = {"bars": bars, "indexes": indexes, "funding": funding, "times": times}
    raw_targets = freq.raw_targets_for(BASE, raw)
    targets, stabilization = v90.stabilize(
        raw_targets,
        times,
        v90.Config(BASE.weight_tolerance, BASE.turnover_threshold, BASE.stale_bars),
    )
    hourly = {
        symbol: {int(row["ts"]): row for row in source[symbol]["candles"]}
        for symbol in core.v4.SYMBOLS
    }
    raw.update({"targets": targets, "stabilization": stabilization, "hourly": hourly, "source": source})
    return raw


def build_profile(targets: Dict[int, Dict[str, float]], raw: dict) -> dict:
    normal_cost = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_cost = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    normal_base = core.core_rows(config, raw["times"], normal_cost, features)
    severe_base = core.core_rows(config, raw["times"], severe_cost, features)
    context = v89.context_for(targets, raw, normal_cost, features)
    normal, normal_diag = v86.controlled_core(normal_base, context, v95.STRONG_CONFIG)
    severe, severe_diag = v86.controlled_core(severe_base, context, v95.STRONG_CONFIG)
    return {
        "normal": normal,
        "severe": severe,
        "targets": targets,
        "context": context,
        "features": features,
        "diagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def active_target(targets: Dict[int, Dict[str, float]], times: List[int], position: int, delay: int) -> Dict[str, float]:
    source = position - 1 - delay
    return dict(targets.get(times[source], {})) if source >= 0 else {}


def scaled_weights(target: Dict[str, float], gross: float) -> Dict[str, float]:
    exposure = sum(abs(float(value)) for value in target.values())
    if exposure <= 1e-12 or gross <= 1e-12:
        return {}
    factor = gross / exposure
    return {symbol: float(weight) * factor for symbol, weight in target.items() if abs(float(weight)) > 1e-12}


def candle(raw: dict, symbol: str, ts: int) -> Optional[dict]:
    return raw["hourly"].get(symbol, {}).get(ts)


def segment_return(raw: dict, symbol: str, start: int, end: int) -> Optional[float]:
    first = candle(raw, symbol, start)
    last = candle(raw, symbol, end - HOUR)
    if first is None or last is None or float(first["open"]) <= 0:
        return None
    return float(last["close"]) / float(first["open"]) - 1.0


def second_half_contributions(raw: dict, weights: Dict[str, float], ts: int) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for symbol, weight in weights.items():
        value = segment_return(raw, symbol, ts + 6 * HOUR, ts + BUCKET)
        if value is not None:
            result[symbol] = float(weight) * value
    return result


def first_half_portfolio_state(raw: dict, weights: Dict[str, float], ts: int) -> dict:
    if not weights:
        return {"mfePct": 0.0, "midPct": 0.0}
    entry = {symbol: candle(raw, symbol, ts) for symbol in weights}
    mfe = 0.0
    mid = 0.0
    for hour in range(6):
        current = 0.0
        favorable = 0.0
        for symbol, weight in weights.items():
            first = entry.get(symbol)
            row = candle(raw, symbol, ts + hour * HOUR)
            if first is None or row is None or float(first["open"]) <= 0:
                continue
            start_price = float(first["open"])
            current += weight * (float(row["close"]) / start_price - 1.0)
            if weight >= 0:
                favorable += weight * (float(row["high"]) / start_price - 1.0)
            else:
                favorable += abs(weight) * (1.0 - float(row["low"]) / start_price)
        mfe = max(mfe, favorable)
        mid = current
    return {"mfePct": mfe * 100.0, "midPct": mid * 100.0}


def build_episode_snapshots(raw: dict, targets: Dict[int, Dict[str, float]], delay: int) -> tuple[dict, list]:
    snapshots: Dict[Tuple[int, str], dict] = {}
    episodes: List[dict] = []
    state: Dict[str, dict] = {}
    times = raw["times"]
    for position, ts in enumerate(times):
        target = active_target(targets, times, position, delay)
        signs = {symbol: 1 if float(weight) > 0 else -1 for symbol, weight in target.items() if abs(float(weight)) > 1e-12}
        for symbol in list(state):
            if symbol not in signs or signs[symbol] != state[symbol]["side"]:
                item = state.pop(symbol)
                exit_row = candle(raw, symbol, ts)
                if exit_row is not None:
                    realized = item["side"] * (float(exit_row["open"]) / item["entryPrice"] - 1.0) * 100.0
                    item.update({"exitTs": ts, "realizedPct": realized, "captureRatio": max(0.0, realized) / item["mfePct"] if item["mfePct"] > 0 else None})
                    episodes.append(item)
        for symbol, side in signs.items():
            if symbol not in state:
                row = candle(raw, symbol, ts)
                if row is None or float(row["open"]) <= 0:
                    continue
                state[symbol] = {
                    "symbol": symbol,
                    "side": side,
                    "entryTs": ts,
                    "entryPrice": float(row["open"]),
                    "mfePct": 0.0,
                    "episodeId": f"{symbol}:{ts}:{side}",
                }
            item = state[symbol]
            current_pct = 0.0
            for hour in range(6):
                row = candle(raw, symbol, ts + hour * HOUR)
                if row is None:
                    continue
                entry_price = item["entryPrice"]
                if side > 0:
                    favorable = (float(row["high"]) / entry_price - 1.0) * 100.0
                    current_pct = (float(row["close"]) / entry_price - 1.0) * 100.0
                else:
                    favorable = (1.0 - float(row["low"]) / entry_price) * 100.0
                    current_pct = (1.0 - float(row["close"]) / entry_price) * 100.0
                item["mfePct"] = max(float(item["mfePct"]), favorable)
            snapshots[(ts, symbol)] = {
                "episodeId": item["episodeId"],
                "mfePct": float(item["mfePct"]),
                "currentPct": current_pct,
            }
            for hour in range(6, 12):
                row = candle(raw, symbol, ts + hour * HOUR)
                if row is None:
                    continue
                entry_price = item["entryPrice"]
                favorable = (
                    (float(row["high"]) / entry_price - 1.0) * 100.0
                    if side > 0
                    else (1.0 - float(row["low"]) / entry_price) * 100.0
                )
                item["mfePct"] = max(float(item["mfePct"]), favorable)
    return snapshots, episodes


def development_capture_audit(episodes: List[dict]) -> dict:
    by_symbol: Dict[str, List[dict]] = {}
    for item in episodes:
        if int(item.get("exitTs", core.CORE_END)) <= DEV_END and float(item.get("mfePct", 0.0)) > 0:
            by_symbol.setdefault(item["symbol"], []).append(item)
    result = {}
    for symbol, items in by_symbol.items():
        winning = [item for item in items if float(item.get("realizedPct", 0.0)) > 0 and item.get("captureRatio") is not None]
        ratios = [float(item["captureRatio"]) for item in winning]
        result[symbol] = {
            "episodes": len(items),
            "winningEpisodes": len(winning),
            "medianCaptureRatio": statistics.median(ratios) if ratios else None,
            "meanMfePct": statistics.fmean(float(item["mfePct"]) for item in items) if items else 0.0,
            "meanRealizedPct": statistics.fmean(float(item.get("realizedPct", 0.0)) for item in items) if items else 0.0,
        }
    eligible = [
        (symbol, item) for symbol, item in result.items()
        if item["winningEpisodes"] >= 8 and item["medianCaptureRatio"] is not None
    ]
    eligible.sort(key=lambda pair: (pair[1]["medianCaptureRatio"], -pair[1]["winningEpisodes"]))
    flagged = [symbol for symbol, item in eligible if float(item["medianCaptureRatio"]) < 0.55]
    if not flagged and eligible:
        flagged = [eligible[0][0]]
    return {"symbols": result, "flaggedSymbols": flagged, "selectionWindowEnd": iso_ms(DEV_END)}


def previous_market_breadth(raw: dict, ts: int, config: GrossConfig) -> dict:
    prev_ts = ts - BUCKET
    positive = volume_positive = 0
    ratios = []
    for symbol in ("ETH", "BNB", "SOL"):
        index = raw["indexes"].get(symbol, {}).get(prev_ts)
        if index is None:
            continue
        rows = raw["bars"][symbol]
        row = rows[index]
        if float(row["close"]) > float(row["open"]):
            positive += 1
        ratio = core.v4.volume_ratio(rows, index)
        if ratio is not None:
            ratios.append(float(ratio))
            if float(ratio) >= config.volume_ratio_min:
                volume_positive += 1
    return {
        "positiveBreadth": positive,
        "volumeBreadth": volume_positive,
        "averageVolumeRatio": statistics.fmean(ratios) if ratios else 0.0,
    }


def modify_rows(
    rows: List[dict],
    targets: Dict[int, Dict[str, float]],
    raw: dict,
    delay: int,
    cost_bps: float,
    exit_config: Optional[ExitConfig] = None,
    trail_config: Optional[TrailConfig] = None,
    gross_config: Optional[GrossConfig] = None,
    flagged_symbols: Iterable[str] = (),
    snapshots: Optional[dict] = None,
) -> tuple[List[dict], dict]:
    result = []
    times = raw["times"]
    flagged = set(flagged_symbols)
    equity = peak = 1.0
    exit_triggers = trail_triggers = gross_buckets = gross_toggles = 0
    previous_gross_active = False
    for position, source_row in enumerate(rows):
        ts = int(source_row["ts"])
        target = active_target(targets, times, position, delay)
        base_gross = float(source_row["gross"])
        value = float(source_row["return"])
        gross = base_gross
        max_gross = float(source_row.get("maxGross", base_gross))
        variant_dd = equity / peak - 1.0

        gross_active = False
        if gross_config is not None and position > 0:
            prior_context = raw.get("context", {}).get(times[position - 1], {})
            feature = prior_context.get("feature", {})
            breadth = previous_market_breadth(raw, ts, gross_config)
            gross_active = bool(
                variant_dd > gross_config.max_drawdown
                and int(prior_context.get("regime", 0)) > 0
                and not bool(source_row.get("whipsawActive", False))
                and int(source_row.get("ddStage", 0)) == 0
                and float(feature.get("mom20", 0.0)) >= gross_config.mom20_min
                and float(feature.get("mom3", 0.0)) > 0.0
                and breadth["positiveBreadth"] >= gross_config.breadth_min
                and breadth["volumeBreadth"] >= gross_config.volume_breadth_min
                and breadth["averageVolumeRatio"] >= gross_config.volume_ratio_min
            )
            if gross_active and gross > 0:
                factor = 1.0 + gross_config.extra_boost
                cap = min(factor, 2.0 / gross)
                value *= cap
                gross *= cap
                max_gross *= cap
                gross_buckets += 1
        if gross_active != previous_gross_active:
            gross_toggles += 1
        previous_gross_active = gross_active

        weights = scaled_weights(target, gross)
        reductions: Dict[str, float] = {symbol: 0.0 for symbol in weights}
        if exit_config is not None and weights:
            state = first_half_portfolio_state(raw, weights, ts)
            mfe = float(state["mfePct"])
            midpoint = float(state["midPct"])
            giveback = mfe > 0 and midpoint <= mfe * (1.0 - exit_config.giveback_fraction)
            trend_break = midpoint <= exit_config.trend_break_pct
            if mfe >= exit_config.activation_pct and (giveback or trend_break):
                reductions = {symbol: exit_config.shrink for symbol in weights}
                exit_triggers += 1

        if trail_config is not None and snapshots is not None:
            any_trail = False
            for symbol in weights:
                if symbol not in flagged:
                    continue
                snap = snapshots.get((ts, symbol))
                if not snap:
                    continue
                mfe = float(snap.get("mfePct", 0.0))
                current = float(snap.get("currentPct", 0.0))
                if mfe >= trail_config.activation_pct and current <= mfe * trail_config.retention_fraction:
                    existing = reductions.get(symbol, 0.0)
                    reductions[symbol] = 1.0 - (1.0 - existing) * (1.0 - trail_config.shrink)
                    any_trail = True
            if any_trail:
                trail_triggers += 1

        if any(reduction > 0 for reduction in reductions.values()):
            contributions = second_half_contributions(raw, weights, ts)
            reduced_notional = 0.0
            for symbol, reduction in reductions.items():
                value -= reduction * float(contributions.get(symbol, 0.0))
                reduced_notional += abs(float(weights.get(symbol, 0.0))) * reduction
            value -= 2.0 * reduced_notional * cost_bps / 10_000.0
            gross = max(0.0, gross - 0.5 * reduced_notional)

        result.append({
            **source_row,
            "return": value,
            "gross": gross,
            "maxGross": max_gross,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    extra_orders = 2 * (exit_triggers + trail_triggers) + gross_toggles
    return result, {
        "exitTriggers": exit_triggers,
        "trailTriggers": trail_triggers,
        "grossBoostBuckets": gross_buckets,
        "grossToggleOrders": gross_toggles,
        "extraOrderEvents": extra_orders,
    }


def episode_win_rate(rows: List[dict], targets: Dict[int, Dict[str, float]], times: List[int], delay: int, start: int, end: int) -> dict:
    episodes: List[float] = []
    active_signature = None
    value = 1.0
    for position, row in enumerate(rows):
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        target = active_target(targets, times, position, delay)
        signature = tuple(sorted((symbol, 1 if weight > 0 else -1) for symbol, weight in target.items() if abs(weight) > 1e-12))
        if active_signature is None:
            active_signature = signature
        elif signature != active_signature:
            if active_signature:
                episodes.append(value - 1.0)
            value = 1.0
            active_signature = signature
        if signature:
            value *= max(0.001, 1.0 + float(row["return"]))
    if active_signature:
        episodes.append(value - 1.0)
    return {
        "episodes": len(episodes),
        "winRatePct": sum(item > 0 for item in episodes) / len(episodes) * 100.0 if episodes else None,
        "profitFactor": (
            sum(item for item in episodes if item > 0) / abs(sum(item for item in episodes if item < 0))
            if any(item < 0 for item in episodes)
            else 999.0 if any(item > 0 for item in episodes) else None
        ),
    }


def positive_bucket_rate(rows: List[dict], start: int, end: int) -> float | None:
    active = [float(row["return"]) for row in rows if start <= int(row["ts"]) < end and float(row.get("gross", 0.0)) > 0]
    return sum(value > 0 for value in active) / len(active) * 100.0 if active else None


def evaluate_core_rows(rows: List[dict], targets: Dict[int, Dict[str, float]], raw: dict, delay: int, base_orders: int, extra_orders: int) -> dict:
    full = v69.metrics(rows, core.CORE_START, core.CORE_END)
    return {
        "full": full,
        "development": v69.metrics(rows, core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(rows, DEV_END, core.CORE_END),
        "episodeQuality": episode_win_rate(rows, targets, raw["times"], delay, core.CORE_START, core.CORE_END),
        "positiveActiveBucketRatePct": positive_bucket_rate(rows, core.CORE_START, core.CORE_END),
        "orderEvents": base_orders + extra_orders,
        "monthlyOrderEvents": (base_orders + extra_orders) / MONTHS,
    }


def combine_rows(profile: dict, pengu_rows: List[dict]) -> dict:
    trades = v69.scale_trades(v96.TARGET_V67_GROSS)
    main = v96.v68.v67_series(pengu_rows, trades)
    no_best = v96.v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month = v96.v68.v67_series(pengu_rows, v69.remove_best_month(trades))
    normal, cap_normal = v96.reserved_combine(profile["normal"], main, "base")
    severe, cap_severe = v96.reserved_combine(profile["severe"], main, "severe")
    excluded, _ = v96.reserved_combine(profile["normal"], main, "excludedBase")
    excluded_severe, _ = v96.reserved_combine(profile["severe"], main, "excludedSevere")
    remove_best, _ = v96.reserved_combine(profile["normal"], no_best, "base")
    remove_best_severe, _ = v96.reserved_combine(profile["severe"], no_best, "severe")
    remove_month, _ = v96.reserved_combine(profile["normal"], no_month, "base")
    remove_month_severe, _ = v96.reserved_combine(profile["severe"], no_month, "severe")
    return {
        "normalRows": normal,
        "severeRows": severe,
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "development": v69.metrics(normal, core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(severe, core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(normal, DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, DEV_END, core.CORE_END),
        "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
        "removeBestPenguTradeSevere": v69.metrics(remove_best_severe, core.CORE_START, core.CORE_END),
        "removeBestPenguMonthSevere": v69.metrics(remove_month_severe, core.CORE_START, core.CORE_END),
        "removeBestPortfolioMonthSevere": v69.metrics(floorval.remove_best_month(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "removeBestPortfolioBucketSevere": v69.metrics(floorval.remove_best_bucket(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "capDiagnostics": {"normal": cap_normal, "severe": cap_severe},
    }


def family_pass(candidate: dict, baseline: dict) -> bool:
    dev = candidate["combined"]["development"]
    dev_severe = candidate["combined"]["developmentSevere"]
    base_dev = baseline["combined"]["development"]
    base_severe = baseline["combined"]["developmentSevere"]
    return bool(
        dev["compoundedReturnPct"] > base_dev["compoundedReturnPct"]
        and dev_severe["compoundedReturnPct"] >= base_severe["compoundedReturnPct"] - 5.0
        and dev["maxDrawdownPct"] >= base_dev["maxDrawdownPct"] - 2.0
        and dev_severe["maxDrawdownPct"] >= base_severe["maxDrawdownPct"] - 2.0
    )


def fee_pass(candidate: dict, baseline: dict) -> bool:
    dev = candidate["combined"]["development"]
    severe = candidate["combined"]["developmentSevere"]
    base_dev = baseline["combined"]["development"]
    base_severe = baseline["combined"]["developmentSevere"]
    return bool(
        dev["compoundedReturnPct"] >= base_dev["compoundedReturnPct"] * 0.98
        and severe["compoundedReturnPct"] >= base_severe["compoundedReturnPct"]
        and candidate["orders"]["orderEvents"] < baseline["orders"]["orderEvents"]
    )


def compact_combined(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.endswith("Rows")}


def candidate_payload(config, profile: dict, targets: Dict[int, Dict[str, float]], raw: dict, base_orders: int, diagnostics: dict, pengu_rows: List[dict]) -> dict:
    combined = combine_rows(profile, pengu_rows)
    orders = {
        "baseOrderEvents": base_orders,
        "extraOrderEvents": int(diagnostics.get("extraOrderEvents", 0)),
        "orderEvents": base_orders + int(diagnostics.get("extraOrderEvents", 0)),
        "monthlyOrderEvents": (base_orders + int(diagnostics.get("extraOrderEvents", 0))) / MONTHS,
    }
    return {
        "config": asdict(config) if hasattr(config, "__dataclass_fields__") else config,
        "core": {
            "normal": evaluate_core_rows(profile["normal"], targets, raw, 0, base_orders, int(diagnostics.get("extraOrderEvents", 0))),
            "severe": evaluate_core_rows(profile["severe"], targets, raw, 1, base_orders, int(diagnostics.get("extraOrderEvents", 0))),
        },
        "combined": compact_combined(combined),
        "orders": orders,
        "diagnostics": diagnostics,
    }


def pengu_mfe_audit(pengu_rows: List[dict]) -> dict:
    rows_by_ts = {int(row["ts"]): row for row in pengu_rows}
    details = []
    for trade in v69.scale_trades(v96.TARGET_V67_GROSS):
        entry = float(trade["entry_price"])
        side = int(trade["side"])
        mfe = 0.0
        ts = int(trade["entry_ts"])
        while ts < int(trade["exit_ts"]):
            row = rows_by_ts.get(ts)
            if row:
                if side > 0:
                    mfe = max(mfe, (float(row["high"]) / entry - 1.0) * 100.0)
                else:
                    mfe = max(mfe, (1.0 - float(row["low"]) / entry) * 100.0)
            ts += HOUR
        realized_price = side * (float(trade["exit_price"]) / entry - 1.0) * 100.0
        details.append({
            "side": side,
            "mode": trade.get("mode"),
            "entryTs": int(trade["entry_ts"]),
            "mfePricePct": mfe,
            "realizedPricePct": realized_price,
            "captureRatio": max(0.0, realized_price) / mfe if mfe > 0 else None,
            "basePortfolioPct": float(trade["base_pct"]),
            "severePortfolioPct": float(trade["severe_pct"]),
        })
    ratios = [float(item["captureRatio"]) for item in details if item["captureRatio"] is not None and item["realizedPricePct"] > 0]
    return {
        "tradeCount": len(details),
        "medianWinningCaptureRatio": statistics.median(ratios) if ratios else None,
        "meanWinningCaptureRatio": statistics.fmean(ratios) if ratios else None,
        "details": details,
        "decision": "DIAGNOSTIC_ONLY_FIXED_HISTORICAL_SEQUENCE_NO_PENGU_PROMOTION",
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = build_raw_with_hourly()
    base_profile = build_profile(raw["targets"], raw)
    raw["context"] = base_profile["context"]
    base_frequency = freq.count_core_frequency(raw["targets"], raw["times"], raw["stabilization"])

    trade_rows = v69.scale_trades(v96.TARGET_V67_GROSS)
    trade_start = min(int(trade["entry_ts"]) for trade in trade_rows)
    trade_end = max(int(trade["exit_ts"]) for trade in trade_rows)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * v69.DAY, trade_end + v69.HOUR)

    normal_snapshots, episodes = build_episode_snapshots(raw, raw["targets"], 0)
    severe_snapshots, _ = build_episode_snapshots(raw, raw["targets"], 1)
    capture_audit = development_capture_audit(episodes)

    baseline = candidate_payload(
        {"config_id": "CURRENT_V96"},
        base_profile,
        raw["targets"],
        raw,
        base_frequency["orderEvents"],
        {"extraOrderEvents": 0},
        pengu_rows,
    )

    exit_candidates = []
    for config in EXIT_CONFIGS:
        normal, normal_diag = modify_rows(base_profile["normal"], raw["targets"], raw, 0, 10, exit_config=config)
        severe, severe_diag = modify_rows(base_profile["severe"], raw["targets"], raw, 1, 50, exit_config=config)
        diagnostics = {"normal": normal_diag, "severe": severe_diag, "extraOrderEvents": normal_diag["extraOrderEvents"]}
        item = candidate_payload(config, {"normal": normal, "severe": severe}, raw["targets"], raw, base_frequency["orderEvents"], diagnostics, pengu_rows)
        item["developmentPass"] = family_pass(item, baseline)
        exit_candidates.append(item)

    trail_candidates = []
    for config in TRAIL_CONFIGS:
        normal, normal_diag = modify_rows(
            base_profile["normal"], raw["targets"], raw, 0, 10,
            trail_config=config, flagged_symbols=capture_audit["flaggedSymbols"], snapshots=normal_snapshots,
        )
        severe, severe_diag = modify_rows(
            base_profile["severe"], raw["targets"], raw, 1, 50,
            trail_config=config, flagged_symbols=capture_audit["flaggedSymbols"], snapshots=severe_snapshots,
        )
        diagnostics = {"normal": normal_diag, "severe": severe_diag, "extraOrderEvents": normal_diag["extraOrderEvents"]}
        item = candidate_payload(config, {"normal": normal, "severe": severe}, raw["targets"], raw, base_frequency["orderEvents"], diagnostics, pengu_rows)
        item["developmentPass"] = family_pass(item, baseline)
        trail_candidates.append(item)

    gross_candidates = []
    for config in GROSS_CONFIGS:
        normal, normal_diag = modify_rows(base_profile["normal"], raw["targets"], raw, 0, 10, gross_config=config)
        severe, severe_diag = modify_rows(base_profile["severe"], raw["targets"], raw, 1, 50, gross_config=config)
        diagnostics = {"normal": normal_diag, "severe": severe_diag, "extraOrderEvents": normal_diag["extraOrderEvents"]}
        item = candidate_payload(config, {"normal": normal, "severe": severe}, raw["targets"], raw, base_frequency["orderEvents"], diagnostics, pengu_rows)
        item["developmentPass"] = family_pass(item, baseline)
        gross_candidates.append(item)

    fee_candidates = []
    for threshold in FEE_THRESHOLDS:
        raw_targets = freq.raw_targets_for(BASE, raw)
        targets, stabilization = v90.stabilize(raw_targets, raw["times"], v90.Config(0.05, threshold, 12))
        profile = build_profile(targets, raw)
        frequency = freq.count_core_frequency(targets, raw["times"], stabilization)
        item = candidate_payload(
            {"config_id": f"FEE_TURNOVER_{threshold}", "turnoverThreshold": threshold},
            profile,
            targets,
            raw,
            frequency["orderEvents"],
            {"extraOrderEvents": 0, "stabilization": stabilization},
            pengu_rows,
        )
        item["developmentPass"] = fee_pass(item, baseline)
        item["profile"] = profile
        item["targets"] = targets
        item["frequency"] = frequency
        fee_candidates.append(item)

    def select(items: List[dict], fee: bool = False) -> Optional[dict]:
        passed = [item for item in items if item.get("developmentPass")]
        if not passed:
            return None
        if fee:
            passed.sort(key=lambda item: (
                item["combined"]["developmentSevere"]["compoundedReturnPct"],
                item["combined"]["development"]["compoundedReturnPct"],
                -item["orders"]["orderEvents"],
            ), reverse=True)
        else:
            passed.sort(key=lambda item: (
                item["combined"]["development"]["compoundedReturnPct"],
                item["combined"]["developmentSevere"]["compoundedReturnPct"],
                item["combined"]["development"]["maxDrawdownPct"],
            ), reverse=True)
        return passed[0]

    selected_exit = select(exit_candidates)
    selected_trail = select(trail_candidates)
    selected_gross = select(gross_candidates)
    selected_fee = select(fee_candidates, fee=True)

    combo_base_profile = selected_fee["profile"] if selected_fee else base_profile
    combo_targets = selected_fee["targets"] if selected_fee else raw["targets"]
    combo_frequency = selected_fee["frequency"] if selected_fee else base_frequency
    raw["context"] = combo_base_profile["context"]
    combo_normal_snapshots, combo_episodes = build_episode_snapshots(raw, combo_targets, 0)
    combo_severe_snapshots, _ = build_episode_snapshots(raw, combo_targets, 1)
    combo_audit = development_capture_audit(combo_episodes)
    exit_config = ExitConfig(**selected_exit["config"]) if selected_exit else None
    trail_config = TrailConfig(**selected_trail["config"]) if selected_trail else None
    gross_config = GrossConfig(**selected_gross["config"]) if selected_gross else None
    normal, normal_diag = modify_rows(
        combo_base_profile["normal"], combo_targets, raw, 0, 10,
        exit_config=exit_config,
        trail_config=trail_config,
        gross_config=gross_config,
        flagged_symbols=combo_audit["flaggedSymbols"],
        snapshots=combo_normal_snapshots,
    )
    severe, severe_diag = modify_rows(
        combo_base_profile["severe"], combo_targets, raw, 1, 50,
        exit_config=exit_config,
        trail_config=trail_config,
        gross_config=gross_config,
        flagged_symbols=combo_audit["flaggedSymbols"],
        snapshots=combo_severe_snapshots,
    )
    combo_diag = {"normal": normal_diag, "severe": severe_diag, "extraOrderEvents": normal_diag["extraOrderEvents"]}
    combo = candidate_payload(
        {
            "config_id": "SELECTED_COMBINATION",
            "fee": selected_fee["config"] if selected_fee else None,
            "exit": selected_exit["config"] if selected_exit else None,
            "trail": selected_trail["config"] if selected_trail else None,
            "gross": selected_gross["config"] if selected_gross else None,
        },
        {"normal": normal, "severe": severe},
        combo_targets,
        raw,
        combo_frequency["orderEvents"],
        combo_diag,
        pengu_rows,
    )

    winner_pool = [baseline, combo]
    winner_pool += [item for item in (selected_exit, selected_trail, selected_gross, selected_fee) if item]
    winner_pool.sort(key=lambda item: (
        item["combined"]["reused2026H1"]["compoundedReturnPct"],
        item["combined"]["reused2026H1Severe"]["compoundedReturnPct"],
        item["combined"]["full"]["compoundedReturnPct"],
    ), reverse=True)
    observed_leader = winner_pool[0]

    status = "V96_PROFIT_EXTENSION_CANDIDATE_FOUND" if observed_leader is not baseline else "NO_ROBUST_V96_PROFIT_EXTENSION"
    payload = rounded({
        "version": 1,
        "strategyId": "DISDEX_V96_12H_ENTRY_6H_EXIT_PROFIT_CAPTURE_GROSS_FEE_BT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "period": {"startInclusive": iso_ms(core.CORE_START), "developmentEnd": iso_ms(DEV_END), "endExclusive": iso_ms(core.CORE_END)},
        "method": {
            "entryChronology": "Unchanged completed 12h V96 target chronology",
            "sixHourUse": "Exit-only completed first-half diagnostic; no reversal and no new 6h entry",
            "exitCost": "Conservative two-way cost for midpoint shrink and next 12h reset",
            "selection": "Each family selected on 2023-2025 Development only; 2026H1 reported once as reused chronological evidence",
            "normalTurnoverBps": 10,
            "severeTurnoverBps": 50,
        },
        "baseline": baseline,
        "captureAudit": capture_audit,
        "families": {
            "sixHourExitOnly": {"selected": selected_exit, "candidates": exit_candidates},
            "profitCaptureTrailing": {"selected": selected_trail, "candidates": trail_candidates},
            "strongMarketGross": {"selected": selected_gross, "candidates": gross_candidates},
            "feeFilter": {"selected": {key: value for key, value in selected_fee.items() if key not in ("profile", "targets")} if selected_fee else None,
                          "candidates": [{key: value for key, value in item.items() if key not in ("profile", "targets")} for item in fee_candidates]},
        },
        "combination": combo,
        "observedLeader": {
            "config": observed_leader["config"],
            "combined": observed_leader["combined"],
            "orders": observed_leader["orders"],
        },
        "penguIndependentAudit": pengu_mfe_audit(pengu_rows),
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "The 6h exit and trailing variants are causal half-bucket execution proxies anchored to the exact current 12h V96 return rows.",
            "2026H1 has already been observed in prior research and is not a pristine Holdout.",
            "PENGU uses a fixed historical V67 trade sequence; the MFE audit is diagnostic only and cannot authorize a new PENGU rule.",
            "Episode win rate is based on Core target-signature episodes; portfolio PF remains monthly Profit Factor to match the existing V96 metric.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-profit-capture-bt.json"
    md_path = state_dir / "v96-profit-capture-bt.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def line(name: str, item: Optional[dict]) -> str:
        if not item:
            return f"| {name} | no Development pass | - | - | - | - | - | - |"
        c = item["combined"]
        return (
            f"| {name} | {c['full']['compoundedReturnPct']}% | {c['full']['monthlyProfitFactor']} | "
            f"{c['full']['maxDrawdownPct']}% | {c['fullSevere']['compoundedReturnPct']}% | "
            f"{c['fullSevere']['maxDrawdownPct']}% | {c['reused2026H1']['compoundedReturnPct']}% | "
            f"{item['orders']['monthlyOrderEvents']} |"
        )

    report = [
        "# V96 12h Entry / 6h Exit Profit Extension Backtest",
        "",
        f"- Status: **{status}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
        f"- Development-only flagged trailing symbols: `{', '.join(capture_audit['flaggedSymbols']) or 'NONE'}`",
        "",
        "| Variant | Full return | PF | Max DD | Severe return | Severe DD | 2026H1 | Monthly orders |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        line("Current V96", baseline),
        line("6h exit-only selected", selected_exit),
        line("Profit trailing selected", selected_trail),
        line("Strong-market Gross selected", selected_gross),
        line("Fee filter selected", selected_fee),
        line("Selected combination", combo),
        "",
        f"- Observed chronological leader: `{observed_leader['config']}`",
        f"- PENGU audit decision: `{payload['penguIndependentAudit']['decision']}`",
        "",
        "## Interpretation rule",
        "",
        "A variant is a research lead only. It must not modify Production because every family and 2026H1 are known-history evidence, and the PENGU sequence is fixed historical data.",
    ]
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
