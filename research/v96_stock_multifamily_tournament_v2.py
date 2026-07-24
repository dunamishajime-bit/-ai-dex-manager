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
STRATEGY_ID = "V96_STOCK_MULTIFAMILY_TOURNAMENT_V2"
MIN_FAMILY_DEV_TRADES = 8
MIN_VALIDATION_TRADES = 5
MIN_HOLDOUT_TRADES = 5


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    entry_minute: int
    exit_minute: int
    threshold: float
    stop_atr: float = 1.25
    gross_cap: float = 1.0


@dataclass(frozen=True)
class Leg:
    symbol: str
    side: int
    weight: float
    atr_pct: float
    reference: Optional[float] = None


@dataclass(frozen=True)
class Signal:
    candidate_id: str
    family: str
    theme: str
    day: str
    signal_minute: int
    legs: Tuple[Leg, ...]
    score: float
    detail: dict


CANDIDATES = tuple(
    [Candidate(f"GAP_FADE_{value:.2f}", "GAP_FADE", 600, 945, value) for value in (0.50, 0.75, 1.00)]
    + [Candidate(f"GAP_CONT_{value:.2f}", "GAP_CONTINUATION", 600, 945, value) for value in (0.50, 0.75, 1.00)]
    + [Candidate(f"OPEN_EXHAUST_{value:.2f}", "OPENING_EXHAUSTION", 615, 945, value) for value in (0.75, 1.00, 1.25)]
    + [Candidate(f"XS_REV_PAIR_{value:.2f}", "XS_REVERSION_PAIR", 660, 945, value) for value in (1.00, 1.50, 2.00)]
    + [Candidate(f"XS_MOM_PAIR_{value:.2f}", "XS_MOMENTUM_PAIR", 630, 945, value) for value in (1.00, 1.50, 2.00)]
    + [Candidate(f"RESIDUAL_FADE_{value:.2f}", "THEME_RESIDUAL_FADE", 690, 945, value) for value in (0.75, 1.00, 1.25)]
    + [Candidate(f"LATE_FADE_{value:.2f}", "LATE_DAY_FADE", 840, 945, value) for value in (1.00, 1.50, 2.00)]
    + [Candidate(f"PM_BREAK_{value:.2f}", "AFTERNOON_BREAKOUT", 810, 945, value) for value in (0.10, 0.20, 0.30)]
    + [Candidate(f"PULLBACK_{value:.2f}", "MORNING_PULLBACK_TREND", 660, 945, value) for value in (0.35, 0.50, 0.75)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def previous_close_map(features: dict) -> Dict[str, Dict[str, float]]:
    result: Dict[str, Dict[str, float]] = defaultdict(dict)
    for symbol, rows in features["summaries"].items():
        previous: Optional[float] = None
        for day in sorted(rows):
            if previous is not None:
                result[symbol][day] = previous
            previous = finite(rows[day].get("close"))
    return result


def intraday_state(
    symbol: str,
    day: str,
    minute: int,
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    features: dict,
    prev_close: Dict[str, Dict[str, float]],
) -> Optional[dict]:
    bars = sessions.get(symbol, {}).get(day, {})
    bar = bars.get(minute)
    opening = bars.get(570)
    atr = features["atrPct"].get(symbol, {}).get(day)
    prior = prev_close.get(symbol, {}).get(day)
    if bar is None or opening is None or atr is None or atr <= 0:
        return None
    used = [item for key, item in bars.items() if 570 <= key <= minute]
    if not used:
        return None
    base_volume = sum(item.base_volume for item in used)
    quote_volume = sum(item.quote_volume for item in used)
    vwap = quote_volume / base_volume if base_volume > 0 else None
    if vwap is None or vwap <= 0:
        return None
    move_pct = (bar.close / opening.open - 1.0) * 100.0
    gap_pct = (opening.open / prior - 1.0) * 100.0 if prior and prior > 0 else None
    return {
        "symbol": symbol,
        "bar": bar,
        "open": opening.open,
        "close": bar.close,
        "vwap": vwap,
        "atrPct": atr,
        "moveAtr": move_pct / atr,
        "gapAtr": gap_pct / atr if gap_pct is not None else None,
        "previousClose": prior,
    }


def theme_members(
    theme: str,
    day: str,
    minute: int,
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    features: dict,
    prev_close: Dict[str, Dict[str, float]],
) -> List[dict]:
    return [
        item
        for item in (
            intraday_state(symbol, day, minute, sessions, features, prev_close)
            for symbol in base.THEMES[theme]
        )
        if item is not None
    ]


def rank_map(members: Sequence[dict]) -> Dict[str, float]:
    ordered = sorted(members, key=lambda item: (item["moveAtr"], item["symbol"]))
    if len(ordered) <= 1:
        return {item["symbol"]: 0.5 for item in ordered}
    return {item["symbol"]: index / (len(ordered) - 1) for index, item in enumerate(ordered)}


def one_leg(candidate: Candidate, state: dict, side: int, theme: str, score: float, detail: dict) -> Signal:
    stop_pct = max(0.60, candidate.stop_atr * state["atrPct"])
    gross = min(candidate.gross_cap, 0.75 / stop_pct)
    return Signal(
        candidate.candidate_id,
        candidate.family,
        theme,
        state["bar"].day,
        candidate.entry_minute,
        (Leg(state["symbol"], side, gross, state["atrPct"], state.get("previousClose")),),
        score,
        detail,
    )


def pair_signal(
    candidate: Candidate,
    long_state: dict,
    short_state: dict,
    theme: str,
    score: float,
    detail: dict,
) -> Signal:
    max_stop = max(
        max(0.60, candidate.stop_atr * long_state["atrPct"]),
        max(0.60, candidate.stop_atr * short_state["atrPct"]),
    )
    gross = min(candidate.gross_cap, 0.75 / max_stop)
    return Signal(
        candidate.candidate_id,
        candidate.family,
        theme,
        long_state["bar"].day,
        candidate.entry_minute,
        (
            Leg(long_state["symbol"], 1, gross / 2.0, long_state["atrPct"]),
            Leg(short_state["symbol"], -1, gross / 2.0, short_state["atrPct"]),
        ),
        score,
        detail,
    )


def build_signal(
    candidate: Candidate,
    day: str,
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    features: dict,
    prev_close: Dict[str, Dict[str, float]],
) -> Optional[Signal]:
    minute = candidate.entry_minute
    all_states = [
        item
        for item in (
            intraday_state(symbol, day, minute, sessions, features, prev_close)
            for symbol in base.SYMBOLS
        )
        if item is not None
    ]
    if len(all_states) < 5:
        return None

    options: List[Signal] = []
    if candidate.family in {"GAP_FADE", "GAP_CONTINUATION"}:
        for state in all_states:
            gap = state.get("gapAtr")
            if gap is None or abs(gap) < candidate.threshold:
                continue
            move = state["moveAtr"]
            above = state["close"] > state["vwap"]
            gap_side = 1 if gap > 0 else -1
            if candidate.family == "GAP_FADE":
                side = -gap_side
                confirmed = (gap_side > 0 and (move < 0 or not above)) or (gap_side < 0 and (move > 0 or above))
            else:
                side = gap_side
                confirmed = (side > 0 and move > 0 and above) or (side < 0 and move < 0 and not above)
            if confirmed:
                options.append(one_leg(candidate, state, side, "ALL", abs(gap) + abs(move), {"gapAtr": gap, "moveAtr": move}))

    elif candidate.family == "OPENING_EXHAUSTION":
        for state in all_states:
            bars = sessions[state["symbol"]][day]
            opening = [bars.get(570), bars.get(585)]
            if any(item is None for item in opening):
                continue
            up = (max(item.high for item in opening if item) / state["open"] - 1.0) * 100.0 / state["atrPct"]
            down = (min(item.low for item in opening if item) / state["open"] - 1.0) * 100.0 / state["atrPct"]
            if up >= candidate.threshold and state["close"] < state["vwap"]:
                options.append(one_leg(candidate, state, -1, "ALL", up, {"openingExcursionAtr": up}))
            if down <= -candidate.threshold and state["close"] > state["vwap"]:
                options.append(one_leg(candidate, state, 1, "ALL", abs(down), {"openingExcursionAtr": down}))

    elif candidate.family in {"XS_REVERSION_PAIR", "XS_MOMENTUM_PAIR"}:
        for theme in base.THEMES:
            members = theme_members(theme, day, minute, sessions, features, prev_close)
            if len(members) < 5:
                continue
            strongest = max(members, key=lambda item: item["moveAtr"])
            weakest = min(members, key=lambda item: item["moveAtr"])
            spread = strongest["moveAtr"] - weakest["moveAtr"]
            if spread < candidate.threshold:
                continue
            if candidate.family == "XS_REVERSION_PAIR":
                long_state, short_state = weakest, strongest
            else:
                long_state, short_state = strongest, weakest
            options.append(pair_signal(candidate, long_state, short_state, theme, spread, {"spreadAtr": spread}))

    elif candidate.family == "THEME_RESIDUAL_FADE":
        for theme in base.THEMES:
            members = theme_members(theme, day, minute, sessions, features, prev_close)
            if len(members) < 5:
                continue
            median = statistics.median(item["moveAtr"] for item in members)
            if abs(median) > 0.75:
                continue
            state = max(members, key=lambda item: abs(item["moveAtr"] - median))
            residual = state["moveAtr"] - median
            if abs(residual) >= candidate.threshold:
                options.append(one_leg(candidate, state, -1 if residual > 0 else 1, theme, abs(residual), {"residualAtr": residual, "themeMedianAtr": median}))

    elif candidate.family == "LATE_DAY_FADE":
        for state in all_states:
            if abs(state["moveAtr"]) < candidate.threshold:
                continue
            earlier = sessions[state["symbol"]][day].get(minute - 30)
            if earlier is None:
                continue
            recent = state["close"] / earlier.close - 1.0
            side = -1 if state["moveAtr"] > 0 else 1
            if (side < 0 and recent < 0) or (side > 0 and recent > 0):
                options.append(one_leg(candidate, state, side, "ALL", abs(state["moveAtr"]), {"moveAtr": state["moveAtr"], "last30m": recent}))

    elif candidate.family == "AFTERNOON_BREAKOUT":
        for theme in base.THEMES:
            members = theme_members(theme, day, minute, sessions, features, prev_close)
            if len(members) < 5:
                continue
            positive = sum(item["moveAtr"] > 0 for item in members) / len(members)
            negative = sum(item["moveAtr"] < 0 for item in members) / len(members)
            for state in members:
                bars = sessions[state["symbol"]][day]
                morning = [item for key, item in bars.items() if 570 <= key <= 720]
                if len(morning) < 8:
                    continue
                high = max(item.high for item in morning)
                low = min(item.low for item in morning)
                up_break = (state["close"] / high - 1.0) * 100.0 / state["atrPct"]
                down_break = (state["close"] / low - 1.0) * 100.0 / state["atrPct"]
                if positive >= 0.60 and up_break >= candidate.threshold and state["close"] > state["vwap"]:
                    options.append(one_leg(candidate, state, 1, theme, up_break + positive, {"breakAtr": up_break, "breadth": positive}))
                if negative >= 0.60 and down_break <= -candidate.threshold and state["close"] < state["vwap"]:
                    options.append(one_leg(candidate, state, -1, theme, abs(down_break) + negative, {"breakAtr": down_break, "breadth": negative}))

    elif candidate.family == "MORNING_PULLBACK_TREND":
        for theme in base.THEMES:
            members = theme_members(theme, day, minute, sessions, features, prev_close)
            if len(members) < 5:
                continue
            median = statistics.median(item["moveAtr"] for item in members)
            ranks = rank_map(members)
            for state in members:
                prior = sessions[state["symbol"]][day].get(minute - 30)
                if prior is None:
                    continue
                pullback = state["close"] / prior.close - 1.0
                rank = ranks[state["symbol"]]
                if median >= candidate.threshold and rank >= 0.75 and state["close"] > state["vwap"] and pullback < 0:
                    options.append(one_leg(candidate, state, 1, theme, median + rank, {"themeMoveAtr": median, "rank": rank, "pullback": pullback}))
                if median <= -candidate.threshold and rank <= 0.25 and state["close"] < state["vwap"] and pullback > 0:
                    options.append(one_leg(candidate, state, -1, theme, abs(median) + (1.0 - rank), {"themeMoveAtr": median, "rank": rank, "pullback": pullback}))

    if not options:
        return None
    return max(options, key=lambda signal: (signal.score, signal.candidate_id, signal.legs[0].symbol))


def future_vwap(bars: Dict[int, base.Bar], minute: int) -> Optional[float]:
    used = [item for key, item in bars.items() if 570 <= key <= minute]
    base_volume = sum(item.base_volume for item in used)
    quote_volume = sum(item.quote_volume for item in used)
    return quote_volume / base_volume if base_volume > 0 else None


def simulate_signal(
    signal: Signal,
    candidate: Candidate,
    scenario: base.CostScenario,
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
) -> Optional[dict]:
    fill_minute = candidate.entry_minute + 15
    entry_data: Dict[str, Tuple[Leg, float]] = {}
    total_gross = sum(abs(leg.weight) for leg in signal.legs)
    if total_gross <= 0:
        return None
    for leg in signal.legs:
        bar = sessions.get(leg.symbol, {}).get(signal.day, {}).get(fill_minute)
        if bar is None:
            return None
        entry_data[leg.symbol] = (leg, bar.open)

    exits: Dict[str, float] = {}
    exit_reason = "FORCED_INTRADAY_EXIT"
    stop_extra = 0.0
    minutes = sorted(set().union(*(
        set(sessions.get(leg.symbol, {}).get(signal.day, {})) for leg in signal.legs
    )))
    for minute in [value for value in minutes if fill_minute <= value <= candidate.exit_minute]:
        stop_triggered = False
        for leg in signal.legs:
            bar = sessions.get(leg.symbol, {}).get(signal.day, {}).get(minute)
            if bar is None:
                continue
            entry = entry_data[leg.symbol][1]
            stop_pct = max(0.60, candidate.stop_atr * leg.atr_pct) / 100.0
            stop = entry * (1.0 - leg.side * stop_pct)
            hit = (leg.side > 0 and bar.low <= stop) or (leg.side < 0 and bar.high >= stop)
            if hit:
                exits[leg.symbol] = stop * (1.0 - leg.side * scenario.stop_slippage_bps / 10_000.0)
                stop_extra += abs(leg.weight) * scenario.stop_slippage_bps / 10_000.0
                stop_triggered = True
        if stop_triggered:
            exit_reason = "HARD_STOP_EXIT"
            for leg in signal.legs:
                if leg.symbol not in exits:
                    bar = sessions.get(leg.symbol, {}).get(signal.day, {}).get(minute)
                    if bar is not None:
                        exits[leg.symbol] = bar.close
            break

        if len(signal.legs) == 1:
            leg = signal.legs[0]
            bar = sessions.get(leg.symbol, {}).get(signal.day, {}).get(minute)
            if bar is None:
                continue
            if candidate.family == "GAP_FADE" and leg.reference:
                touched = (leg.side > 0 and bar.high >= leg.reference) or (leg.side < 0 and bar.low <= leg.reference)
                if touched:
                    exits[leg.symbol] = leg.reference
                    exit_reason = "GAP_FILLED"
                    break
            if candidate.family in {"GAP_CONTINUATION", "AFTERNOON_BREAKOUT", "MORNING_PULLBACK_TREND"}:
                vwap = future_vwap(sessions[leg.symbol][signal.day], minute)
                if vwap is not None and ((leg.side > 0 and bar.close < vwap) or (leg.side < 0 and bar.close > vwap)):
                    exits[leg.symbol] = bar.close
                    exit_reason = "VWAP_FAILURE_EXIT"
                    break
            if candidate.family in {"OPENING_EXHAUSTION", "THEME_RESIDUAL_FADE", "LATE_DAY_FADE"}:
                vwap = future_vwap(sessions[leg.symbol][signal.day], minute)
                if vwap is not None and ((leg.side > 0 and bar.high >= vwap) or (leg.side < 0 and bar.low <= vwap)):
                    exits[leg.symbol] = vwap
                    exit_reason = "VWAP_TARGET"
                    break

    for leg in signal.legs:
        if leg.symbol in exits:
            continue
        bars = sessions.get(leg.symbol, {}).get(signal.day, {})
        preferred = bars.get(candidate.exit_minute)
        if preferred is not None:
            exits[leg.symbol] = preferred.open
        else:
            available = [item for key, item in bars.items() if fill_minute <= key <= candidate.exit_minute]
            if not available:
                return None
            exits[leg.symbol] = available[-1].close
            exit_reason = "SESSION_DATA_END_EXIT"

    raw = 0.0
    for leg in signal.legs:
        entry = entry_data[leg.symbol][1]
        exit_price = exits[leg.symbol]
        raw += leg.weight * leg.side * (exit_price / entry - 1.0)
    cost = 2.0 * total_gross * scenario.turnover_bps / 10_000.0 + stop_extra
    value = raw - cost
    return {
        "candidateId": signal.candidate_id,
        "family": signal.family,
        "theme": signal.theme,
        "day": signal.day,
        "entryMinute": fill_minute,
        "exitReason": exit_reason,
        "symbols": [leg.symbol for leg in signal.legs],
        "sides": [leg.side for leg in signal.legs],
        "gross": total_gross,
        "rawReturn": raw,
        "cost": cost,
        "return": value,
        "score": signal.score,
        "detail": signal.detail,
    }


def replay_candidate(
    candidate: Candidate,
    scenario: base.CostScenario,
    days: Sequence[str],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    features: dict,
    prev_close: Dict[str, Dict[str, float]],
) -> List[dict]:
    trades: List[dict] = []
    for day in days:
        signal = build_signal(candidate, day, sessions, features, prev_close)
        if signal is None:
            continue
        trade = simulate_signal(signal, candidate, scenario, sessions)
        if trade is not None:
            trades.append(trade)
    return trades


def product_return(values: Iterable[float]) -> float:
    return base.product_return(values)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    drawdown = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        drawdown = min(drawdown, equity / peak - 1.0)
    return drawdown


def metrics(trades: Sequence[dict]) -> dict:
    ordered = sorted(trades, key=lambda item: (item["day"], item["candidateId"]))
    values = [finite(item.get("return")) for item in ordered]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    positive = sum(wins)
    negative = -sum(losses)
    if ordered:
        start = dt.date.fromisoformat(ordered[0]["day"])
        end = dt.date.fromisoformat(ordered[-1]["day"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    compounded = product_return(values)
    return {
        "trades": len(values),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1.0 else -100.0,
        "profitFactor": positive / negative if negative > 1e-15 else None,
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "averageWinPct": statistics.mean(wins) * 100.0 if wins else 0.0,
        "averageLossPct": statistics.mean(losses) * 100.0 if losses else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    start, end = interval
    return [item for item in trades if start <= item["day"] <= end]


def removals(trades: Sequence[dict]) -> dict:
    if not trades:
        return {"bestTradeRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [finite(item["return"]) for item in trades]
    best = max(range(len(values)), key=values.__getitem__)
    months: Dict[str, List[float]] = defaultdict(list)
    for item, value in zip(trades, values):
        months[item["day"][:7]].append(value)
    best_month = max(months, key=lambda key: product_return(months[key]))
    return {
        "bestTradeRemovedPct": product_return(value for index, value in enumerate(values) if index != best) * 100.0,
        "bestMonth": best_month,
        "bestMonthRemovedPct": product_return(value for item, value in zip(trades, values) if item["day"][:7] != best_month) * 100.0,
    }


def score(metric_median: dict, metric_normal: dict, metric_severe: dict) -> float:
    pf = metric_median.get("profitFactor") or 0.0
    return (
        metric_median["compoundedReturnPct"]
        + 0.50 * metric_normal["compoundedReturnPct"]
        + 0.25 * metric_severe["compoundedReturnPct"]
        + 2.0 * (pf - 1.0)
        + 0.10 * metric_median["maxDrawdownPct"]
    )


def validation_pass(result: dict) -> bool:
    median = result["FORWARD_MEDIAN"]
    normal = result["NORMAL"]
    severe = result["SEVERE"]
    return bool(
        median["trades"] >= MIN_VALIDATION_TRADES
        and median["compoundedReturnPct"] > 0
        and normal["compoundedReturnPct"] > 0
        and severe["compoundedReturnPct"] > 0
        and (median.get("profitFactor") or 0) > 1.05
        and (severe.get("profitFactor") or 0) > 1.0
    )


def holdout_pass(result: dict) -> bool:
    median = result["FORWARD_MEDIAN"]
    normal = result["NORMAL"]
    severe = result["SEVERE"]
    return bool(
        median["trades"] >= MIN_HOLDOUT_TRADES
        and median["compoundedReturnPct"] > 0
        and normal["compoundedReturnPct"] > 0
        and severe["compoundedReturnPct"] > 0
        and (median.get("profitFactor") or 0) > 1.0
        and (normal.get("profitFactor") or 0) > 1.0
    )


def combine_daily(candidate_trades: Dict[str, List[dict]], ids: Sequence[str]) -> List[dict]:
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for candidate_id in ids:
        for trade in candidate_trades.get(candidate_id, []):
            by_day[trade["day"]].append(trade)
    combined: List[dict] = []
    for day, items in sorted(by_day.items()):
        value = statistics.mean(finite(item["return"]) for item in items)
        combined.append({
            "candidateId": "VALIDATION_SELECTED_ENSEMBLE",
            "family": "ENSEMBLE",
            "theme": "MIXED",
            "day": day,
            "symbols": sorted(set(symbol for item in items for symbol in item["symbols"])),
            "return": value,
            "gross": 1.0,
            "members": [item["candidateId"] for item in items],
        })
    return combined


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
    features = base.build_features(sessions)
    prev_close = previous_close_map(features)
    eligible_days = sorted(set().union(*(set(features["atrPct"].get(symbol, {})) for symbol in base.SYMBOLS)))
    splits = base.chronological_splits(eligible_days)

    trades_by_scenario: Dict[str, Dict[str, List[dict]]] = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            trades_by_scenario[scenario.name][candidate.candidate_id] = replay_candidate(
                candidate, scenario, eligible_days, sessions, features, prev_close
            )

    family_results: Dict[str, dict] = {}
    family_winners: Dict[str, str] = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {
                scenario.name: metrics(subset(trades_by_scenario[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"]))
                for scenario in base.SCENARIOS
            }
            candidate_score = score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"])
            rows.append({"candidate": asdict(candidate), "development": development, "score": candidate_score})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= MIN_FAMILY_DEV_TRADES]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        family_winners[family] = winner_id
        validation = {
            scenario.name: metrics(subset(trades_by_scenario[scenario.name][winner_id], splits["VALIDATION"]))
            for scenario in base.SCENARIOS
        }
        family_results[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": validation_pass(validation),
        }

    passing_ids = [item["winnerId"] for item in family_results.values() if item["validationPass"]]
    single_candidates = []
    for candidate_id in passing_ids:
        validation = {
            scenario.name: metrics(subset(trades_by_scenario[scenario.name][candidate_id], splits["VALIDATION"]))
            for scenario in base.SCENARIOS
        }
        single_candidates.append((score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]), candidate_id))

    portfolio_options: List[dict] = []
    if single_candidates:
        _, best_single = max(single_candidates)
        portfolio_options.append({"portfolioId": best_single, "members": [best_single]})
    if len(passing_ids) >= 2:
        portfolio_options.append({"portfolioId": "VALIDATION_SELECTED_ENSEMBLE", "members": sorted(passing_ids)})

    for option in portfolio_options:
        validation_metrics = {}
        for scenario in base.SCENARIOS:
            if len(option["members"]) == 1:
                trades = trades_by_scenario[scenario.name][option["members"][0]]
            else:
                trades = combine_daily(trades_by_scenario[scenario.name], option["members"])
            validation_metrics[scenario.name] = metrics(subset(trades, splits["VALIDATION"]))
        option["validation"] = validation_metrics
        option["validationScore"] = score(validation_metrics["FORWARD_MEDIAN"], validation_metrics["NORMAL"], validation_metrics["SEVERE"])

    selected = max(portfolio_options, key=lambda item: (item["validationScore"], item["portfolioId"])) if portfolio_options else None
    final_result = None
    if selected is not None:
        final_result = {"portfolioId": selected["portfolioId"], "members": selected["members"], "validation": selected["validation"], "scenarios": {}}
        for scenario in base.SCENARIOS:
            if len(selected["members"]) == 1:
                trades = trades_by_scenario[scenario.name][selected["members"][0]]
            else:
                trades = combine_daily(trades_by_scenario[scenario.name], selected["members"])
            final_result["scenarios"][scenario.name] = {
                "full": metrics(trades),
                "development": metrics(subset(trades, splits["DEVELOPMENT"])),
                "validation": metrics(subset(trades, splits["VALIDATION"])),
                "holdout": metrics(subset(trades, splits["HOLDOUT"])),
                "removals": removals(trades),
                "trades": trades,
            }
        final_result["holdoutPass"] = holdout_pass({name: item["holdout"] for name, item in final_result["scenarios"].items()})
        normal = final_result["scenarios"]["NORMAL"]["full"]
        severe = final_result["scenarios"]["SEVERE"]["full"]
        final_result["cryptoLikeHistorical"] = bool(
            final_result["holdoutPass"]
            and normal["compoundedReturnPct"] >= 50.0
            and normal["cagrPct"] >= 50.0
            and severe["compoundedReturnPct"] > 0
            and normal["maxDrawdownPct"] >= -30.0
        )

    if final_result and final_result["cryptoLikeHistorical"]:
        status = "CRYPTO_LIKE_HISTORICAL_STOCK_EDGE_FOUND_SHADOW_ONLY"
    elif final_result and final_result["holdoutPass"]:
        status = "ROBUST_POSITIVE_STOCK_EDGE_FOUND_SHADOW_ONLY"
    elif passing_ids:
        status = "VALIDATION_LEAD_FAILED_UNTOUCHED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_STOCK_FAMILY"

    return rounded({
        "version": 2,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "dataWindow": {"startUtc": base.START_UTC.isoformat(), "endUtc": base.END_UTC.isoformat()},
        "splits": splits,
        "candidateCount": len(CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in CANDIDATES)),
        "selectionDiscipline": {
            "familyParameterSelection": "DEVELOPMENT only",
            "familyScreen": "VALIDATION only",
            "finalEvaluation": "selected single or validation-selected ensemble on untouched HOLDOUT once",
            "holdoutRetuningAllowed": False,
        },
        "families": family_results,
        "validationPassingWinnerIds": passing_ids,
        "portfolioOptions": portfolio_options,
        "selected": final_result,
        "cryptoComparison": {
            "referenceV96FullPct": 1353.60,
            "referenceV96CagrPct": 115.02,
            "note": "The stock history is much shorter and Gross is capped at 1.0, so absolute full-period return is not directly comparable.",
        },
        "evidenceLimits": [
            "Current-listing survivorship bias and uneven Aster stock-perpetual history remain.",
            "Historical OI, event first-seen chronology, halts and order-book gates are not reconstructed.",
            "Forward Median, Normal, p95 and Severe costs are applied to the OHLCV core.",
            "A positive result would remain Shadow-only until Forward execution evidence exists.",
            "The same Holdout must not be reused to redesign failed families.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-multifamily-tournament-v2.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Multi-family Tournament V2",
        "",
        f"- Status: **{result['status']}**",
        f"- Candidates / families: {result['candidateCount']} / {result['familyCount']}",
        f"- Validation-passing family winners: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "## Family winners",
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
        lines.extend([
            "",
            "## Selected portfolio — untouched Holdout",
            "",
            f"Portfolio: **{selected['portfolioId']}**",
            f"Members: {', '.join(selected['members'])}",
            f"Holdout pass: **{'YES' if selected['holdoutPass'] else 'NO'}**",
            f"Crypto-like historical threshold: **{'YES' if selected['cryptoLikeHistorical'] else 'NO'}**",
            "",
            "| Scenario | Full return | CAGR | PF | DD | Holdout return | Holdout PF | Trades |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            item = selected["scenarios"][name]
            lines.append(
                f"| {name} | {item['full']['compoundedReturnPct']}% | {item['full']['cagrPct']}% | {item['full']['profitFactor']} | "
                f"{item['full']['maxDrawdownPct']}% | {item['holdout']['compoundedReturnPct']}% | {item['holdout']['profitFactor']} | {item['full']['trades']} |"
            )
    lines.extend([
        "",
        "## Anti-overfit restriction",
        "",
        "Families and neighborhoods were predeclared together. Development selected each family parameter, Validation selected the final single/ensemble, and only then was the untouched Holdout evaluated. Failed families must not be retuned on this Holdout.",
    ])
    (output_dir / "v96-stock-multifamily-tournament-v2.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 27
    assert len(set(candidate.family for candidate in CANDIDATES)) == 9
    assert all(candidate.entry_minute < candidate.exit_minute for candidate in CANDIDATES)
    assert abs(product_return([0.10, -0.05]) - 0.045) < 1e-12
    sample = [
        {"candidateId": "A", "day": "2026-01-01", "return": 0.10, "symbols": ["A"]},
        {"candidateId": "B", "day": "2026-01-01", "return": -0.02, "symbols": ["B"]},
    ]
    combined = combine_daily({"A": [sample[0]], "B": [sample[1]]}, ["A", "B"])
    assert abs(combined[0]["return"] - 0.04) < 1e-12


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-multifamily-tournament-v2")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock multi-family tournament self-test: PASS")
        return 0
    result = analyze(Path(args.cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "validationPassingWinnerIds": result["validationPassingWinnerIds"],
        "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
