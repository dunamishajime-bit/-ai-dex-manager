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

import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_MULTI_ASSET_TREND_TOURNAMENT_V6"
SYMBOLS = ("AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT")
REBALANCE_EVERY_DAYS = 5
WEIGHT_TOLERANCE = 0.05


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    parameter: float


CANDIDATES = tuple(
    [Candidate(f"LONG_MOM_{value:.2f}", "LONG_MOMENTUM_PORTFOLIO", value) for value in (0.00, 0.03, 0.05)]
    + [Candidate(f"TS_MOM_{value:.2f}", "TIME_SERIES_MOMENTUM", value) for value in (0.00, 0.03, 0.05)]
    + [Candidate(f"MA_CROSS_{fast}", "MOVING_AVERAGE_CROSS", float(fast)) for fast in (5, 10, 15)]
    + [Candidate(f"MULTI_HORIZON_{votes}", "MULTI_HORIZON_VOTE", float(votes)) for votes in (1, 2, 3)]
    + [Candidate(f"XS_LS_{lookback}", "CROSS_SECTIONAL_LONG_SHORT", float(lookback)) for lookback in (5, 10, 20)]
    + [Candidate(f"REGIME_BASKET_{value:.2f}", "REGIME_BASKET", value) for value in (0.00, 0.02, 0.04)]
    + [Candidate(f"LONG_BREAKOUT_{lookback}", "LONG_BREAKOUT_PORTFOLIO", float(lookback)) for lookback in (10, 15, 20)]
    + [Candidate(f"DUAL_BREAKOUT_{lookback}", "DUAL_BREAKOUT_PORTFOLIO", float(lookback)) for lookback in (10, 15, 20)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def history(rows: Dict[str, swing.DailyBar], day: str, count: int) -> List[swing.DailyBar]:
    return swing.history(rows, day, count)


def snapshot(symbol: str, day: str, bars: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[dict]:
    rows = history(bars.get(symbol, {}), day, 50)
    if len(rows) < 41 or rows[-1].day != day:
        return None
    vol20 = swing.stdev_returns(rows, 20)
    sma20 = swing.sma(rows, 20)
    sma40 = swing.sma(rows, 40)
    if not vol20 or sma20 is None or sma40 is None:
        return None
    return {
        "symbol": symbol,
        "rows": rows,
        "bar": rows[-1],
        "vol20": vol20,
        "sma20": sma20,
        "sma40": sma40,
        "mom5": swing.pct_change(rows, 5),
        "mom10": swing.pct_change(rows, 10),
        "mom20": swing.pct_change(rows, 20),
    }


def normalized_inverse_vol(items: Sequence[Tuple[dict, int]], gross: float = 1.0) -> Dict[str, float]:
    if not items:
        return {}
    raw = [(item["symbol"], side, 1.0 / max(1e-6, item["vol20"])) for item, side in items]
    total = sum(value for _symbol, _side, value in raw)
    return {symbol: side * gross * value / total for symbol, side, value in raw}


def split_inverse_vol(long_items: Sequence[dict], short_items: Sequence[dict]) -> Dict[str, float]:
    result = {}
    result.update(normalized_inverse_vol([(item, 1) for item in long_items], 0.5) if long_items else {})
    result.update(normalized_inverse_vol([(item, -1) for item in short_items], 0.5) if short_items else {})
    return result


def target_weights(candidate: Candidate, day: str, bars: Dict[str, Dict[str, swing.DailyBar]]) -> Dict[str, float]:
    states = [item for item in (snapshot(symbol, day, bars) for symbol in SYMBOLS) if item is not None]
    if len(states) != len(SYMBOLS):
        return {}
    parameter = candidate.parameter

    if candidate.family == "LONG_MOMENTUM_PORTFOLIO":
        active = [
            item for item in states
            if item["mom20"] is not None
            and item["mom20"] > parameter
            and item["bar"].close > item["sma20"]
        ]
        return normalized_inverse_vol([(item, 1) for item in active])

    if candidate.family == "TIME_SERIES_MOMENTUM":
        active = []
        for item in states:
            momentum = item["mom20"]
            if momentum is None or abs(momentum) <= parameter:
                continue
            side = 1 if momentum > 0 and item["bar"].close > item["sma20"] else -1 if momentum < 0 and item["bar"].close < item["sma20"] else 0
            if side:
                active.append((item, side))
        return normalized_inverse_vol(active)

    if candidate.family == "MOVING_AVERAGE_CROSS":
        fast = int(parameter)
        active = []
        for item in states:
            fast_ma = swing.sma(item["rows"], fast)
            if fast_ma is None:
                continue
            side = 1 if fast_ma > item["sma40"] else -1 if fast_ma < item["sma40"] else 0
            if side:
                active.append((item, side))
        return normalized_inverse_vol(active)

    if candidate.family == "MULTI_HORIZON_VOTE":
        minimum_votes = int(parameter)
        active = []
        for item in states:
            values = [item["mom5"], item["mom10"], item["mom20"]]
            positive = sum(value is not None and value > 0 for value in values)
            negative = sum(value is not None and value < 0 for value in values)
            if positive >= minimum_votes and positive > negative:
                active.append((item, 1))
            elif negative >= minimum_votes and negative > positive:
                active.append((item, -1))
        return normalized_inverse_vol(active)

    if candidate.family == "CROSS_SECTIONAL_LONG_SHORT":
        lookback = int(parameter)
        ranked = []
        for item in states:
            value = swing.pct_change(item["rows"], lookback)
            if value is not None:
                ranked.append((item, value))
        ordered = sorted(ranked, key=lambda row: row[1])
        if len(ordered) < 4:
            return {}
        short_items = [row[0] for row in ordered[:2]]
        long_items = [row[0] for row in ordered[-2:]]
        return split_inverse_vol(long_items, short_items)

    if candidate.family == "REGIME_BASKET":
        values = [(item, item["mom20"]) for item in states if item["mom20"] is not None]
        median = statistics.median(value for _item, value in values)
        if median > parameter:
            selected = [item for item, value in sorted(values, key=lambda row: row[1], reverse=True)[:3] if value > 0]
            return normalized_inverse_vol([(item, 1) for item in selected])
        if median < -parameter:
            selected = [item for item, value in sorted(values, key=lambda row: row[1])[:3] if value < 0]
            return normalized_inverse_vol([(item, -1) for item in selected])
        return {}

    if candidate.family in {"LONG_BREAKOUT_PORTFOLIO", "DUAL_BREAKOUT_PORTFOLIO"}:
        lookback = int(parameter)
        active = []
        for item in states:
            rows = item["rows"]
            prior = rows[-1 - lookback:-1]
            if len(prior) < lookback:
                continue
            prior_high = max(row.high for row in prior)
            prior_low = min(row.low for row in prior)
            if item["bar"].close > prior_high:
                active.append((item, 1))
            elif candidate.family == "DUAL_BREAKOUT_PORTFOLIO" and item["bar"].close < prior_low:
                active.append((item, -1))
        return normalized_inverse_vol(active)

    return {}


def apply_weight_band(current: Dict[str, float], target: Dict[str, float]) -> Dict[str, float]:
    result = dict(current)
    for symbol in set(current) | set(target):
        old = current.get(symbol, 0.0)
        new = target.get(symbol, 0.0)
        if abs(new - old) >= WEIGHT_TOLERANCE or (old == 0.0) != (new == 0.0) or old * new < 0:
            if abs(new) > 1e-12:
                result[symbol] = new
            else:
                result.pop(symbol, None)
    gross = sum(abs(value) for value in result.values())
    if gross > 1.0 + 1e-12:
        result = {symbol: value / gross for symbol, value in result.items()}
    return result


def common_days(
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> List[str]:
    days = sorted(set.intersection(*(set(bars.get(symbol, {})) for symbol in SYMBOLS)))
    result = []
    for day in days:
        if not all(snapshot(symbol, day, bars) is not None for symbol in SYMBOLS):
            continue
        fresh = True
        for symbol in SYMBOLS:
            times = funding_mod.session_times(sessions, symbol, day)
            if times is None or funding_mod.funding_snapshot(funding.get(symbol, []), times[1]) is None:
                fresh = False
                break
        if fresh:
            result.append(day)
    return result


def next_day(day: str, days: Sequence[str]) -> Optional[str]:
    index = days.index(day)
    return days[index + 1] if index + 1 < len(days) else None


def replay(
    candidate: Candidate,
    scenario: base.CostScenario,
    days: Sequence[str],
    bars: Dict[str, Dict[str, swing.DailyBar]],
    sessions: Dict[str, Dict[str, Dict[int, base.Bar]]],
    funding: Dict[str, List[Tuple[int, float]]],
) -> dict:
    current: Dict[str, float] = {}
    rows = []
    total_turnover = 0.0
    for index, decision_day in enumerate(days[:-1]):
        hold_day = days[index + 1]
        exit_day = next_day(hold_day, days)
        if exit_day is None:
            break
        if index % REBALANCE_EVERY_DAYS == 0:
            target = target_weights(candidate, decision_day, bars)
            target = apply_weight_band(current, target)
        else:
            target = dict(current)
        turnover = sum(abs(target.get(symbol, 0.0) - current.get(symbol, 0.0)) for symbol in set(target) | set(current))
        execution_cost = turnover * scenario.turnover_bps / 10_000.0
        price_return = 0.0
        funding_cost = 0.0
        valid = True
        for symbol, weight in target.items():
            hold_bar = bars.get(symbol, {}).get(hold_day)
            exit_bar = bars.get(symbol, {}).get(exit_day)
            hold_times = funding_mod.session_times(sessions, symbol, hold_day)
            exit_times = funding_mod.session_times(sessions, symbol, exit_day)
            if hold_bar is None or exit_bar is None or hold_times is None or exit_times is None or hold_bar.open <= 0:
                valid = False
                break
            price_return += weight * (exit_bar.open / hold_bar.open - 1.0)
            total_rate = funding_mod.funding_between(funding.get(symbol, []), hold_times[0], exit_times[0])
            funding_cost += weight * total_rate
        if not valid:
            continue
        value = price_return - funding_cost - execution_cost
        rows.append({
            "candidateId": candidate.candidate_id,
            "family": candidate.family,
            "decisionDay": decision_day,
            "day": hold_day,
            "exitDay": exit_day,
            "weights": target,
            "gross": sum(abs(value) for value in target.values()),
            "turnover": turnover,
            "priceReturn": price_return,
            "fundingCost": funding_cost,
            "executionCost": execution_cost,
            "return": value,
        })
        total_turnover += turnover
        current = target
    return {"rows": rows, "totalTurnover": total_turnover}


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


def metrics(rows: Sequence[dict], multiplier: float = 1.0) -> dict:
    ordered = sorted(rows, key=lambda row: row["day"])
    values = [multiplier * finite(row["return"]) for row in ordered]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    compounded = product_return(values)
    if ordered:
        start = dt.date.fromisoformat(ordered[0]["day"])
        end = dt.date.fromisoformat(ordered[-1]["exitDay"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    positive = sum(wins)
    negative = -sum(losses)
    return {
        "days": len(values),
        "rebalances": sum(row["turnover"] > 1e-12 for row in ordered),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": positive / negative if negative > 1e-15 else None,
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageDayPct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "averageGross": statistics.mean(row["gross"] for row in ordered) if ordered else 0.0,
        "totalTurnover": sum(row["turnover"] for row in ordered) * multiplier,
    }


def subset(rows: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    start, end = interval
    return [row for row in rows if start <= row["day"] <= end]


def removals(rows: Sequence[dict], multiplier: float = 1.0) -> dict:
    if not rows:
        return {"bestDayRemovedPct": 0.0, "bestMonthRemovedPct": 0.0}
    values = [multiplier * finite(row["return"]) for row in rows]
    best = max(range(len(values)), key=values.__getitem__)
    months: Dict[str, List[float]] = defaultdict(list)
    for row, value in zip(rows, values):
        months[row["day"][:7]].append(value)
    best_month = max(months, key=lambda key: product_return(months[key]))
    return {
        "bestDayRemovedPct": product_return(value for index, value in enumerate(values) if index != best) * 100.0,
        "bestMonth": best_month,
        "bestMonthRemovedPct": product_return(value for row, value in zip(rows, values) if row["day"][:7] != best_month) * 100.0,
    }


def score(median: dict, normal: dict, severe: dict) -> float:
    return median["compoundedReturnPct"] + 0.5 * normal["compoundedReturnPct"] + 0.25 * severe["compoundedReturnPct"] + 2.0 * ((median.get("profitFactor") or 0.0) - 1.0) + 0.10 * median["maxDrawdownPct"]


def validation_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["days"] >= 10
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05
    )


def holdout_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["days"] >= 10
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["NORMAL"].get("profitFactor") or 0) > 1.0
    )


def combine(rows_by_candidate: Dict[str, List[dict]], ids: Sequence[str]) -> List[dict]:
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for candidate_id in ids:
        for row in rows_by_candidate.get(candidate_id, []):
            by_day[row["day"]].append(row)
    result = []
    for day, items in sorted(by_day.items()):
        result.append({
            "candidateId": "VALIDATION_SELECTED_MULTI_ASSET_ENSEMBLE",
            "family": "ENSEMBLE",
            "decisionDay": day,
            "day": day,
            "exitDay": max(item["exitDay"] for item in items),
            "weights": {},
            "gross": statistics.mean(item["gross"] for item in items),
            "turnover": statistics.mean(item["turnover"] for item in items),
            "return": statistics.mean(finite(item["return"]) for item in items),
        })
    return result


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
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    days = common_days(bars, sessions, funding)
    splits = base.chronological_splits(days)
    if len(days) < 100:
        raise RuntimeError(f"insufficient multi-asset history: {len(days)}")

    all_rows: Dict[str, Dict[str, List[dict]]] = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_rows[scenario.name][candidate.candidate_id] = replay(candidate, scenario, days, bars, sessions, funding)["rows"]

    families = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {scenario.name: metrics(subset(all_rows[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])) for scenario in base.SCENARIOS}
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"])})
        winner = max(rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {scenario.name: metrics(subset(all_rows[scenario.name][winner_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        families[family] = {"developmentCandidates": rows, "winnerId": winner_id, "winnerValidation": validation, "validationPass": validation_pass(validation)}

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {scenario.name: metrics(subset(all_rows[scenario.name][candidate_id], splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": candidate_id, "members": [candidate_id], "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})
    if len(passing) >= 2:
        validation = {scenario.name: metrics(subset(combine(all_rows[scenario.name], passing), splits["VALIDATION"])) for scenario in base.SCENARIOS}
        options.append({"portfolioId": "VALIDATION_SELECTED_MULTI_ASSET_ENSEMBLE", "members": sorted(passing), "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {"portfolioId": selected_option["portfolioId"], "members": selected_option["members"], "validation": selected_option["validation"], "gross1": {}, "normalizedGross2": {}}
        for scenario in base.SCENARIOS:
            rows = all_rows[scenario.name][selected_option["members"][0]] if len(selected_option["members"]) == 1 else combine(all_rows[scenario.name], selected_option["members"])
            selected["gross1"][scenario.name] = {
                "full": metrics(rows),
                "development": metrics(subset(rows, splits["DEVELOPMENT"])),
                "validation": metrics(subset(rows, splits["VALIDATION"])),
                "holdout": metrics(subset(rows, splits["HOLDOUT"])),
                "removals": removals(rows),
                "rows": rows,
            }
            selected["normalizedGross2"][scenario.name] = {
                "full": metrics(rows, 2.0),
                "holdout": metrics(subset(rows, splits["HOLDOUT"]), 2.0),
                "removals": removals(rows, 2.0),
            }
        selected["holdoutPassGross1"] = holdout_pass({name: item["holdout"] for name, item in selected["gross1"].items()})
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(selected["holdoutPassGross1"] and normal2["compoundedReturnPct"] >= 50 and normal2["cagrPct"] >= 50 and severe2["compoundedReturnPct"] > 0 and normal2["maxDrawdownPct"] >= -50)

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_MULTI_ASSET_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_MULTI_ASSET_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "MULTI_ASSET_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_MULTI_ASSET_FAMILY"

    return rounded({
        "version": 6,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "universe": list(SYMBOLS),
        "candidateCount": len(CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in CANDIDATES)),
        "eligibleDays": len(days),
        "firstEligibleDay": days[0],
        "lastEligibleDay": days[-1],
        "rebalanceEveryDays": REBALANCE_EVERY_DAYS,
        "weightTolerance": WEIGHT_TOLERANCE,
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "selectionDiscipline": {"familySelection": "DEVELOPMENT only", "portfolioSelection": "VALIDATION only", "finalEvaluation": "reused historical HOLDOUT once", "holdoutRetuningAllowed": False},
        "classificationLimit": "The same dates and current listings were inspected by earlier Stock research; any lead is reused historical evidence.",
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False},
        "limitations": [
            "Five mature current listings create survivorship and concentration risk.",
            "Signals use completed regular-session closes and execute at the next regular-session open.",
            "Returns include next-open price changes and actual historical Funding between regular-session opens.",
            "Intraday stop paths, exact event chronology and order-book gates are not reconstructed.",
            "Gross 2.0 is normalized sensitivity only, not an allocation approval.",
        ],
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-multiasset-trend-tournament-v6.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Multi-Asset Trend Tournament V6",
        "",
        f"- Status: **{result['status']}**",
        f"- Universe: {', '.join(result['universe'])}",
        f"- Window: {result['firstEligibleDay']}–{result['lastEligibleDay']} ({result['eligibleDays']} days)",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
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
    (output_dir / "v96-stock-multiasset-trend-tournament-v6.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(SYMBOLS) == 5
    assert len(CANDIDATES) == 24
    assert len(set(candidate.family for candidate in CANDIDATES)) == 8
    bounded = apply_weight_band({}, {"A": 0.6, "B": 0.6})
    assert abs(sum(abs(value) for value in bounded.values()) - 1.0) < 1e-12


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--price-cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-multiasset-trend-tournament-v6")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock multi-asset trend tournament V6 self-test: PASS")
        return 0
    result = analyze(Path(args.price_cache_dir).resolve(), Path(args.funding_cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"], "eligibleDays": result["eligibleDays"], "validationPassingWinnerIds": result["validationPassingWinnerIds"], "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
