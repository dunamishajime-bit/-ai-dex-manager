from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_v96_profit_capture_bt as pc

core = pc.core
v69 = pc.v69
HOUR = pc.HOUR
START_2025 = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
START_2026 = pc.DEV_END
MONTHS = pc.MONTHS
ALT_SYMBOLS = ("ETH", "BNB", "SOL")


@dataclass(frozen=True)
class FallbackConfig:
    config_id: str
    family: str
    gross: float
    hold_bars: int
    btc_sma_bars: int = 80
    alt_sma_bars: int = 44
    momentum_bars: int = 20
    momentum_min_pct: float = 0.0
    breadth_min: int = 2
    volume_ratio_min: float = 0.70
    rsi_min: float = 30.0
    rsi_max: float = 70.0
    pullback_min_pct: float = -8.0
    pullback_max_pct: float = -0.5
    breakout_lookback: int = 20
    breakdown_lookback: int = 20


PULLBACK_CONFIGS = (
    FallbackConfig("PB25_H2_M3_R55_V065", "PULLBACK_LONG", 0.25, 2, momentum_min_pct=3.0, volume_ratio_min=0.65, rsi_min=35.0, rsi_max=55.0, pullback_max_pct=-0.5),
    FallbackConfig("PB30_H2_M5_R58_V070", "PULLBACK_LONG", 0.30, 2, momentum_min_pct=5.0, volume_ratio_min=0.70, rsi_min=35.0, rsi_max=58.0, pullback_max_pct=-0.8),
    FallbackConfig("PB35_H2_M8_R55_V075", "PULLBACK_LONG", 0.35, 2, momentum_min_pct=8.0, volume_ratio_min=0.75, rsi_min=38.0, rsi_max=55.0, pullback_max_pct=-1.0),
    FallbackConfig("PB25_H4_M5_R60_V060", "PULLBACK_LONG", 0.25, 4, momentum_min_pct=5.0, volume_ratio_min=0.60, rsi_min=35.0, rsi_max=60.0, pullback_max_pct=-0.5),
    FallbackConfig("PB30_H4_M8_R58_V070", "PULLBACK_LONG", 0.30, 4, momentum_min_pct=8.0, volume_ratio_min=0.70, rsi_min=38.0, rsi_max=58.0, pullback_max_pct=-1.0),
    FallbackConfig("PB35_H3_M10_R55_V080", "PULLBACK_LONG", 0.35, 3, momentum_min_pct=10.0, volume_ratio_min=0.80, rsi_min=40.0, rsi_max=55.0, pullback_max_pct=-1.2),
)

BREAKOUT_CONFIGS = (
    FallbackConfig("BO25_H2_L20_M3_V100", "BREAKOUT_LONG", 0.25, 2, momentum_min_pct=3.0, volume_ratio_min=1.00, rsi_min=45.0, rsi_max=75.0, breakout_lookback=20),
    FallbackConfig("BO30_H2_L20_M5_V110", "BREAKOUT_LONG", 0.30, 2, momentum_min_pct=5.0, volume_ratio_min=1.10, rsi_min=45.0, rsi_max=74.0, breakout_lookback=20),
    FallbackConfig("BO35_H2_L40_M8_V120", "BREAKOUT_LONG", 0.35, 2, momentum_min_pct=8.0, volume_ratio_min=1.20, rsi_min=48.0, rsi_max=72.0, breakout_lookback=40),
    FallbackConfig("BO25_H4_L20_M5_V100", "BREAKOUT_LONG", 0.25, 4, momentum_min_pct=5.0, volume_ratio_min=1.00, rsi_min=45.0, rsi_max=75.0, breakout_lookback=20),
    FallbackConfig("BO30_H4_L40_M8_V110", "BREAKOUT_LONG", 0.30, 4, momentum_min_pct=8.0, volume_ratio_min=1.10, rsi_min=48.0, rsi_max=73.0, breakout_lookback=40),
    FallbackConfig("BO35_H3_L30_M10_V125", "BREAKOUT_LONG", 0.35, 3, momentum_min_pct=10.0, volume_ratio_min=1.25, rsi_min=50.0, rsi_max=72.0, breakout_lookback=30),
)

