from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49

HOUR = v47.HOUR
PROBE_GROSS = 0.05
FULL_GROSS = 0.15
ADD_GROSS = FULL_GROSS - PROBE_GROSS
CONFIRM_HOURS = 3
COOLDOWN_HOURS = 6
BASE_COST_PCT = 0.14
SEVERE_COST_PCT = 0.28


@dataclass(frozen=True)
class Candidate:
    side: int
    family: str
    lookback: int
    momentum1h: float
    momentum3h: float
    relative3h: float
    volume_acceleration: float
    volatility_expansion: float
    extreme_factor: float
    confirmation_move_pct: float
    exit_profile: str

    @property
    def candidate_id(self) -> str:
        side_name = "L" if self.side > 0 else "S"
        return (
            f"{side_name}_{self.family}_LB{self.lookback}"
            f"_M1{self.momentum1h:g}_M3{self.momentum3h:g}"
            f"_REL{self.relative3h:g}_VA{self.volume_acceleration:g}"
            f"_VX{self.volatility_expansion:g}_XF{self.extreme_factor:g}"
            f"_CF{self.confirmation_move_pct:g}_{self.exit_profile}"
        ).replace(".", "p")


@dataclass
class Trade:
    candidate_id: str
    signal_ts: int
    entry_ts: int
    add_ts: Optional[int]
    exit_ts: int
    side: int
    mode: str
    probe_gross: float
    add_gross: float
    total_gross: float
    entry_price: float
    add_price: Optional[float]
    exit_price: float
    gross_pct: float
    funding_pct: float
    base_pct: float
    severe_pct: float
    confirmed: bool
    partial_taken: bool
    exit_reason: str


def candidate_space(side: int) -> List[Candidate]:
    if side > 0:
        values = itertools.product(
            ("BREAK", "ACCEL"),
            (6, 12),
            (0.35, 0.65),
            (1.2, 2.0),
            (0.5, 1.0),
            (1.10, 1.40),
            (1.00, 1.20),
            (1.6, 2.2),
            (0.4, 0.7),
            ("FAST", "WIDE"),
        )
    else:
        values = itertools.product(
            ("BREAK", "ACCEL"),
            (6, 12),
            (0.55, 0.90),
            (1.5, 2.5),
            (0.5, 1.0),
            (1.05, 1.30),
            (0.95, 1.15),
            (1.4, 1.8),
            (0.4, 0.7),
            ("FAST", "WIDE"),
        )
    return [Candidate(side, *row) for row in values]


def prepare_features(pengu: List[dict], btc: List[dict]) -> dict:
    features = v49.prepare_features(pengu, btc)
    close = features["close"]
    features["sma12"] = v47.rolling_mean(close, 12)
    features["sma24"] = v47.rolling_mean(close, 24)
    features["sma72"] = v47.rolling_mean(close, 72)
    return features


def side_value(side: int, value: float) -> float:
    return side * value


def trend_allows(candidate: Candidate, rows: List[dict], index: int, features: dict) -> bool:
    close = float(rows[index]["close"])
    sma12 = features["sma12"][index]
    sma24 = features["sma24"][index]
    sma72 = features["sma72"][index]
    if sma12 is None or sma24 is None or sma72 is None:
        return False
    if candidate.side > 0:
        return close > sma12 > sma24 and close > sma72 * 0.98
    return close < sma12 < sma24 or close < sma72 * 0.98


