from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import v96_stock_basis_mature_v9 as v9
import v96_stock_cash_perp_basis_v10 as v10
import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_PERP_FADE_ENHANCEMENT_V11"
SYMBOLS = tuple(v10.SYMBOL_MAP)
MIN_BASIS_BPS = 50.0
ROLLING_BASIS_DAYS = 20
CONVERGENCE_BPS = 15.0
BASIS_STOP_MULTIPLE = 1.5
PRICE_STOP_PCT = 2.0

CASH_MINUTES = (570, 630, 690, 750, 810, 870)
PERP_SIGNAL_MINUTE = 600
PERP_ENTRY_MINUTE = 630
PERP_CHECK_CLOSE_STARTS = (660, 720, 780, 840, 900)
PERP_EXIT_OPEN_MINUTES = (690, 750, 810, 870, 930)

DIRECTION_MODES = (
    "BOTH",
    "PREMIUM_SHORT_ONLY",
    "DISCOUNT_LONG_ONLY",
    "PREMIUM_HEAVY",
    "DISCOUNT_HEAVY",
)
SIZING_MODES = ("FLAT", "TIERED")
EXIT_MODES = ("TIME", "CONVERGENCE", "CONVERGENCE_PRICE2")
SELECTION_MODES = ("ABS_TOP1", "ZSCORE_TOP1", "ZSCORE_TOP2")


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    direction_mode: str
    sizing_mode: str
    exit_mode: str
    selection_mode: str