BEAR_CONFIGS = (
    FallbackConfig("BS20_H2_L10_M0_V080", "BEAR_ALT_SHORT", 0.20, 2, momentum_min_pct=0.0, volume_ratio_min=0.80, rsi_min=25.0, rsi_max=55.0, breakdown_lookback=10),
    FallbackConfig("BS25_H2_L20_M0_V100", "BEAR_ALT_SHORT", 0.25, 2, momentum_min_pct=0.0, volume_ratio_min=1.00, rsi_min=25.0, rsi_max=52.0, breakdown_lookback=20),
    FallbackConfig("BS30_H2_L20_M3_V110", "BEAR_ALT_SHORT", 0.30, 2, momentum_min_pct=3.0, volume_ratio_min=1.10, rsi_min=25.0, rsi_max=50.0, breakdown_lookback=20),
    FallbackConfig("BS20_H4_L10_M0_V075", "BEAR_ALT_SHORT", 0.20, 4, momentum_min_pct=0.0, volume_ratio_min=0.75, rsi_min=22.0, rsi_max=55.0, breakdown_lookback=10),
    FallbackConfig("BS25_H4_L20_M3_V090", "BEAR_ALT_SHORT", 0.25, 4, momentum_min_pct=3.0, volume_ratio_min=0.90, rsi_min=25.0, rsi_max=52.0, breakdown_lookback=20),
    FallbackConfig("BS30_H3_L30_M5_V110", "BEAR_ALT_SHORT", 0.30, 3, momentum_min_pct=5.0, volume_ratio_min=1.10, rsi_min=25.0, rsi_max=48.0, breakdown_lookback=30),
)

FAMILIES = {
    "pullbackLong": PULLBACK_CONFIGS,
    "breakoutLong": BREAKOUT_CONFIGS,
    "bearAltShort": BEAR_CONFIGS,
}


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


def sma(rows: List[dict], index: int, bars: int) -> Optional[float]:
    if bars <= 0 or index + 1 < bars:
        return None
    return statistics.fmean(float(row["close"]) for row in rows[index - bars + 1:index + 1])


def momentum_pct(rows: List[dict], index: int, bars: int) -> Optional[float]:
    if bars <= 0 or index < bars:
        return None
    first = float(rows[index - bars]["close"])
    return (float(rows[index]["close"]) / first - 1.0) * 100.0 if first > 0 else None


def rsi(rows: List[dict], index: int, bars: int = 14) -> Optional[float]:
    if index < bars:
        return None
    gains: List[float] = []
    losses: List[float] = []
    for position in range(index - bars + 1, index + 1):
        change = float(rows[position]["close"]) - float(rows[position - 1]["close"])
        gains.append(max(0.0, change))
        losses.append(max(0.0, -change))
    average_gain = statistics.fmean(gains)
    average_loss = statistics.fmean(losses)
    if average_loss <= 1e-12:
        return 100.0 if average_gain > 0 else 50.0
    rs = average_gain / average_loss
    return 100.0 - 100.0 / (1.0 + rs)


def bar_return_pct(row: dict) -> float:
    opening = float(row["open"])
    return (float(row["close"]) / opening - 1.0) * 100.0 if opening > 0 else 0.0


def prior_high(rows: List[dict], index: int, lookback: int) -> Optional[float]:
    if index < lookback:
        return None
    return max(float(row["high"]) for row in rows[index - lookback:index])


def prior_low(rows: List[dict], index: int, lookback: int) -> Optional[float]:
    if index < lookback:
        return None
    return min(float(row["low"]) for row in rows[index - lookback:index])


