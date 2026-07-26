from __future__ import annotations

import bisect
import datetime as dt
import json
import math
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_v96_bear_short_exit_bt as bear_exit

flat = bear_exit.flat
pc = flat.pc
core = flat.core
v69 = flat.v69
HOUR = flat.HOUR
DAY = v69.DAY
BUCKET12 = 12 * HOUR
BUCKET8 = 8 * HOUR
START_2025 = flat.START_2025
START_2026 = flat.START_2026
MONTHS = flat.MONTHS
ALT_SYMBOLS = flat.ALT_SYMBOLS
ENTRY_CONFIG = bear_exit.ENTRY_CONFIG


@dataclass(frozen=True)
class ConfirmConfig:
    config_id: str
    rule: str
    confirmation_bars: int
    hold_bars: int = 4
    min_extension_pct: float = 0.0
    volume_ratio_min: float = 0.0


CONFIRM_CONFIGS = (
    ConfirmConfig("C1_SECOND_CLOSE", "SECOND_CLOSE", 1),
    ConfirmConfig("C1_LOWER_CLOSE", "LOWER_CLOSE", 1),
    ConfirmConfig("C1_BTC_ALT_CONT", "BTC_ALT_CONT", 1),
    ConfirmConfig("C1_BEAR_BODY", "BEAR_BODY", 1),
    ConfirmConfig("C1_RETEST_REJECT", "RETEST_REJECT", 1),
    ConfirmConfig("C1_LOW_EXTENSION_05", "LOW_EXTENSION", 1, min_extension_pct=0.5),
    ConfirmConfig("C1_LOW_EXTENSION_10", "LOW_EXTENSION", 1, min_extension_pct=1.0),
    ConfirmConfig("C1_VOLUME_CONT_100", "VOLUME_CONT", 1, volume_ratio_min=1.00),
    ConfirmConfig("C1_VOLUME_CONT_120", "VOLUME_CONT", 1, volume_ratio_min=1.20),
    ConfirmConfig("C2_TWO_CLOSES", "TWO_CLOSES", 2),
)


@dataclass(frozen=True)
class EightConfig:
    config_id: str
    family: str
    gross: float
    hold_bars: int
    btc_sma_bars: int
    alt_sma_bars: int
    momentum_bars: int
    momentum_min_pct: float
    volume_ratio_min: float
    rsi_min: float
    rsi_max: float
    lookback: int
    pullback_min_pct: float = -8.0
    pullback_max_pct: float = -0.4


EIGHT_CONFIGS = (
    EightConfig("8H_TR20_H3_M3_V070", "TREND_ROTATION_LONG", 0.20, 3, 90, 66, 18, 3.0, 0.70, 40.0, 72.0, 20),
    EightConfig("8H_TR25_H6_M5_V080", "TREND_ROTATION_LONG", 0.25, 6, 90, 66, 18, 5.0, 0.80, 42.0, 70.0, 20),
    EightConfig("8H_TR30_H3_M8_V090", "TREND_ROTATION_LONG", 0.30, 3, 120, 66, 24, 8.0, 0.90, 45.0, 68.0, 30),
    EightConfig("8H_PB20_H3_M3_R58_V065", "PULLBACK_LONG", 0.20, 3, 90, 66, 18, 3.0, 0.65, 35.0, 58.0, 20, -6.0, -0.4),
    EightConfig("8H_PB25_H6_M5_R55_V070", "PULLBACK_LONG", 0.25, 6, 90, 66, 18, 5.0, 0.70, 37.0, 55.0, 20, -6.0, -0.7),
    EightConfig("8H_PB30_H3_M8_R52_V080", "PULLBACK_LONG", 0.30, 3, 120, 66, 24, 8.0, 0.80, 40.0, 52.0, 30, -5.0, -1.0),
    EightConfig("8H_BO20_H3_L30_M3_V100", "BREAKOUT_LONG", 0.20, 3, 90, 66, 18, 3.0, 1.00, 45.0, 75.0, 30),
    EightConfig("8H_BO25_H6_L30_M5_V110", "BREAKOUT_LONG", 0.25, 6, 90, 66, 18, 5.0, 1.10, 48.0, 73.0, 30),
    EightConfig("8H_BO30_H3_L60_M8_V120", "BREAKOUT_LONG", 0.30, 3, 120, 66, 24, 8.0, 1.20, 50.0, 70.0, 60),
    EightConfig("8H_BS20_H3_L20_M0_V080", "BEAR_ALT_SHORT", 0.20, 3, 90, 66, 18, 0.0, 0.80, 24.0, 55.0, 20),
    EightConfig("8H_BS25_H6_L30_M3_V090", "BEAR_ALT_SHORT", 0.25, 6, 90, 66, 18, 3.0, 0.90, 24.0, 52.0, 30),
    EightConfig("8H_BS30_H3_L45_M5_V110", "BEAR_ALT_SHORT", 0.30, 3, 120, 66, 24, 5.0, 1.10, 24.0, 48.0, 45),
)


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


