from __future__ import annotations

import datetime as dt
import hashlib
import itertools
import json
import math
import os
import random
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_pengu_v57_extended_bt_v3 as archive

HOUR = 3_600_000
DAY = 24 * HOUR
BAR = 12 * HOUR
START_DATE = dt.date(2022, 9, 1)
END_DATE = dt.date(2026, 7, 1)
SYMBOLS = ("BTC", "ETH", "BNB", "SOL")
NORMAL_COST_BPS = 10.0
SEVERE_COST_BPS = 35.0
SEVERE_ADVERSE_BPS = 5.0
CASH_RESERVE = 0.02
GROSS_CAP = 1.55
RANDOM_SEED = 73073


@dataclass(frozen=True)
class SignalConfig:
    regime_days: int
    asset_sma_days: int
    momentum_days: int
    top_k: int
    rebalance_days: int

    @property
    def config_id(self) -> str:
        return (
            f"R{self.regime_days}_S{self.asset_sma_days}_M{self.momentum_days}"
            f"_K{self.top_k}_RB{self.rebalance_days}"
        )


@dataclass(frozen=True)
class RiskConfig:
    bull_gross: float
    bear_gross: float
    stop_atr: float
    target_vol_pct: float
    max_symbol_gross: float
    dd_brake_start: float

    @property
    def config_id(self) -> str:
        return (
            f"BG{self.bull_gross:g}_HG{self.bear_gross:g}_SL{self.stop_atr:g}"
            f"_TV{self.target_vol_pct:g}_MS{self.max_symbol_gross:g}"
            f"_DD{self.dd_brake_start:g}"
        ).replace(".", "p")


@dataclass
class SimState:
    weight: float = 0.0
    entry_price: Optional[float] = None
    entry_atr: Optional[float] = None
    cooldown_until: int = 0


def signal_space() -> List[SignalConfig]:
    return [SignalConfig(*values) for values in itertools.product(
        (60, 90, 120),
        (30, 45, 60),
        (20, 40, 60),
        (1, 2),
        (2, 4, 6),
    )]


def risk_space() -> List[RiskConfig]:
    return [RiskConfig(*values) for values in itertools.product(
        (0.8, 1.0, 1.2),
        (0.3, 0.5),
        (2.5, 3.5),
        (40.0, 55.0),
        (0.45, 0.60),
        (0.12, 0.18),
    )]