def feature(raw: dict, symbol: str, ts: int, config: FallbackConfig) -> Optional[dict]:
    index = raw["indexes"].get(symbol, {}).get(ts)
    if index is None:
        return None
    rows = raw["bars"][symbol]
    average = sma(rows, index, config.alt_sma_bars if symbol != "BTC" else config.btc_sma_bars)
    momentum = momentum_pct(rows, index, config.momentum_bars)
    strength = rsi(rows, index)
    volume = core.v4.volume_ratio(rows, index)
    if average is None or momentum is None or strength is None or volume is None:
        return None
    return {
        "index": index,
        "rows": rows,
        "close": float(rows[index]["close"]),
        "sma": float(average),
        "momentumPct": float(momentum),
        "rsi": float(strength),
        "volumeRatio": float(volume),
        "barReturnPct": bar_return_pct(rows[index]),
    }


def signal_at(config: FallbackConfig, raw: dict, ts: int) -> Optional[dict]:
    btc = feature(raw, "BTC", ts, config)
    if btc is None:
        return None
    alt = {symbol: feature(raw, symbol, ts, config) for symbol in ALT_SYMBOLS}
    alt = {symbol: item for symbol, item in alt.items() if item is not None}
    if len(alt) < config.breadth_min:
        return None

    if config.family in ("PULLBACK_LONG", "BREAKOUT_LONG"):
        if not (btc["close"] > btc["sma"] and btc["momentumPct"] > 0.0):
            return None
        trend = {
            symbol: item for symbol, item in alt.items()
            if item["close"] > item["sma"] and item["momentumPct"] >= config.momentum_min_pct
        }
        if len(trend) < config.breadth_min:
            return None
        candidates: List[Tuple[str, float]] = []
        for symbol, item in trend.items():
            if not (config.rsi_min <= item["rsi"] <= config.rsi_max):
                continue
            if item["volumeRatio"] < config.volume_ratio_min:
                continue
            if config.family == "PULLBACK_LONG":
                if not (config.pullback_min_pct <= item["barReturnPct"] <= config.pullback_max_pct):
                    continue
                score = item["momentumPct"] - abs(item["barReturnPct"]) * 0.20 + min(2.0, item["volumeRatio"])
            else:
                level = prior_high(item["rows"], item["index"], config.breakout_lookback)
                if level is None or item["close"] <= level:
                    continue
                breakout_pct = (item["close"] / level - 1.0) * 100.0
                score = item["momentumPct"] + breakout_pct * 2.0 + min(2.0, item["volumeRatio"])
            candidates.append((symbol, score))
        if not candidates:
            return None
        symbol, score = max(candidates, key=lambda pair: pair[1])
        return {"symbol": symbol, "side": 1, "score": score}

    if config.family == "BEAR_ALT_SHORT":
        if not (btc["close"] < btc["sma"] and btc["momentumPct"] < 0.0):
            return None
        down = {
            symbol: item for symbol, item in alt.items()
            if item["close"] < item["sma"] and item["momentumPct"] <= -config.momentum_min_pct
        }
        if len(down) < config.breadth_min:
            return None
        candidates = []
        for symbol, item in down.items():
            if not (config.rsi_min <= item["rsi"] <= config.rsi_max):
                continue
            if item["volumeRatio"] < config.volume_ratio_min:
                continue
            level = prior_low(item["rows"], item["index"], config.breakdown_lookback)
            if level is None or item["close"] >= level:
                continue
            breakdown_pct = (1.0 - item["close"] / level) * 100.0
            score = -item["momentumPct"] + breakdown_pct * 2.0 + min(2.0, item["volumeRatio"])
            candidates.append((symbol, score))
        if not candidates:
            return None
        symbol, score = max(candidates, key=lambda pair: pair[1])
        return {"symbol": symbol, "side": -1, "score": score}
    raise ValueError(f"Unsupported fallback family: {config.family}")