def signal_snapshot(raw: dict, ts: int) -> Optional[dict]:
    signal = flat.signal_at(ENTRY_CONFIG, raw, ts)
    if signal is None or signal.get("side") != -1:
        return None
    symbol = str(signal["symbol"])
    alt = flat.feature(raw, symbol, ts, ENTRY_CONFIG)
    btc = flat.feature(raw, "BTC", ts, ENTRY_CONFIG)
    if alt is None or btc is None:
        return None
    level = flat.prior_low(alt["rows"], alt["index"], ENTRY_CONFIG.breakdown_lookback)
    if level is None:
        return None
    bar = alt["rows"][alt["index"]]
    return {
        "symbol": symbol,
        "signalTs": ts,
        "breakdownLevel": float(level),
        "signalClose": float(alt["close"]),
        "signalLow": float(bar["low"]),
        "btcSignalClose": float(btc["close"]),
    }


def confirmation_pass(config: ConfirmConfig, raw: dict, watch: dict, ts: int) -> bool:
    symbol = watch["symbol"]
    alt = flat.feature(raw, symbol, ts, ENTRY_CONFIG)
    btc = flat.feature(raw, "BTC", ts, ENTRY_CONFIG)
    if alt is None or btc is None:
        return False
    row = alt["rows"][alt["index"]]
    level = float(watch["breakdownLevel"])
    close = float(alt["close"])
    if config.rule == "SECOND_CLOSE":
        return close < level
    if config.rule == "LOWER_CLOSE":
        return close < float(watch["signalClose"])
    if config.rule == "BTC_ALT_CONT":
        return close < level and float(btc["close"]) < float(watch["btcSignalClose"])
    if config.rule == "BEAR_BODY":
        return close < level and float(row["close"]) < float(row["open"])
    if config.rule == "RETEST_REJECT":
        return float(row["high"]) >= level * 0.995 and close < level
    if config.rule == "LOW_EXTENSION":
        extension = (1.0 - float(row["low"]) / float(watch["signalLow"])) * 100.0
        return close < level and extension >= config.min_extension_pct
    if config.rule == "VOLUME_CONT":
        return close < level and float(alt["volumeRatio"]) >= config.volume_ratio_min
    if config.rule == "TWO_CLOSES":
        prior_ts = ts - BUCKET12
        prior = flat.feature(raw, symbol, prior_ts, ENTRY_CONFIG)
        return prior is not None and float(prior["close"]) < level and close < level
    raise ValueError(config.rule)