def rolling_mean(values: Sequence[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= length:
            total -= values[index - length]
        if index >= length - 1:
            result[index] = total / length
    return result


def rolling_std(values: Sequence[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length - 1, len(values)):
        result[index] = statistics.pstdev(values[index - length + 1:index + 1])
    return result


def momentum(values: Sequence[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        prior = values[index - length]
        if prior > 0:
            result[index] = (values[index] / prior - 1.0) * 100.0
    return result


def true_range(rows: Sequence[dict]) -> List[float]:
    if not rows:
        return []
    result = [float(rows[0]["high"]) - float(rows[0]["low"])]
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        result.append(max(high - low, abs(high - previous), abs(low - previous)))
    return result


def resample_12h(rows: Sequence[dict]) -> List[dict]:
    groups: Dict[int, List[dict]] = {}
    for row in rows:
        bucket = int(row["ts"]) // BAR * BAR
        groups.setdefault(bucket, []).append(row)
    result: List[dict] = []
    for ts, items in sorted(groups.items()):
        items.sort(key=lambda row: int(row["ts"]))
        if len(items) != 12:
            continue
        result.append({
            "ts": ts,
            "open": float(items[0]["open"]),
            "high": max(float(item["high"]) for item in items),
            "low": min(float(item["low"]) for item in items),
            "close": float(items[-1]["close"]),
            "volume": sum(float(item.get("volume", 0.0)) for item in items),
        })
    return result


def funding_buckets(points: Sequence[dict]) -> Dict[int, float]:
    result: Dict[int, float] = {}
    for point in points:
        bucket = int(point["ts"]) // BAR * BAR
        result[bucket] = result.get(bucket, 0.0) + float(point["rate"])
    return result


def fetch_data() -> tuple[Dict[str, List[dict]], Dict[str, Dict[int, float]], List[int], dict]:
    now = dt.datetime.now(dt.timezone.utc)
    last_complete = archive.previous_complete_month(now)
    months = list(archive.iter_months(START_DATE, last_complete))
    end_ts = int(dt.datetime.combine(END_DATE, dt.time(), tzinfo=dt.timezone.utc).timestamp() * 1000)
    bars: Dict[str, List[dict]] = {}
    funding: Dict[str, Dict[int, float]] = {}
    coverage: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        pair = f"{symbol}USDT"
        hourly, kline_months = archive.fetch_archive_klines(pair, months)
        points, funding_months = archive.fetch_archive_funding(pair, months)
        hourly = [row for row in hourly if int(row["ts"]) < end_ts]
        points = [row for row in points if int(row["ts"]) < end_ts]
        bars[symbol] = resample_12h(hourly)
        funding[symbol] = funding_buckets(points)
        coverage[symbol] = {
            "klineMonths": kline_months,
            "fundingMonths": funding_months,
            "bars12h": len(bars[symbol]),
        }
    common = set(int(row["ts"]) for row in bars["BTC"])
    for symbol in SYMBOLS[1:]:
        common &= {int(row["ts"]) for row in bars[symbol]}
    times = sorted(common)
    start_ts = int(dt.datetime(2023, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    times = [ts for ts in times if start_ts <= ts < end_ts]
    aligned: Dict[str, List[dict]] = {}
    for symbol in SYMBOLS:
        mapping = {int(row["ts"]): row for row in bars[symbol]}
        aligned[symbol] = [mapping[ts] for ts in times]
    return aligned, funding, times, coverage


def build_features(bars: Dict[str, List[dict]]) -> dict:
    features: Dict[str, dict] = {}
    for symbol, rows in bars.items():
        closes = [float(row["close"]) for row in rows]
        volumes = [float(row["volume"]) for row in rows]
        log_returns = [0.0]
        for index in range(1, len(closes)):
            log_returns.append(math.log(closes[index] / closes[index - 1]) if closes[index - 1] > 0 else 0.0)
        tr = true_range(rows)
        features[symbol] = {
            "closes": closes,
            "volumes": volumes,
            "tr": tr,
            "atr20": rolling_mean(tr, 20),
            "rv40": [
                value * math.sqrt(730.0) * 100.0 if value is not None else None
                for value in rolling_std(log_returns, 40)
            ],
        }
    return features


def signal_targets(config: SignalConfig, bars: Dict[str, List[dict]], times: List[int], features: dict) -> Dict[int, Dict[str, float]]:
    regime_length = config.regime_days * 2
    asset_sma_length = config.asset_sma_days * 2
    momentum_length = config.momentum_days * 2
    series: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        closes = features[symbol]["closes"]
        volumes = features[symbol]["volumes"]
        series[symbol] = {
            "smaRegime": rolling_mean(closes, regime_length),
            "smaAsset": rolling_mean(closes, asset_sma_length),
            "momentum": momentum(closes, momentum_length),
            "volRecent": rolling_mean(volumes, 20),
            "volBase": rolling_mean(volumes, 80),
        }
    result: Dict[int, Dict[str, float]] = {}
    held: Dict[str, float] = {}
    rebalance_bars = config.rebalance_days * 2
    for index, ts in enumerate(times):
        if index % rebalance_bars != 0:
            result[ts] = dict(held)
            continue
        btc_close = features["BTC"]["closes"][index]
        btc_regime = series["BTC"]["smaRegime"][index]
        btc_momentum = series["BTC"]["momentum"][index]
        if btc_regime is None or btc_momentum is None:
            held = {}
            result[ts] = {}
            continue
        if btc_close > btc_regime and btc_momentum > 0:
            candidates: List[Tuple[str, float]] = []
            for symbol in SYMBOLS:
                close = features[symbol]["closes"][index]
                sma_asset = series[symbol]["smaAsset"][index]
                mom = series[symbol]["momentum"][index]
                rv = features[symbol]["rv40"][index]
                recent_volume = series[symbol]["volRecent"][index]
                base_volume = series[symbol]["volBase"][index]
                if None in (sma_asset, mom, rv, recent_volume, base_volume) or not base_volume:
                    continue
                volume_ratio = float(recent_volume) / float(base_volume)
                if close > float(sma_asset) and float(mom) > 0 and volume_ratio >= 0.70:
                    relative = float(mom) - float(btc_momentum)
                    score = float(mom) + relative * 0.25 - float(rv) * 0.04 + min(2.0, volume_ratio)
                    candidates.append((symbol, score))
            selected = sorted(candidates, key=lambda item: item[1], reverse=True)[: config.top_k]
            held = {symbol: 1.0 / len(selected) for symbol, _ in selected} if selected else {}
        elif btc_close < btc_regime and btc_momentum < 0:
            held = {"BTC": -1.0}
        else:
            held = {}
        result[ts] = dict(held)
    return result


def average_targets(members: Sequence[Dict[int, Dict[str, float]]], times: Sequence[int]) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        symbols = set().union(*(member.get(ts, {}).keys() for member in members))
        result[ts] = {
            symbol: statistics.fmean(member.get(ts, {}).get(symbol, 0.0) for member in members)
            for symbol in symbols
        }
        result[ts] = {symbol: weight for symbol, weight in result[ts].items() if abs(weight) > 1e-12}
    return result


def gross(weights: Dict[str, float]) -> float:
    return sum(abs(value) for value in weights.values())


def turnover(left: Dict[str, float], right: Dict[str, float]) -> float:
    return sum(abs(right.get(symbol, 0.0) - left.get(symbol, 0.0)) for symbol in set(left) | set(right))


def scale_targets(raw: Dict[str, float], config: RiskConfig) -> Dict[str, float]:
    positive = any(value > 0 for value in raw.values())
    target_gross = config.bull_gross if positive else config.bear_gross
    values = {symbol: value * target_gross for symbol, value in raw.items()}
    values = {
        symbol: max(-config.max_symbol_gross, min(config.max_symbol_gross, value))
        for symbol, value in values.items()
    }
    current = gross(values)
    if current > GROSS_CAP:
        factor = GROSS_CAP / current
        values = {symbol: value * factor for symbol, value in values.items()}
    return {symbol: value * (1.0 - CASH_RESERVE) for symbol, value in values.items()}


def simulate(targets: Dict[int, Dict[str, float]], risk: RiskConfig, bars: Dict[str, List[dict]], features: dict, funding: Dict[str, Dict[int, float]], times: List[int], severe: bool = False, bundle_shift: Optional[List[int]] = None) -> List[dict]:
    states = {symbol: SimState() for symbol in SYMBOLS}
    previous_weights: Dict[str, float] = {}
    equity = peak = 1.0
    recent_returns: List[float] = []
    rows: List[dict] = []
    cost_bps = SEVERE_COST_BPS if severe else NORMAL_COST_BPS
    delay = 1 if severe else 0
    for index, ts in enumerate(times):
        source_index = index - 1 - delay
        if bundle_shift is not None and source_index >= 0:
            source_index = bundle_shift[source_index]
        desired_raw = targets.get(times[source_index], {}) if source_index >= 0 else {}
        desired = scale_targets(desired_raw, risk)
        if len(recent_returns) >= 40:
            rv = statistics.pstdev(recent_returns[-40:]) * math.sqrt(730.0) * 100.0
            if rv > risk.target_vol_pct and rv > 0:
                factor = risk.target_vol_pct / rv
                desired = {symbol: value * factor for symbol, value in desired.items()}
        drawdown = equity / peak - 1.0
        if drawdown <= -risk.dd_brake_start - 0.08:
            desired = {symbol: value * 0.40 for symbol, value in desired.items()}
        elif drawdown <= -risk.dd_brake_start:
            desired = {symbol: value * 0.65 for symbol, value in desired.items()}
        for symbol, state in states.items():
            if index < state.cooldown_until:
                desired[symbol] = 0.0
        desired = {symbol: value for symbol, value in desired.items() if abs(value) > 1e-12}
        turn = turnover(previous_weights, desired)
        value = -turn * cost_bps / 10_000.0
        stop_count = 0
        for symbol in SYMBOLS:
            row = bars[symbol][index]
            weight = desired.get(symbol, 0.0)
            state = states[symbol]
            if weight == 0.0:
                state.weight = 0.0
                state.entry_price = None
                state.entry_atr = None
                continue
            sign_changed = state.weight == 0.0 or state.weight * weight <= 0.0
            if sign_changed:
                state.entry_price = float(row["open"])
                prior_index = max(0, index - 1)
                state.entry_atr = features[symbol]["atr20"][prior_index]
            state.weight = weight
            entry = state.entry_price or float(row["open"])
            atr = state.entry_atr or max(1e-12, float(row["high"]) - float(row["low"]))
            if weight > 0:
                stop_price = entry - risk.stop_atr * atr
                hit = float(row["low"]) <= stop_price
                exit_price = min(float(row["open"]), stop_price) if float(row["open"]) < stop_price else stop_price
            else:
                stop_price = entry + risk.stop_atr * atr
                hit = float(row["high"]) >= stop_price
                exit_price = max(float(row["open"]), stop_price) if float(row["open"]) > stop_price else stop_price
            if hit:
                asset_return = exit_price / float(row["open"]) - 1.0
                value += weight * asset_return
                if severe:
                    value -= abs(weight) * SEVERE_ADVERSE_BPS / 10_000.0
                state.weight = 0.0
                state.entry_price = None
                state.entry_atr = None
                state.cooldown_until = index + 2
                desired[symbol] = 0.0
                stop_count += 1
            else:
                asset_return = float(row["close"]) / float(row["open"]) - 1.0
                value += weight * asset_return
                value -= weight * funding.get(symbol, {}).get(ts, 0.0)
                if severe:
                    value -= abs(weight) * SEVERE_ADVERSE_BPS / 10_000.0
        desired = {symbol: value_ for symbol, value_ in desired.items() if abs(value_) > 1e-12}
        current_gross = gross(desired)
        rows.append({"ts": ts, "return": value, "gross": current_gross, "turnover": turn, "stops": stop_count, "weights": dict(desired)})
        recent_returns.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        previous_weights = dict(desired)
    return rows


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def monthly_returns(rows: Sequence[dict], start: int, end: int) -> List[float]:
    groups: Dict[str, List[float]] = {}
    for row in rows:
        if start <= int(row["ts"]) < end:
            key = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
            groups.setdefault(key, []).append(float(row["return"]))
    return [product(groups[key]) for key in sorted(groups)]


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    return gains / losses if losses > 0 else 999.0 if gains > 0 else None


def metrics(rows: Sequence[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    values = [float(row["return"]) for row in active]
    equity = peak = 1.0
    max_dd = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    months = monthly_returns(active, start, end)
    monthly_sharpe = None
    if len(months) >= 2 and statistics.pstdev(months) > 0:
        monthly_sharpe = statistics.fmean(months) / statistics.pstdev(months) * math.sqrt(12.0)
    years = max(0.25, (end - start) / (365.25 * DAY))
    annual: Dict[str, float] = {}
    for year in range(2023, 2027):
        y0 = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        y1 = int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        yvals = [float(row["return"]) for row in active if y0 <= int(row["ts"]) < y1]
        if yvals:
            annual[str(year)] = product(yvals) * 100.0
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "monthlyProfitFactor": profit_factor(months),
        "monthlySharpe": monthly_sharpe,
        "positiveMonthsPct": sum(value > 0 for value in months) / len(months) * 100.0 if months else None,
        "averageGross": statistics.fmean(float(row["gross"]) for row in active) if active else 0.0,
        "maxGross": max((float(row["gross"]) for row in active), default=0.0),
        "turnover": sum(float(row["turnover"]) for row in active),
        "stops": sum(int(row["stops"]) for row in active),
        "annualReturnsPct": annual,
        "months": len(months),
    }


def outer_folds(times: Sequence[int]) -> List[Tuple[int, int]]:
    boundaries = [
        (dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc), dt.datetime(2024, 7, 1, tzinfo=dt.timezone.utc)),
        (dt.datetime(2024, 7, 1, tzinfo=dt.timezone.utc), dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc)),
        (dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc), dt.datetime(2025, 7, 1, tzinfo=dt.timezone.utc)),
        (dt.datetime(2025, 7, 1, tzinfo=dt.timezone.utc), dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)),
        (dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc), dt.datetime(2026, 7, 1, tzinfo=dt.timezone.utc)),
    ]
    first = times[0]
    last = times[-1] + BAR
    return [(max(first, int(start.timestamp() * 1000)), min(last, int(end.timestamp() * 1000))) for start, end in boundaries if max(first, int(start.timestamp() * 1000)) < min(last, int(end.timestamp() * 1000))]


def inner_bounds(train_start: int, test_start: int) -> Tuple[int, int, int]:
    validation_start = max(train_start + 180 * DAY, test_start - 180 * DAY)
    return train_start, validation_start, test_start


def signal_neighbor(a: SignalConfig, b: SignalConfig) -> bool:
    return sum([a.regime_days != b.regime_days, a.asset_sma_days != b.asset_sma_days, a.momentum_days != b.momentum_days, a.top_k != b.top_k, a.rebalance_days != b.rebalance_days]) <= 1


def risk_neighbor(a: RiskConfig, b: RiskConfig) -> bool:
    return sum([a.bull_gross != b.bull_gross, a.bear_gross != b.bear_gross, a.stop_atr != b.stop_atr, a.target_vol_pct != b.target_vol_pct, a.max_symbol_gross != b.max_symbol_gross, a.dd_brake_start != b.dd_brake_start]) <= 1


def base_risk() -> RiskConfig:
    return RiskConfig(1.0, 0.5, 3.5, 55.0, 0.60, 0.18)


def pass_signal(normal_dev: dict, severe_dev: dict, normal_val: dict, severe_val: dict) -> bool:
    return bool(normal_dev["compoundedReturnPct"] > 0 and normal_dev["maxDrawdownPct"] >= -30 and severe_dev["compoundedReturnPct"] > -5 and normal_val["compoundedReturnPct"] > 0 and severe_val["compoundedReturnPct"] >= -2 and (normal_val["monthlyProfitFactor"] or 0) >= 1.0)


def pass_risk(normal_dev: dict, severe_dev: dict, normal_val: dict, severe_val: dict) -> bool:
    return bool(normal_dev["compoundedReturnPct"] > 0 and normal_dev["maxDrawdownPct"] >= -28 and severe_dev["compoundedReturnPct"] > 0 and severe_dev["maxDrawdownPct"] >= -40 and normal_val["compoundedReturnPct"] > 0 and normal_val["maxDrawdownPct"] >= -18 and severe_val["compoundedReturnPct"] >= 0 and severe_val["maxDrawdownPct"] >= -25 and (normal_val["monthlyProfitFactor"] or 0) >= 1.05)


def select_signal_members(configs: Sequence[SignalConfig], rows_by_id: Dict[str, List[dict]], severe_by_id: Dict[str, List[dict]], train_start: int, validation_start: int, validation_end: int) -> List[SignalConfig]:
    passed: List[SignalConfig] = []
    scored: List[Tuple[tuple, SignalConfig]] = []
    for config in configs:
        dev = metrics(rows_by_id[config.config_id], train_start, validation_start)
        dev_severe = metrics(severe_by_id[config.config_id], train_start, validation_start)
        val = metrics(rows_by_id[config.config_id], validation_start, validation_end)
        val_severe = metrics(severe_by_id[config.config_id], validation_start, validation_end)
        if pass_signal(dev, dev_severe, val, val_severe):
            passed.append(config)
            scored.append(((val_severe["compoundedReturnPct"], val["compoundedReturnPct"], val["maxDrawdownPct"], dev_severe["compoundedReturnPct"], -config.top_k, -config.rebalance_days), config))
    stable = [config for config in passed if sum(signal_neighbor(config, other) for other in passed if other != config) >= 2]
    stable_ids = {config.config_id for config in stable}
    ranked = [item for item in scored if item[1].config_id in stable_ids]
    ranked.sort(key=lambda item: item[0], reverse=True)
    selected: List[SignalConfig] = []
    for _, config in ranked:
        if not any(config.config_id == item.config_id for item in selected):
            selected.append(config)
        if len(selected) >= 5:
            break
    return selected


def select_risk(risks: Sequence[RiskConfig], rows_by_id: Dict[str, List[dict]], severe_by_id: Dict[str, List[dict]], train_start: int, validation_start: int, validation_end: int) -> Optional[RiskConfig]:
    passed: List[RiskConfig] = []
    scored: List[Tuple[tuple, RiskConfig]] = []
    for risk in risks:
        dev = metrics(rows_by_id[risk.config_id], train_start, validation_start)
        dev_severe = metrics(severe_by_id[risk.config_id], train_start, validation_start)
        val = metrics(rows_by_id[risk.config_id], validation_start, validation_end)
        val_severe = metrics(severe_by_id[risk.config_id], validation_start, validation_end)
        if pass_risk(dev, dev_severe, val, val_severe):
            passed.append(risk)
            scored.append(((val_severe["compoundedReturnPct"], val["compoundedReturnPct"], val["maxDrawdownPct"], dev_severe["compoundedReturnPct"], -risk.bull_gross, -risk.bear_gross, risk.stop_atr), risk))
    stable = [risk for risk in passed if sum(risk_neighbor(risk, other) for other in passed if other != risk) >= 2]
    stable_ids = {risk.config_id for risk in stable}
    ranked = [item for item in scored if item[1].config_id in stable_ids]
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        return None
    top_score = ranked[0][0]
    top = [risk for score, risk in ranked if score[0] >= top_score[0] - 1.0 and score[1] >= top_score[1] - 2.0]
    top.sort(key=lambda risk: (risk.bull_gross, risk.bear_gross, -risk.stop_atr, risk.target_vol_pct))
    return top[0]


def splice(rows_by_fold: Sequence[Tuple[int, int, List[dict]]]) -> List[dict]:
    result: List[dict] = []
    for start, end, rows in rows_by_fold:
        result.extend(row for row in rows if start <= int(row["ts"]) < end)
    return sorted(result, key=lambda row: int(row["ts"]))


def selected_final_signals(selections: Sequence[Sequence[SignalConfig]], all_configs: Sequence[SignalConfig]) -> List[SignalConfig]:
    counts: Dict[str, int] = {}
    for selection in selections:
        for config in selection:
            counts[config.config_id] = counts.get(config.config_id, 0) + 1
    lookup = {config.config_id: config for config in all_configs}
    ranked = sorted(counts, key=lambda key: (counts[key], -lookup[key].top_k, -lookup[key].rebalance_days), reverse=True)
    selected = [lookup[key] for key in ranked if counts[key] >= 2][:5]
    return selected if len(selected) >= 3 else [lookup[key] for key in ranked[:5]]


def selected_final_risk(selections: Sequence[RiskConfig]) -> RiskConfig:
    counts: Dict[str, int] = {}
    for risk in selections:
        counts[risk.config_id] = counts.get(risk.config_id, 0) + 1
    ranked = sorted(selections, key=lambda risk: (counts[risk.config_id], -risk.bull_gross, -risk.bear_gross, risk.stop_atr, -risk.dd_brake_start), reverse=True)
    return ranked[0]


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def deflated_sharpe(months: Sequence[float], trials: int) -> dict:
    if len(months) < 3 or statistics.pstdev(months) == 0:
        return {"sharpe": None, "expectedMaxSharpe": None, "probability": None}
    sr = statistics.fmean(months) / statistics.pstdev(months) * math.sqrt(12.0)
    n = len(months)
    euler = 0.5772156649
    z1 = statistics.NormalDist().inv_cdf(1.0 - 1.0 / max(2, trials))
    z2 = statistics.NormalDist().inv_cdf(1.0 - 1.0 / (max(2, trials) * math.e))
    expected_max = (1.0 - euler) * z1 + euler * z2
    mean = statistics.fmean(months)
    sd = statistics.pstdev(months)
    skew = sum((value - mean) ** 3 for value in months) / n / (sd ** 3)
    kurt = sum((value - mean) ** 4 for value in months) / n / (sd ** 4)
    denominator = math.sqrt(max(1e-12, 1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr))
    z = (sr - expected_max) * math.sqrt(max(1, n - 1)) / denominator
    return {"sharpe": sr, "expectedMaxSharpe": expected_max, "probability": normal_cdf(z)}


def block_bootstrap_indices(length: int, block: int, rng: random.Random) -> List[int]:
    result: List[int] = []
    while len(result) < length:
        start = rng.randrange(length)
        result.extend((start + offset) % length for offset in range(block))
    return result[:length]


def reality_and_spa(candidate_months: Dict[str, List[float]], benchmark: List[float], iterations: int = 1000) -> dict:
    common = min([len(benchmark), *(len(values) for values in candidate_months.values())])
    if common < 6:
        return {"realityCheckP": None, "spaApproxP": None, "observedMaxMean": None}
    differences = {key: [values[index] - benchmark[index] for index in range(common)] for key, values in candidate_months.items()}
    observed_means = {key: statistics.fmean(values) for key, values in differences.items()}
    observed_max = max(observed_means.values())
    observed_t = max(observed_means[key] / (statistics.pstdev(values) / math.sqrt(common)) if statistics.pstdev(values) > 0 else -999.0 for key, values in differences.items())
    centered = {key: [value - observed_means[key] for value in values] for key, values in differences.items()}
    rng = random.Random(RANDOM_SEED + 17)
    exceed_mean = exceed_t = 0
    for _ in range(iterations):
        indices = block_bootstrap_indices(common, 3, rng)
        bootstrap_means = {key: statistics.fmean(values[index] for index in indices) for key, values in centered.items()}
        if max(bootstrap_means.values()) >= observed_max:
            exceed_mean += 1
        t_values = []
        for values in centered.values():
            sample = [values[index] for index in indices]
            sd = statistics.pstdev(sample)
            t_values.append(statistics.fmean(sample) / (sd / math.sqrt(common)) if sd > 0 else -999.0)
        if max(t_values) >= observed_t:
            exceed_t += 1
    return {"realityCheckP": (exceed_mean + 1) / (iterations + 1), "spaApproxP": (exceed_t + 1) / (iterations + 1), "observedMaxMean": observed_max, "observedMaxT": observed_t, "iterations": iterations}


def permuted_bundle_indices(length: int, block_size: int, rng: random.Random) -> List[int]:
    blocks = [list(range(start, min(length, start + block_size))) for start in range(0, length, block_size)]
    rng.shuffle(blocks)
    return [index for block in blocks for index in block][:length]


def permutation_test(targets: Dict[int, Dict[str, float]], risk: RiskConfig, bars: Dict[str, List[dict]], features: dict, funding: Dict[str, Dict[int, float]], times: List[int], observed_return: float, iterations: int = 500) -> dict:
    rng = random.Random(RANDOM_SEED + 31)
    exceed = 0
    returns: List[float] = []
    for _ in range(iterations):
        shifted = permuted_bundle_indices(len(times), 60, rng)
        rows = simulate(targets, risk, bars, features, funding, times, False, shifted)
        value = metrics(rows, times[0], times[-1] + BAR)["compoundedReturnPct"]
        returns.append(value)
        if value >= observed_return:
            exceed += 1
    returns.sort()
    return {"pValue": (exceed + 1) / (iterations + 1), "iterations": iterations, "medianReturnPct": statistics.median(returns), "p95ReturnPct": returns[min(len(returns) - 1, int(0.95 * len(returns)))], "maxReturnPct": max(returns)}


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    bars, funding, times, coverage = fetch_data()
    features = build_features(bars)
    signals = signal_space()
    risks = risk_space()
    target_maps = {config.config_id: signal_targets(config, bars, times, features) for config in signals}
    baseline = base_risk()
    signal_rows = {config.config_id: simulate(target_maps[config.config_id], baseline, bars, features, funding, times, False) for config in signals}
    signal_severe = {config.config_id: simulate(target_maps[config.config_id], baseline, bars, features, funding, times, True) for config in signals}
    folds = outer_folds(times)
    train_start = times[0]
    fold_results = []
    signal_selections: List[List[SignalConfig]] = []
    risk_selections: List[RiskConfig] = []
    oos_normal_parts: List[Tuple[int, int, List[dict]]] = []
    oos_severe_parts: List[Tuple[int, int, List[dict]]] = []
    for fold_index, (test_start, test_end) in enumerate(folds):
        dev_start, validation_start, validation_end = inner_bounds(train_start, test_start)
        members = select_signal_members(signals, signal_rows, signal_severe, dev_start, validation_start, validation_end)
        if not members:
            raise RuntimeError(f"No stable signal ensemble for fold {fold_index}")
        signal_selections.append(members)
        ensemble_targets = average_targets([target_maps[item.config_id] for item in members], times)
        risk_rows = {risk.config_id: simulate(ensemble_targets, risk, bars, features, funding, times, False) for risk in risks}
        risk_severe = {risk.config_id: simulate(ensemble_targets, risk, bars, features, funding, times, True) for risk in risks}
        selected_risk = select_risk(risks, risk_rows, risk_severe, dev_start, validation_start, validation_end)
        if selected_risk is None:
            raise RuntimeError(f"No stable risk config for fold {fold_index}")
        risk_selections.append(selected_risk)
        test_normal = risk_rows[selected_risk.config_id]
        test_severe = risk_severe[selected_risk.config_id]
        oos_normal_parts.append((test_start, test_end, test_normal))
        oos_severe_parts.append((test_start, test_end, test_severe))
        fold_results.append({"fold": fold_index + 1, "testStart": dt.datetime.fromtimestamp(test_start / 1000, tz=dt.timezone.utc).isoformat(), "testEnd": dt.datetime.fromtimestamp(test_end / 1000, tz=dt.timezone.utc).isoformat(), "signalMembers": [asdict(item) for item in members], "risk": asdict(selected_risk), "test": metrics(test_normal, test_start, test_end), "testSevere": metrics(test_severe, test_start, test_end)})
    oos_normal = splice(oos_normal_parts)
    oos_severe = splice(oos_severe_parts)
    oos_start, oos_end = folds[0][0], folds[-1][1]
    final_signals = selected_final_signals(signal_selections, signals)
    final_risk = selected_final_risk(risk_selections)
    final_targets = average_targets([target_maps[item.config_id] for item in final_signals], times)
    final_rows = simulate(final_targets, final_risk, bars, features, funding, times, False)
    final_severe = simulate(final_targets, final_risk, bars, features, funding, times, True)
    full_start, full_end = times[0], times[-1] + BAR
    candidate_months: Dict[str, List[float]] = {}
    for risk in risks:
        candidate_months[risk.config_id] = monthly_returns(simulate(final_targets, risk, bars, features, funding, times, False), full_start, full_end)
    benchmark_months = monthly_returns(simulate(final_targets, base_risk(), bars, features, funding, times, False), full_start, full_end)
    months_oos = monthly_returns(oos_normal, oos_start, oos_end)
    dsr = deflated_sharpe(months_oos, len(signals) * len(folds) + len(risks) * len(folds))
    reality = reality_and_spa(candidate_months, benchmark_months, 1000)
    full_metric = metrics(final_rows, full_start, full_end)
    permutation = permutation_test(final_targets, final_risk, bars, features, funding, times, full_metric["compoundedReturnPct"], 500)
    positive_oos = sum(item["test"]["compoundedReturnPct"] > 0 for item in fold_results)
    positive_oos_severe = sum(item["testSevere"]["compoundedReturnPct"] > 0 for item in fold_results)
    oos_metric = metrics(oos_normal, oos_start, oos_end)
    oos_severe_metric = metrics(oos_severe, oos_start, oos_end)
    robust_pass = bool(positive_oos >= 4 and positive_oos_severe >= 3 and oos_metric["compoundedReturnPct"] > 0 and oos_severe_metric["compoundedReturnPct"] > 0 and oos_metric["maxDrawdownPct"] >= -25 and oos_severe_metric["maxDrawdownPct"] >= -35 and (dsr["probability"] or 0) >= 0.90 and (reality["realityCheckP"] is not None and reality["realityCheckP"] <= 0.10) and (permutation["pValue"] is not None and permutation["pValue"] <= 0.10))
    status = "MAJOR_CORE_ROBUST_PASS" if robust_pass else "MAJOR_CORE_RESEARCH_ONLY"
    frozen_payload = {"strategyId": "MAJOR_CORE_NESTED_V73", "effectiveAfter": "2026-07-20T00:00:00+00:00", "signalMembers": [asdict(item) for item in final_signals], "risk": asdict(final_risk), "cashReservePct": CASH_RESERVE * 100.0, "grossCap": GROSS_CAP, "minimumForwardTradesBeforeRetune": 30, "minimumForwardMonthsBeforeRetune": 6, "retuningForbiddenBeforeEitherThreshold": True}
    frozen_json = json.dumps(frozen_payload, sort_keys=True, separators=(",", ":"))
    frozen_payload["sha256"] = hashlib.sha256(frozen_json.encode("utf-8")).hexdigest()
    result = rounded({"version": 73, "strategyId": "MAJOR_CORE_NESTED_V73", "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": status, "robustPass": robust_pass, "universe": list(SYMBOLS), "period": {"start": dt.datetime.fromtimestamp(full_start / 1000, tz=dt.timezone.utc).isoformat(), "end": dt.datetime.fromtimestamp(full_end / 1000, tz=dt.timezone.utc).isoformat()}, "candidateCounts": {"signal": len(signals), "risk": len(risks)}, "outerFolds": fold_results, "outerOos": oos_metric, "outerOosSevere": oos_severe_metric, "positiveOuterFolds": positive_oos, "positiveOuterSevereFolds": positive_oos_severe, "selectedSignalMembers": [asdict(item) for item in final_signals], "selectedRisk": asdict(final_risk), "full": full_metric, "fullSevere": metrics(final_severe, full_start, full_end), "multipleTesting": {"deflatedSharpe": dsr, "whiteRealityCheckAndSpaApprox": reality, "monthlyBlockPermutation": permutation}, "forwardFreeze": frozen_payload, "coverage": coverage, "riskSpecification": {"execution": "Signals use completed 12h bars and execute from the next 12h open; Severe adds one-bar delay.", "longUniverse": list(SYMBOLS), "bearHedge": "BTC short only when BTC is below its regime SMA and momentum is negative.", "perSymbolHardStop": f"{final_risk.stop_atr} ATR fixed from entry; one 12h-bar cooldown after stop.", "targetVolatilityPct": final_risk.target_vol_pct, "maxSymbolGross": final_risk.max_symbol_gross, "majorCoreGrossCap": GROSS_CAP, "cashReservePct": CASH_RESERVE * 100.0, "drawdownBrake": {"startPct": final_risk.dd_brake_start * 100.0, "scaleAtStart": 0.65, "scaleAtAdditional8Pct": 0.40}, "normalCostBpsPerTurnover": NORMAL_COST_BPS, "severeCostBpsPerTurnover": SEVERE_COST_BPS, "severeAdverseBpsPerBarGross": SEVERE_ADVERSE_BPS}, "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False}, "limitations": ["The final configuration is derived from repeated historical research; the forward-freeze manifest is required before promotion.", "The multiple-testing procedures are implemented on monthly returns and 30-day decision blocks; they reduce but do not eliminate data-snooping risk.", "Only BTC, ETH, BNB and SOL are included to limit universe-selection and survivorship risk."]})
    (state_dir / "major-core-nested-v73.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "major-core-v73-forward-freeze.json").write_text(json.dumps(result["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8")
    report = ["# Major Core Nested Walk-forward V73", "", f"- Status: **{status}**", f"- Universe: {', '.join(SYMBOLS)}", f"- Outer OOS: {oos_metric['compoundedReturnPct']}% / CAGR {oos_metric['cagrPct']}% / DD {oos_metric['maxDrawdownPct']}%", f"- Outer OOS Severe: {oos_severe_metric['compoundedReturnPct']}% / DD {oos_severe_metric['maxDrawdownPct']}%", f"- Positive folds: {positive_oos}/{len(folds)}; Severe {positive_oos_severe}/{len(folds)}", f"- Full: {full_metric['compoundedReturnPct']}% / CAGR {full_metric['cagrPct']}% / DD {full_metric['maxDrawdownPct']}%", f"- Full Severe: {result['fullSevere']['compoundedReturnPct']}% / DD {result['fullSevere']['maxDrawdownPct']}%", f"- Deflated Sharpe probability: {dsr['probability']}", f"- White Reality Check p: {reality['realityCheckP']}", f"- SPA approximation p: {reality['spaApproxP']}", f"- 30-day decision-block permutation p: {permutation['pValue']}", "", "## Frozen risk", f"- Bull gross: {final_risk.bull_gross}", f"- BTC bear gross: {final_risk.bear_gross}", f"- Hard stop: {final_risk.stop_atr} ATR", f"- Target volatility: {final_risk.target_vol_pct}%", f"- Per-symbol gross cap: {final_risk.max_symbol_gross}", f"- Major-core gross cap: {GROSS_CAP}", f"- Cash reserve: {CASH_RESERVE * 100.0}%", f"- Freeze SHA256: `{result['forwardFreeze']['sha256']}`", "", "- Production / LIVE / VPS changed: **NO**"]
    (state_dir / "major-core-nested-v73.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
