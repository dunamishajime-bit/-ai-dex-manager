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
from zoneinfo import ZoneInfo

import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
STRATEGY_ID = "V96_STOCK_OVERNIGHT_SESSION_TOURNAMENT_V7"
SYMBOLS = ("AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT")


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_atr: float
    exit_minute: int


CANDIDATES = tuple(
    [Candidate(f"OVERNIGHT_CONT_2H_{value:.2f}", "OVERNIGHT_CONTINUATION_2H", value, 690) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"OVERNIGHT_CONT_DAY_{value:.2f}", "OVERNIGHT_CONTINUATION_DAY", value, 945) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"OVERNIGHT_FADE_2H_{value:.2f}", "OVERNIGHT_FADE_2H", value, 690) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"OVERNIGHT_FADE_DAY_{value:.2f}", "OVERNIGHT_FADE_DAY", value, 945) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"EUROPE_CONT_DAY_{value:.2f}", "EUROPE_CONTINUATION_DAY", value, 945) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"EUROPE_FADE_DAY_{value:.2f}", "EUROPE_FADE_DAY", value, 945) for value in (0.25, 0.50, 0.75)]
    + [Candidate(f"XS_OVERNIGHT_MOM_{value:.2f}", "XS_OVERNIGHT_MOMENTUM_PAIR", value, 945) for value in (0.50, 1.00, 1.50)]
    + [Candidate(f"XS_OVERNIGHT_REV_{value:.2f}", "XS_OVERNIGHT_REVERSION_PAIR", value, 945) for value in (0.50, 1.00, 1.50)]
)


@dataclass(frozen=True)
class Signal:
    candidate_id: str
    family: str
    day: str
    symbols: Tuple[str, ...]
    sides: Tuple[int, ...]
    weights: Tuple[float, ...]
    score: float
    stop_pct: float
    detail: dict


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def all_session_bars(rows: Sequence[list]) -> Dict[str, Dict[int, base.Bar]]:
    result: Dict[str, Dict[int, base.Bar]] = defaultdict(dict)
    for row in rows:
        ts = int(row[0])
        local = dt.datetime.fromtimestamp(ts / 1000.0, tz=UTC).astimezone(NY)
        minute = local.hour * 60 + local.minute
        if finite(row[1]) <= 0 or finite(row[4]) <= 0:
            continue
        result[local.date().isoformat()][minute] = base.Bar(
            ts=ts,
            day=local.date().isoformat(),
            minute=minute,
            open=finite(row[1]),
            high=finite(row[2]),
            low=finite(row[3]),
            close=finite(row[4]),
            base_volume=finite(row[5]),
            quote_volume=finite(row[7]),
        )
    return dict(result)


def prior_atr(symbol: str, previous_day: str, daily: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[float]:
    rows = swing.history(daily.get(symbol, {}), previous_day, 20)
    return swing.mean_tr(rows, 20) if len(rows) >= 20 else None


def segment_state(
    symbol: str,
    previous_day: str,
    day: str,
    mode: str,
    full: Dict[str, Dict[str, Dict[int, base.Bar]]],
    daily: Dict[str, Dict[str, swing.DailyBar]],
) -> Optional[dict]:
    previous = full.get(symbol, {}).get(previous_day, {}).get(945)
    premarket = full.get(symbol, {}).get(day, {}).get(555)
    europe_start = full.get(symbol, {}).get(day, {}).get(120)
    regular_open = full.get(symbol, {}).get(day, {}).get(570)
    atr = prior_atr(symbol, previous_day, daily)
    if previous is None or premarket is None or regular_open is None or atr is None or atr <= 0:
        return None
    if mode == "OVERNIGHT":
        start_price = previous.close
    elif mode == "EUROPE":
        if europe_start is None:
            return None
        start_price = europe_start.open
    else:
        return None
    move_pct = (premarket.close / start_price - 1.0) * 100.0
    return {
        "symbol": symbol,
        "moveAtr": move_pct / atr,
        "atrPct": atr,
        "entryBar": regular_open,
        "premarketClose": premarket.close,
        "startPrice": start_price,
    }


def build_signal(
    candidate: Candidate,
    previous_day: str,
    day: str,
    full: Dict[str, Dict[str, Dict[int, base.Bar]]],
    daily: Dict[str, Dict[str, swing.DailyBar]],
) -> Optional[Signal]:
    # Mondays include a weekend interval and are intentionally excluded from this first frozen test.
    if dt.date.fromisoformat(day).weekday() == 0:
        return None
    mode = "EUROPE" if candidate.family.startswith("EUROPE") else "OVERNIGHT"
    states = [
        item for item in (
            segment_state(symbol, previous_day, day, mode, full, daily) for symbol in SYMBOLS
        ) if item is not None
    ]
    if len(states) != len(SYMBOLS):
        return None
    threshold = candidate.threshold_atr

    if candidate.family.startswith("XS_OVERNIGHT"):
        strongest = max(states, key=lambda item: item["moveAtr"])
        weakest = min(states, key=lambda item: item["moveAtr"])
        dispersion = strongest["moveAtr"] - weakest["moveAtr"]
        if dispersion < threshold:
            return None
        if candidate.family == "XS_OVERNIGHT_MOMENTUM_PAIR":
            long_item, short_item = strongest, weakest
        else:
            long_item, short_item = weakest, strongest
        return Signal(
            candidate.candidate_id,
            candidate.family,
            day,
            (long_item["symbol"], short_item["symbol"]),
            (1, -1),
            (0.5, 0.5),
            dispersion,
            max(2.0, 1.5 * max(long_item["atrPct"], short_item["atrPct"])),
            {"dispersionAtr": dispersion},
        )

    selected = max(states, key=lambda item: abs(item["moveAtr"]))
    if abs(selected["moveAtr"]) < threshold:
        return None
    continuation = "CONTINUATION" in candidate.family
    side = 1 if selected["moveAtr"] > 0 else -1
    if not continuation:
        side *= -1
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        (selected["symbol"],),
        (side,),
        (1.0,),
        abs(selected["moveAtr"]),
        max(2.0, 1.5 * selected["atrPct"]),
        {"segmentMoveAtr": selected["moveAtr"], "mode": mode},
    )