def build_fallback_targets(config: FallbackConfig, raw: dict, base_targets: Dict[int, Dict[str, float]]) -> tuple[Dict[int, Dict[str, float]], dict]:
    targets: Dict[int, Dict[str, float]] = {}
    pending: Optional[dict] = None
    active: Optional[dict] = None
    remaining = 0
    generated_signals = entries = suppressed_by_primary = 0
    by_symbol = {symbol: 0 for symbol in ALT_SYMBOLS}
    for ts in raw["times"]:
        primary_active = bool(base_targets.get(ts, {}))
        if primary_active:
            if active is not None or pending is not None:
                suppressed_by_primary += 1
            targets[ts] = {}
            active = None
            remaining = 0
        else:
            if active is None and pending is not None:
                active = pending
                remaining = config.hold_bars
                entries += 1
                by_symbol[active["symbol"]] += 1
            if active is not None and remaining > 0:
                targets[ts] = {active["symbol"]: active["side"] * config.gross}
                remaining -= 1
                if remaining == 0:
                    active = None
            else:
                targets[ts] = {}
        pending = signal_at(config, raw, ts)
        if pending is not None:
            generated_signals += 1
    return targets, {
        "generatedSignals": generated_signals,
        "entries": entries,
        "suppressedByPrimary": suppressed_by_primary,
        "entriesBySymbol": by_symbol,
        "activeBuckets": sum(bool(targets.get(ts, {})) for ts in raw["times"]),
    }


def combine_targets(base_targets: Dict[int, Dict[str, float]], fallback_targets: Dict[int, Dict[str, float]], times: List[int]) -> Dict[int, Dict[str, float]]:
    return {ts: dict(base_targets.get(ts, {})) if base_targets.get(ts, {}) else dict(fallback_targets.get(ts, {})) for ts in times}


def target_signature(target: Dict[str, float]) -> tuple:
    return tuple(sorted((symbol, round(float(weight), 8)) for symbol, weight in target.items() if abs(float(weight)) > 1e-12))


def target_frequency(targets: Dict[int, Dict[str, float]], times: List[int]) -> dict:
    previous: Dict[str, float] = {}
    changes = episode_starts = active_buckets = 0
    for ts in times:
        current = targets.get(ts, {})
        if current:
            active_buckets += 1
        if not previous and current:
            episode_starts += 1
        if target_signature(current) != target_signature(previous):
            changes += 1
        previous = current
    return {"orderEventsProxy": changes, "episodeStarts": episode_starts, "activeBuckets": active_buckets}


def compact_combined(combined: dict) -> dict:
    return {key: value for key, value in combined.items() if not key.endswith("Rows")}


def combined_windows(profile: dict, pengu_rows: List[dict]) -> tuple[dict, dict]:
    combined = pc.combine_rows(profile, pengu_rows)
    normal_rows = combined["normalRows"]
    severe_rows = combined["severeRows"]
    windows = {
        "discovery2023_2024": {
            "normal": v69.metrics(normal_rows, core.CORE_START, START_2025),
            "severe": v69.metrics(severe_rows, core.CORE_START, START_2025),
        },
        "validation2025": {
            "normal": v69.metrics(normal_rows, START_2025, START_2026),
            "severe": v69.metrics(severe_rows, START_2025, START_2026),
        },
        "reused2026H1": {
            "normal": v69.metrics(normal_rows, START_2026, core.CORE_END),
            "severe": v69.metrics(severe_rows, START_2026, core.CORE_END),
        },
        "full": {"normal": combined["full"], "severe": combined["fullSevere"]},
    }
    return compact_combined(combined), windows


def uplift(candidate: dict, baseline: dict) -> dict:
    result = {}
    for window in ("discovery2023_2024", "validation2025", "reused2026H1", "full"):
        result[window] = {}
        for mode in ("normal", "severe"):
            current = candidate[window][mode]
            base = baseline[window][mode]
            result[window][mode] = {
                "returnPctPoints": float(current["compoundedReturnPct"]) - float(base["compoundedReturnPct"]),
                "maxDrawdownPctPoints": float(current["maxDrawdownPct"]) - float(base["maxDrawdownPct"]),
                "monthlyProfitFactorDelta": float(current["monthlyProfitFactor"]) - float(base["monthlyProfitFactor"]),
            }
    return result