def build_confirmed_targets(config: ConfirmConfig, raw: dict, base_targets: Dict[int, Dict[str, float]]) -> tuple[Dict[int, Dict[str, float]], dict]:
    targets: Dict[int, Dict[str, float]] = {}
    watch: Optional[dict] = None
    pending_entry: Optional[dict] = None
    active: Optional[dict] = None
    remaining = 0
    entries = generated = confirmed = suppressed = 0
    by_symbol = {symbol: 0 for symbol in ALT_SYMBOLS}
    entries_by_year: Dict[str, int] = {}

    for ts in raw["times"]:
        primary_active = bool(base_targets.get(ts, {}))
        if primary_active:
            if active is not None or pending_entry is not None or watch is not None:
                suppressed += 1
            targets[ts] = {}
            active = pending_entry = watch = None
            remaining = 0
        else:
            if active is None and pending_entry is not None:
                active = pending_entry
                pending_entry = None
                remaining = config.hold_bars
                entries += 1
                symbol = active["symbol"]
                by_symbol[symbol] += 1
                year = str(dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year)
                entries_by_year[year] = entries_by_year.get(year, 0) + 1
            if active is not None and remaining > 0:
                targets[ts] = {active["symbol"]: -float(ENTRY_CONFIG.gross)}
                remaining -= 1
                if remaining == 0:
                    active = None
            else:
                targets[ts] = {}

            if active is None and pending_entry is None and watch is not None:
                due = int(watch["signalTs"]) + config.confirmation_bars * BUCKET12
                if ts >= due:
                    if confirmation_pass(config, raw, watch, ts):
                        pending_entry = {"symbol": watch["symbol"]}
                        confirmed += 1
                    watch = None

            if active is None and pending_entry is None and watch is None:
                snapshot = signal_snapshot(raw, ts)
                if snapshot is not None:
                    watch = snapshot
                    generated += 1

    return targets, {
        "generatedInitialSignals": generated,
        "confirmedSignals": confirmed,
        "entries": entries,
        "suppressedByPrimary": suppressed,
        "entriesBySymbol": by_symbol,
        "entriesByYear": entries_by_year,
        "activeBuckets": sum(bool(targets.get(ts, {})) for ts in raw["times"]),
    }


def confirm_discovery_pass(item: dict) -> bool:
    u = item["uplift"]["discovery2023_2024"]
    return bool(
        item["fallbackDiagnostics"]["entries"] >= 10
        and u["normal"]["returnPctPoints"] >= 20.0
        and u["severe"]["returnPctPoints"] >= 0.0
        and u["normal"]["maxDrawdownPctPoints"] >= -2.0
        and u["severe"]["maxDrawdownPctPoints"] >= -2.0
    )


def window_nonnegative(item: dict, window: str) -> bool:
    u = item["uplift"][window]
    return bool(
        u["normal"]["returnPctPoints"] >= 0.0
        and u["severe"]["returnPctPoints"] >= 0.0
        and u["normal"]["maxDrawdownPctPoints"] >= -2.0
        and u["severe"]["maxDrawdownPctPoints"] >= -2.0
    )


