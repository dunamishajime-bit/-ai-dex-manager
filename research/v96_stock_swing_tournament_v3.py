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

import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_SWING_TOURNAMENT_V3"


@dataclass(frozen=True)
class DailyBar:
    day: str
    open: float
    high: float
    low: float
    close: float
    quote_volume: float
    true_range_pct: float


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    lookback: int
    hold_days: int
    threshold: float


@dataclass(frozen=True)
class Leg:
    symbol: str
    side: int
    weight: float


@dataclass(frozen=True)
class Signal:
    candidate_id: str
    family: str
    decision_day: str
    legs: Tuple[Leg, ...]
    score: float
    stop_pct: float
    detail: dict


PAIRS = (
    ("NVDAUSDT", "AMDUSDT"),
    ("AVGOUSDT", "QCOMUSDT"),
    ("METAUSDT", "GOOGLUSDT"),
    ("MSFTUSDT", "ORCLUSDT"),
    ("AMATUSDT", "MUUSDT"),
    ("TSMUSDT", "ASMLUSDT"),
    ("ARMUSDT", "MRVLUSDT"),
    ("ADBEUSDT", "CRMUSDT"),
)

CANDIDATES = tuple(
    [Candidate(f"LONG_BREAKOUT_{lookback}", "LONG_BREAKOUT", lookback, max(5, lookback // 4), 0.0) for lookback in (20, 40, 60)]
    + [Candidate(f"LONG_ROTATION_{threshold:.2f}", "LONG_ROTATION", 20, 5, threshold) for threshold in (0.00, 0.05, 0.10)]
    + [Candidate(f"TREND_PULLBACK_{threshold:.2f}", "TREND_PULLBACK", 20, 5, threshold) for threshold in (0.10, 0.15, 0.20)]
    + [Candidate(f"VOL_COMPRESSION_{threshold:.2f}", "VOL_COMPRESSION_BREAKOUT", 20, 7, threshold) for threshold in (0.60, 0.70, 0.80)]
    + [Candidate(f"XS_REVERSAL_{threshold:.3f}", "XS_REVERSAL_PAIR", 3, 2, threshold) for threshold in (0.05, 0.075, 0.10)]
    + [Candidate(f"PAIR_MR_{threshold:.2f}", "PAIR_MEAN_REVERSION", 40, 10, threshold) for threshold in (1.50, 2.00, 2.50)]
    + [Candidate(f"DEF_TREND_{lookback}", "DEFENSIVE_TREND", lookback, 5, 0.0) for lookback in (10, 20, 40)]
    + [Candidate(f"DAILY_EXHAUST_{threshold:.2f}", "DAILY_EXHAUSTION", 20, 2, threshold) for threshold in (1.00, 1.50, 2.00)]
    + [Candidate(f"CLOSE_STRENGTH_{threshold:.2f}", "CLOSE_STRENGTH_CONTINUATION", 10, 3, threshold) for threshold in (0.75, 0.85, 0.92)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def daily_bars(sessions: Dict[str, Dict[str, Dict[int, base.Bar]]]) -> Dict[str, Dict[str, DailyBar]]:
    result: Dict[str, Dict[str, DailyBar]] = defaultdict(dict)
    for symbol, by_day in sessions.items():
        previous_close: Optional[float] = None
        for day in sorted(by_day):
            ordered = [by_day[day][key] for key in sorted(by_day[day]) if 570 <= key < 960]
            if len(ordered) < 20:
                continue
            high = max(item.high for item in ordered)
            low = min(item.low for item in ordered)
            reference = previous_close if previous_close and previous_close > 0 else ordered[0].open
            tr = max(high - low, abs(high - reference), abs(low - reference)) / reference * 100.0
            result[symbol][day] = DailyBar(
                day,
                ordered[0].open,
                high,
                low,
                ordered[-1].close,
                sum(item.quote_volume for item in ordered),
                tr,
            )
            previous_close = ordered[-1].close
    return dict(result)


def history(rows: Dict[str, DailyBar], day: str, count: int, include_current: bool = True) -> List[DailyBar]:
    days = [key for key in sorted(rows) if key <= day] if include_current else [key for key in sorted(rows) if key < day]
    return [rows[key] for key in days[-count:]]


def pct_change(rows: Sequence[DailyBar], lookback: int) -> Optional[float]:
    if len(rows) <= lookback:
        return None
    prior = rows[-1 - lookback].close
    return rows[-1].close / prior - 1.0 if prior > 0 else None


def mean_tr(rows: Sequence[DailyBar], count: int = 20) -> Optional[float]:
    if len(rows) < count:
        return None
    return statistics.mean(item.true_range_pct for item in rows[-count:])


def stdev_returns(rows: Sequence[DailyBar], count: int = 20) -> Optional[float]:
    if len(rows) <= count:
        return None
    values = [rows[index].close / rows[index - 1].close - 1.0 for index in range(len(rows) - count, len(rows))]
    return statistics.stdev(values) if len(values) >= 2 else None


def sma(rows: Sequence[DailyBar], count: int) -> Optional[float]:
    if len(rows) < count:
        return None
    return statistics.mean(item.close for item in rows[-count:])


def pair_signal(candidate: Candidate, a: str, b: str, side_a: int, score: float, day: str, detail: dict) -> Signal:
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        (Leg(a, side_a, 0.5), Leg(b, -side_a, 0.5)),
        score,
        8.0,
        detail,
    )


def single_signal(candidate: Candidate, symbol: str, side: int, score: float, day: str, stop_pct: float, detail: dict) -> Signal:
    return Signal(candidate.candidate_id, candidate.family, day, (Leg(symbol, side, 1.0),), score, stop_pct, detail)


def symbol_snapshot(symbol: str, day: str, bars: Dict[str, Dict[str, DailyBar]], need: int = 80) -> Optional[dict]:
    rows = history(bars.get(symbol, {}), day, need)
    if len(rows) < 21 or rows[-1].day != day:
        return None
    atr = mean_tr(rows, 20)
    vol = stdev_returns(rows, 20)
    if atr is None or atr <= 0 or vol is None or vol <= 0:
        return None
    return {"symbol": symbol, "rows": rows, "bar": rows[-1], "atrPct": atr, "vol": vol}


def build_signal(candidate: Candidate, day: str, bars: Dict[str, Dict[str, DailyBar]]) -> Optional[Signal]:
    snapshots = [item for item in (symbol_snapshot(symbol, day, bars) for symbol in base.SYMBOLS) if item is not None]
    if len(snapshots) < 8:
        return None
    options: List[Signal] = []

    if candidate.family == "LONG_BREAKOUT":
        breadth_values = []
        for item in snapshots:
            mom20 = pct_change(item["rows"], 20)
            if mom20 is not None:
                breadth_values.append(mom20 > 0)
        breadth = sum(breadth_values) / len(breadth_values) if breadth_values else 0.0
        if breadth < 0.55:
            return None
        for item in snapshots:
            rows = item["rows"]
            if len(rows) <= candidate.lookback:
                continue
            prior_high = max(row.high for row in rows[-1 - candidate.lookback:-1])
            momentum = pct_change(rows, candidate.lookback)
            if momentum is not None and momentum > 0 and item["bar"].close > prior_high:
                score = momentum / item["vol"]
                options.append(single_signal(candidate, item["symbol"], 1, score, day, max(2.0, 2.0 * item["atrPct"]), {"breadth": breadth, "momentum": momentum}))

    elif candidate.family == "LONG_ROTATION":
        momenta = []
        for item in snapshots:
            momentum = pct_change(item["rows"], candidate.lookback)
            average = sma(item["rows"], candidate.lookback)
            if momentum is not None and average is not None:
                momenta.append((item, momentum, average))
        if not momenta or statistics.median(value for _item, value, _average in momenta) <= candidate.threshold:
            return None
        item, momentum, average = max(momenta, key=lambda row: row[1] / row[0]["vol"])
        if item["bar"].close > average and momentum > candidate.threshold:
            options.append(single_signal(candidate, item["symbol"], 1, momentum / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"momentum": momentum}))

    elif candidate.family == "TREND_PULLBACK":
        for item in snapshots:
            rows = item["rows"]
            momentum = pct_change(rows, 20)
            recent = pct_change(rows, 3)
            average = sma(rows, 20)
            if momentum is None or recent is None or average is None:
                continue
            if momentum >= candidate.threshold and recent < -0.01 and item["bar"].close > average:
                options.append(single_signal(candidate, item["symbol"], 1, momentum / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"momentum20": momentum, "pullback3": recent}))

    elif candidate.family == "VOL_COMPRESSION_BREAKOUT":
        for item in snapshots:
            rows = item["rows"]
            if len(rows) < 21:
                continue
            atr5 = statistics.mean(row.true_range_pct for row in rows[-5:])
            atr20 = statistics.mean(row.true_range_pct for row in rows[-20:])
            prior_high = max(row.high for row in rows[-11:-1])
            ratio = atr5 / atr20 if atr20 > 0 else 999.0
            if ratio <= candidate.threshold and item["bar"].close > prior_high:
                options.append(single_signal(candidate, item["symbol"], 1, (1.0 - ratio) / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"compression": ratio}))

    elif candidate.family == "XS_REVERSAL_PAIR":
        values = []
        for item in snapshots:
            move = pct_change(item["rows"], candidate.lookback)
            if move is not None:
                values.append((item, move))
        if len(values) >= 8:
            strongest = max(values, key=lambda row: row[1])
            weakest = min(values, key=lambda row: row[1])
            dispersion = strongest[1] - weakest[1]
            if dispersion >= candidate.threshold:
                options.append(pair_signal(candidate, weakest[0]["symbol"], strongest[0]["symbol"], 1, dispersion, day, {"dispersion": dispersion}))

    elif candidate.family == "PAIR_MEAN_REVERSION":
        for a, b in PAIRS:
            a_rows = bars.get(a, {})
            b_rows = bars.get(b, {})
            common = [key for key in sorted(set(a_rows) & set(b_rows)) if key <= day]
            if len(common) < candidate.lookback or common[-1] != day:
                continue
            ratios = [math.log(a_rows[key].close / b_rows[key].close) for key in common[-candidate.lookback:]]
            sigma = statistics.stdev(ratios) if len(ratios) >= 2 else 0.0
            if sigma <= 0:
                continue
            z = (ratios[-1] - statistics.mean(ratios)) / sigma
            if abs(z) >= candidate.threshold:
                options.append(pair_signal(candidate, a, b, -1 if z > 0 else 1, abs(z), day, {"zscore": z}))

    elif candidate.family == "DEFENSIVE_TREND":
        values = []
        for item in snapshots:
            momentum = pct_change(item["rows"], candidate.lookback)
            if momentum is not None:
                values.append((item, momentum))
        if len(values) >= 8:
            positive = sum(value > 0 for _item, value in values) / len(values)
            if positive >= 0.60:
                item, momentum = max(values, key=lambda row: row[1] / row[0]["vol"])
                options.append(single_signal(candidate, item["symbol"], 1, momentum / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"breadth": positive, "momentum": momentum}))
            elif positive <= 0.40:
                item, momentum = min(values, key=lambda row: row[1] / row[0]["vol"])
                options.append(single_signal(candidate, item["symbol"], -1, abs(momentum) / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"breadth": positive, "momentum": momentum}))

    elif candidate.family == "DAILY_EXHAUSTION":
        for item in snapshots:
            rows = item["rows"]
            if len(rows) < 2:
                continue
            move = (rows[-1].close / rows[-2].close - 1.0) * 100.0 / item["atrPct"]
            if abs(move) >= candidate.threshold:
                options.append(single_signal(candidate, item["symbol"], -1 if move > 0 else 1, abs(move), day, max(2.0, 1.5 * item["atrPct"]), {"dailyMoveAtr": move}))

    elif candidate.family == "CLOSE_STRENGTH_CONTINUATION":
        for item in snapshots:
            bar = item["bar"]
            location = (bar.close - bar.low) / (bar.high - bar.low) if bar.high > bar.low else 0.5
            momentum = pct_change(item["rows"], candidate.lookback)
            if momentum is None:
                continue
            if location >= candidate.threshold and momentum > 0:
                options.append(single_signal(candidate, item["symbol"], 1, location + momentum / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"closeLocation": location, "momentum": momentum}))
            elif location <= 1.0 - candidate.threshold and momentum < 0:
                options.append(single_signal(candidate, item["symbol"], -1, 1.0 - location + abs(momentum) / item["vol"], day, max(2.0, 2.0 * item["atrPct"]), {"closeLocation": location, "momentum": momentum}))

    return max(options, key=lambda signal: (signal.score, signal.candidate_id, signal.legs[0].symbol)) if options else None