def arm_signal(candidate: Candidate, rows: List[dict], index: int, features: dict, btc_index: int) -> tuple[bool, bool]:
    if index < max(200, candidate.lookback):
        return False, False
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    relative = features["relative3"][index]
    volume_acceleration = features["volumeAcceleration"][index]
    volatility_expansion = features["volatilityExpansion"][index]
    body_strength = features["bodyStrength"][index]
    direction_count = features["directionCount"][index]
    required = (m1, m3, relative, volume_acceleration, volatility_expansion, body_strength, direction_count)
    if any(value is None for value in required):
        return False, False
    if side_value(candidate.side, float(m1)) < candidate.momentum1h:
        return False, False
    if side_value(candidate.side, float(m3)) < candidate.momentum3h:
        return False, False
    if side_value(candidate.side, float(relative)) < candidate.relative3h:
        return False, False
    if float(volume_acceleration) < candidate.volume_acceleration:
        return False, False
    if float(volatility_expansion) < candidate.volatility_expansion:
        return False, False
    if side_value(candidate.side, float(body_strength)) < 0.25:
        return False, False
    if side_value(candidate.side, float(direction_count)) < 1:
        return False, False
    if not trend_allows(candidate, rows, index, features):
        return False, False
    close = float(rows[index]["close"])
    if candidate.family == "BREAK":
        prior = rows[index - candidate.lookback:index]
        boundary = max(float(row["high"]) for row in prior) if candidate.side > 0 else min(float(row["low"]) for row in prior)
        if candidate.side > 0 and close <= boundary:
            return False, False
        if candidate.side < 0 and close >= boundary:
            return False, False
    else:
        previous_m1 = features["mom1"][index - 1]
        if previous_m1 is None:
            return False, False
        acceleration = side_value(candidate.side, float(m1) - float(previous_m1))
        minimum_acceleration = 0.20 if candidate.side > 0 else 0.30
        if acceleration < minimum_acceleration:
            return False, False
    if not v49.btc_risk_allows(candidate.side, features, btc_index):
        return False, False
    extreme = bool(
        side_value(candidate.side, float(m1)) >= candidate.momentum1h * candidate.extreme_factor
        and side_value(candidate.side, float(m3)) >= candidate.momentum3h * candidate.extreme_factor
        and float(volume_acceleration) >= candidate.volume_acceleration * 1.25
        and float(volatility_expansion) >= candidate.volatility_expansion * 1.10
        and side_value(candidate.side, float(body_strength)) >= 0.60
        and side_value(candidate.side, float(direction_count)) >= 2
    )
    return True, extreme


def confirmation_index(candidate: Candidate, rows: List[dict], features: dict, signal_index: int) -> Optional[int]:
    signal_close = float(rows[signal_index]["close"])
    threshold = signal_close * (1.0 + candidate.side * candidate.confirmation_move_pct / 100.0)
    end_index = min(signal_index + CONFIRM_HOURS, len(rows) - 2)
    directional_closes = 0
    for cursor in range(signal_index + 1, end_index + 1):
        close = float(rows[cursor]["close"])
        previous = float(rows[cursor - 1]["close"])
        if side_value(candidate.side, close - previous) > 0:
            directional_closes += 1
        threshold_met = close >= threshold if candidate.side > 0 else close <= threshold
        current_m1 = features["mom1"][cursor]
        current_relative = features["relative3"][cursor]
        if (
            threshold_met
            and directional_closes >= 2
            and current_m1 is not None
            and current_relative is not None
            and side_value(candidate.side, float(current_m1)) >= candidate.momentum1h * 0.65
            and side_value(candidate.side, float(current_relative)) >= candidate.relative3h * 0.50
        ):
            return cursor
    return None


def funding_decimal(points: List[dict], start: int, end: int) -> float:
    return sum(float(point["rate"]) for point in points if start <= int(point["ts"]) < end)


def side_return(side: int, entry: float, exit_price: float) -> float:
    return side * (exit_price / entry - 1.0)


def cost_amount(gross: float, severe: bool = False) -> float:
    rate = SEVERE_COST_PCT if severe else BASE_COST_PCT
    return gross * rate / 100.0