def resample_8h(hourly: Dict[int, dict]) -> List[dict]:
    grouped: Dict[int, List[dict]] = {}
    for ts, row in sorted(hourly.items()):
        bucket = (int(ts) // BUCKET8) * BUCKET8
        grouped.setdefault(bucket, []).append(row)
    result = []
    for ts, rows in sorted(grouped.items()):
        rows = sorted(rows, key=lambda item: int(item["ts"]))
        if len(rows) != 8 or int(rows[-1]["ts"]) != ts + 7 * HOUR:
            continue
        result.append({
            "ts": ts,
            "open": float(rows[0]["open"]),
            "high": max(float(row["high"]) for row in rows),
            "low": min(float(row["low"]) for row in rows),
            "close": float(rows[-1]["close"]),
            "volume": sum(float(row.get("volume", 0.0)) for row in rows),
        })
    return result


def simple_sma(rows: List[dict], index: int, bars: int) -> Optional[float]:
    if index + 1 < bars:
        return None
    return statistics.fmean(float(row["close"]) for row in rows[index - bars + 1:index + 1])


def simple_momentum(rows: List[dict], index: int, bars: int) -> Optional[float]:
    if index < bars:
        return None
    first = float(rows[index - bars]["close"])
    return (float(rows[index]["close"]) / first - 1.0) * 100.0 if first > 0 else None


def simple_rsi(rows: List[dict], index: int, bars: int = 14) -> Optional[float]:
    if index < bars:
        return None
    gains, losses = [], []
    for position in range(index - bars + 1, index + 1):
        delta = float(rows[position]["close"]) - float(rows[position - 1]["close"])
        gains.append(max(0.0, delta))
        losses.append(max(0.0, -delta))
    avg_gain = statistics.fmean(gains)
    avg_loss = statistics.fmean(losses)
    if avg_loss <= 1e-12:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def volume_ratio8(rows: List[dict], index: int, bars: int = 20) -> Optional[float]:
    if index < bars:
        return None
    average = statistics.fmean(float(row.get("volume", 0.0)) for row in rows[index - bars:index])
    return float(rows[index].get("volume", 0.0)) / average if average > 0 else None


def prior_level(rows: List[dict], index: int, lookback: int, high: bool) -> Optional[float]:
    if index < lookback:
        return None
    values = [float(row["high"] if high else row["low"]) for row in rows[index - lookback:index]]
    return max(values) if high else min(values)


def feature8(bars8: dict, indexes8: dict, symbol: str, ts: int, config: EightConfig) -> Optional[dict]:
    index = indexes8.get(symbol, {}).get(ts)
    if index is None:
        return None
    rows = bars8[symbol]
    sma_bars = config.btc_sma_bars if symbol == "BTC" else config.alt_sma_bars
    average = simple_sma(rows, index, sma_bars)
    momentum = simple_momentum(rows, index, config.momentum_bars)
    strength = simple_rsi(rows, index)
    volume = volume_ratio8(rows, index)
    if None in (average, momentum, strength, volume):
        return None
    row = rows[index]
    bar_return = (float(row["close"]) / float(row["open"]) - 1.0) * 100.0 if float(row["open"]) > 0 else 0.0
    return {
        "rows": rows,
        "index": index,
        "close": float(row["close"]),
        "open": float(row["open"]),
        "high": float(row["high"]),
        "low": float(row["low"]),
        "sma": float(average),
        "momentumPct": float(momentum),
        "rsi": float(strength),
        "volumeRatio": float(volume),
        "barReturnPct": bar_return,
    }


def signal8(config: EightConfig, bars8: dict, indexes8: dict, ts: int) -> Optional[dict]:
    btc = feature8(bars8, indexes8, "BTC", ts, config)
    if btc is None:
        return None
    alt = {symbol: feature8(bars8, indexes8, symbol, ts, config) for symbol in ALT_SYMBOLS}
    alt = {symbol: value for symbol, value in alt.items() if value is not None}
    if len(alt) < 2:
        return None

    if config.family in ("TREND_ROTATION_LONG", "PULLBACK_LONG", "BREAKOUT_LONG"):
        if not (btc["close"] > btc["sma"] and btc["momentumPct"] > 0.0):
            return None
        trend = {
            symbol: item for symbol, item in alt.items()
            if item["close"] > item["sma"] and item["momentumPct"] >= config.momentum_min_pct
        }
        if len(trend) < 2:
            return None
        candidates: List[Tuple[str, float]] = []
        for symbol, item in trend.items():
            if not (config.rsi_min <= item["rsi"] <= config.rsi_max):
                continue
            if item["volumeRatio"] < config.volume_ratio_min:
                continue
            if config.family == "TREND_ROTATION_LONG":
                score = item["momentumPct"] + min(2.0, item["volumeRatio"])
            elif config.family == "PULLBACK_LONG":
                if not (config.pullback_min_pct <= item["barReturnPct"] <= config.pullback_max_pct):
                    continue
                score = item["momentumPct"] - abs(item["barReturnPct"]) * 0.2 + min(2.0, item["volumeRatio"])
            else:
                level = prior_level(item["rows"], item["index"], config.lookback, True)
                if level is None or item["close"] <= level:
                    continue
                score = item["momentumPct"] + (item["close"] / level - 1.0) * 200.0 + min(2.0, item["volumeRatio"])
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
        if len(down) < 2:
            return None
        candidates = []
        for symbol, item in down.items():
            if not (config.rsi_min <= item["rsi"] <= config.rsi_max):
                continue
            if item["volumeRatio"] < config.volume_ratio_min:
                continue
            level = prior_level(item["rows"], item["index"], config.lookback, False)
            if level is None or item["close"] >= level:
                continue
            score = -item["momentumPct"] + (1.0 - item["close"] / level) * 200.0 + min(2.0, item["volumeRatio"])
            candidates.append((symbol, score))
        if not candidates:
            return None
        symbol, score = max(candidates, key=lambda pair: pair[1])
        return {"symbol": symbol, "side": -1, "score": score}
    raise ValueError(config.family)


def primary_active_lookup(base_targets: Dict[int, Dict[str, float]], times12: List[int]):
    def active(ts: int) -> bool:
        position = bisect.bisect_right(times12, ts) - 1
        return bool(base_targets.get(times12[position], {})) if position >= 0 else False
    return active


def build_8h_targets(config: EightConfig, bars8: dict, indexes8: dict, times8: List[int], primary_active) -> tuple[Dict[int, Dict[str, float]], dict]:
    targets: Dict[int, Dict[str, float]] = {}
    pending: Optional[dict] = None
    active: Optional[dict] = None
    remaining = 0
    entries = generated = suppressed = 0
    by_symbol = {symbol: 0 for symbol in ALT_SYMBOLS}
    entries_by_year: Dict[str, int] = {}
    for ts in times8:
        if primary_active(ts):
            if active is not None or pending is not None:
                suppressed += 1
            targets[ts] = {}
            active = pending = None
            remaining = 0
        else:
            if active is None and pending is not None:
                active = pending
                pending = None
                remaining = config.hold_bars
                entries += 1
                by_symbol[active["symbol"]] += 1
                year = str(dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year)
                entries_by_year[year] = entries_by_year.get(year, 0) + 1
            if active is not None and remaining > 0:
                targets[ts] = {active["symbol"]: active["side"] * config.gross}
                remaining -= 1
                if remaining == 0:
                    active = None
            else:
                targets[ts] = {}
            if active is None and pending is None:
                candidate = signal8(config, bars8, indexes8, ts)
                if candidate is not None:
                    pending = candidate
                    generated += 1
    return targets, {
        "generatedSignals": generated,
        "entries": entries,
        "suppressedByPrimary": suppressed,
        "entriesBySymbol": by_symbol,
        "entriesByYear": entries_by_year,
        "activeBuckets8h": sum(bool(targets.get(ts, {})) for ts in times8),
    }


def shifted_severe_targets(targets: Dict[int, Dict[str, float]], times8: List[int], primary_active) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for index, ts in enumerate(times8):
        source = times8[index - 1] if index > 0 else None
        result[ts] = {} if primary_active(ts) or source is None else dict(targets.get(source, {}))
    return result


def hourly_fallback_rows(targets8: Dict[int, Dict[str, float]], raw: dict, times8: List[int], cost_bps: float, carry_bps_per_8h: float) -> tuple[Dict[int, float], Dict[int, float], dict]:
    returns12: Dict[int, float] = {}
    gross12: Dict[int, float] = {}
    previous: Dict[str, float] = {}
    changes = 0
    for ts in times8:
        current = dict(targets8.get(ts, {}))
        symbols = set(previous) | set(current)
        turnover = sum(abs(float(current.get(symbol, 0.0)) - float(previous.get(symbol, 0.0))) for symbol in symbols)
        if turnover > 1e-12:
            changes += 1
        first_hour = True
        for hour in range(8):
            hts = ts + hour * HOUR
            hour_return = 0.0
            for symbol, weight in current.items():
                row = raw["hourly"].get(symbol, {}).get(hts)
                if row is None or float(row["open"]) <= 0:
                    continue
                hour_return += float(weight) * (float(row["close"]) / float(row["open"]) - 1.0)
            if first_hour and turnover > 0:
                hour_return -= turnover * cost_bps / 10_000.0
            if first_hour and current and carry_bps_per_8h > 0:
                hour_return -= sum(abs(float(weight)) for weight in current.values()) * carry_bps_per_8h / 10_000.0
            first_hour = False
            bucket = (hts // BUCKET12) * BUCKET12
            returns12[bucket] = (1.0 + returns12.get(bucket, 0.0)) * (1.0 + hour_return) - 1.0
            gross12[bucket] = max(gross12.get(bucket, 0.0), sum(abs(float(weight)) for weight in current.values()))
        previous = current
    return returns12, gross12, {"targetChangeEvents8h": changes}


def add_8h_to_profile(base_profile: dict, normal_return: dict, normal_gross: dict, severe_return: dict, severe_gross: dict) -> dict:
    def merge(rows: List[dict], extra_returns: dict, extra_gross: dict) -> List[dict]:
        result = []
        for row in rows:
            ts = int(row["ts"])
            extra = float(extra_returns.get(ts, 0.0))
            value = (1.0 + float(row["return"])) * (1.0 + extra) - 1.0
            gross = float(row.get("gross", 0.0)) + float(extra_gross.get(ts, 0.0))
            result.append({**row, "return": value, "gross": gross, "maxGross": max(float(row.get("maxGross", 0.0)), gross)})
        return result
    return {
        "normal": merge(base_profile["normal"], normal_return, normal_gross),
        "severe": merge(base_profile["severe"], severe_return, severe_gross),
        "diagnostics": base_profile.get("diagnostics", {}),
    }


def evaluate_8h(config: EightConfig, raw: dict, base_profile: dict, base_targets: dict, base_frequency: dict, baseline_windows: dict, pengu_rows: List[dict], bars8: dict, indexes8: dict, times8: List[int], primary_active) -> dict:
    normal_targets, diagnostics = build_8h_targets(config, bars8, indexes8, times8, primary_active)
    severe_targets = shifted_severe_targets(normal_targets, times8, primary_active)
    nr, ng, nd = hourly_fallback_rows(normal_targets, raw, times8, 10.0, 0.0)
    sr, sg, sd = hourly_fallback_rows(severe_targets, raw, times8, 50.0, 3.0)
    profile = add_8h_to_profile(base_profile, nr, ng, sr, sg)
    combined, windows = flat.combined_windows(profile, pengu_rows)
    item = {
        "config": asdict(config),
        "combined": combined,
        "windows": windows,
        "uplift": flat.uplift(windows, baseline_windows),
        "fallbackDiagnostics": diagnostics,
        "orders": {
            "baseOfficialOrderEvents": base_frequency["orderEvents"],
            "extraOrderEventsProxy": nd["targetChangeEvents8h"],
            "combinedOrderEventsEstimate": base_frequency["orderEvents"] + nd["targetChangeEvents8h"],
            "monthlyOrderEventsEstimate": (base_frequency["orderEvents"] + nd["targetChangeEvents8h"]) / MONTHS,
            "normal8h": nd,
            "severe8h": sd,
        },
    }
    u = item["uplift"]["discovery2023_2024"]
    item["discoveryPass"] = bool(
        diagnostics["entries"] >= 15
        and u["normal"]["returnPctPoints"] > 0.0
        and u["severe"]["returnPctPoints"] >= 0.0
        and u["normal"]["maxDrawdownPctPoints"] >= -2.0
        and u["severe"]["maxDrawdownPctPoints"] >= -2.0
    )
    item["validationPass"] = bool(item["discoveryPass"] and window_nonnegative(item, "validation2025"))
    item["reused2026Pass"] = bool(item["validationPass"] and window_nonnegative(item, "reused2026H1"))
    return item


def choose_discovery(items: List[dict]) -> Optional[dict]:
    passed = [item for item in items if item.get("discoveryPass")]
    if not passed:
        return None
    passed.sort(key=lambda item: (
        item["uplift"]["discovery2023_2024"]["severe"]["returnPctPoints"],
        item["uplift"]["discovery2023_2024"]["normal"]["returnPctPoints"],
        -item["orders"]["extraOrderEventsProxy"],
    ), reverse=True)
    return passed[0]


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = pc.build_raw_with_hourly()
    base_targets = raw["targets"]
    base_profile = pc.build_profile(base_targets, raw)
    base_frequency = pc.freq.count_core_frequency(base_targets, raw["times"], raw["stabilization"])
    trades = v69.scale_trades(pc.v96.TARGET_V67_GROSS)
    trade_start = min(int(trade["entry_ts"]) for trade in trades)
    trade_end = max(int(trade["exit_ts"]) for trade in trades)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    baseline_combined, baseline_windows = flat.combined_windows(base_profile, pengu_rows)
    baseline = {
        "config": {"config_id": "CURRENT_V96_VOLUME50_TURNOVER075"},
        "combined": baseline_combined,
        "windows": baseline_windows,
        "orders": {"officialOrderEvents": base_frequency["orderEvents"]},
    }

    confirmation_candidates = []
    confirmation_maps = {}
    for config in CONFIRM_CONFIGS:
        targets, diagnostics = build_confirmed_targets(config, raw, base_targets)
        item, _ = flat.evaluate_target_map(
            {"config_id": config.config_id, "fixedEntry": asdict(ENTRY_CONFIG), "confirmation": asdict(config)},
            targets, diagnostics, raw, base_targets, base_frequency, baseline_windows, pengu_rows,
        )
        item["discoveryPass"] = confirm_discovery_pass(item)
        item["validationPass"] = bool(item["discoveryPass"] and window_nonnegative(item, "validation2025"))
        item["reused2026Pass"] = bool(item["validationPass"] and window_nonnegative(item, "reused2026H1"))
        confirmation_candidates.append(item)
        confirmation_maps[config.config_id] = targets

    confirmation_selected = choose_discovery(confirmation_candidates)
    confirmation_success = bool(confirmation_selected and confirmation_selected["reused2026Pass"])

    eight_candidates: List[dict] = []
    eight_selected = None
    eight_ran = not confirmation_success
    if eight_ran:
        bars8 = {symbol: resample_8h(raw["hourly"][symbol]) for symbol in ("BTC",) + ALT_SYMBOLS}
        indexes8 = {symbol: {int(row["ts"]): index for index, row in enumerate(rows)} for symbol, rows in bars8.items()}
        times8 = [int(row["ts"]) for row in bars8["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
        primary_active = primary_active_lookup(base_targets, raw["times"])
        for config in EIGHT_CONFIGS:
            eight_candidates.append(evaluate_8h(
                config, raw, base_profile, base_targets, base_frequency, baseline_windows,
                pengu_rows, bars8, indexes8, times8, primary_active,
            ))
        eight_selected = choose_discovery(eight_candidates)

    if confirmation_success:
        status = "BEAR_CONFIRMATION_HISTORICAL_LEAD_FORWARD_REQUIRED"
        observed = confirmation_selected
    elif not eight_ran:
        status = "NO_BEAR_CONFIRMATION_IMPROVEMENT"
        observed = confirmation_selected
    elif eight_selected is None:
        status = "NO_BEAR_CONFIRMATION_OR_8H_DISCOVERY_PASS"
        observed = confirmation_selected
    elif eight_selected["reused2026Pass"]:
        status = "EIGHT_HOUR_FALLBACK_HISTORICAL_LEAD_FORWARD_REQUIRED"
        observed = eight_selected
    elif eight_selected["validationPass"]:
        status = "EIGHT_HOUR_2025_PASS_REUSED_2026_FAIL"
        observed = eight_selected
    else:
        status = "NO_BEAR_CONFIRMATION_OR_8H_VALIDATION_PASS"
        observed = eight_selected

    payload = rounded({
        "version": 1,
        "strategyId": "DISDEX_V96_BEAR_CONFIRMATION_THEN_8H_FALLBACK_BT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "period": {
            "startInclusive": iso_ms(core.CORE_START),
            "discoveryEndExclusive": iso_ms(START_2025),
            "validationEndExclusive": iso_ms(START_2026),
            "endExclusive": iso_ms(core.CORE_END),
        },
        "method": {
            "primary": "Current V96 Volume50 / turnover 7.5% chronology frozen and always has priority",
            "stage1": "Freeze BS25_H4_L20_M3_V090 and test only completed-12h entry-confirmation timing; fixed 48h hold",
            "stage2Condition": "Run independent 8h signal engine only when no Stage-1 Discovery-selected candidate passes 2025 and reused 2026H1",
            "selection": "2023-2024 Discovery selection, 2025 chronological Validation, 2026H1 reused evidence only",
            "causality": "Signals use completed bars and enter on the next bar; no same-bar execution or look-ahead",
            "eightHourStress": "Normal 10 bps turnover; Severe 50 bps turnover, one 8h target delay and 3 bps adverse carry per active 8h bucket",
        },
        "baseline": baseline,
        "stage1BearConfirmation": {
            "fixedEntry": asdict(ENTRY_CONFIG),
            "selectedOnDiscovery": confirmation_selected,
            "successAcross2025AndReused2026": confirmation_success,
            "candidates": confirmation_candidates,
        },
        "stage2EightHour": {
            "ran": eight_ran,
            "selectedOnDiscovery": eight_selected,
            "candidates": eight_candidates,
        },
        "observedLeader": observed,
        "resultGate": {
            "stage1Discovery": "At least 10 entries, >=20 Normal uplift points, non-negative Severe uplift, DD within 2 points",
            "stage2Discovery": "At least 15 entries, positive Normal and non-negative Severe uplift, DD within 2 points",
            "validation": "Non-negative Normal and Severe uplift in 2025",
            "reused2026": "Non-negative Normal and Severe uplift; descriptive reused evidence, not pristine Holdout",
            "productionAuthorization": False,
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False, "merged": False},
        "limitations": [
            "2026H1 has already been observed and cannot be treated as an untouched Holdout.",
            "The 8h engine is an independent flat-only overlay but is conservatively aggregated into the existing 12h portfolio rows for PENGU reservation and Gross-cap evaluation.",
            "No intrabar stop or same-bar close execution is assumed.",
            "Historical improvement cannot authorize Production without an exact frozen Forward/Shadow test.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-bear-confirm-then-8h-bt.json"
    md_path = state_dir / "v96-bear-confirm-then-8h-bt.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 Bear Confirmation then 8h Fallback Backtest", "", f"Status: `{status}`", "",
        "## Stage 1: Bear confirmation", "",
        "| Candidate | Entries | Discovery N/S | 2025 N/S | 2026H1 N/S | Full N/S |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for item in confirmation_candidates:
        u, w = item["uplift"], item["windows"]["full"]
        lines.append(
            f"| {item['config']['config_id']} | {item['fallbackDiagnostics']['entries']} | "
            f"{u['discovery2023_2024']['normal']['returnPctPoints']:.4f}/{u['discovery2023_2024']['severe']['returnPctPoints']:.4f} | "
            f"{u['validation2025']['normal']['returnPctPoints']:.4f}/{u['validation2025']['severe']['returnPctPoints']:.4f} | "
            f"{u['reused2026H1']['normal']['returnPctPoints']:.4f}/{u['reused2026H1']['severe']['returnPctPoints']:.4f} | "
            f"{w['normal']['compoundedReturnPct']:.4f}%/{w['severe']['compoundedReturnPct']:.4f}% |"
        )
    lines.extend(["", "## Stage 2: 8h engine", "", f"Ran: `{eight_ran}`", ""])
    if eight_ran:
        lines.extend([
            "| Candidate | Entries | Discovery N/S | 2025 N/S | 2026H1 N/S | Full N/S | Est. orders |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ])
        for item in eight_candidates:
            u, w = item["uplift"], item["windows"]["full"]
            lines.append(
                f"| {item['config']['config_id']} | {item['fallbackDiagnostics']['entries']} | "
                f"{u['discovery2023_2024']['normal']['returnPctPoints']:.4f}/{u['discovery2023_2024']['severe']['returnPctPoints']:.4f} | "
                f"{u['validation2025']['normal']['returnPctPoints']:.4f}/{u['validation2025']['severe']['returnPctPoints']:.4f} | "
                f"{u['reused2026H1']['normal']['returnPctPoints']:.4f}/{u['reused2026H1']['severe']['returnPctPoints']:.4f} | "
                f"{w['normal']['compoundedReturnPct']:.4f}%/{w['severe']['compoundedReturnPct']:.4f}% | "
                f"{item['orders']['combinedOrderEventsEstimate']} |"
            )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": status,
        "stage1Selected": confirmation_selected["config"]["config_id"] if confirmation_selected else None,
        "stage1Success": confirmation_success,
        "stage2Ran": eight_ran,
        "stage2Selected": eight_selected["config"]["config_id"] if eight_selected else None,
        "json": str(json_path),
        "markdown": str(md_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