def next_common_day(signal: Signal, days: Sequence[str], bars: Dict[str, Dict[str, DailyBar]]) -> Optional[str]:
    for day in days:
        if day <= signal.decision_day:
            continue
        if all(day in bars.get(leg.symbol, {}) for leg in signal.legs):
            return day
    return None


def simulate_trade(
    candidate: Candidate,
    signal: Signal,
    scenario: base.CostScenario,
    days: Sequence[str],
    bars: Dict[str, Dict[str, DailyBar]],
) -> Optional[dict]:
    entry_day = next_common_day(signal, days, bars)
    if entry_day is None:
        return None
    start_index = days.index(entry_day)
    entry_prices = {leg.symbol: bars[leg.symbol][entry_day].open for leg in signal.legs}
    exit_prices: Dict[str, float] = {}
    exit_day = entry_day
    reason = "FIXED_HOLD_EXIT"
    stop_extra = 0.0
    holding = 0
    for index in range(start_index, len(days)):
        day = days[index]
        if not all(day in bars.get(leg.symbol, {}) for leg in signal.legs):
            continue
        holding += 1
        stopped = False
        for leg in signal.legs:
            bar = bars[leg.symbol][day]
            entry = entry_prices[leg.symbol]
            stop = entry * (1.0 - leg.side * signal.stop_pct / 100.0)
            gap_hit = (leg.side > 0 and bar.open <= stop) or (leg.side < 0 and bar.open >= stop)
            intraday_hit = (leg.side > 0 and bar.low <= stop) or (leg.side < 0 and bar.high >= stop)
            if gap_hit:
                exit_prices[leg.symbol] = bar.open * (1.0 - leg.side * scenario.stop_slippage_bps / 10_000.0)
                stop_extra += abs(leg.weight) * scenario.stop_slippage_bps / 10_000.0
                stopped = True
            elif intraday_hit:
                exit_prices[leg.symbol] = stop * (1.0 - leg.side * scenario.stop_slippage_bps / 10_000.0)
                stop_extra += abs(leg.weight) * scenario.stop_slippage_bps / 10_000.0
                stopped = True
        if stopped:
            for leg in signal.legs:
                if leg.symbol not in exit_prices:
                    exit_prices[leg.symbol] = bars[leg.symbol][day].close
            exit_day = day
            reason = "HARD_STOP_EXIT"
            break
        if holding >= candidate.hold_days:
            for leg in signal.legs:
                exit_prices[leg.symbol] = bars[leg.symbol][day].close
            exit_day = day
            break
    if len(exit_prices) != len(signal.legs):
        return None
    raw = sum(
        leg.weight * leg.side * (exit_prices[leg.symbol] / entry_prices[leg.symbol] - 1.0)
        for leg in signal.legs
    )
    gross = sum(abs(leg.weight) for leg in signal.legs)
    cost = 2.0 * gross * scenario.turnover_bps / 10_000.0 + stop_extra
    return {
        "candidateId": signal.candidate_id,
        "family": signal.family,
        "decisionDay": signal.decision_day,
        "entryDay": entry_day,
        "exitDay": exit_day,
        "symbols": [leg.symbol for leg in signal.legs],
        "sides": [leg.side for leg in signal.legs],
        "gross": gross,
        "rawReturn": raw,
        "cost": cost,
        "return": raw - cost,
        "exitReason": reason,
        "score": signal.score,
        "detail": signal.detail,
    }