def candidate_discovery_pass(item: dict) -> bool:
    discovery = item["uplift"]["discovery2023_2024"]
    return bool(
        item["fallbackDiagnostics"]["entries"] >= 10
        and discovery["normal"]["returnPctPoints"] > 0.0
        and discovery["severe"]["returnPctPoints"] >= -5.0
        and discovery["normal"]["maxDrawdownPctPoints"] >= -2.0
        and discovery["severe"]["maxDrawdownPctPoints"] >= -2.0
    )


def candidate_validation_pass(item: dict) -> bool:
    validation = item["uplift"]["validation2025"]
    return bool(
        item.get("discoveryPass", False)
        and validation["normal"]["returnPctPoints"] > 0.0
        and validation["severe"]["returnPctPoints"] >= 0.0
        and validation["normal"]["maxDrawdownPctPoints"] >= -2.0
        and validation["severe"]["maxDrawdownPctPoints"] >= -2.0
    )


def evaluate_target_map(config_payload: dict, fallback_targets: Dict[int, Dict[str, float]], fallback_diag: dict, raw: dict, base_targets: Dict[int, Dict[str, float]], base_frequency: dict, baseline_windows: dict, pengu_rows: List[dict]) -> tuple[dict, dict]:
    combined_target_map = combine_targets(base_targets, fallback_targets, raw["times"])
    profile = pc.build_profile(combined_target_map, raw)
    combined, windows = combined_windows(profile, pengu_rows)
    frequency = target_frequency(combined_target_map, raw["times"])
    base_proxy = target_frequency(base_targets, raw["times"])
    extra_orders = frequency["orderEventsProxy"] - base_proxy["orderEventsProxy"]
    item = {
        "config": config_payload,
        "combined": combined,
        "windows": windows,
        "uplift": uplift(windows, baseline_windows),
        "fallbackDiagnostics": fallback_diag,
        "orders": {
            "baseOfficialOrderEvents": base_frequency["orderEvents"],
            "extraOrderEventsProxy": extra_orders,
            "combinedOrderEventsEstimate": base_frequency["orderEvents"] + extra_orders,
            "monthlyOrderEventsEstimate": (base_frequency["orderEvents"] + extra_orders) / MONTHS,
            "targetFrequency": frequency,
        },
        "controlDiagnostics": profile["diagnostics"],
    }
    item["discoveryPass"] = candidate_discovery_pass(item)
    item["validationPass"] = candidate_validation_pass(item)
    return item, combined_target_map


def choose_family(items: List[dict]) -> Optional[dict]:
    passed = [item for item in items if item["discoveryPass"]]
    if not passed:
        return None
    passed.sort(key=lambda item: (
        item["uplift"]["discovery2023_2024"]["normal"]["returnPctPoints"],
        item["uplift"]["discovery2023_2024"]["severe"]["returnPctPoints"],
        -item["orders"]["extraOrderEventsProxy"],
    ), reverse=True)
    return passed[0]


def merge_fallback_maps(named_maps: List[Tuple[str, Dict[int, Dict[str, float]]]], times: List[int]) -> tuple[Dict[int, Dict[str, float]], dict]:
    result: Dict[int, Dict[str, float]] = {}
    selected = {name: 0 for name, _mapping in named_maps}
    for ts in times:
        target: Dict[str, float] = {}
        for name, mapping in named_maps:
            if mapping.get(ts, {}):
                target = dict(mapping[ts])
                selected[name] += 1
                break
        result[ts] = target
    return result, {"priority": [name for name, _mapping in named_maps], "selectedBuckets": selected}


def standalone_episode_details(targets: Dict[int, Dict[str, float]], profile: dict, times: List[int]) -> List[dict]:
    rows_by_ts = {int(row["ts"]): row for row in profile["normal"]}
    episodes: List[dict] = []
    active_signature = None
    active_times: List[int] = []
    value = 1.0
    for ts in times:
        signature = target_signature(targets.get(ts, {}))
        if active_signature is None:
            active_signature = signature
        if signature != active_signature:
            if active_signature:
                episodes.append({"signature": active_signature, "times": list(active_times), "returnPct": (value - 1.0) * 100.0})
            active_signature = signature
            active_times = []
            value = 1.0
        if signature:
            active_times.append(ts)
            value *= max(0.001, 1.0 + float(rows_by_ts.get(ts, {}).get("return", 0.0)))
    if active_signature:
        episodes.append({"signature": active_signature, "times": list(active_times), "returnPct": (value - 1.0) * 100.0})
    return episodes


