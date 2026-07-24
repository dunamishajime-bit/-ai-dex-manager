from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_FUNDING_CARRY_TOURNAMENT_V4"
FUNDING_MAX_AGE_MS = 36 * 60 * 60 * 1000


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_bps: float
    hold_days: int


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


CANDIDATES = tuple(
    [Candidate(f"NEG_CARRY_{value:.1f}", "NEGATIVE_CARRY_LONG", value, 3) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"POS_CARRY_{value:.1f}", "POSITIVE_CARRY_SHORT", value, 3) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"DISP_PAIR_{value:.1f}", "FUNDING_DISPERSION_PAIR", value, 3) for value in (2.0, 5.0, 10.0)]
    + [Candidate(f"NEG_TREND_{value:.1f}", "NEGATIVE_FUNDING_TREND_LONG", value, 5) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"POS_TREND_{value:.1f}", "POSITIVE_FUNDING_TREND_SHORT", value, 5) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"NEG_OVERSOLD_{value:.1f}", "NEGATIVE_FUNDING_OVERSOLD_LONG", value, 3) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"POS_OVERBOUGHT_{value:.1f}", "POSITIVE_FUNDING_OVERBOUGHT_SHORT", value, 3) for value in (0.5, 1.5, 3.0)]
    + [Candidate(f"PERSIST_PAIR_{value:.1f}", "PERSISTENT_FUNDING_DISPERSION_PAIR", value, 5) for value in (1.0, 3.0, 6.0)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def fetch_funding(symbol: str, cache_dir: Path) -> List[dict]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-funding-{base.START_UTC.date()}-{base.END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    cursor = int(base.START_UTC.timestamp() * 1000)
    end_ms = int(base.END_UTC.timestamp() * 1000)
    result: List[dict] = []
    while cursor < end_ms:
        payload = base.request_json(
            "/fapi/v1/fundingRate",
            {
                "symbol": symbol,
                "startTime": cursor,
                "endTime": end_ms - 1,
                "limit": 1000,
            },
        )
        if not isinstance(payload, list) or not payload:
            break
        result.extend(item for item in payload if isinstance(item, dict))
        last = int(payload[-1].get("fundingTime", cursor))
        if last + 1 <= cursor:
            break
        cursor = last + 1
        if len(payload) < 1000:
            break
        time.sleep(0.05)
    dedup = {int(item.get("fundingTime", 0)): item for item in result if int(item.get("fundingTime", 0)) > 0}
    rows = [dedup[key] for key in sorted(dedup)]
    path.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    return rows


def load_funding(cache_dir: Path) -> Dict[str, List[dict]]:
    result: Dict[str, List[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_funding, symbol, cache_dir): symbol for symbol in base.SYMBOLS}
        for future in concurrent.futures.as_completed(futures):
            symbol = futures[future]
            result[symbol] = future.result()
            print(f"loaded funding {symbol}: {len(result[symbol])}")
    return dict(sorted(result.items()))


def funding_points(rows: Sequence[dict]) -> List[Tuple[int, float]]:
    result = []
    for item in rows:
        ts = int(item.get("fundingTime", 0))
        rate = finite(item.get("fundingRate"), math.nan)
        if ts > 0 and math.isfinite(rate):
            result.append((ts, rate))
    return sorted(result)


def funding_snapshot(points: Sequence[Tuple[int, float]], ts: int) -> Optional[dict]:
    prior = [(time_ms, rate) for time_ms, rate in points if time_ms <= ts]
    if not prior or ts - prior[-1][0] > FUNDING_MAX_AGE_MS:
        return None
    rates = [rate for _time_ms, rate in prior[-3:]]
    return {
        "latest": rates[-1],
        "median3": statistics.median(rates),
        "lastTs": prior[-1][0],
        "count3": len(rates),
    }


def funding_between(points: Sequence[Tuple[int, float]], start_ts: int, end_ts: int) -> float:
    return sum(rate for ts, rate in points if start_ts <= ts < end_ts)


def session_times(sessions: Dict[str, Dict[str, Dict[int, base.Bar]]], symbol: str, day: str) -> Optional[Tuple[int, int]]:
    bars = sessions.get(symbol, {}).get(day, {})
    if not bars:
        return None
    first = bars.get(570) or bars[min(bars)]
    last = bars[max(bars)]
    return first.ts, last.ts + base.INTERVAL_MS


def previous_close_days(bars: Dict[str, swing.DailyBar], day: str, count: int) -> List[swing.DailyBar]:
    return swing.history(bars, day, count)


def snapshot(
    symbol: str,
    day: str,
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[dict]:
    rows = previous_close_days(bars.get(symbol, {}), day, 30)
    times = session_times(sessions, symbol, day)
    if len(rows) < 21 or rows[-1].day != day or times is None:
        return None
    fund = funding_snapshot(funding.get(symbol, []), times[1])
    if fund is None:
        return None
    mom20 = swing.pct_change(rows, 20)
    mom3 = swing.pct_change(rows, 3)
    average = swing.sma(rows, 20)
    atr = swing.mean_tr(rows, 20)
    vol = swing.stdev_returns(rows, 20)
    if None in (mom20, mom3, average, atr, vol) or not vol or not atr:
        return None
    return {
        "symbol": symbol,
        "bar": rows[-1],
        "times": times,
        "funding": fund,
        "latestBps": fund["latest"] * 10_000.0,
        "median3Bps": fund["median3"] * 10_000.0,
        "mom20": mom20,
        "mom3": mom3,
        "sma20": average,
        "atrPct": atr,
        "vol": vol,
    }


def basket_signal(candidate: Candidate, states: Sequence[dict], side: int, day: str, detail: dict) -> Signal:
    selected = list(states)[: min(3, len(states))]
    each = 1.0 / len(selected)
    stop_pct = max(3.0, 2.0 * max(item["atrPct"] for item in selected))
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        tuple(Leg(item["symbol"], side, each) for item in selected),
        sum(abs(item["latestBps"]) for item in selected),
        stop_pct,
        detail,
    )


def pair_signal(candidate: Candidate, long_state: dict, short_state: dict, day: str, detail: dict) -> Signal:
    stop_pct = max(4.0, 2.0 * max(long_state["atrPct"], short_state["atrPct"]))
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        (Leg(long_state["symbol"], 1, 0.5), Leg(short_state["symbol"], -1, 0.5)),
        short_state["latestBps"] - long_state["latestBps"],
        stop_pct,
        detail,
    )


def build_signal(
    candidate: Candidate,
    day: str,
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[Signal]:
    states = [
        item for item in (
            snapshot(symbol, day, bars, sessions, funding) for symbol in base.SYMBOLS
        ) if item is not None
    ]
    if len(states) < 8:
        return None
    threshold = candidate.threshold_bps

    if candidate.family == "NEGATIVE_CARRY_LONG":
        eligible = sorted(
            (item for item in states if item["latestBps"] <= -threshold),
            key=lambda item: item["latestBps"],
        )
        return basket_signal(candidate, eligible, 1, day, {"thresholdBps": threshold}) if eligible else None

    if candidate.family == "POSITIVE_CARRY_SHORT":
        eligible = sorted(
            (item for item in states if item["latestBps"] >= threshold),
            key=lambda item: item["latestBps"], reverse=True,
        )
        return basket_signal(candidate, eligible, -1, day, {"thresholdBps": threshold}) if eligible else None

    if candidate.family == "FUNDING_DISPERSION_PAIR":
        long_state = min(states, key=lambda item: item["latestBps"])
        short_state = max(states, key=lambda item: item["latestBps"])
        spread = short_state["latestBps"] - long_state["latestBps"]
        return pair_signal(candidate, long_state, short_state, day, {"fundingSpreadBps": spread}) if spread >= threshold else None

    if candidate.family == "NEGATIVE_FUNDING_TREND_LONG":
        eligible = sorted(
            (
                item for item in states
                if item["latestBps"] <= -threshold
                and item["mom20"] >= 0.05
                and item["bar"].close > item["sma20"]
            ),
            key=lambda item: (-item["mom20"] / item["vol"], item["latestBps"]),
        )
        return basket_signal(candidate, eligible, 1, day, {"thresholdBps": threshold, "trendFilter": ">=5%"}) if eligible else None

    if candidate.family == "POSITIVE_FUNDING_TREND_SHORT":
        eligible = sorted(
            (
                item for item in states
                if item["latestBps"] >= threshold
                and item["mom20"] <= -0.05
                and item["bar"].close < item["sma20"]
            ),
            key=lambda item: (item["mom20"] / item["vol"], -item["latestBps"]),
        )
        return basket_signal(candidate, eligible, -1, day, {"thresholdBps": threshold, "trendFilter": "<=-5%"}) if eligible else None

    if candidate.family == "NEGATIVE_FUNDING_OVERSOLD_LONG":
        eligible = sorted(
            (
                item for item in states
                if item["latestBps"] <= -threshold and item["mom3"] <= -0.03
            ),
            key=lambda item: (item["mom3"], item["latestBps"]),
        )
        return basket_signal(candidate, eligible, 1, day, {"thresholdBps": threshold, "mom3Filter": "<=-3%"}) if eligible else None

    if candidate.family == "POSITIVE_FUNDING_OVERBOUGHT_SHORT":
        eligible = sorted(
            (
                item for item in states
                if item["latestBps"] >= threshold and item["mom3"] >= 0.03
            ),
            key=lambda item: (item["mom3"], item["latestBps"]), reverse=True,
        )
        return basket_signal(candidate, eligible, -1, day, {"thresholdBps": threshold, "mom3Filter": ">=3%"}) if eligible else None

    if candidate.family == "PERSISTENT_FUNDING_DISPERSION_PAIR":
        persistent = [item for item in states if item["funding"]["count3"] >= 3]
        if len(persistent) < 2:
            return None
        long_state = min(persistent, key=lambda item: item["median3Bps"])
        short_state = max(persistent, key=lambda item: item["median3Bps"])
        spread = short_state["median3Bps"] - long_state["median3Bps"]
        if long_state["median3Bps"] >= 0 or short_state["median3Bps"] <= 0 or spread < threshold:
            return None
        return pair_signal(candidate, long_state, short_state, day, {"median3SpreadBps": spread})

    return None


def common_history_days(
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> List[str]:
    all_days = sorted(set().union(*(set(rows) for rows in bars.values())))
    result = []
    for day in all_days:
        count = sum(
            snapshot(symbol, day, bars, sessions, funding) is not None
            for symbol in base.SYMBOLS
        )
        if count >= 8:
            result.append(day)
    return result


def next_common_day(signal: Signal, days: Sequence[str], bars: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[str]:
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
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[dict]:
    entry_day = next_common_day(signal, days, bars)
    if entry_day is None:
        return None
    start_index = days.index(entry_day)
    entry_prices = {leg.symbol: bars[leg.symbol][entry_day].open for leg in signal.legs}
    entry_times = {leg.symbol: session_times(sessions, leg.symbol, entry_day) for leg in signal.legs}
    if any(value is None for value in entry_times.values()):
        return None
    exits: Dict[str, float] = {}
    exit_times: Dict[str, int] = {}
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
            times = session_times(sessions, leg.symbol, day)
            if times is None:
                return None
            entry = entry_prices[leg.symbol]
            stop = entry * (1.0 - leg.side * signal.stop_pct / 100.0)
            gap_hit = (leg.side > 0 and bar.open <= stop) or (leg.side < 0 and bar.open >= stop)
            intraday_hit = (leg.side > 0 and bar.low <= stop) or (leg.side < 0 and bar.high >= stop)
            if gap_hit:
                exits[leg.symbol] = bar.open * (1.0 - leg.side * scenario.stop_slippage_bps / 10_000.0)
                exit_times[leg.symbol] = times[0]
                stop_extra += abs(leg.weight) * scenario.stop_slippage_bps / 10_000.0
                stopped = True
            elif intraday_hit:
                exits[leg.symbol] = stop * (1.0 - leg.side * scenario.stop_slippage_bps / 10_000.0)
                exit_times[leg.symbol] = times[1]
                stop_extra += abs(leg.weight) * scenario.stop_slippage_bps / 10_000.0
                stopped = True
        if stopped:
            for leg in signal.legs:
                if leg.symbol not in exits:
                    exits[leg.symbol] = bars[leg.symbol][day].close
                    exit_times[leg.symbol] = session_times(sessions, leg.symbol, day)[1]  # type: ignore[index]
            exit_day = day
            reason = "HARD_STOP_EXIT"
            break
        if holding >= candidate.hold_days:
            for leg in signal.legs:
                exits[leg.symbol] = bars[leg.symbol][day].close
                exit_times[leg.symbol] = session_times(sessions, leg.symbol, day)[1]  # type: ignore[index]
            exit_day = day
            break
    if len(exits) != len(signal.legs):
        return None

    price_return = 0.0
    funding_cost = 0.0
    funding_detail = {}
    for leg in signal.legs:
        price_return += leg.weight * leg.side * (exits[leg.symbol] / entry_prices[leg.symbol] - 1.0)
        start_ts = entry_times[leg.symbol][0]  # type: ignore[index]
        total_rate = funding_between(funding.get(leg.symbol, []), start_ts, exit_times[leg.symbol])
        signed_cost = leg.weight * leg.side * total_rate
        funding_cost += signed_cost
        funding_detail[leg.symbol] = {"sumRate": total_rate, "signedCost": signed_cost}
    gross = sum(abs(leg.weight) for leg in signal.legs)
    execution_cost = 2.0 * gross * scenario.turnover_bps / 10_000.0 + stop_extra
    value = price_return - funding_cost - execution_cost
    return {
        "candidateId": signal.candidate_id,
        "family": signal.family,
        "decisionDay": signal.decision_day,
        "entryDay": entry_day,
        "exitDay": exit_day,
        "symbols": [leg.symbol for leg in signal.legs],
        "sides": [leg.side for leg in signal.legs],
        "gross": gross,
        "priceReturn": price_return,
        "fundingCost": funding_cost,
        "executionCost": execution_cost,
        "return": value,
        "exitReason": reason,
        "score": signal.score,
        "fundingDetail": funding_detail,
        "detail": signal.detail,
    }


def replay_candidate(
    candidate: Candidate,
    scenario: base.CostScenario,
    days: Sequence[str],
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> List[dict]:
    trades: List[dict] = []
    blocked_until = ""
    for day in days:
        if blocked_until and day <= blocked_until:
            continue
        signal = build_signal(candidate, day, bars, sessions, funding)
        if signal is None:
            continue
        trade = simulate_trade(candidate, signal, scenario, days, bars, sessions, funding)
        if trade is not None:
            trades.append(trade)
            blocked_until = trade["exitDay"]
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


def metrics(trades: Sequence[dict], multiplier: float = 1.0) -> dict:
    ordered = sorted(trades, key=lambda item: (item["exitDay"], item["candidateId"]))
    values = [multiplier * finite(item["return"]) for item in ordered]
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


def removals(trades: Sequence[dict], multiplier: float = 1.0) -> dict:
    if not trades:
        return {"bestTradeRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [multiplier * finite(item["return"]) for item in trades]
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
        result["FORWARD_MEDIAN"]["trades"] >= 5
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05
    )


def holdout_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 5
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
            "candidateId": "VALIDATION_SELECTED_FUNDING_ENSEMBLE",
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


def analyze(price_cache: Path, funding_cache: Path) -> dict:
    raw = base.load_all(price_cache)
    sessions = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items()}
    bars = swing.daily_bars(sessions)
    funding_raw = load_funding(funding_cache)
    funding = {symbol: funding_points(rows) for symbol, rows in funding_raw.items()}
    eligible_days = common_history_days(bars, sessions, funding)
    splits = base.chronological_splits(eligible_days)
    if len(eligible_days) < 60:
        raise RuntimeError(f"insufficient eligible funding/price days: {len(eligible_days)}")

    all_trades: Dict[str, Dict[str, List[dict]]] = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_trades[scenario.name][candidate.candidate_id] = replay_candidate(
                candidate, scenario, eligible_days, bars, sessions, funding
            )

    families = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {
                scenario.name: metrics(subset(all_trades[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"]))
                for scenario in base.SCENARIOS
            }
            rows.append({
                "candidate": asdict(candidate),
                "development": development,
                "score": score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"]),
            })
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: metrics(subset(all_trades[scenario.name][winner_id], splits["VALIDATION"]))
            for scenario in base.SCENARIOS
        }
        families[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": validation_pass(validation),
        }

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {
            scenario.name: metrics(subset(all_trades[scenario.name][candidate_id], splits["VALIDATION"]))
            for scenario in base.SCENARIOS
        }
        options.append({
            "portfolioId": candidate_id,
            "members": [candidate_id],
            "validation": validation,
            "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]),
        })
    if len(passing) >= 2:
        validation = {}
        for scenario in base.SCENARIOS:
            validation[scenario.name] = metrics(subset(combine(all_trades[scenario.name], passing), splits["VALIDATION"]))
        options.append({
            "portfolioId": "VALIDATION_SELECTED_FUNDING_ENSEMBLE",
            "members": sorted(passing),
            "validation": validation,
            "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]),
        })

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {
            "portfolioId": selected_option["portfolioId"],
            "members": selected_option["members"],
            "validation": selected_option["validation"],
            "gross1": {},
            "normalizedGross2": {},
        }
        for scenario in base.SCENARIOS:
            trades = (
                all_trades[scenario.name][selected_option["members"][0]]
                if len(selected_option["members"]) == 1
                else combine(all_trades[scenario.name], selected_option["members"])
            )
            selected["gross1"][scenario.name] = {
                "full": metrics(trades),
                "development": metrics(subset(trades, splits["DEVELOPMENT"])),
                "validation": metrics(subset(trades, splits["VALIDATION"])),
                "holdout": metrics(subset(trades, splits["HOLDOUT"])),
                "removals": removals(trades),
                "trades": trades,
            }
            selected["normalizedGross2"][scenario.name] = {
                "full": metrics(trades, 2.0),
                "holdout": metrics(subset(trades, splits["HOLDOUT"]), 2.0),
                "removals": removals(trades, 2.0),
            }
        selected["holdoutPassGross1"] = holdout_pass({
            name: item["holdout"] for name, item in selected["gross1"].items()
        })
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(
            selected["holdoutPassGross1"]
            and normal2["compoundedReturnPct"] >= 50
            and normal2["cagrPct"] >= 50
            and severe2["compoundedReturnPct"] > 0
            and normal2["maxDrawdownPct"] >= -50
        )

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_FUNDING_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_FUNDING_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "FUNDING_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_FUNDING_FAMILY"

    coverage = {
        symbol: {
            "fundingRows": len(funding.get(symbol, [])),
            "firstFundingTs": funding[symbol][0][0] if funding.get(symbol) else None,
            "lastFundingTs": funding[symbol][-1][0] if funding.get(symbol) else None,
        }
        for symbol in base.SYMBOLS
    }
    return rounded({
        "version": 4,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in CANDIDATES)),
        "eligibleDays": len(eligible_days),
        "firstEligibleDay": eligible_days[0],
        "lastEligibleDay": eligible_days[-1],
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "fundingCoverage": coverage,
        "selectionDiscipline": {
            "familyThresholdSelection": "DEVELOPMENT only",
            "familyScreenAndPortfolioSelection": "VALIDATION only",
            "finalEvaluation": "reused historical HOLDOUT evaluated once",
            "holdoutRetuningAllowed": False,
        },
        "classificationLimit": "This date range was previously inspected by other stock strategies. Any positive result is reused historical evidence and cannot be called independent Holdout evidence.",
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
        "limitations": [
            "Regular-session OHLC is used for price execution while Funding accrues continuously between the regular-session entry and exit timestamps.",
            "Off-session price stop paths are unavailable; overnight gap stops are handled at the next regular-session open.",
            "Current-listing survivorship bias and uneven contract history remain.",
            "Historical order-book, event first-seen and halt gates are not reconstructed.",
            "Gross 2.0 results are normalized sensitivity only, not a Stock Production allocation approval.",
        ],
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-funding-carry-tournament-v4.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Funding Carry Tournament V4",
        "",
        f"- Status: **{result['status']}**",
        f"- Eligible window: {result['firstEligibleDay']}–{result['lastEligibleDay']} ({result['eligibleDays']} days)",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev trades | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for family, item in result["families"].items():
        winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
        lines.append(
            f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['trades']} | "
            f"{winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {winner['development']['SEVERE']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | "
            f"{'YES' if item['validationPass'] else 'NO'} |"
        )
    selected = result.get("selected")
    if selected:
        lines.extend([
            "",
            "## Selected reused-historical portfolio",
            "",
            f"Portfolio: **{selected['portfolioId']}**",
            f"Gross 1 Holdout pass: **{'YES' if selected['holdoutPassGross1'] else 'NO'}**",
            f"Normalized Gross 2 crypto-like threshold: **{'YES' if selected['cryptoLikeNormalizedGross2'] else 'NO'}**",
            "",
            "| Scenario | G1 Full | G1 CAGR | G1 DD | G1 Holdout | G2 Full | G2 CAGR | G2 DD | G2 Holdout |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            g1 = selected["gross1"][name]
            g2 = selected["normalizedGross2"][name]
            lines.append(
                f"| {name} | {g1['full']['compoundedReturnPct']}% | {g1['full']['cagrPct']}% | {g1['full']['maxDrawdownPct']}% | "
                f"{g1['holdout']['compoundedReturnPct']}% | {g2['full']['compoundedReturnPct']}% | {g2['full']['cagrPct']}% | "
                f"{g2['full']['maxDrawdownPct']}% | {g2['holdout']['compoundedReturnPct']}% |"
            )
    lines.extend(["", "Any positive result remains reused historical Shadow evidence; the dates are not independent after prior Stock experiments."])
    (output_dir / "v96-stock-funding-carry-tournament-v4.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 24
    assert len(set(candidate.family for candidate in CANDIDATES)) == 8
    points = [(100, -0.001), (200, 0.002), (300, -0.0005)]
    assert abs(funding_between(points, 100, 300) - 0.001) < 1e-12
    snap = funding_snapshot(points, 300)
    assert snap is not None and snap["latest"] == -0.0005


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--price-cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-funding-carry-tournament-v4")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock funding carry tournament V4 self-test: PASS")
        return 0
    result = analyze(Path(args.price_cache_dir).resolve(), Path(args.funding_cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "eligibleDays": result["eligibleDays"],
        "validationPassingWinnerIds": result["validationPassingWinnerIds"],
        "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