def replay_candidate(candidate: Candidate, scenario: base.CostScenario, days: Sequence[str], bars: Dict[str, Dict[str, DailyBar]]) -> List[dict]:
    trades: List[dict] = []
    blocked_until = ""
    for day in days:
        if blocked_until and day <= blocked_until:
            continue
        signal = build_signal(candidate, day, bars)
        if signal is None:
            continue
        trade = simulate_trade(candidate, signal, scenario, days, bars)
        if trade is not None:
            trades.append(trade)
            blocked_until = trade["exitDay"]
    return trades


def product_return(values: Iterable[float]) -> float:
    return base.product_return(values)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    dd = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        dd = min(dd, equity / peak - 1.0)
    return dd


def metrics(trades: Sequence[dict]) -> dict:
    ordered = sorted(trades, key=lambda item: (item["exitDay"], item["candidateId"]))
    values = [finite(item["return"]) for item in ordered]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    compounded = product_return(values)
    if ordered:
        start = dt.date.fromisoformat(ordered[0]["entryDay"])
        end = dt.date.fromisoformat(ordered[-1]["exitDay"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    positive = sum(wins)
    negative = -sum(losses)
    return {
        "trades": len(values),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": positive / negative if negative > 1e-15 else None,
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    start, end = interval
    return [item for item in trades if start <= item["exitDay"] <= end]


def removals(trades: Sequence[dict]) -> dict:
    if not trades:
        return {"bestTradeRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [finite(item["return"]) for item in trades]
    best = max(range(len(values)), key=values.__getitem__)
    months: Dict[str, List[float]] = defaultdict(list)
    for item, value in zip(trades, values):
        months[item["exitDay"][:7]].append(value)
    best_month = max(months, key=lambda key: product_return(months[key]))
    return {
        "bestTradeRemovedPct": product_return(value for index, value in enumerate(values) if index != best) * 100.0,
        "bestMonth": best_month,
        "bestMonthRemovedPct": product_return(value for item, value in zip(trades, values) if item["exitDay"][:7] != best_month) * 100.0,
    }


def score(median: dict, normal: dict, severe: dict) -> float:
    return median["compoundedReturnPct"] + 0.5 * normal["compoundedReturnPct"] + 0.25 * severe["compoundedReturnPct"] + 2.0 * ((median.get("profitFactor") or 0.0) - 1.0) + 0.10 * median["maxDrawdownPct"]


def validation_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 4
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05
    )


def holdout_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 4
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["NORMAL"].get("profitFactor") or 0) > 1.0
    )


def combine(trades_by_candidate: Dict[str, List[dict]], ids: Sequence[str]) -> List[dict]:
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for candidate_id in ids:
        for trade in trades_by_candidate.get(candidate_id, []):
            by_day[trade["exitDay"]].append(trade)
    return [
        {
            "candidateId": "VALIDATION_SELECTED_SWING_ENSEMBLE",
            "family": "ENSEMBLE",
            "decisionDay": day,
            "entryDay": day,
            "exitDay": day,
            "symbols": sorted(set(symbol for item in items for symbol in item["symbols"])),
            "return": statistics.mean(finite(item["return"]) for item in items),
            "gross": 1.0,
        }
        for day, items in sorted(by_day.items())
    ]


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(cache_dir: Path) -> dict:
    raw = base.load_all(cache_dir)
    sessions = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items()}
    bars = daily_bars(sessions)
    eligible_days = sorted(set().union(*(set(rows) for rows in bars.values())))
    splits = base.chronological_splits(eligible_days)
    all_trades: Dict[str, Dict[str, List[dict]]] = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_trades[scenario.name][candidate.candidate_id] = replay_candidate(candidate, scenario, eligible_days, bars)

    families: Dict[str, dict] = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            dev = {scenario.name: metrics(subset(all_trades[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])) for scenario in base.SCENARIOS}
            rows.append({"candidate": asdict(candidate), "development": dev, "score": score(dev["FORWARD_MEDIAN"], dev["NORMAL"], dev["SEVERE"])})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 6]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {scenario.name: metrics(subset(all_trades[scenario.name][winner_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        families[family] = {"developmentCandidates": rows, "winnerId": winner_id, "winnerValidation": validation, "validationPass": validation_pass(validation)}

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {scenario.name: metrics(subset(all_trades[scenario.name][candidate_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": candidate_id, "members": [candidate_id], "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})
    if len(passing) >= 2:
        validation = {}
        for scenario in base.SCENARIOS:
            validation[scenario.name] = metrics(subset(combine(all_trades[scenario.name], passing), splits["VALIDATION"]))
        options.append({"portfolioId": "VALIDATION_SELECTED_SWING_ENSEMBLE", "members": sorted(passing), "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {"portfolioId": selected_option["portfolioId"], "members": selected_option["members"], "validation": selected_option["validation"], "scenarios": {}}
        for scenario in base.SCENARIOS:
            trades = all_trades[scenario.name][selected_option["members"][0]] if len(selected_option["members"]) == 1 else combine(all_trades[scenario.name], selected_option["members"])
            selected["scenarios"][scenario.name] = {
                "full": metrics(trades),
                "development": metrics(subset(trades, splits["DEVELOPMENT"])),
                "validation": metrics(subset(trades, splits["VALIDATION"])),
                "holdout": metrics(subset(trades, splits["HOLDOUT"])),
                "removals": removals(trades),
                "trades": trades,
            }
        selected["holdoutPass"] = holdout_pass({name: item["holdout"] for name, item in selected["scenarios"].items()})
        normal = selected["scenarios"]["NORMAL"]["full"]
        severe = selected["scenarios"]["SEVERE"]["full"]
        selected["cryptoLikeHistorical"] = bool(selected["holdoutPass"] and normal["compoundedReturnPct"] >= 50 and normal["cagrPct"] >= 50 and severe["compoundedReturnPct"] > 0 and normal["maxDrawdownPct"] >= -35)

    if selected and selected["cryptoLikeHistorical"]:
        status = "CRYPTO_LIKE_SWING_EDGE_FOUND_SHADOW_ONLY"
    elif selected and selected["holdoutPass"]:
        status = "ROBUST_POSITIVE_SWING_EDGE_FOUND_SHADOW_ONLY"
    elif passing:
        status = "SWING_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_SWING_FAMILY"

    return rounded({
        "version": 3,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in CANDIDATES)),
        "dataWindow": {"startUtc": base.START_UTC.isoformat(), "endUtc": base.END_UTC.isoformat()},
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "classificationLimit": "The historical date range was already inspected by prior stock experiments. Any lead is reused historical evidence, not an independent holdout.",
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
        "limitations": [
            "Regular-session daily OHLC is used while multi-day returns include close-to-next-open gaps.",
            "Off-session Spread, Slippage and stop execution are represented only by cost and stop-fill stress.",
            "Current-listing survivorship bias and uneven symbol history remain.",
            "Historical OI, exact event chronology, Funding and order-book gates are not reconstructed.",
            "No positive result can be called independent Holdout evidence after earlier stock research inspected the same dates.",
        ],
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-swing-tournament-v3.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Swing Tournament V3",
        "",
        f"- Status: **{result['status']}**",
        f"- Candidates / families: {result['candidateCount']} / {result['familyCount']}",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for family, item in result["families"].items():
        winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
        lines.append(
            f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{winner['development']['SEVERE']['compoundedReturnPct']}% | {item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | {'YES' if item['validationPass'] else 'NO'} |"
        )
    selected = result.get("selected")
    if selected:
        lines.extend(["", "## Selected reused-historical test", "", f"Portfolio: **{selected['portfolioId']}**", f"Holdout pass: **{'YES' if selected['holdoutPass'] else 'NO'}**", f"Crypto-like threshold: **{'YES' if selected['cryptoLikeHistorical'] else 'NO'}**", "", "| Scenario | Full | CAGR | PF | DD | Holdout | Holdout PF | Trades |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            item = selected["scenarios"][name]
            lines.append(f"| {name} | {item['full']['compoundedReturnPct']}% | {item['full']['cagrPct']}% | {item['full']['profitFactor']} | {item['full']['maxDrawdownPct']}% | {item['holdout']['compoundedReturnPct']}% | {item['holdout']['profitFactor']} | {item['full']['trades']} |")
    lines.extend(["", "This date range has already been inspected by prior stock experiments. Any positive lead remains reused historical evidence and requires a fresh Forward clock."])
    (output_dir / "v96-stock-swing-tournament-v3.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 27
    assert len(set(candidate.family for candidate in CANDIDATES)) == 9
    assert len(PAIRS) == 8
    assert all(candidate.hold_days >= 2 for candidate in CANDIDATES)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-swing-tournament-v3")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock swing tournament self-test: PASS")
        return 0
    result = analyze(Path(args.cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"], "validationPassingWinnerIds": result["validationPassingWinnerIds"], "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