def removal_stress(fallback_targets: Dict[int, Dict[str, float]], raw: dict, base_targets: Dict[int, Dict[str, float]], base_frequency: dict, baseline_windows: dict, pengu_rows: List[dict]) -> dict:
    standalone = pc.build_profile(fallback_targets, raw)
    episodes = standalone_episode_details(fallback_targets, standalone, raw["times"])
    best_episode = max(episodes, key=lambda item: item["returnPct"], default=None)
    no_best_episode = {ts: dict(target) for ts, target in fallback_targets.items()}
    if best_episode:
        for ts in best_episode["times"]:
            no_best_episode[ts] = {}
    month_returns: Dict[str, float] = {}
    for row in standalone["normal"]:
        ts = int(row["ts"])
        if not fallback_targets.get(ts, {}):
            continue
        month = dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        month_returns[month] = (1.0 + month_returns.get(month, 0.0)) * (1.0 + float(row["return"])) - 1.0
    best_month = max(month_returns, key=month_returns.get, default=None)
    no_best_month = {
        ts: ({} if best_month and dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m") == best_month else dict(target))
        for ts, target in fallback_targets.items()
    }
    best_episode_item, _ = evaluate_target_map({"config_id": "REMOVE_BEST_FALLBACK_EPISODE"}, no_best_episode, {"entries": max(0, len(episodes) - 1)}, raw, base_targets, base_frequency, baseline_windows, pengu_rows)
    best_month_item, _ = evaluate_target_map({"config_id": "REMOVE_BEST_FALLBACK_MONTH"}, no_best_month, {"entries": len(episodes)}, raw, base_targets, base_frequency, baseline_windows, pengu_rows)
    return {
        "episodeCount": len(episodes),
        "bestEpisode": {key: value for key, value in (best_episode or {}).items() if key != "times"},
        "bestMonth": best_month,
        "bestMonthStandaloneReturnPct": month_returns.get(best_month) * 100.0 if best_month else None,
        "removeBestEpisodeCombined": {"full": best_episode_item["windows"]["full"], "validation2025": best_episode_item["windows"]["validation2025"], "reused2026H1": best_episode_item["windows"]["reused2026H1"]},
        "removeBestMonthCombined": {"full": best_month_item["windows"]["full"], "validation2025": best_month_item["windows"]["validation2025"], "reused2026H1": best_month_item["windows"]["reused2026H1"]},
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = pc.build_raw_with_hourly()
    base_targets = raw["targets"]
    base_profile = pc.build_profile(base_targets, raw)
    base_frequency = pc.freq.count_core_frequency(base_targets, raw["times"], raw["stabilization"])
    trades = v69.scale_trades(pc.v96.TARGET_V67_GROSS)
    trade_start = min(int(trade["entry_ts"]) for trade in trades)
    trade_end = max(int(trade["exit_ts"]) for trade in trades)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * v69.DAY, trade_end + HOUR)
    baseline_combined, baseline_windows = combined_windows(base_profile, pengu_rows)
    baseline_proxy = target_frequency(base_targets, raw["times"])
    baseline = {
        "config": {"config_id": "CURRENT_V96_VOLUME50_TURNOVER075"},
        "combined": baseline_combined,
        "windows": baseline_windows,
        "orders": {"officialOrderEvents": base_frequency["orderEvents"], "monthlyOrderEvents": base_frequency["orderEvents"] / MONTHS, "targetFrequency": baseline_proxy},
    }

    family_results = {}
    family_maps: Dict[str, Dict[str, Dict[int, Dict[str, float]]]] = {}
    selected_family_items: Dict[str, dict] = {}
    selected_family_maps: Dict[str, Dict[int, Dict[str, float]]] = {}
    for family_name, configs in FAMILIES.items():
        items = []
        maps = {}
        for config in configs:
            fallback_targets, fallback_diag = build_fallback_targets(config, raw, base_targets)
            item, _ = evaluate_target_map(asdict(config), fallback_targets, fallback_diag, raw, base_targets, base_frequency, baseline_windows, pengu_rows)
            items.append(item)
            maps[config.config_id] = fallback_targets
        selected = choose_family(items)
        family_results[family_name] = {"selectedOnDiscovery": selected, "candidates": items}
        family_maps[family_name] = maps
        if selected:
            selected_family_items[family_name] = selected
            selected_family_maps[family_name] = maps[selected["config"]["config_id"]]

    combo_specs: List[Tuple[str, List[str]]] = []
    available = list(selected_family_maps)
    if "pullbackLong" in available and "breakoutLong" in available:
        combo_specs.append(("LONG_FALLBACK_COMBO", ["breakoutLong", "pullbackLong"]))
    if "bearAltShort" in available and "pullbackLong" in available:
        combo_specs.append(("PULLBACK_BEAR_COMBO", ["pullbackLong", "bearAltShort"]))
    if "bearAltShort" in available and "breakoutLong" in available:
        combo_specs.append(("BREAKOUT_BEAR_COMBO", ["breakoutLong", "bearAltShort"]))
    if len(available) >= 2:
        priority = [name for name in ("breakoutLong", "pullbackLong", "bearAltShort") if name in selected_family_maps]
        combo_specs.append(("ALL_SELECTED_FALLBACKS", priority))

    combo_results = []
    combo_maps: Dict[str, Dict[int, Dict[str, float]]] = {}
    for combo_id, names in combo_specs:
        merged, merge_diag = merge_fallback_maps([(name, selected_family_maps[name]) for name in names], raw["times"])
        config_payload = {"config_id": combo_id, "families": [selected_family_items[name]["config"] for name in names], "priority": names}
        frequency = target_frequency(merged, raw["times"])
        fallback_diag = {"entries": frequency["episodeStarts"], "activeBuckets": frequency["activeBuckets"], "merge": merge_diag}
        item, _ = evaluate_target_map(config_payload, merged, fallback_diag, raw, base_targets, base_frequency, baseline_windows, pengu_rows)
        combo_results.append(item)
        combo_maps[combo_id] = merged

    leader_pool = [item for item in selected_family_items.values() if item.get("validationPass")]
    leader_pool.extend(item for item in combo_results if item.get("validationPass"))
    leader_pool.sort(key=lambda item: (
        item["uplift"]["validation2025"]["normal"]["returnPctPoints"],
        item["uplift"]["validation2025"]["severe"]["returnPctPoints"],
        item["uplift"]["discovery2023_2024"]["normal"]["returnPctPoints"],
    ), reverse=True)
    observed_leader = leader_pool[0] if leader_pool else None
    observed_map = None
    if observed_leader:
        config_id = observed_leader["config"]["config_id"]
        if config_id in combo_maps:
            observed_map = combo_maps[config_id]
        else:
            for family_name, selected in selected_family_items.items():
                if selected["config"]["config_id"] == config_id:
                    observed_map = selected_family_maps[family_name]
                    break
    stress = removal_stress(observed_map, raw, base_targets, base_frequency, baseline_windows, pengu_rows) if observed_map is not None else None

    status = "NO_FALLBACK_FAMILY_VALIDATION_PASS"
    if observed_leader is not None:
        reused = observed_leader["uplift"]["reused2026H1"]
        status = "V96_FALLBACK_HISTORICAL_LEAD_FORWARD_REQUIRED" if reused["normal"]["returnPctPoints"] > 0.0 and reused["severe"]["returnPctPoints"] >= 0.0 else "V96_FALLBACK_VALIDATION_LEAD_REUSED_2026_NOT_CONFIRMED"

    payload = rounded({
        "version": 1,
        "strategyId": "DISDEX_V96_FLAT_ONLY_FALLBACK_ENTRY_BT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "period": {"startInclusive": iso_ms(core.CORE_START), "discoveryEndExclusive": iso_ms(START_2025), "validationEndExclusive": iso_ms(START_2026), "endExclusive": iso_ms(core.CORE_END)},
        "method": {
            "primary": "Current V96 Volume50 / turnover 7.5% target chronology is frozen and always has priority",
            "fallbackScope": "Fallback can hold exposure only when the stabilized current V96 target is empty",
            "causality": "Signal uses one completed 12h bar and enters at the next 12h bucket; no current-bucket look-ahead",
            "selection": "Candidate parameters selected on 2023-2024 Discovery; 2025 is independent chronological Validation; 2026H1 is reused evidence only",
            "families": ["pullback continuation long", "initial breakout long", "bear-market alt short"],
            "costs": "Existing Core simulator: Normal 10 bps; Severe 50 bps plus one-bucket delay and existing funding/slippage stress",
            "fallbackGrossRange": [0.20, 0.35],
            "primaryReactivation": "Primary target immediately replaces fallback; no simultaneous Primary/Fallback Core holding",
        },
        "baseline": baseline,
        "families": family_results,
        "combinations": combo_results,
        "observedLeader": observed_leader,
        "stress": stress,
        "resultGate": {
            "discoveryRule": "positive Discovery uplift, Severe within -5 points, DD deterioration no more than 2 points, at least 10 fallback entries",
            "validationRule": "positive 2025 Normal and Severe uplift with DD deterioration no more than 2 points",
            "productionAuthorization": False,
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False, "merged": False},
        "limitations": [
            "2026H1 is not a pristine Holdout because it has been used in prior V96 research.",
            "The fallback families use fixed 12h holding windows; no intrabucket stop or 6h reversal was optimized.",
            "Order events are an estimate based on target-map changes added to the official current V96 order-event count.",
            "A historical lead is not a Production candidate until the exact frozen rule survives untouched Forward/Shadow evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-flat-fallback-entry-bt.json"
    md_path = state_dir / "v96-flat-fallback-entry-bt.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Flat-only Fallback Entry Backtest", "", f"Status: `{payload['status']}`", "",
        "| Candidate | Discovery uplift | 2025 uplift | 2026H1 reused uplift | Full return | Severe full | Est. orders |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    compact_items = []
    for family_name, family in family_results.items():
        selected = family["selectedOnDiscovery"]
        if selected:
            compact_items.append((family_name, selected))
    compact_items.extend((item["config"]["config_id"], item) for item in combo_results)
    for name, item in compact_items:
        u = item["uplift"]
        w = item["windows"]
        lines.append(f"| {name} | {u['discovery2023_2024']['normal']['returnPctPoints']:.4f} | {u['validation2025']['normal']['returnPctPoints']:.4f} | {u['reused2026H1']['normal']['returnPctPoints']:.4f} | {w['full']['normal']['compoundedReturnPct']:.4f}% | {w['full']['severe']['compoundedReturnPct']:.4f}% | {item['orders']['combinedOrderEventsEstimate']} |")
    if observed_leader:
        lines.extend(["", "## Observed leader", "", f"- Config: `{observed_leader['config']['config_id']}`", f"- Validation pass: `{observed_leader['validationPass']}`", f"- 2025 Normal uplift: `{observed_leader['uplift']['validation2025']['normal']['returnPctPoints']:.4f}` points", f"- 2025 Severe uplift: `{observed_leader['uplift']['validation2025']['severe']['returnPctPoints']:.4f}` points", f"- 2026H1 reused Normal uplift: `{observed_leader['uplift']['reused2026H1']['normal']['returnPctPoints']:.4f}` points", f"- 2026H1 reused Severe uplift: `{observed_leader['uplift']['reused2026H1']['severe']['returnPctPoints']:.4f}` points"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "observedLeader": payload["observedLeader"]["config"]["config_id"] if payload["observedLeader"] else None, "json": str(json_path), "markdown": str(md_path)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