def make_unconfirmed_probe(candidate: Candidate, rows: List[dict], funding: List[dict], features: dict, signal_index: int) -> Optional[Trade]:
    profile = v49.exit_profile(candidate)
    entry_index = signal_index + 1
    if entry_index + CONFIRM_HOURS >= len(rows):
        return None
    entry_ts = int(rows[entry_index]["ts"])
    entry_price = float(rows[entry_index]["open"])
    atr = features["atr24"][signal_index]
    if atr is None or atr <= 0:
        return None
    stop = entry_price - candidate.side * profile.stop_atr * float(atr)
    end_index = entry_index + CONFIRM_HOURS - 1
    exit_index = end_index
    exit_price = float(rows[end_index]["close"])
    reason = "NO_FOLLOW_THROUGH"
    for cursor in range(entry_index, end_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        stop_hit = low <= stop if candidate.side > 0 else high >= stop
        if stop_hit:
            exit_index = cursor
            exit_price = stop
            reason = "PROBE_STOP"
            break
    exit_ts = int(rows[exit_index]["ts"]) + HOUR
    gross_account = PROBE_GROSS * side_return(candidate.side, entry_price, exit_price)
    funding_account = PROBE_GROSS * candidate.side * funding_decimal(funding, entry_ts, exit_ts)
    return Trade(
        candidate_id=candidate.candidate_id,
        signal_ts=int(rows[signal_index]["ts"]),
        entry_ts=entry_ts,
        add_ts=None,
        exit_ts=exit_ts,
        side=candidate.side,
        mode="EXTREME_PROBE_ONLY",
        probe_gross=PROBE_GROSS,
        add_gross=0.0,
        total_gross=PROBE_GROSS,
        entry_price=entry_price,
        add_price=None,
        exit_price=exit_price,
        gross_pct=gross_account * 100.0,
        funding_pct=funding_account * 100.0,
        base_pct=(gross_account - funding_account - cost_amount(PROBE_GROSS)) * 100.0,
        severe_pct=(gross_account - funding_account - cost_amount(PROBE_GROSS, True)) * 100.0,
        confirmed=False,
        partial_taken=False,
        exit_reason=reason,
    )


def make_confirmed_trade(candidate: Candidate, rows: List[dict], funding: List[dict], features: dict, signal_index: int, confirm_index: int, extreme: bool) -> Optional[Trade]:
    profile = v49.exit_profile(candidate)
    initial_entry_index = signal_index + 1 if extreme else confirm_index + 1
    add_index = confirm_index + 1 if extreme else None
    if initial_entry_index >= len(rows):
        return None
    entry_ts = int(rows[initial_entry_index]["ts"])
    entry_price = float(rows[initial_entry_index]["open"])
    if extreme:
        if add_index is None or add_index >= len(rows):
            return None
        add_ts = int(rows[add_index]["ts"])
        add_price = float(rows[add_index]["open"])
        weighted_entry = (PROBE_GROSS * entry_price + ADD_GROSS * add_price) / FULL_GROSS
        probe_gross = PROBE_GROSS
        add_gross = ADD_GROSS
        position_start_index = add_index
        mode = "EXTREME_PROBE_ADD"
    else:
        add_ts = None
        add_price = None
        weighted_entry = entry_price
        probe_gross = 0.0
        add_gross = FULL_GROSS
        position_start_index = initial_entry_index
        mode = "ARMED_CONFIRMED_FULL"
    atr = features["atr24"][signal_index]
    if atr is None or atr <= 0:
        return None
    atr = float(atr)
    fixed_stop = weighted_entry - candidate.side * profile.stop_atr * atr
    take_profit = weighted_entry + candidate.side * profile.take_profit_atr * atr
    best_price = weighted_entry
    maximum_exit_index = min(position_start_index + profile.maximum_hold_hours, len(rows) - 1)
    final_exit_index = maximum_exit_index
    final_exit_price = float(rows[final_exit_index]["close"])
    partial_index: Optional[int] = None
    partial_price: Optional[float] = None
    reason = "TIME"
    for cursor in range(position_start_index, maximum_exit_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        active_stop = max(fixed_stop, best_price - profile.trail_atr * atr) if candidate.side > 0 else min(fixed_stop, best_price + profile.trail_atr * atr)
        stop_hit = low <= active_stop if candidate.side > 0 else high >= active_stop
        if stop_hit:
            final_exit_index = cursor
            final_exit_price = active_stop
            reason = "TRAIL_OR_STOP"
            break
        if partial_index is None:
            target_hit = high >= take_profit if candidate.side > 0 else low <= take_profit
            if target_hit:
                partial_index = cursor
                partial_price = take_profit
        best_price = max(best_price, high) if candidate.side > 0 else min(best_price, low)
    final_exit_ts = int(rows[final_exit_index]["ts"]) + HOUR
    legs: List[tuple[float, float, int]] = []
    if extreme:
        legs.append((PROBE_GROSS, entry_price, entry_ts))
        assert add_price is not None and add_ts is not None
        legs.append((ADD_GROSS, add_price, add_ts))
    else:
        legs.append((FULL_GROSS, entry_price, entry_ts))
    gross_account = 0.0
    funding_account = 0.0
    if partial_index is not None and partial_price is not None:
        partial_exit_ts = int(rows[partial_index]["ts"]) + HOUR
        for gross, price, leg_start in legs:
            gross_account += gross * 0.5 * side_return(candidate.side, price, partial_price)
            gross_account += gross * 0.5 * side_return(candidate.side, price, final_exit_price)
            funding_account += candidate.side * gross * 0.5 * funding_decimal(funding, leg_start, partial_exit_ts)
            funding_account += candidate.side * gross * 0.5 * funding_decimal(funding, leg_start, final_exit_ts)
    else:
        for gross, price, leg_start in legs:
            gross_account += gross * side_return(candidate.side, price, final_exit_price)
            funding_account += candidate.side * gross * funding_decimal(funding, leg_start, final_exit_ts)
    return Trade(
        candidate_id=candidate.candidate_id,
        signal_ts=int(rows[signal_index]["ts"]),
        entry_ts=entry_ts,
        add_ts=add_ts,
        exit_ts=final_exit_ts,
        side=candidate.side,
        mode=mode,
        probe_gross=probe_gross,
        add_gross=add_gross,
        total_gross=FULL_GROSS,
        entry_price=entry_price,
        add_price=add_price,
        exit_price=final_exit_price,
        gross_pct=gross_account * 100.0,
        funding_pct=funding_account * 100.0,
        base_pct=(gross_account - funding_account - cost_amount(FULL_GROSS)) * 100.0,
        severe_pct=(gross_account - funding_account - cost_amount(FULL_GROSS, True)) * 100.0,
        confirmed=True,
        partial_taken=partial_index is not None,
        exit_reason=reason,
    )


def run_candidate(candidate: Candidate, pengu: List[dict], btc: List[dict], funding: List[dict], features: dict) -> tuple[List[Trade], int]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[Trade] = []
    armed_without_order = 0
    next_free_ts = 0
    for index in range(200, len(pengu) - 60):
        ts = int(pengu[index]["ts"])
        if ts < next_free_ts:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None:
            continue
        armed, extreme = arm_signal(candidate, pengu, index, features, btc_index)
        if not armed:
            continue
        latest_funding = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if candidate.side > 0 and (latest_funding is None or latest_funding > 0.0003):
            continue
        confirmed_at = confirmation_index(candidate, pengu, features, index)
        trade: Optional[Trade]
        if confirmed_at is not None:
            trade = make_confirmed_trade(candidate, pengu, funding, features, index, confirmed_at, extreme)
        elif extreme:
            trade = make_unconfirmed_probe(candidate, pengu, funding, features, index)
        else:
            armed_without_order += 1
            next_free_ts = int(pengu[index]["ts"]) + CONFIRM_HOURS * HOUR
            continue
        if trade is None:
            continue
        trades.append(trade)
        next_free_ts = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades, armed_without_order


def metrics(trades: Iterable[Trade], start: int, end: int, severe: bool = False) -> dict:
    active = [trade for trade in trades if start <= trade.entry_ts and trade.exit_ts <= end]
    equity = peak = 1.0
    max_dd = 0.0
    values: List[float] = []
    for trade in active:
        value = (trade.severe_pct if severe else trade.base_pct) / 100.0
        values.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    gains = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    return {
        "trades": len(active),
        "confirmedTrades": sum(trade.confirmed for trade in active),
        "probeOnlyTrades": sum(not trade.confirmed for trade in active),
        "extremeProbeAddTrades": sum(trade.mode == "EXTREME_PROBE_ADD" for trade in active),
        "armedConfirmedTrades": sum(trade.mode == "ARMED_CONFIRMED_FULL" for trade in active),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "profitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
        "maxDrawdownPct": max_dd * 100.0,
        "averageTradePct": statistics.fmean(values) * 100.0 if values else None,
    }


def fold_bounds(rows: List[dict], count: int = 5) -> List[tuple[int, int]]:
    start = int(rows[0]["ts"])
    end = int(rows[-1]["ts"]) + HOUR
    span = end - start
    return [(start + span * index // count, start + span * (index + 1) // count) for index in range(count)]


def wave_events(rows: List[dict], horizon_hours: int, threshold_pct: float) -> List[dict]:
    candidates = []
    for index in range(200, len(rows) - horizon_hours - 1):
        start_index = index + 1
        end_index = start_index + horizon_hours
        start_price = float(rows[start_index]["open"])
        end_price = float(rows[end_index]["open"])
        move = (end_price / start_price - 1.0) * 100.0
        if abs(move) >= threshold_pct:
            candidates.append({
                "startTs": int(rows[start_index]["ts"]),
                "endTs": int(rows[end_index]["ts"]),
                "side": 1 if move > 0 else -1,
                "movePct": move,
            })
    events: List[dict] = []
    for item in candidates:
        if events and events[-1]["side"] == item["side"] and item["startTs"] <= events[-1]["endTs"]:
            events[-1]["endTs"] = max(events[-1]["endTs"], item["endTs"])
            if abs(item["movePct"]) > abs(events[-1]["maxMovePct"]):
                events[-1]["maxMovePct"] = item["movePct"]
                events[-1]["peakWindowStartTs"] = item["startTs"]
        else:
            events.append({
                "startTs": item["startTs"],
                "endTs": item["endTs"],
                "side": item["side"],
                "maxMovePct": item["movePct"],
                "peakWindowStartTs": item["startTs"],
            })
    return events


def capture_metrics(trades: List[Trade], events: List[dict], early_hours: int, side: Optional[int] = None) -> dict:
    selected_events = [event for event in events if side is None or int(event["side"]) == side]
    details = []
    for event in selected_events:
        matching = [trade for trade in trades if trade.side == event["side"] and event["startTs"] <= trade.entry_ts <= event["endTs"]]
        early = [trade for trade in matching if trade.entry_ts <= event["startTs"] + early_hours * HOUR]
        profitable = [trade for trade in matching if trade.base_pct > 0]
        details.append({
            **event,
            "captured": bool(matching),
            "earlyCaptured": bool(early),
            "profitableCaptured": bool(profitable),
            "matchingTrades": len(matching),
            "tradeEntries": [trade.entry_ts for trade in matching],
            "tradeReturnsPct": [trade.base_pct for trade in matching],
        })
    return {
        "events": len(details),
        "capturedEvents": sum(item["captured"] for item in details),
        "earlyCapturedEvents": sum(item["earlyCaptured"] for item in details),
        "profitableCapturedEvents": sum(item["profitableCaptured"] for item in details),
        "captureRatePct": sum(item["captured"] for item in details) / len(details) * 100.0 if details else None,
        "earlyCaptureRatePct": sum(item["earlyCaptured"] for item in details) / len(details) * 100.0 if details else None,
        "details": details,
    }


def events_by_fold(events: List[dict], folds: List[tuple[int, int]]) -> List[List[dict]]:
    return [[event for event in events if start <= event["startTs"] < end] for start, end in folds]


def candidate_summary(candidate: Candidate, trades: List[Trade], armed_without_order: int, folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> dict:
    fold_metrics = [metrics(trades, start, end) for start, end in folds]
    fold_severe = [metrics(trades, start, end, True) for start, end in folds]
    train_start = folds[0][0]
    train_end = folds[2][1]
    validation_start, validation_end = folds[3]
    holdout_start, holdout_end = folds[4]
    train = metrics(trades, train_start, train_end)
    train_severe = metrics(trades, train_start, train_end, True)
    validation = metrics(trades, validation_start, validation_end)
    validation_severe = metrics(trades, validation_start, validation_end, True)
    holdout = metrics(trades, holdout_start, holdout_end)
    holdout_severe = metrics(trades, holdout_start, holdout_end, True)
    captures = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        captures.append({
            "6h5": capture_metrics(fold_trades, proxies["6h5"][index], 3, candidate.side),
            "12h8": capture_metrics(fold_trades, proxies["12h8"][index], 4, candidate.side),
            "24h12": capture_metrics(fold_trades, proxies["24h12"][index], 6, candidate.side),
        })
    train_captured = sum(captures[index][name]["capturedEvents"] for index in range(3) for name in ("6h5", "12h8", "24h12"))
    train_early = sum(captures[index][name]["earlyCapturedEvents"] for index in range(3) for name in ("6h5", "12h8", "24h12"))
    validation_events = sum(captures[3][name]["events"] for name in ("6h5", "12h8", "24h12"))
    validation_captured = sum(captures[3][name]["capturedEvents"] for name in ("6h5", "12h8", "24h12"))
    validation_early = sum(captures[3][name]["earlyCapturedEvents"] for name in ("6h5", "12h8", "24h12"))
    positive_train_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_metrics[:3])
    severe_positive_train_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_severe[:3])
    minimum_train_trades = 8 if candidate.side < 0 else 6
    train_passed = bool(
        train["trades"] >= minimum_train_trades
        and train["compoundedReturnPct"] > 0
        and (train["profitFactor"] or 0) >= 1.15
        and train["maxDrawdownPct"] >= -5
        and train_severe["compoundedReturnPct"] > 0
        and positive_train_folds >= 2
        and severe_positive_train_folds >= 2
        and train_captured >= 2
        and train_early >= 1
    )
    validation_passed = bool(
        train_passed
        and validation["trades"] >= 2
        and validation["compoundedReturnPct"] > 0
        and (validation["profitFactor"] or 0) >= 1.0
        and validation["maxDrawdownPct"] >= -3
        and validation_severe["compoundedReturnPct"] > 0
        and (validation_events == 0 or (validation_captured >= 1 and validation_early >= 1))
    )
    return {
        "candidate": asdict(candidate),
        "folds": fold_metrics,
        "foldsSevere": fold_severe,
        "captures": captures,
        "train": train,
        "trainSevere": train_severe,
        "validation": validation,
        "validationSevere": validation_severe,
        "holdout": holdout,
        "holdoutSevere": holdout_severe,
        "armedWithoutOrder": armed_without_order,
        "positiveTrainFolds": positive_train_folds,
        "severePositiveTrainFolds": severe_positive_train_folds,
        "trainCapturedEvents": train_captured,
        "trainEarlyCapturedEvents": train_early,
        "validationProxyEvents": validation_events,
        "validationCapturedEvents": validation_captured,
        "validationEarlyCapturedEvents": validation_early,
        "trainPassed": train_passed,
        "validationPassed": validation_passed,
        "trades": [asdict(trade) for trade in trades],
    }


def cluster_key(item: dict) -> tuple:
    candidate = item["candidate"]
    return (candidate["side"], candidate["family"], candidate["lookback"], candidate["exit_profile"], candidate["extreme_factor"])


def rank_key(item: dict) -> tuple:
    validation = item["validation"]
    severe = item["validationSevere"]
    train = item["train"]
    return (
        item["validationEarlyCapturedEvents"],
        item["validationCapturedEvents"],
        severe["compoundedReturnPct"],
        validation["compoundedReturnPct"],
        validation["profitFactor"] or 0,
        item["positiveTrainFolds"],
        train["compoundedReturnPct"],
        train["maxDrawdownPct"],
    )


def rebuild_trades(item: Optional[dict]) -> List[Trade]:
    if not item:
        return []
    return [Trade(**row) for row in item["trades"]]


def combine_sides(long_trades: List[Trade], short_trades: List[Trade]) -> List[Trade]:
    grouped: Dict[int, List[Trade]] = {}
    for trade in [*long_trades, *short_trades]:
        grouped.setdefault(trade.entry_ts, []).append(trade)
    result: List[Trade] = []
    next_free_ts = 0
    for entry_ts in sorted(grouped):
        if entry_ts < next_free_ts:
            continue
        choices = grouped[entry_ts]
        selected = next((trade for trade in choices if trade.side < 0), choices[0])
        result.append(selected)
        next_free_ts = selected.exit_ts
    return result


def adoption_gate(item: Optional[dict], trades: List[Trade], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    if item is None:
        return False, {"reason": "NO_SELECTED_CANDIDATE"}
    holdout = item["holdout"]
    holdout_severe = item["holdoutSevere"]
    audit24 = capture_metrics(trades, major24, 6, side)
    audit72 = capture_metrics(trades, major72, 12, side)
    total_events = audit24["events"] + audit72["events"]
    early_events = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable_events = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early_events / total_events * 100.0 if total_events else None
    profitable_rate = profitable_events / total_events * 100.0 if total_events else None
    passed = bool(
        holdout["trades"] >= 2
        and holdout["compoundedReturnPct"] > 0
        and holdout_severe["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.05
        and total_events > 0
        and early_rate is not None
        and early_rate >= 50.0
        and profitable_rate is not None
        and profitable_rate >= 50.0
    )
    return passed, {
        "holdout": holdout,
        "holdoutSevere": holdout_severe,
        "major24": audit24,
        "major72": audit72,
        "totalMajorEvents": total_events,
        "earlyMajorEvents": early_events,
        "profitableMajorEvents": profitable_events,
        "earlyMajorRatePct": early_rate,
        "profitableMajorRatePct": profitable_rate,
    }


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


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
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V50")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    if len(pengu) < 3000 or len(btc) < 3000:
        raise RuntimeError("Insufficient history")
    features = prepare_features(pengu, btc)
    folds = fold_bounds(pengu, 5)
    proxy_raw = {
        "6h5": wave_events(pengu, 6, 5.0),
        "12h8": wave_events(pengu, 12, 8.0),
        "24h12": wave_events(pengu, 24, 12.0),
    }
    proxies = {name: events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = wave_events(pengu, 24, 20.0)
    major72 = wave_events(pengu, 72, 35.0)
    summaries: Dict[str, dict] = {}
    candidate_counts = {1: 0, -1: 0}
    for side in (-1, 1):
        candidates = candidate_space(side)
        candidate_counts[side] = len(candidates)
        print(f"Evaluating {'Short' if side < 0 else 'Long'} {len(candidates)} candidates")
        for position, candidate in enumerate(candidates, start=1):
            if position % 200 == 0:
                print(f"{'Short' if side < 0 else 'Long'} {position}/{len(candidates)}")
            trades, armed_without_order = run_candidate(candidate, pengu, btc, funding, features)
            summaries[candidate.candidate_id] = candidate_summary(candidate, trades, armed_without_order, folds, proxies)
    cluster_counts: Dict[tuple, int] = {}
    for item in summaries.values():
        if item["validationPassed"]:
            key = cluster_key(item)
            cluster_counts[key] = cluster_counts.get(key, 0) + 1
    eligible_by_side: Dict[int, List[str]] = {1: [], -1: []}
    for candidate_id, item in summaries.items():
        item["validationClusterSize"] = cluster_counts.get(cluster_key(item), 0)
        if item["validationPassed"] and item["validationClusterSize"] >= 2:
            side = int(item["candidate"]["side"])
            eligible_by_side[side].append(candidate_id)
    for side in (-1, 1):
        eligible_by_side[side].sort(key=lambda key: rank_key(summaries[key]), reverse=True)
    selected_short = eligible_by_side[-1][0] if eligible_by_side[-1] else None
    selected_long = eligible_by_side[1][0] if eligible_by_side[1] else None
    short_item = summaries[selected_short] if selected_short else None
    long_item = summaries[selected_long] if selected_long else None
    short_trades = rebuild_trades(short_item)
    long_trades = rebuild_trades(long_item)
    short_enabled, short_gate = adoption_gate(short_item, short_trades, major24, major72, -1)
    long_enabled, long_gate = adoption_gate(long_item, long_trades, major24, major72, 1)
    enabled_long_trades = long_trades if long_enabled else []
    enabled_short_trades = short_trades if short_enabled else []
    combined = combine_sides(enabled_long_trades, enabled_short_trades)
    train_start = folds[0][0]
    train_end = folds[2][1]
    validation_start, validation_end = folds[3]
    holdout_start, holdout_end = folds[4]
    combined_result = {
        "train": metrics(combined, train_start, train_end),
        "trainSevere": metrics(combined, train_start, train_end, True),
        "validation": metrics(combined, validation_start, validation_end),
        "validationSevere": metrics(combined, validation_start, validation_end, True),
        "holdout": metrics(combined, holdout_start, holdout_end),
        "holdoutSevere": metrics(combined, holdout_start, holdout_end, True),
        "full": metrics(combined, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(combined, folds[0][0], folds[-1][1], True),
        "major24": capture_metrics(combined, major24, 6),
        "major72": capture_metrics(combined, major72, 12),
        "trades": [asdict(trade) for trade in combined],
    }
    status = (
        "SHORT_AND_LONG_ENABLED" if short_enabled and long_enabled
        else "SHORT_ONLY_ENABLED" if short_enabled
        else "LONG_ONLY_ENABLED" if long_enabled
        else "NO_PRODUCTION_CANDIDATE"
    )
    result = rounded({
        "version": 50,
        "strategyId": "PENGU_WAVE_SLEEVE_V50_SEPARATE_ADAPTIVE",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "basePr": 42,
        "baseCommit": "ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "design": {
            "decisionIntervalHours": 1,
            "confirmationWindowHours": CONFIRM_HOURS,
            "extremeProbeGross": PROBE_GROSS,
            "confirmedGross": FULL_GROSS,
            "ordinarySignalMode": "ARMED_NO_ORDER",
            "longShortSeparate": True,
            "shortPriority": True,
            "longDisabledUntilGate": True,
            "fundingFailClosedLong": True,
            "fundingIndependentShort": True,
            "sameCandleStopPriority": True,
        },
        "candidateCounts": {"long": candidate_counts[1], "short": candidate_counts[-1]},
        "folds": [{"start": iso(start), "end": iso(end)} for start, end in folds],
        "selectedShort": selected_short,
        "selectedLong": selected_long,
        "eligibleShortCount": len(eligible_by_side[-1]),
        "eligibleLongCount": len(eligible_by_side[1]),
        "selectedShortResult": short_item,
        "selectedLongResult": long_item,
        "shortAdoptionGatePassed": short_enabled,
        "longAdoptionGatePassed": long_enabled,
        "shortGateEvidence": short_gate,
        "longGateEvidence": long_gate,
        "combinedEnabled": combined_result,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "The final chronological 20% is untouched during selection.",
            "Long and Short candidate spaces and gates are separate.",
            "Short is selected and evaluated first and wins conflicts.",
            "A side is disabled unless untouched Holdout Severe is positive and at least half of side-specific major waves are captured early and profitably.",
            "Major-wave counts remain small and require forward evidence before LIVE use.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "pengu-wave-sleeve-v50.json"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    short_holdout = short_gate.get("holdout", {})
    long_holdout = long_gate.get("holdout", {})
    report = [
        "# PENGU Wave Sleeve V50 Separate Adaptive",
        "",
        f"- Status: **{status}**",
        "- Decision interval: **1 hour**",
        "- Ordinary candidates: **armed, no order**",
        "- Extreme candidates: **0.05 immediate probe**",
        "- Confirmation within 3h: **0.15 total Gross**",
        f"- Selected Short: **{selected_short or 'NONE'}**",
        f"- Selected Long: **{selected_long or 'NONE'}**",
        f"- Short gate: **{'PASS' if short_enabled else 'FAIL'}**",
        f"- Long gate: **{'PASS' if long_enabled else 'FAIL'}**",
        "",
        "## Short",
        "",
        f"- Holdout: {short_holdout.get('compoundedReturnPct')}% / PF {short_holdout.get('profitFactor')} / DD {short_holdout.get('maxDrawdownPct')}%",
        f"- Holdout Severe: {short_gate.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Major early rate: {short_gate.get('earlyMajorRatePct')}%",
        "",
        "## Long",
        "",
        f"- Holdout: {long_holdout.get('compoundedReturnPct')}% / PF {long_holdout.get('profitFactor')} / DD {long_holdout.get('maxDrawdownPct')}%",
        f"- Holdout Severe: {long_gate.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Major early rate: {long_gate.get('earlyMajorRatePct')}%",
        "",
        "## Enabled portfolio",
        "",
        f"- Holdout: {combined_result['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {combined_result['holdoutSevere']['compoundedReturnPct']}%",
        f"- Full: {combined_result['full']['compoundedReturnPct']}%",
        f"- Major 24h early: {combined_result['major24']['earlyCapturedEvents']}/{combined_result['major24']['events']}",
        f"- Major 72h early: {combined_result['major72']['earlyCapturedEvents']}/{combined_result['major72']['events']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    md_path = state_dir / "pengu-wave-sleeve-v50.md"
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