def simulate(
    candidate: Candidate,
    signal: Signal,
    scenario: base.CostScenario,
    full: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> Optional[dict]:
    entries = {}
    exits = {}
    entry_ts = {}
    exit_ts = {}
    stop_extra = 0.0
    exit_reason = "SCHEDULED_EXIT"
    for symbol in signal.symbols:
        entry = full.get(symbol, {}).get(signal.day, {}).get(570)
        scheduled = full.get(symbol, {}).get(signal.day, {}).get(candidate.exit_minute)
        if entry is None or scheduled is None:
            return None
        entries[symbol] = entry.open
        entry_ts[symbol] = entry.ts

    minutes = sorted(set().union(*(
        set(full.get(symbol, {}).get(signal.day, {})) for symbol in signal.symbols
    )))
    stopped = False
    for minute in [value for value in minutes if 570 <= value <= candidate.exit_minute]:
        for symbol, side, weight in zip(signal.symbols, signal.sides, signal.weights):
            bar = full.get(symbol, {}).get(signal.day, {}).get(minute)
            if bar is None:
                continue
            stop = entries[symbol] * (1.0 - side * signal.stop_pct / 100.0)
            hit = (side > 0 and bar.low <= stop) or (side < 0 and bar.high >= stop)
            if hit:
                exits[symbol] = stop * (1.0 - side * scenario.stop_slippage_bps / 10_000.0)
                exit_ts[symbol] = bar.ts + base.INTERVAL_MS
                stop_extra += weight * scenario.stop_slippage_bps / 10_000.0
                stopped = True
        if stopped:
            for symbol in signal.symbols:
                if symbol not in exits:
                    bar = full[symbol][signal.day].get(minute)
                    if bar is None:
                        return None
                    exits[symbol] = bar.close
                    exit_ts[symbol] = bar.ts + base.INTERVAL_MS
            exit_reason = "HARD_STOP_EXIT"
            break

    if not stopped:
        for symbol in signal.symbols:
            bar = full[symbol][signal.day][candidate.exit_minute]
            exits[symbol] = bar.open
            exit_ts[symbol] = bar.ts

    price_return = 0.0
    funding_cost = 0.0
    for symbol, side, weight in zip(signal.symbols, signal.sides, signal.weights):
        price_return += weight * side * (exits[symbol] / entries[symbol] - 1.0)
        funding_cost += weight * side * funding_mod.funding_between(funding.get(symbol, []), entry_ts[symbol], exit_ts[symbol])
    gross = sum(signal.weights)
    execution_cost = 2.0 * gross * scenario.turnover_bps / 10_000.0 + stop_extra
    return {
        "candidateId": signal.candidate_id,
        "family": signal.family,
        "day": signal.day,
        "entryDay": signal.day,
        "exitDay": signal.day,
        "symbols": list(signal.symbols),
        "sides": list(signal.sides),
        "gross": gross,
        "priceReturn": price_return,
        "fundingCost": funding_cost,
        "executionCost": execution_cost,
        "return": price_return - funding_cost - execution_cost,
        "exitReason": exit_reason,
        "score": signal.score,
        "detail": signal.detail,
    }


def eligible_days(
    daily: Dict[str, Dict[str, swing.DailyBar]],
    full: Dict[str, Dict[str, Dict[int, base.Bar]]],
) -> List[str]:
    common_regular = sorted(set.intersection(*(set(daily.get(symbol, {})) for symbol in SYMBOLS)))
    result = []
    for index, day in enumerate(common_regular):
        if index == 0:
            continue
        previous_day = common_regular[index - 1]
        if all(
            prior_atr(symbol, previous_day, daily) is not None
            and full.get(symbol, {}).get(previous_day, {}).get(945) is not None
            and full.get(symbol, {}).get(day, {}).get(120) is not None
            and full.get(symbol, {}).get(day, {}).get(555) is not None
            and full.get(symbol, {}).get(day, {}).get(570) is not None
            and full.get(symbol, {}).get(day, {}).get(945) is not None
            for symbol in SYMBOLS
        ):
            result.append(day)
    return result


def replay_candidate(
    candidate: Candidate,
    scenario: base.CostScenario,
    days: Sequence[str],
    full: Dict[str, Dict[str, Dict[int, base.Bar]]],
    daily: Dict[str, Dict[str, swing.DailyBar]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> List[dict]:
    common_regular = sorted(set.intersection(*(set(daily.get(symbol, {})) for symbol in SYMBOLS)))
    previous_map = {common_regular[index]: common_regular[index - 1] for index in range(1, len(common_regular))}
    trades = []
    for day in days:
        previous_day = previous_map.get(day)
        if previous_day is None:
            continue
        signal = build_signal(candidate, previous_day, day, full, daily)
        if signal is None:
            continue
        trade = simulate(candidate, signal, scenario, full, funding)
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


def metrics(trades: Sequence[dict], multiplier: float = 1.0) -> dict:
    ordered = sorted(trades, key=lambda item: item["day"])
    values = [multiplier * finite(item["return"]) for item in ordered]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    compounded = product_return(values)
    if ordered:
        start = dt.date.fromisoformat(ordered[0]["day"])
        end = dt.date.fromisoformat(ordered[-1]["day"])
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
    return [item for item in trades if start <= item["day"] <= end]


def removals(trades: Sequence[dict], multiplier: float = 1.0) -> dict:
    if not trades:
        return {"bestTradeRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [multiplier * finite(item["return"]) for item in trades]
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


def score(median: dict, normal: dict, severe: dict) -> float:
    return median["compoundedReturnPct"] + 0.5 * normal["compoundedReturnPct"] + 0.25 * severe["compoundedReturnPct"] + 2.0 * ((median.get("profitFactor") or 0.0) - 1.0) + 0.10 * median["maxDrawdownPct"]


def validation_pass(result: dict) -> bool:
    return bool(result["FORWARD_MEDIAN"]["trades"] >= 8 and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0 and result["NORMAL"]["compoundedReturnPct"] > 0 and result["SEVERE"]["compoundedReturnPct"] > 0 and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05)


def holdout_pass(result: dict) -> bool:
    return bool(result["FORWARD_MEDIAN"]["trades"] >= 8 and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0 and result["NORMAL"]["compoundedReturnPct"] > 0 and result["SEVERE"]["compoundedReturnPct"] > 0 and (result["NORMAL"].get("profitFactor") or 0) > 1.0)


def combine(trades_by_candidate: Dict[str, List[dict]], ids: Sequence[str]) -> List[dict]:
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for candidate_id in ids:
        for trade in trades_by_candidate.get(candidate_id, []):
            by_day[trade["day"]].append(trade)
    return [{"candidateId": "VALIDATION_SELECTED_OVERNIGHT_ENSEMBLE", "family": "ENSEMBLE", "day": day, "entryDay": day, "exitDay": day, "symbols": sorted(set(symbol for item in items for symbol in item["symbols"])), "return": statistics.mean(finite(item["return"]) for item in items), "gross": 1.0} for day, items in sorted(by_day.items())]


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
    full = {symbol: all_session_bars(rows) for symbol, rows in raw.items() if symbol in SYMBOLS}
    regular = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items() if symbol in SYMBOLS}
    daily = swing.daily_bars(regular)
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    days = eligible_days(daily, full)
    splits = base.chronological_splits(days)
    if len(days) < 80:
        raise RuntimeError(f"insufficient overnight-session history: {len(days)}")

    all_trades = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_trades[scenario.name][candidate.candidate_id] = replay_candidate(candidate, scenario, days, full, daily, funding)

    families = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {scenario.name: metrics(subset(all_trades[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])) for scenario in base.SCENARIOS}
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"])})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 12]
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
        validation = {scenario.name: metrics(subset(combine(all_trades[scenario.name], passing), splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": "VALIDATION_SELECTED_OVERNIGHT_ENSEMBLE", "members": sorted(passing), "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {"portfolioId": selected_option["portfolioId"], "members": selected_option["members"], "validation": selected_option["validation"], "gross1": {}, "normalizedGross2": {}}
        for scenario in base.SCENARIOS:
            trades = all_trades[scenario.name][selected_option["members"][0]] if len(selected_option["members"]) == 1 else combine(all_trades[scenario.name], selected_option["members"])
            selected["gross1"][scenario.name] = {"full": metrics(trades), "development": metrics(subset(trades, splits["DEVELOPMENT"])), "validation": metrics(subset(trades, splits["VALIDATION"])), "holdout": metrics(subset(trades, splits["HOLDOUT"])), "removals": removals(trades), "trades": trades}
            selected["normalizedGross2"][scenario.name] = {"full": metrics(trades, 2.0), "holdout": metrics(subset(trades, splits["HOLDOUT"]), 2.0), "removals": removals(trades, 2.0)}
        selected["holdoutPassGross1"] = holdout_pass({name: item["holdout"] for name, item in selected["gross1"].items()})
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(selected["holdoutPassGross1"] and normal2["compoundedReturnPct"] >= 50 and normal2["cagrPct"] >= 50 and severe2["compoundedReturnPct"] > 0 and normal2["maxDrawdownPct"] >= -50)

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_OVERNIGHT_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_OVERNIGHT_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "OVERNIGHT_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_OVERNIGHT_FAMILY"

    return rounded({"version": 7, "strategyId": STRATEGY_ID, "status": status, "generatedAt": dt.datetime.now(UTC).isoformat(), "universe": list(SYMBOLS), "candidateCount": len(CANDIDATES), "familyCount": len(set(candidate.family for candidate in CANDIDATES)), "eligibleDays": len(days), "firstEligibleDay": days[0], "lastEligibleDay": days[-1], "splits": splits, "families": families, "validationPassingWinnerIds": passing, "portfolioOptions": options, "selected": selected, "selectionDiscipline": {"familySelection": "DEVELOPMENT only", "portfolioSelection": "VALIDATION only", "finalEvaluation": "reused historical HOLDOUT once", "holdoutRetuningAllowed": False}, "classificationLimit": "The same dates and listings were already inspected; any positive result is reused historical evidence.", "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False}, "limitations": ["Monday signals are excluded to avoid mixing weekend intervals into weekday overnight behavior.", "Signals observe 24-hour stock-perpetual prices but enter and exit during the U.S. regular session.", "Historical order-book and event gates are not reconstructed.", "Gross 2.0 is normalized sensitivity only, not an allocation approval."]})


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-overnight-session-tournament-v7.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# V96 Stock Overnight Session Tournament V7", "", f"- Status: **{result['status']}**", f"- Window: {result['firstEligibleDay']}–{result['lastEligibleDay']} ({result['eligibleDays']} days)", f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}", "- Production / LIVE / VPS / orders changed: **NO**", "", "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |", "| --- | --- | ---: | ---: | ---: | ---: | --- |"]
    for family, item in result["families"].items():
        winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
        lines.append(f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {winner['development']['SEVERE']['compoundedReturnPct']}% | {item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | {'YES' if item['validationPass'] else 'NO'} |")
    selected = result.get("selected")
    if selected:
        lines.extend(["", "## Selected reused-historical portfolio", "", f"Portfolio: **{selected['portfolioId']}**", f"Gross 1 Holdout pass: **{'YES' if selected['holdoutPassGross1'] else 'NO'}**", f"Normalized Gross 2 crypto-like threshold: **{'YES' if selected['cryptoLikeNormalizedGross2'] else 'NO'}**", "", "| Scenario | G1 Full | G1 CAGR | G1 DD | G1 Holdout | G2 Full | G2 CAGR | G2 DD | G2 Holdout |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            g1 = selected["gross1"][name]
            g2 = selected["normalizedGross2"][name]
            lines.append(f"| {name} | {g1['full']['compoundedReturnPct']}% | {g1['full']['cagrPct']}% | {g1['full']['maxDrawdownPct']}% | {g1['holdout']['compoundedReturnPct']}% | {g2['full']['compoundedReturnPct']}% | {g2['full']['cagrPct']}% | {g2['full']['maxDrawdownPct']}% | {g2['holdout']['compoundedReturnPct']}% |")
    (output_dir / "v96-stock-overnight-session-tournament-v7.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 24
    assert len(set(candidate.family for candidate in CANDIDATES)) == 8
    assert len(SYMBOLS) == 5


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--price-cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-overnight-session-tournament-v7")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock overnight session tournament V7 self-test: PASS")
        return 0
    result = analyze(Path(args.price_cache_dir).resolve(), Path(args.funding_cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"], "eligibleDays": result["eligibleDays"], "validationPassingWinnerIds": result["validationPassingWinnerIds"], "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
