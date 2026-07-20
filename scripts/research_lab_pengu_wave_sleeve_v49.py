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

HOUR = v47.HOUR
PROBE_GROSS = 0.05
ADD_GROSS = 0.10
TOTAL_GROSS = PROBE_GROSS + ADD_GROSS
BASE_COST_PCT = 0.14
SEVERE_COST_PCT = 0.28
CONFIRM_HOURS = 3
COOLDOWN_HOURS = 6


@dataclass(frozen=True)
class ExitProfile:
    name: str
    stop_atr: float
    take_profit_atr: float
    trail_atr: float
    maximum_hold_hours: int


EXIT_PROFILES = (
    ExitProfile("FAST", 1.2, 2.0, 1.8, 24),
    ExitProfile("WIDE", 1.8, 3.0, 2.8, 48),
)


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
    confirmation_move_pct: float
    exit_profile: str

    @property
    def candidate_id(self) -> str:
        side = "L" if self.side > 0 else "S"
        values = (
            f"{side}_{self.family}_LB{self.lookback}"
            f"_M1{self.momentum1h:g}_M3{self.momentum3h:g}"
            f"_REL{self.relative3h:g}_VA{self.volume_acceleration:g}"
            f"_VX{self.volatility_expansion:g}_CF{self.confirmation_move_pct:g}"
            f"_{self.exit_profile}"
        )
        return values.replace(".", "p")


@dataclass
class Trade:
    candidate_id: str
    signal_ts: int
    entry_ts: int
    add_ts: Optional[int]
    exit_ts: int
    side: int
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


def candidate_space() -> List[Candidate]:
    result: List[Candidate] = []
    for values in itertools.product(
        (1, -1),
        ("BREAK", "ACCEL"),
        (12, 24),
        (1.0, 1.6),
        (2.5, 4.0),
        (1.0, 2.0),
        (1.4, 1.9),
        (1.10, 1.35),
        (0.6, 1.0),
        ("FAST", "WIDE"),
    ):
        result.append(Candidate(*values))
    return result