CANDIDATES = tuple(
    Candidate(
        f"{direction}__{sizing}__{exit_mode}__{selection}",
        direction,
        sizing,
        exit_mode,
        selection,
    )
    for direction in DIRECTION_MODES
    for sizing in SIZING_MODES
    for exit_mode in EXIT_MODES
    for selection in SELECTION_MODES
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def local_parts(ts: int) -> Tuple[str, int, int]:
    return v9.local_parts(ts)


def parse_cash_intraday(payload: dict) -> Tuple[Dict[str, dict], dict]:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(results, list) or not results:
        return {}, {"bars": 0, "completeDays": 0, "error": chart.get("error") if isinstance(chart, dict) else None}
    root = results[0]
    timestamps = root.get("timestamp") or []
    quote = ((root.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    closes = quote.get("close") or []
    by_day: Dict[str, dict] = defaultdict(dict)
    valid = 0
    for index, raw_ts in enumerate(timestamps):
        if index >= len(opens) or index >= len(closes):
            continue
        open_price = finite(opens[index], math.nan)
        close_price = finite(closes[index], math.nan)
        if not math.isfinite(open_price) or not math.isfinite(close_price) or min(open_price, close_price) <= 0:
            continue
        ts_ms = int(raw_ts) * 1000
        day, minute, weekday = local_parts(ts_ms)
        if weekday >= 5 or minute not in CASH_MINUTES:
            continue
        by_day[day][minute] = {"ts": ts_ms, "open": open_price, "close": close_price}
        valid += 1
    completed = {}
    for day, slots in by_day.items():
        if not all(minute in slots for minute in CASH_MINUTES):
            continue
        completed[day] = {
            "signal": slots[570]["close"],
            "signalTs": slots[570]["ts"] + 60 * 60 * 1000,
            "entry": slots[630]["open"],
            "entryTs": slots[630]["ts"],
            "checkpoints": [
                {"ts": slots[minute]["ts"] + 60 * 60 * 1000, "cash": slots[minute]["close"]}
                for minute in (630, 690, 750, 810, 870)
            ],
        }
    return completed, {
        "bars": valid,
        "completeDays": len(completed),
        "firstDay": min(completed) if completed else None,
        "lastDay": max(completed) if completed else None,
        "events": sorted((root.get("events") or {}).keys()),
    }


def load_cash_intraday(cache_dir: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    data: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"source": "Yahoo Finance public chart response", "symbols": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(v10.fetch_yahoo_chart, ticker, cache_dir): (symbol, ticker)
            for symbol, ticker in v10.SYMBOL_MAP.items()
        }
        for future in concurrent.futures.as_completed(futures):
            symbol, ticker = futures[future]
            rows, detail = parse_cash_intraday(future.result())
            data[symbol] = rows
            diagnostics["symbols"][symbol] = {"ticker": ticker, **detail}
            print(f"loaded intraday cash {ticker}: {len(rows)} complete days")
    return dict(sorted(data.items())), diagnostics


def load_perp_intraday(market_cache: Path, funding_cache: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    market = v9.load_market(market_cache)
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    result: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"symbols": {}}
    required_minutes = {PERP_SIGNAL_MINUTE, PERP_ENTRY_MINUTE, *PERP_CHECK_CLOSE_STARTS, *PERP_EXIT_OPEN_MINUTES}
    for symbol in SYMBOLS:
        trade = v9.row_map(market[symbol]["trade"])
        by_day: Dict[str, dict] = defaultdict(dict)
        for ts, row in trade.items():
            day, minute, weekday = local_parts(ts)
            if weekday >= 5 or minute not in required_minutes:
                continue
            open_price = finite(row[1])
            close_price = finite(row[4])
            if min(open_price, close_price) <= 0:
                continue
            by_day[day][minute] = {"ts": ts, "open": open_price, "close": close_price}
        completed = {}
        for day, slots in by_day.items():
            if not required_minutes.issubset(slots):
                continue
            signal = slots[PERP_SIGNAL_MINUTE]
            entry = slots[PERP_ENTRY_MINUTE]
            checks = []
            for close_start, exit_minute in zip(PERP_CHECK_CLOSE_STARTS, PERP_EXIT_OPEN_MINUTES):
                check_bar = slots[close_start]
                exit_bar = slots[exit_minute]
                checks.append({
                    "ts": check_bar["ts"] + 30 * 60 * 1000,
                    "perp": check_bar["close"],
                    "exit": exit_bar["open"],
                    "exitTs": exit_bar["ts"],
                })
            completed[day] = {
                "signal": signal["close"],
                "signalTs": signal["ts"] + 30 * 60 * 1000,
                "entry": entry["open"],
                "entryTs": entry["ts"],
                "checkpoints": checks,
                "fundingPoints": funding.get(symbol, []),
            }
        result[symbol] = completed
        diagnostics["symbols"][symbol] = {
            "tradeBars": len(trade),
            "fundingRows": len(funding.get(symbol, [])),
            "completeDays": len(completed),
        }
    return result, diagnostics


def align_intraday(cash: Dict[str, Dict[str, dict]], perp: Dict[str, Dict[str, dict]]) -> Tuple[List[str], Dict[str, Dict[str, dict]], dict]:
    aligned: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOLS:
        common_days = sorted(set(cash.get(symbol, {})) & set(perp.get(symbol, {})))
        rows = {}
        clock_rejected = 0
        for day in common_days:
            c = cash[symbol][day]
            p = perp[symbol][day]
            if abs(c["signalTs"] - p["signalTs"]) > 5 * 60 * 1000 or abs(c["entryTs"] - p["entryTs"]) > 5 * 60 * 1000:
                clock_rejected += 1
                continue
            checkpoints = []
            valid = True
            for cash_check, perp_check in zip(c["checkpoints"], p["checkpoints"]):
                if abs(cash_check["ts"] - perp_check["ts"]) > 5 * 60 * 1000:
                    valid = False
                    break
                checkpoints.append({
                    "ts": perp_check["ts"],
                    "basisBps": (perp_check["perp"] / cash_check["cash"] - 1.0) * 10000.0,
                    "exit": perp_check["exit"],
                    "exitTs": perp_check["exitTs"],
                })
            if not valid:
                clock_rejected += 1
                continue
            rows[day] = {
                "symbol": symbol,
                "cash": c,
                "perp": p,
                "basisBps": (p["signal"] / c["signal"] - 1.0) * 10000.0,
                "entry": p["entry"],
                "entryTs": p["entryTs"],
                "checkpoints": checkpoints,
            }
        aligned[symbol] = rows
        diagnostics["symbols"][symbol] = {
            "commonDays": len(common_days),
            "alignedDays": len(rows),
            "clockRejected": clock_rejected,
            "firstDay": min(rows) if rows else None,
            "lastDay": max(rows) if rows else None,
        }
    days = sorted(set.intersection(*(set(aligned[symbol]) for symbol in SYMBOLS)))
    return days, aligned, diagnostics


def rolling_scores(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> Dict[str, Dict[str, float]]:
    result: Dict[str, Dict[str, float]] = {day: {} for day in days}
    history: Dict[str, List[float]] = {symbol: [] for symbol in SYMBOLS}
    for day in days:
        for symbol in SYMBOLS:
            basis = finite(aligned[symbol][day]["basisBps"])
            previous = history[symbol][-ROLLING_BASIS_DAYS:]
            if len(previous) >= ROLLING_BASIS_DAYS:
                sigma = statistics.pstdev(previous)
                result[day][symbol] = abs(basis) / sigma if sigma > 1e-9 else 0.0
            else:
                result[day][symbol] = 0.0
            history[symbol].append(basis)
    return result


def direction_factor(mode: str, basis_bps: float) -> Optional[float]:
    premium = basis_bps > 0
    if mode == "PREMIUM_SHORT_ONLY" and not premium:
        return None
    if mode == "DISCOUNT_LONG_ONLY" and premium:
        return None
    if mode == "PREMIUM_HEAVY":
        return 1.0 if premium else 0.5
    if mode == "DISCOUNT_HEAVY":
        return 0.5 if premium else 1.0
    return 1.0


def tier_gross(mode: str, max_abs_basis: float) -> float:
    if mode == "FLAT":
        return 1.0
    if max_abs_basis < 135.0:
        return 0.5
    if max_abs_basis < 215.0:
        return 1.0
    return 1.25


def select_rows(candidate: Candidate, day: str, aligned: Dict[str, Dict[str, dict]], scores: Dict[str, Dict[str, float]], allowed: Sequence[str]) -> List[Tuple[dict, float]]:
    eligible: List[Tuple[dict, float, float]] = []
    for symbol in allowed:
        row = aligned[symbol][day]
        basis = finite(row["basisBps"])
        if abs(basis) < MIN_BASIS_BPS:
            continue
        factor = direction_factor(candidate.direction_mode, basis)
        if factor is None:
            continue
        score_value = abs(basis) if candidate.selection_mode == "ABS_TOP1" else scores[day].get(symbol, 0.0)
        if candidate.selection_mode.startswith("ZSCORE") and score_value <= 0:
            continue
        eligible.append((row, score_value, factor))
    if not eligible:
        return []
    count = 2 if candidate.selection_mode == "ZSCORE_TOP2" else 1
    selected = sorted(eligible, key=lambda item: (item[1], abs(item[0]["basisBps"])), reverse=True)[:count]
    target = tier_gross(candidate.sizing_mode, max(abs(item[0]["basisBps"]) for item in selected))
    base_weight = target / len(selected)
    return [(row, base_weight * factor) for row, _score, factor in selected]


def exit_for(row: dict, side: int, exit_mode: str) -> Tuple[float, int, str, float]:
    entry_basis = finite(row["basisBps"])
    entry_price = finite(row["entry"])
    final = row["checkpoints"][-1]
    if exit_mode == "TIME":
        return finite(final["exit"]), int(final["exitTs"]), "TIME", finite(final["basisBps"])
    for checkpoint in row["checkpoints"]:
        current_basis = finite(checkpoint["basisBps"])
        exit_price = finite(checkpoint["exit"])
        price_return = side * (exit_price / entry_price - 1.0)
        converged = abs(current_basis) <= CONVERGENCE_BPS or current_basis * entry_basis <= 0
        basis_stop = abs(current_basis) >= BASIS_STOP_MULTIPLE * abs(entry_basis)
        price_stop = exit_mode == "CONVERGENCE_PRICE2" and price_return <= -PRICE_STOP_PCT / 100.0
        if converged:
            return exit_price, int(checkpoint["exitTs"]), "BASIS_CONVERGED", current_basis
        if basis_stop:
            return exit_price, int(checkpoint["exitTs"]), "BASIS_STOP", current_basis
        if price_stop:
            return exit_price, int(checkpoint["exitTs"]), "PRICE_STOP", current_basis
    return finite(final["exit"]), int(final["exitTs"]), "TIME", finite(final["basisBps"])


def build_trade(candidate: Candidate, day: str, aligned: Dict[str, Dict[str, dict]], scores: Dict[str, Dict[str, float]], allowed: Sequence[str] = SYMBOLS) -> Optional[dict]:
    selected = select_rows(candidate, day, aligned, scores, allowed)
    if not selected:
        return None
    gross_return = 0.0
    funding_return = 0.0
    gross = 0.0
    legs = []
    for row, weight in selected:
        basis = finite(row["basisBps"])
        side = 1 if basis < 0 else -1
        exit_price, exit_ts, exit_reason, exit_basis = exit_for(row, side, candidate.exit_mode)
        price_return = weight * side * (exit_price / row["entry"] - 1.0)
        funding = weight * (-side) * funding_mod.funding_between(row["perp"]["fundingPoints"], row["entryTs"], exit_ts)
        gross_return += price_return + funding
        funding_return += funding
        gross += weight
        legs.append({
            "symbol": row["symbol"],
            "side": side,
            "gross": weight,
            "entryBasisBps": basis,
            "exitBasisBps": exit_basis,
            "entry": row["entry"],
            "exit": exit_price,
            "entryTs": row["entryTs"],
            "exitTs": exit_ts,
            "exitReason": exit_reason,
            "priceReturn": price_return,
            "fundingReturn": funding,
        })
    return {
        "candidateId": candidate.candidate_id,
        "entryDay": day,
        "exitDay": day,
        "gross": gross,
        "grossReturn": gross_return,
        "fundingReturn": funding_return,
        "legs": legs,
    }


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    result = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        result = min(result, equity / peak - 1.0)
    return result


def net_values(trades: Sequence[dict], scenario: base.CostScenario, multiplier: float = 1.0) -> List[float]:
    return [
        multiplier * (finite(trade["grossReturn"]) - 2.0 * finite(trade["gross"]) * scenario.turnover_bps / 10000.0)
        for trade in trades
    ]


def metrics(trades: Sequence[dict], scenario: base.CostScenario, multiplier: float = 1.0) -> dict:
    values = net_values(trades, scenario, multiplier)
    compounded = product(values)
    if trades:
        start = dt.date.fromisoformat(trades[0]["entryDay"])
        end = dt.date.fromisoformat(trades[-1]["exitDay"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    exit_counts: Dict[str, int] = defaultdict(int)
    symbol_counts: Dict[str, int] = defaultdict(int)
    long_legs = short_legs = 0
    for trade in trades:
        for leg in trade["legs"]:
            exit_counts[leg["exitReason"]] += 1
            symbol_counts[leg["symbol"]] += 1
            if leg["side"] > 0:
                long_legs += 1
            else:
                short_legs += 1
    return {
        "trades": len(values),
        "legs": sum(len(trade["legs"]) for trade in trades),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "averageGross": statistics.mean(finite(trade["gross"]) for trade in trades) if trades else 0.0,
        "fundingReturnSumPct": sum(finite(trade["fundingReturn"]) for trade in trades) * multiplier * 100.0,
        "longLegs": long_legs,
        "shortLegs": short_legs,
        "exitReasons": dict(sorted(exit_counts.items())),
        "symbolCounts": dict(sorted(symbol_counts.items())),
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    return [trade for trade in trades if interval[0] <= trade["exitDay"] <= interval[1]]


def score(result: dict) -> float:
    return (
        result["FORWARD_MEDIAN"]["compoundedReturnPct"]
        + result["NORMAL"]["compoundedReturnPct"]
        + 0.75 * result["FORWARD_P95"]["compoundedReturnPct"]
        + 0.25 * result["SEVERE"]["compoundedReturnPct"]
        + 3.0 * ((result["FORWARD_P95"].get("profitFactor") or 0.0) - 1.0)
    )


def strict_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 10
        and all(result[name]["compoundedReturnPct"] > 0 for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"))
        and (result["FORWARD_P95"].get("profitFactor") or 0.0) > 1.10
    )


def p95_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 10
        and all(result[name]["compoundedReturnPct"] > 0 for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95"))
        and (result["FORWARD_P95"].get("profitFactor") or 0.0) > 1.10
    )


def remove_best_trade(trades: Sequence[dict], scenario: base.CostScenario) -> List[dict]:
    if not trades:
        return []
    values = net_values(trades, scenario)
    best = max(range(len(trades)), key=lambda index: values[index])
    return [trade for index, trade in enumerate(trades) if index != best]


def remove_best_month(trades: Sequence[dict], scenario: base.CostScenario) -> List[dict]:
    monthly: Dict[str, List[dict]] = defaultdict(list)
    for trade in trades:
        monthly[trade["entryDay"][:7]].append(trade)
    if not monthly:
        return []
    best = max(monthly, key=lambda month: product(net_values(monthly[month], scenario)))
    return [trade for trade in trades if trade["entryDay"][:7] != best]


def component_slices(results: Dict[str, dict]) -> dict:
    baseline = {"direction_mode": "BOTH", "sizing_mode": "FLAT", "exit_mode": "TIME", "selection_mode": "ABS_TOP1"}
    slices = {}
    for field, values in (
        ("direction_mode", DIRECTION_MODES),
        ("sizing_mode", SIZING_MODES),
        ("exit_mode", EXIT_MODES),
        ("selection_mode", SELECTION_MODES),
    ):
        rows = []
        for value in values:
            match = dict(baseline)
            match[field] = value
            candidate = next(item for item in CANDIDATES if all(getattr(item, key) == expected for key, expected in match.items()))
            rows.append({"candidate": asdict(candidate), **results[candidate.candidate_id]})
        slices[field] = rows
    return slices


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(cash_cache: Path, perp_cache: Path, funding_cache: Path) -> dict:
    cash, cash_diag = load_cash_intraday(cash_cache)
    perp, perp_diag = load_perp_intraday(perp_cache, funding_cache)
    days, aligned, alignment = align_intraday(cash, perp)
    safety = {
        "mode": "RESEARCH_ONLY",
        "orderSubmissionAllowed": False,
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "cryptoV96Changed": False,
    }
    if len(days) < 60:
        return rounded({
            "version": 11,
            "strategyId": STRATEGY_ID,
            "status": "INSUFFICIENT_ALIGNED_INTRADAY_HISTORY",
            "candidateCount": len(CANDIDATES),
            "eligibleDays": len(days),
            "safety": safety,
        })
    splits = v10.chronological_splits(days)
    scores = rolling_scores(days, aligned)
    all_trades: Dict[str, List[dict]] = {
        candidate.candidate_id: [trade for day in days if (trade := build_trade(candidate, day, aligned, scores)) is not None]
        for candidate in CANDIDATES
    }
    candidate_results = {}
    for candidate in CANDIDATES:
        trades = all_trades[candidate.candidate_id]
        development = {scenario.name: metrics(subset(trades, splits["DEVELOPMENT"]), scenario) for scenario in base.SCENARIOS}
        candidate_results[candidate.candidate_id] = {
            "candidate": asdict(candidate),
            "development": development,
            "developmentScore": score(development),
        }
    development_eligible = [row for row in candidate_results.values() if row["development"]["FORWARD_MEDIAN"]["trades"] >= 15]
    top_development = sorted(
        development_eligible or list(candidate_results.values()),
        key=lambda row: (row["developmentScore"], row["candidate"]["candidate_id"]),
        reverse=True,
    )[:12]
    validation_rows = []
    for row in top_development:
        candidate_id = row["candidate"]["candidate_id"]
        trades = all_trades[candidate_id]
        validation = {scenario.name: metrics(subset(trades, splits["VALIDATION"]), scenario) for scenario in base.SCENARIOS}
        validation_rows.append({
            **row,
            "validation": validation,
            "validationScore": score(validation),
            "strictPass": strict_pass(validation),
            "p95Pass": p95_pass(validation),
        })
    p95_candidates = [row for row in validation_rows if row["p95Pass"]]
    strict_candidates = [row for row in validation_rows if row["strictPass"]]
    selected_row = max(p95_candidates, key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"])) if p95_candidates else None
    selected = None
    if selected_row:
        candidate = Candidate(**selected_row["candidate"])
        trades = all_trades[candidate.candidate_id]
        selected = {
            "candidate": asdict(candidate),
            "development": selected_row["development"],
            "validation": selected_row["validation"],
            "grossSensitivity": {},
            "removal": {},
            "symbolOnly": {},
            "leaveOneOut": {},
        }
        for multiplier in (1.0, 1.25, 1.5, 2.0):
            selected["grossSensitivity"][str(multiplier)] = {
                scenario.name: {
                    "full": metrics(trades, scenario, multiplier),
                    "development": metrics(subset(trades, splits["DEVELOPMENT"]), scenario, multiplier),
                    "validation": metrics(subset(trades, splits["VALIDATION"]), scenario, multiplier),
                    "holdout": metrics(subset(trades, splits["HOLDOUT"]), scenario, multiplier),
                }
                for scenario in base.SCENARIOS
            }
        for scenario in base.SCENARIOS:
            selected["removal"][scenario.name] = {
                "bestTradeRemoved": metrics(remove_best_trade(trades, scenario), scenario),
                "bestMonthRemoved": metrics(remove_best_month(trades, scenario), scenario),
            }
        for symbol in SYMBOLS:
            only_trades = [trade for day in days if (trade := build_trade(candidate, day, aligned, scores, (symbol,))) is not None]
            without_trades = [
                trade for day in days
                if (trade := build_trade(candidate, day, aligned, scores, tuple(item for item in SYMBOLS if item != symbol))) is not None
            ]
            selected["symbolOnly"][symbol] = {scenario.name: metrics(only_trades, scenario) for scenario in base.SCENARIOS}
            selected["leaveOneOut"][symbol] = {scenario.name: metrics(without_trades, scenario) for scenario in base.SCENARIOS}
        holdout = selected["grossSensitivity"]["1.0"]
        selected["holdoutP95Pass"] = bool(
            holdout["NORMAL"]["holdout"]["trades"] >= 5
            and holdout["NORMAL"]["holdout"]["compoundedReturnPct"] > 0
            and holdout["FORWARD_P95"]["holdout"]["compoundedReturnPct"] > 0
            and (holdout["FORWARD_P95"]["holdout"].get("profitFactor") or 0.0) > 1.0
        )
        selected["holdoutStrictPass"] = bool(selected["holdoutP95Pass"] and holdout["SEVERE"]["holdout"]["compoundedReturnPct"] > 0)
        selected["cryptoLike"] = bool(
            selected["holdoutStrictPass"]
            and holdout["NORMAL"]["full"]["cagrPct"] >= 100.0
            and holdout["NORMAL"]["full"]["compoundedReturnPct"] >= 100.0
        )
    if selected and selected["cryptoLike"]:
        status = "CRYPTO_LIKE_ENHANCEMENT_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutStrictPass"]:
        status = "ROBUST_STRICT_ENHANCEMENT_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutP95Pass"]:
        status = "P95_ENHANCEMENT_FOUND_FAILS_SEVERE_SHADOW_ONLY"
    elif selected:
        status = "VALIDATION_ENHANCEMENT_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_P95_VALIDATION_PASSING_ENHANCEMENT"
    return rounded({
        "version": 11,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES),
        "componentCounts": {
            "direction": len(DIRECTION_MODES),
            "sizing": len(SIZING_MODES),
            "exit": len(EXIT_MODES),
            "selection": len(SELECTION_MODES),
        },
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1]},
        "splits": splits,
        "topDevelopment": top_development,
        "validationRows": validation_rows,
        "strictValidationPassIds": [row["candidate"]["candidate_id"] for row in strict_candidates],
        "p95ValidationPassIds": [row["candidate"]["candidate_id"] for row in p95_candidates],
        "componentSlices": component_slices(candidate_results),
        "selected": selected,
        "cashDiagnostics": cash_diag,
        "perpDiagnostics": perp_diag,
        "alignmentDiagnostics": alignment,
        "selectionDiscipline": {
            "allCombinationsPredeclared": True,
            "developmentTopK": 12,
            "validationSelectionOnly": True,
            "holdoutRetuningAllowed": False,
            "grossSensitivityAfterSelectionOnly": True,
        },
        "historicalExecutionGate": {
            "spreadDepthGateReconstructed": False,
            "reason": "Historical order-book depth and per-order Slippage snapshots are unavailable; P95 and Severe cost scenarios are used instead.",
        },
        "limitations": [
            "The 50 bps parent signal and this enhancement family were motivated by already inspected history.",
            "The final period overlaps prior Stock research and is not an independent Holdout.",
            "Yahoo public hourly cash data is unofficial and unauthenticated.",
            "The convergence exit can only observe hourly cash checkpoints, not every 30 minutes.",
            "Historical Spread, depth, event and halt gates are not reconstructed.",
            "The 2% price stop is a predeclared research assumption because the prior proposal did not specify an exact price-stop level.",
        ],
        "safety": safety,
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-perp-fade-enhancement-v11.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Perp Fade Enhancement V11",
        "",
        f"- Status: **{result['status']}**",
        f"- Candidates: {result['candidateCount']}",
        f"- Eligible days: {result.get('dataWindow', {}).get('eligibleDays', 0)}",
        "- Production / LIVE / VPS / Crypto V96 / orders changed: **NO**",
    ]
    if result.get("validationRows"):
        lines += [
            "", "## Development top candidates / Validation", "",
            "| Candidate | Dev Normal | Dev P95 | Val Normal | Val P95 | Val Severe | P95 pass | Strict |",
            "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
        ]
        for row in result["validationRows"]:
            lines.append(
                f"| {row['candidate']['candidate_id']} | {row['development']['NORMAL']['compoundedReturnPct']}% | "
                f"{row['development']['FORWARD_P95']['compoundedReturnPct']}% | {row['validation']['NORMAL']['compoundedReturnPct']}% | "
                f"{row['validation']['FORWARD_P95']['compoundedReturnPct']}% | {row['validation']['SEVERE']['compoundedReturnPct']}% | "
                f"{'YES' if row['p95Pass'] else 'NO'} | {'YES' if row['strictPass'] else 'NO'} |"
            )
    if result.get("selected"):
        selected = result["selected"]
        lines += [
            "", "## Selected", "",
            f"- Candidate: **{selected['candidate']['candidate_id']}**",
            f"- Holdout P95 pass: **{'YES' if selected['holdoutP95Pass'] else 'NO'}**",
            f"- Holdout strict pass: **{'YES' if selected['holdoutStrictPass'] else 'NO'}**",
            f"- Crypto-like: **{'YES' if selected['cryptoLike'] else 'NO'}**",
        ]
    (output_dir / "v96-stock-perp-fade-enhancement-v11.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 90
    assert len({candidate.candidate_id for candidate in CANDIDATES}) == 90
    assert tier_gross("TIERED", 50.0) == 0.5
    assert tier_gross("TIERED", 135.0) == 1.0
    assert tier_gross("TIERED", 215.0) == 1.25
    assert direction_factor("PREMIUM_SHORT_ONLY", -60.0) is None
    assert direction_factor("DISCOUNT_LONG_ONLY", 60.0) is None
    print("V96 Stock Perp Fade Enhancement V11 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cash-cache-dir", default=".cache/v96-stock-cash-yahoo-v10")
    parser.add_argument("--perp-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-perp-fade-enhancement-v11")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cash_cache_dir), Path(args.perp_cache_dir), Path(args.funding_cache_dir))
    write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
