from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_MATURE_UNIVERSE_TOURNAMENT_V5"
MATURE_SYMBOLS = ("AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT")


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


CANDIDATES = tuple(
    [Candidate(f"TOP_LONG_{value:.2f}", "TOP_MOMENTUM_LONG", 20, 5, value) for value in (0.00, 0.03, 0.05)]
    + [Candidate(f"BOTTOM_SHORT_{value:.2f}", "BOTTOM_MOMENTUM_SHORT", 20, 5, value) for value in (0.00, 0.03, 0.05)]
    + [Candidate(f"REGIME_ROT_{value:.2f}", "REGIME_ROTATION", 20, 5, value) for value in (0.00, 0.02, 0.04)]
    + [Candidate(f"XS_MOM_PAIR_{value:.2f}", "XS_MOMENTUM_PAIR", 10, 5, value) for value in (0.05, 0.10, 0.15)]
    + [Candidate(f"PULLBACK_LONG_{value:.2f}", "TREND_PULLBACK_LONG", 20, 5, value) for value in (0.05, 0.10, 0.15)]
    + [Candidate(f"BREAKOUT_LONG_{lookback}", "BREAKOUT_LONG", lookback, 5, 0.0) for lookback in (10, 15, 20)]
    + [Candidate(f"BREAKDOWN_SHORT_{lookback}", "BREAKDOWN_SHORT", lookback, 5, 0.0) for lookback in (10, 15, 20)]
    + [Candidate(f"VOL_TREND_{lookback}", "VOL_ADJUSTED_TREND_BASKET", lookback, 5, 0.0) for lookback in (10, 15, 20)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def snapshot(symbol: str, day: str, bars: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[dict]:
    rows = swing.history(bars.get(symbol, {}), day, 30)
    if len(rows) < 21 or rows[-1].day != day:
        return None
    atr = swing.mean_tr(rows, 20)
    vol = swing.stdev_returns(rows, 20)
    mom20 = swing.pct_change(rows, 20)
    mom3 = swing.pct_change(rows, 3)
    sma20 = swing.sma(rows, 20)
    if None in (atr, vol, mom20, mom3, sma20) or not atr or not vol:
        return None
    return {
        "symbol": symbol,
        "rows": rows,
        "bar": rows[-1],
        "atrPct": atr,
        "vol": vol,
        "mom20": mom20,
        "mom3": mom3,
        "sma20": sma20,
    }


def single(candidate: Candidate, item: dict, side: int, day: str, score: float, detail: dict) -> Signal:
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        (Leg(item["symbol"], side, 1.0),),
        score,
        max(2.0, 2.0 * item["atrPct"]),
        detail,
    )


def pair(candidate: Candidate, long_item: dict, short_item: dict, day: str, score: float, detail: dict) -> Signal:
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        (Leg(long_item["symbol"], 1, 0.5), Leg(short_item["symbol"], -1, 0.5)),
        score,
        max(3.0, 2.0 * max(long_item["atrPct"], short_item["atrPct"])),
        detail,
    )


def basket(candidate: Candidate, items: Sequence[dict], side: int, day: str, score: float, detail: dict) -> Signal:
    selected = list(items)[:2]
    each = 1.0 / len(selected)
    return Signal(
        candidate.candidate_id,
        candidate.family,
        day,
        tuple(Leg(item["symbol"], side, each) for item in selected),
        score,
        max(3.0, 2.0 * max(item["atrPct"] for item in selected)),
        detail,
    )


def build_signal(candidate: Candidate, day: str, bars: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[Signal]:
    states = [item for item in (snapshot(symbol, day, bars) for symbol in MATURE_SYMBOLS) if item is not None]
    if len(states) != len(MATURE_SYMBOLS):
        return None
    momentum = []
    for item in states:
        value = swing.pct_change(item["rows"], candidate.lookback)
        if value is not None:
            momentum.append((item, value))
    if len(momentum) != len(states):
        return None
    median = statistics.median(value for _item, value in momentum)
    strongest = max(momentum, key=lambda row: row[1] / row[0]["vol"])
    weakest = min(momentum, key=lambda row: row[1] / row[0]["vol"])

    if candidate.family == "TOP_MOMENTUM_LONG":
        if median > candidate.threshold and strongest[1] > candidate.threshold and strongest[0]["bar"].close > strongest[0]["sma20"]:
            return single(candidate, strongest[0], 1, day, strongest[1] / strongest[0]["vol"], {"medianMomentum": median, "symbolMomentum": strongest[1]})

    elif candidate.family == "BOTTOM_MOMENTUM_SHORT":
        if median < -candidate.threshold and weakest[1] < -candidate.threshold and weakest[0]["bar"].close < weakest[0]["sma20"]:
            return single(candidate, weakest[0], -1, day, abs(weakest[1]) / weakest[0]["vol"], {"medianMomentum": median, "symbolMomentum": weakest[1]})

    elif candidate.family == "REGIME_ROTATION":
        if median > candidate.threshold and strongest[1] > 0:
            return single(candidate, strongest[0], 1, day, strongest[1] / strongest[0]["vol"], {"medianMomentum": median})
        if median < -candidate.threshold and weakest[1] < 0:
            return single(candidate, weakest[0], -1, day, abs(weakest[1]) / weakest[0]["vol"], {"medianMomentum": median})

    elif candidate.family == "XS_MOMENTUM_PAIR":
        dispersion = strongest[1] - weakest[1]
        if dispersion >= candidate.threshold:
            return pair(candidate, strongest[0], weakest[0], day, dispersion, {"dispersion": dispersion})

    elif candidate.family == "TREND_PULLBACK_LONG":
        eligible = [
            (item, value) for item, value in momentum
            if value >= candidate.threshold and item["mom3"] <= -0.01 and item["bar"].close > item["sma20"]
        ]
        if eligible:
            item, value = max(eligible, key=lambda row: row[1] / row[0]["vol"])
            return single(candidate, item, 1, day, value / item["vol"], {"momentum": value, "pullback3": item["mom3"]})

    elif candidate.family == "BREAKOUT_LONG":
        options = []
        for item, value in momentum:
            rows = item["rows"]
            if len(rows) <= candidate.lookback:
                continue
            prior_high = max(row.high for row in rows[-1 - candidate.lookback:-1])
            if item["bar"].close > prior_high and value > 0:
                options.append((item, value))
        if options:
            item, value = max(options, key=lambda row: row[1] / row[0]["vol"])
            return single(candidate, item, 1, day, value / item["vol"], {"momentum": value})

    elif candidate.family == "BREAKDOWN_SHORT":
        options = []
        for item, value in momentum:
            rows = item["rows"]
            if len(rows) <= candidate.lookback:
                continue
            prior_low = min(row.low for row in rows[-1 - candidate.lookback:-1])
            if item["bar"].close < prior_low and value < 0:
                options.append((item, value))
        if options:
            item, value = min(options, key=lambda row: row[1] / row[0]["vol"])
            return single(candidate, item, -1, day, abs(value) / item["vol"], {"momentum": value})

    elif candidate.family == "VOL_ADJUSTED_TREND_BASKET":
        if median > 0:
            selected = [item for item, value in sorted(momentum, key=lambda row: row[1] / row[0]["vol"], reverse=True) if value > 0]
            if len(selected) >= 2:
                return basket(candidate, selected, 1, day, median, {"medianMomentum": median})
        elif median < 0:
            selected = [item for item, value in sorted(momentum, key=lambda row: row[1] / row[0]["vol"]) if value < 0]
            if len(selected) >= 2:
                return basket(candidate, selected, -1, day, abs(median), {"medianMomentum": median})

    return None


def eligible_days(bars: Dict[str, Dict[str, swing.DailyBar]]) -> List[str]:
    common = sorted(set.intersection(*(set(bars.get(symbol, {})) for symbol in MATURE_SYMBOLS)))
    return [
        day for day in common
        if all(len(swing.history(bars[symbol], day, 21)) >= 21 for symbol in MATURE_SYMBOLS)
    ]


def simulate_trade(candidate: Candidate, signal: Signal, scenario: base.CostScenario, days: Sequence[str], bars: Dict[str, Dict[str, swing.DailyBar]]) -> Optional[dict]:
    proxy = swing.Signal(
        signal.candidate_id,
        signal.family,
        signal.decision_day,
        tuple(swing.Leg(leg.symbol, leg.side, leg.weight) for leg in signal.legs),
        signal.score,
        signal.stop_pct,
        signal.detail,
    )
    proxy_candidate = swing.Candidate(candidate.candidate_id, candidate.family, candidate.lookback, candidate.hold_days, candidate.threshold)
    return swing.simulate_trade(proxy_candidate, proxy, scenario, days, bars)


def replay_candidate(candidate: Candidate, scenario: base.CostScenario, days: Sequence[str], bars: Dict[str, Dict[str, swing.DailyBar]]) -> List[dict]:
    trades = []
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
            "candidateId": "VALIDATION_SELECTED_MATURE_ENSEMBLE",
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
    bars = swing.daily_bars(sessions)
    days = eligible_days(bars)
    splits = base.chronological_splits(days)
    if len(days) < 80:
        raise RuntimeError(f"insufficient mature-universe history: {len(days)}")
    all_trades = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in CANDIDATES:
        for scenario in base.SCENARIOS:
            all_trades[scenario.name][candidate.candidate_id] = replay_candidate(candidate, scenario, days, bars)

    families = {}
    for family in sorted(set(candidate.family for candidate in CANDIDATES)):
        candidates = [candidate for candidate in CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {
                scenario.name: metrics(subset(all_trades[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"]))
                for scenario in base.SCENARIOS
            }
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"])})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
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
        options.append({"portfolioId": "VALIDATION_SELECTED_MATURE_ENSEMBLE", "members": sorted(passing), "validation": validation, "validationScore": score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"])})

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {"portfolioId": selected_option["portfolioId"], "members": selected_option["members"], "validation": selected_option["validation"], "gross1": {}, "normalizedGross2": {}}
        for scenario in base.SCENARIOS:
            trades = all_trades[scenario.name][selected_option["members"][0]] if len(selected_option["members"]) == 1 else combine(all_trades[scenario.name], selected_option["members"])
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
        selected["holdoutPassGross1"] = holdout_pass({name: item["holdout"] for name, item in selected["gross1"].items()})
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(selected["holdoutPassGross1"] and normal2["compoundedReturnPct"] >= 50 and normal2["cagrPct"] >= 50 and severe2["compoundedReturnPct"] > 0 and normal2["maxDrawdownPct"] >= -50)

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_MATURE_STOCK_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_MATURE_STOCK_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "MATURE_STOCK_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_MATURE_STOCK_FAMILY"

    return rounded({
        "version": 5,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "universe": list(MATURE_SYMBOLS),
        "universePolicy": "Fixed before this run from listing-history maturity, not from candidate PnL.",
        "candidateCount": len(CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in CANDIDATES)),
        "eligibleDays": len(days),
        "firstEligibleDay": days[0],
        "lastEligibleDay": days[-1],
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "classificationLimit": "Dates and current listings were already inspected in earlier Stock work; any lead is reused historical evidence.",
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False},
        "limitations": [
            "Five mature current listings create strong survivorship and concentration risk.",
            "Daily regular-session OHLC includes overnight gaps only between regular-session close and next regular-session open.",
            "Historical Funding, order-book and event gates are not included in this price-family tournament.",
            "Gross 2.0 is normalized sensitivity only and is not an allocation approval.",
        ],
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-mature-universe-tournament-v5.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Mature-universe Tournament V5",
        "",
        f"- Status: **{result['status']}**",
        f"- Universe: {', '.join(result['universe'])}",
        f"- Window: {result['firstEligibleDay']}–{result['lastEligibleDay']} ({result['eligibleDays']} days)",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev trades | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for family, item in result["families"].items():
        winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
        lines.append(f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['trades']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {winner['development']['SEVERE']['compoundedReturnPct']}% | {item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | {item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | {'YES' if item['validationPass'] else 'NO'} |")
    selected = result.get("selected")
    if selected:
        lines.extend(["", "## Selected reused-historical portfolio", "", f"Portfolio: **{selected['portfolioId']}**", f"Gross 1 Holdout pass: **{'YES' if selected['holdoutPassGross1'] else 'NO'}**", f"Normalized Gross 2 crypto-like threshold: **{'YES' if selected['cryptoLikeNormalizedGross2'] else 'NO'}**", "", "| Scenario | G1 Full | G1 CAGR | G1 DD | G1 Holdout | G2 Full | G2 CAGR | G2 DD | G2 Holdout |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            g1 = selected["gross1"][name]
            g2 = selected["normalizedGross2"][name]
            lines.append(f"| {name} | {g1['full']['compoundedReturnPct']}% | {g1['full']['cagrPct']}% | {g1['full']['maxDrawdownPct']}% | {g1['holdout']['compoundedReturnPct']}% | {g2['full']['compoundedReturnPct']}% | {g2['full']['cagrPct']}% | {g2['full']['maxDrawdownPct']}% | {g2['holdout']['compoundedReturnPct']}% |")
    (output_dir / "v96-stock-mature-universe-tournament-v5.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(MATURE_SYMBOLS) == 5
    assert len(CANDIDATES) == 24
    assert len(set(candidate.family for candidate in CANDIDATES)) == 8
    assert set(MATURE_SYMBOLS).issubset(set(base.SYMBOLS))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-mature-universe-tournament-v5")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock mature-universe tournament V5 self-test: PASS")
        return 0
    result = analyze(Path(args.cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"], "eligibleDays": result["eligibleDays"], "validationPassingWinnerIds": result["validationPassingWinnerIds"], "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