def rolling_sum(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= length:
            total -= values[index - length]
        if index >= length - 1:
            result[index] = total
    return result


def prepare_features(pengu: List[dict], btc: List[dict]) -> dict:
    close = [float(row["close"]) for row in pengu]
    volume = [float(row["volume"]) for row in pengu]
    tr = v47.true_range(pengu)
    btc_close = [float(row["close"]) for row in btc]

    volume3 = rolling_sum(volume, 3)
    volume24 = rolling_sum(volume, 24)
    atr6 = v47.rolling_mean(tr, 6)
    atr72 = v47.rolling_mean(tr, 72)
    p_mom1 = v47.momentum(close, 1)
    p_mom3 = v47.momentum(close, 3)
    b_mom3 = v47.momentum(btc_close, 3)

    volume_acceleration: List[Optional[float]] = [None] * len(pengu)
    volatility_expansion: List[Optional[float]] = [None] * len(pengu)
    relative3: List[Optional[float]] = [None] * len(pengu)
    body_strength: List[Optional[float]] = [None] * len(pengu)
    direction_count: List[Optional[int]] = [None] * len(pengu)

    for index, row in enumerate(pengu):
        if volume3[index] is not None and volume24[index] and volume24[index] > 0:
            volume_acceleration[index] = (volume3[index] / 3.0) / (volume24[index] / 24.0)
        if atr6[index] is not None and atr72[index] and atr72[index] > 0:
            volatility_expansion[index] = atr6[index] / atr72[index]
        if p_mom3[index] is not None and index < len(b_mom3) and b_mom3[index] is not None:
            relative3[index] = p_mom3[index] - b_mom3[index]
        candle_range = float(row["high"]) - float(row["low"])
        if candle_range > 0:
            body_strength[index] = (float(row["close"]) - float(row["open"])) / candle_range
        if index >= 2:
            signs = []
            for cursor in range(index - 2, index + 1):
                change = float(pengu[cursor]["close"]) - float(pengu[cursor]["open"])
                signs.append(1 if change > 0 else -1 if change < 0 else 0)
            direction_count[index] = sum(signs)

    return {
        "close": close,
        "mom1": p_mom1,
        "mom3": p_mom3,
        "relative3": relative3,
        "volumeAcceleration": volume_acceleration,
        "volatilityExpansion": volatility_expansion,
        "bodyStrength": body_strength,
        "directionCount": direction_count,
        "atr24": v47.rolling_mean(tr, 24),
        "btcMom24": v47.momentum(btc_close, 24),
        "btcSma168": v47.rolling_mean(btc_close, 168),
        "btcClose": btc_close,
    }


def exit_profile(candidate: Candidate) -> ExitProfile:
    return next(profile for profile in EXIT_PROFILES if profile.name == candidate.exit_profile)


def btc_risk_allows(side: int, features: dict, btc_index: int) -> bool:
    mom = features["btcMom24"][btc_index]
    sma = features["btcSma168"][btc_index]
    close = features["btcClose"][btc_index]
    if mom is None or sma is None:
        return False
    if side > 0:
        return not (close < sma and mom < -4.0)
    return not (close > sma and mom > 6.0)


def probe_signal(
    candidate: Candidate,
    rows: List[dict],
    index: int,
    features: dict,
    btc_index: int,
) -> bool:
    if index < max(200, candidate.lookback):
        return False
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    relative = features["relative3"][index]
    volume_acceleration = features["volumeAcceleration"][index]
    volatility_expansion = features["volatilityExpansion"][index]
    body_strength = features["bodyStrength"][index]
    direction_count = features["directionCount"][index]
    if any(value is None for value in (
        m1, m3, relative, volume_acceleration, volatility_expansion,
        body_strength, direction_count,
    )):
        return False
    if candidate.side * m1 < candidate.momentum1h:
        return False
    if candidate.side * m3 < candidate.momentum3h:
        return False
    if candidate.side * relative < candidate.relative3h:
        return False
    if volume_acceleration < candidate.volume_acceleration:
        return False
    if volatility_expansion < candidate.volatility_expansion:
        return False
    if candidate.side * body_strength < 0.45:
        return False
    if candidate.side * direction_count < 1:
        return False

    close = float(rows[index]["close"])
    if candidate.family == "BREAK":
        prior = rows[index - candidate.lookback:index]
        boundary = (
            max(float(row["high"]) for row in prior)
            if candidate.side > 0
            else min(float(row["low"]) for row in prior)
        )
        if candidate.side > 0 and close <= boundary:
            return False
        if candidate.side < 0 and close >= boundary:
            return False
    else:
        previous_m1 = features["mom1"][index - 1]
        if previous_m1 is None or candidate.side * (m1 - previous_m1) < 0.35:
            return False

    return btc_risk_allows(candidate.side, features, btc_index)


def funding_decimal(points: List[dict], start: int, end: int) -> float:
    return sum(float(point["rate"]) for point in points if start <= int(point["ts"]) < end)


def side_return(side: int, entry: float, exit_price: float) -> float:
    return side * (exit_price / entry - 1.0)


def build_trade(
    candidate: Candidate,
    rows: List[dict],
    funding: List[dict],
    features: dict,
    signal_index: int,
) -> Optional[Trade]:
    profile = exit_profile(candidate)
    entry_index = signal_index + 1
    if entry_index + CONFIRM_HOURS + 1 >= len(rows):
        return None

    signal_ts = int(rows[signal_index]["ts"])
    entry_ts = int(rows[entry_index]["ts"])
    entry_price = float(rows[entry_index]["open"])
    atr = features["atr24"][signal_index]
    if atr is None or atr <= 0:
        return None

    initial_stop = entry_price - candidate.side * profile.stop_atr * atr
    confirmation_price = entry_price * (1.0 + candidate.side * candidate.confirmation_move_pct / 100.0)
    confirmation_index: Optional[int] = None
    probe_exit_index = entry_index + CONFIRM_HOURS - 1
    probe_exit_price = float(rows[probe_exit_index]["close"])
    exit_reason = "NO_FOLLOW_THROUGH"

    for cursor in range(entry_index, probe_exit_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        close = float(rows[cursor]["close"])
        stop_hit = low <= initial_stop if candidate.side > 0 else high >= initial_stop
        if stop_hit:
            probe_exit_index = cursor
            probe_exit_price = initial_stop
            exit_reason = "PROBE_STOP"
            break

        threshold_hit = high >= confirmation_price if candidate.side > 0 else low <= confirmation_price
        close_progress = candidate.side * (close / entry_price - 1.0) * 100.0
        if threshold_hit and close_progress >= candidate.confirmation_move_pct * 0.5:
            confirmation_index = cursor
            break

    if confirmation_index is None:
        exit_ts = int(rows[probe_exit_index]["ts"]) + HOUR
        gross_account = PROBE_GROSS * side_return(candidate.side, entry_price, probe_exit_price)
        funding_account = (
            PROBE_GROSS
            * candidate.side
            * funding_decimal(funding, entry_ts, exit_ts)
        )
        base_cost = PROBE_GROSS * BASE_COST_PCT / 100.0
        severe_cost = PROBE_GROSS * SEVERE_COST_PCT / 100.0
        return Trade(
            candidate_id=candidate.candidate_id,
            signal_ts=signal_ts,
            entry_ts=entry_ts,
            add_ts=None,
            exit_ts=exit_ts,
            side=candidate.side,
            probe_gross=PROBE_GROSS,
            add_gross=0.0,
            total_gross=PROBE_GROSS,
            entry_price=entry_price,
            add_price=None,
            exit_price=probe_exit_price,
            gross_pct=gross_account * 100.0,
            funding_pct=funding_account * 100.0,
            base_pct=(gross_account - funding_account - base_cost) * 100.0,
            severe_pct=(gross_account - funding_account - severe_cost) * 100.0,
            confirmed=False,
            partial_taken=False,
            exit_reason=exit_reason,
        )

    add_index = confirmation_index + 1
    if add_index >= len(rows):
        return None
    add_ts = int(rows[add_index]["ts"])
    add_price = float(rows[add_index]["open"])
    weighted_entry = (
        PROBE_GROSS * entry_price + ADD_GROSS * add_price
    ) / TOTAL_GROSS
    fixed_stop = weighted_entry - candidate.side * profile.stop_atr * atr
    take_profit = weighted_entry + candidate.side * profile.take_profit_atr * atr
    best_price = max(entry_price, add_price) if candidate.side > 0 else min(entry_price, add_price)
    maximum_exit_index = min(
        entry_index + profile.maximum_hold_hours,
        len(rows) - 1,
    )
    final_exit_index = maximum_exit_index
    final_exit_price = float(rows[final_exit_index]["close"])
    partial_index: Optional[int] = None
    partial_price: Optional[float] = None
    exit_reason = "TIME"

    for cursor in range(add_index, maximum_exit_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        active_stop = (
            max(fixed_stop, best_price - profile.trail_atr * atr)
            if candidate.side > 0
            else min(fixed_stop, best_price + profile.trail_atr * atr)
        )
        stop_hit = low <= active_stop if candidate.side > 0 else high >= active_stop
        if stop_hit:
            final_exit_index = cursor
            final_exit_price = active_stop
            exit_reason = "TRAIL_OR_STOP"
            break

        if partial_index is None:
            target_hit = high >= take_profit if candidate.side > 0 else low <= take_profit
            if target_hit:
                partial_index = cursor
                partial_price = take_profit

        best_price = max(best_price, high) if candidate.side > 0 else min(best_price, low)

    final_exit_ts = int(rows[final_exit_index]["ts"]) + HOUR
    if partial_index is not None and partial_price is not None:
        partial_exit_ts = int(rows[partial_index]["ts"]) + HOUR
        gross_account = (
            PROBE_GROSS * 0.5 * side_return(candidate.side, entry_price, partial_price)
            + PROBE_GROSS * 0.5 * side_return(candidate.side, entry_price, final_exit_price)
            + ADD_GROSS * 0.5 * side_return(candidate.side, add_price, partial_price)
            + ADD_GROSS * 0.5 * side_return(candidate.side, add_price, final_exit_price)
        )
        funding_account = candidate.side * (
            PROBE_GROSS * 0.5 * funding_decimal(funding, entry_ts, partial_exit_ts)
            + PROBE_GROSS * 0.5 * funding_decimal(funding, entry_ts, final_exit_ts)
            + ADD_GROSS * 0.5 * funding_decimal(funding, add_ts, partial_exit_ts)
            + ADD_GROSS * 0.5 * funding_decimal(funding, add_ts, final_exit_ts)
        )
    else:
        gross_account = (
            PROBE_GROSS * side_return(candidate.side, entry_price, final_exit_price)
            + ADD_GROSS * side_return(candidate.side, add_price, final_exit_price)
        )
        funding_account = candidate.side * (
            PROBE_GROSS * funding_decimal(funding, entry_ts, final_exit_ts)
            + ADD_GROSS * funding_decimal(funding, add_ts, final_exit_ts)
        )

    base_cost = TOTAL_GROSS * BASE_COST_PCT / 100.0
    severe_cost = TOTAL_GROSS * SEVERE_COST_PCT / 100.0
    return Trade(
        candidate_id=candidate.candidate_id,
        signal_ts=signal_ts,
        entry_ts=entry_ts,
        add_ts=add_ts,
        exit_ts=final_exit_ts,
        side=candidate.side,
        probe_gross=PROBE_GROSS,
        add_gross=ADD_GROSS,
        total_gross=TOTAL_GROSS,
        entry_price=entry_price,
        add_price=add_price,
        exit_price=final_exit_price,
        gross_pct=gross_account * 100.0,
        funding_pct=funding_account * 100.0,
        base_pct=(gross_account - funding_account - base_cost) * 100.0,
        severe_pct=(gross_account - funding_account - severe_cost) * 100.0,
        confirmed=True,
        partial_taken=partial_index is not None,
        exit_reason=exit_reason,
    )


def run_candidate(
    candidate: Candidate,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    features: dict,
) -> List[Trade]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[Trade] = []
    next_free_ts = 0
    for index in range(200, len(pengu) - 52):
        ts = int(pengu[index]["ts"])
        if ts < next_free_ts:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None or not probe_signal(candidate, pengu, index, features, btc_index):
            continue
        latest = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if candidate.side > 0 and (latest is None or latest > 0.0003):
            continue
        trade = build_trade(candidate, pengu, funding, features, index)
        if trade is None:
            continue
        trades.append(trade)
        next_free_ts = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades


def metrics(
    trades: Iterable[Trade],
    start: int,
    end: int,
    severe: bool = False,
) -> dict:
    active = [
        trade for trade in trades
        if start <= trade.entry_ts and trade.exit_ts <= end
    ]
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
    return [
        (start + span * index // count, start + span * (index + 1) // count)
        for index in range(count)
    ]


def wave_events(
    rows: List[dict],
    horizon_hours: int,
    threshold_pct: float,
) -> List[dict]:
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
        if (
            events
            and events[-1]["side"] == item["side"]
            and item["startTs"] <= events[-1]["endTs"]
        ):
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


def capture_metrics(
    trades: List[Trade],
    events: List[dict],
    early_hours: int,
) -> dict:
    details = []
    for event in events:
        matching = [
            trade for trade in trades
            if trade.side == event["side"]
            and event["startTs"] <= trade.entry_ts <= event["endTs"]
        ]
        early = [
            trade for trade in matching
            if trade.entry_ts <= event["startTs"] + early_hours * HOUR
        ]
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
        "captureRatePct": (
            sum(item["captured"] for item in details) / len(details) * 100.0
            if details else None
        ),
        "earlyCaptureRatePct": (
            sum(item["earlyCaptured"] for item in details) / len(details) * 100.0
            if details else None
        ),
        "details": details,
    }


def events_by_fold(
    events: List[dict],
    folds: List[tuple[int, int]],
) -> List[List[dict]]:
    return [
        [event for event in events if start <= event["startTs"] < end]
        for start, end in folds
    ]


def candidate_summary(
    candidate: Candidate,
    trades: List[Trade],
    folds: List[tuple[int, int]],
    proxies: Dict[str, List[List[dict]]],
) -> dict:
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
        fold_trades = [
            trade for trade in trades
            if start <= trade.entry_ts < end
        ]
        captures.append({
            "12h8": capture_metrics(fold_trades, proxies["12h8"][index], 6),
            "24h12": capture_metrics(fold_trades, proxies["24h12"][index], 12),
            "72h20": capture_metrics(fold_trades, proxies["72h20"][index], 24),
        })

    train_captured = sum(
        captures[index][name]["capturedEvents"]
        for index in range(3)
        for name in ("12h8", "24h12", "72h20")
    )
    train_early = sum(
        captures[index][name]["earlyCapturedEvents"]
        for index in range(3)
        for name in ("12h8", "24h12", "72h20")
    )
    validation_events = sum(
        captures[3][name]["events"]
        for name in ("12h8", "24h12", "72h20")
    )
    validation_captured = sum(
        captures[3][name]["capturedEvents"]
        for name in ("12h8", "24h12", "72h20")
    )
    validation_early = sum(
        captures[3][name]["earlyCapturedEvents"]
        for name in ("12h8", "24h12", "72h20")
    )
    positive_train_folds = sum(
        item["compoundedReturnPct"] > 0 for item in fold_metrics[:3]
    )
    severe_positive_train_folds = sum(
        item["compoundedReturnPct"] > 0 for item in fold_severe[:3]
    )

    train_passed = bool(
        train["trades"] >= 8
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
        and (
            validation_events == 0
            or (validation_captured >= 1 and validation_early >= 1)
        )
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
    return (
        candidate["side"],
        candidate["family"],
        candidate["lookback"],
        candidate["exit_profile"],
    )


def rank_key(item: dict) -> tuple:
    validation = item["validation"]
    validation_severe = item["validationSevere"]
    train = item["train"]
    return (
        item["validationEarlyCapturedEvents"],
        item["validationCapturedEvents"],
        validation_severe["compoundedReturnPct"],
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


def combine_sides(
    long_trades: List[Trade],
    short_trades: List[Trade],
) -> List[Trade]:
    grouped: Dict[int, List[Trade]] = {}
    for trade in [*long_trades, *short_trades]:
        grouped.setdefault(trade.entry_ts, []).append(trade)
    result: List[Trade] = []
    next_free_ts = 0
    for entry_ts in sorted(grouped):
        if entry_ts < next_free_ts:
            continue
        choices = grouped[entry_ts]
        selected = next(
            (trade for trade in choices if trade.side < 0),
            choices[0],
        )
        result.append(selected)
        next_free_ts = selected.exit_ts
    return result


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(
        ts / 1000,
        tz=dt.timezone.utc,
    ).isoformat()


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(
        os.environ.get(
            "RESEARCH_AUTONOMOUS_STATE_DIR",
            ".research-state",
        )
    ).resolve()
    now_end = (
        int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
        // HOUR * HOUR
    )
    print("Fetching Aster PENGU/BTC history for V49")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    if len(pengu) < 3000 or len(btc) < 3000:
        raise RuntimeError("Insufficient history")

    features = prepare_features(pengu, btc)
    folds = fold_bounds(pengu, 5)
    proxy_raw = {
        "12h8": wave_events(pengu, 12, 8.0),
        "24h12": wave_events(pengu, 24, 12.0),
        "72h20": wave_events(pengu, 72, 20.0),
    }
    proxies = {
        name: events_by_fold(events, folds)
        for name, events in proxy_raw.items()
    }
    major24 = wave_events(pengu, 24, 20.0)
    major72 = wave_events(pengu, 72, 35.0)

    candidates = candidate_space()
    summaries: Dict[str, dict] = {}
    for position, candidate in enumerate(candidates, start=1):
        if position % 100 == 0:
            print(f"Evaluated {position}/{len(candidates)} candidates")
        trades = run_candidate(candidate, pengu, btc, funding, features)
        summaries[candidate.candidate_id] = candidate_summary(
            candidate,
            trades,
            folds,
            proxies,
        )

    cluster_counts: Dict[tuple, int] = {}
    for item in summaries.values():
        if item["validationPassed"]:
            key = cluster_key(item)
            cluster_counts[key] = cluster_counts.get(key, 0) + 1

    eligible_by_side: Dict[int, List[str]] = {1: [], -1: []}
    for candidate_id, item in summaries.items():
        item["validationClusterSize"] = cluster_counts.get(
            cluster_key(item),
            0,
        )
        if (
            item["validationPassed"]
            and item["validationClusterSize"] >= 2
        ):
            side = int(item["candidate"]["side"])
            eligible_by_side[side].append(candidate_id)

    for side in (1, -1):
        eligible_by_side[side].sort(
            key=lambda key: rank_key(summaries[key]),
            reverse=True,
        )

    selected_long = (
        eligible_by_side[1][0]
        if eligible_by_side[1]
        else None
    )
    selected_short = (
        eligible_by_side[-1][0]
        if eligible_by_side[-1]
        else None
    )
    long_item = summaries[selected_long] if selected_long else None
    short_item = summaries[selected_short] if selected_short else None
    combined = combine_sides(
        rebuild_trades(long_item),
        rebuild_trades(short_item),
    )

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
        "major24": capture_metrics(combined, major24, 12),
        "major72": capture_metrics(combined, major72, 24),
        "trades": [asdict(trade) for trade in combined],
    }

    holdout = combined_result["holdout"]
    holdout_severe = combined_result["holdoutSevere"]
    major24_result = combined_result["major24"]
    captured_major = (
        major24_result["capturedEvents"]
        + combined_result["major72"]["capturedEvents"]
    )
    profitable_major = (
        major24_result["profitableCapturedEvents"]
        + combined_result["major72"]["profitableCapturedEvents"]
    )
    early_major = (
        major24_result["earlyCapturedEvents"]
        + combined_result["major72"]["earlyCapturedEvents"]
    )
    total_major = (
        major24_result["events"]
        + combined_result["major72"]["events"]
    )

    adoption_passed = bool(
        (selected_long or selected_short)
        and holdout["trades"] >= 3
        and holdout["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.10
        and holdout["maxDrawdownPct"] >= -5
        and holdout_severe["compoundedReturnPct"] > 0
        and (
            total_major == 0
            or early_major / total_major >= 0.5
        )
        and (
            captured_major == 0
            or profitable_major / captured_major >= 0.5
        )
    )
    status = (
        "ROBUST_CANDIDATE"
        if adoption_passed
        else "REJECTED_HOLDOUT_OR_CAPTURE"
        if selected_long or selected_short
        else "NO_VALIDATED_CANDIDATE"
    )

    result = rounded({
        "version": 49,
        "strategyId": "PENGU_WAVE_SLEEVE_V49_PROBE_ADD",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "basePr": 42,
        "baseCommit": "ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "design": {
            "probeGross": PROBE_GROSS,
            "addGross": ADD_GROSS,
            "maximumGross": TOTAL_GROSS,
            "confirmationHours": CONFIRM_HOURS,
            "noFollowThroughExit": True,
            "partialTakeProfit": True,
            "atrTrailingExit": True,
            "longFundingMaximum": 0.0003,
        },
        "candidateCount": len(candidates),
        "folds": [
            {"start": iso(start), "end": iso(end)}
            for start, end in folds
        ],
        "selectionUse": {
            "trainFolds": [0, 1, 2],
            "validationFold": 3,
            "untouchedHoldoutFold": 4,
        },
        "proxyEventCountsByFold": {
            name: [len(items) for items in by_fold]
            for name, by_fold in proxies.items()
        },
        "majorEventCounts": {
            "24h20pct": len(major24),
            "72h35pct": len(major72),
        },
        "validatedClusterLongCount": len(eligible_by_side[1]),
        "validatedClusterShortCount": len(eligible_by_side[-1]),
        "selectedLong": selected_long,
        "selectedShort": selected_short,
        "selectedLongResult": long_item,
        "selectedShortResult": short_item,
        "combined": combined_result,
        "adoptionPassed": adoption_passed,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The final chronological fifth is never used for candidate selection.",
            "Candidate selection uses medium-wave proxy events; major waves are audited separately.",
            "A candidate is rejected unless untouched holdout and untouched Severe are both positive.",
            "The simulation uses next-open probe/add execution and stop-first ordering when intrabar outcomes conflict.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "pengu-wave-sleeve-v49.json"
    md_path = state_dir / "pengu-wave-sleeve-v49.md"
    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    combined_metrics = result["combined"]
    report = [
        "# PENGU Wave Sleeve V49 Probe/Add Validation",
        "",
        f"- Status: **{status}**",
        f"- Selected Long: **{selected_long or 'NONE'}**",
        f"- Selected Short: **{selected_short or 'NONE'}**",
        f"- Candidate count: {len(candidates)}",
        f"- Validated cluster Long / Short: {len(eligible_by_side[1])} / {len(eligible_by_side[-1])}",
        "- Probe / Add / Maximum Gross: **0.05 / 0.10 / 0.15**",
        "",
        "## Chronological results",
        "",
        f"- Train: {combined_metrics['train']['compoundedReturnPct']}% / PF {combined_metrics['train']['profitFactor']} / DD {combined_metrics['train']['maxDrawdownPct']}% / N {combined_metrics['train']['trades']}",
        f"- Validation: {combined_metrics['validation']['compoundedReturnPct']}% / PF {combined_metrics['validation']['profitFactor']} / DD {combined_metrics['validation']['maxDrawdownPct']}% / N {combined_metrics['validation']['trades']}",
        f"- Untouched Holdout: {combined_metrics['holdout']['compoundedReturnPct']}% / PF {combined_metrics['holdout']['profitFactor']} / DD {combined_metrics['holdout']['maxDrawdownPct']}% / N {combined_metrics['holdout']['trades']}",
        f"- Untouched Holdout Severe: {combined_metrics['holdoutSevere']['compoundedReturnPct']}% / DD {combined_metrics['holdoutSevere']['maxDrawdownPct']}%",
        f"- Full: {combined_metrics['full']['compoundedReturnPct']}% / Severe {combined_metrics['fullSevere']['compoundedReturnPct']}%",
        "",
        "## Major-wave audit",
        "",
        f"- 24h >=20%: {combined_metrics['major24']['capturedEvents']}/{combined_metrics['major24']['events']} captured; early {combined_metrics['major24']['earlyCapturedEvents']}/{combined_metrics['major24']['events']}; profitable {combined_metrics['major24']['profitableCapturedEvents']}/{combined_metrics['major24']['events']}",
        f"- 72h >=35%: {combined_metrics['major72']['capturedEvents']}/{combined_metrics['major72']['events']} captured; early {combined_metrics['major72']['earlyCapturedEvents']}/{combined_metrics['major72']['events']}; profitable {combined_metrics['major72']['profitableCapturedEvents']}/{combined_metrics['major72']['events']}",
        "",
        f"- Adoption gate: **{'PASS' if adoption_passed else 'FAIL'}**",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
