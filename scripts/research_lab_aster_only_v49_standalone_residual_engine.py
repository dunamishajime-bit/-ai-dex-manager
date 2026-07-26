from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v39_overnight_open_router as v39
import research_lab_aster_only_v46_closing_overlay as v46

STRATEGY_ID = "DISDEX_ASTER_ONLY_V49_STANDALONE_RESIDUAL_ENGINE"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
TP_PCT = 1.0
SL_PCT = 1.0
WINDOWS = ("OPEN_1030", "MID_1230", "CLOSE_1500")


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    open_residual_bps: float
    intraday_residual_bps: float
    recent_residual_bps: float
    broad_regime_bps: float
    direction_mode: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{family}__O{open_bps:g}__I{intra_bps:g}__R{recent:g}__B{broad:g}__{direction}",
        family,
        open_bps,
        intra_bps,
        recent,
        broad,
        direction,
    )
    for family in ("CONTINUATION", "REVERSAL", "REGIME_SWITCH")
    for open_bps in (50.0, 100.0)
    for intra_bps in (50.0, 100.0, 150.0)
    for recent in (25.0, 50.0)
    for broad in (75.0, 150.0)
    for direction in ("BOTH", "LONG_ONLY", "SHORT_ONLY")
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def direction_allowed(mode: str, side: int) -> bool:
    return mode == "BOTH" or (mode == "LONG_ONLY" and side > 0) or (mode == "SHORT_ONLY" and side < 0)


def relation_side(family: str, residual: float, recent: float, broad_recent: float, regime_bps: float) -> Optional[int]:
    continuation = residual * recent > 0
    if family == "CONTINUATION":
        if not continuation:
            return None
    elif family == "REVERSAL":
        if continuation:
            return None
    elif family == "REGIME_SWITCH":
        want_continuation = abs(broad_recent) <= regime_bps
        if continuation != want_continuation:
            return None
    else:
        raise ValueError(family)
    return 1 if recent > 0 else -1


def open_signal(candidate: Candidate, day_feature: Dict[str, dict]) -> Optional[Tuple[str, int, float, dict]]:
    overnight_median = statistics.median(finite(row["overnightBps"]) for row in day_feature.values())
    first_hour_median = statistics.median(finite(row["firstHourBps"]) for row in day_feature.values())
    eligible = []
    for symbol in v14.SYMBOLS:
        row = day_feature[symbol]
        if not row["historyReady"]:
            continue
        residual = finite(row["overnightBps"]) - overnight_median
        recent = finite(row["firstHourBps"]) - first_hour_median
        if abs(residual) < candidate.open_residual_bps or abs(recent) < candidate.recent_residual_bps:
            continue
        side = relation_side(candidate.family, residual, recent, first_hour_median, candidate.broad_regime_bps)
        if side is None or not direction_allowed(candidate.direction_mode, side):
            continue
        edge = max(0.0, min(abs(residual), abs(recent)) - 5.0)
        strength = abs(recent) + 0.5 * abs(residual) + 20.0 * abs(finite(row["overnightZscore"]))
        eligible.append((strength, symbol, side, edge, {"residual": residual, "recent": recent, "broad": first_hour_median}))
    if not eligible:
        return None
    _strength, symbol, side, edge, state = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, state


def intraday_state(day_rows: Dict[str, dict], entry_minute: int) -> Dict[str, dict]:
    recent_start = 690 if entry_minute == 750 else 840
    states = {}
    for symbol, row in day_rows.items():
        bars = row["bars"]
        entry = finite(bars[entry_minute][1])
        start = finite(bars[630][1])
        recent_price = finite(bars[recent_start][1])
        states[symbol] = {
            "entry": entry,
            "entryTs": int(bars[entry_minute][0]),
            "dayBps": (entry / start - 1.0) * 10_000.0,
            "recentBps": (entry / recent_price - 1.0) * 10_000.0,
            "bars": bars,
        }
    return states


def intraday_signal(candidate: Candidate, day_rows: Dict[str, dict], entry_minute: int) -> Optional[Tuple[str, int, float, dict]]:
    states = intraday_state(day_rows, entry_minute)
    median_day = statistics.median(row["dayBps"] for row in states.values())
    median_recent = statistics.median(row["recentBps"] for row in states.values())
    eligible = []
    for symbol, row in states.items():
        residual = finite(row["dayBps"]) - median_day
        recent = finite(row["recentBps"]) - median_recent
        if abs(residual) < candidate.intraday_residual_bps or abs(recent) < candidate.recent_residual_bps:
            continue
        side = relation_side(candidate.family, residual, recent, median_recent, candidate.broad_regime_bps)
        if side is None or not direction_allowed(candidate.direction_mode, side):
            continue
        edge = max(0.0, min(abs(residual), abs(recent)) - 5.0)
        strength = abs(recent) + 0.5 * abs(residual)
        eligible.append((strength, symbol, side, edge, {**row, "residual": residual, "recent": recent, "broad": median_recent}))
    if not eligible:
        return None
    _strength, symbol, side, edge, state = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, state


def execute_trade(day: str, window: str, symbol: str, side: int, edge: float, entry_price: float, entry_ts: int,
                  bars: Dict[int, list], scan_minutes: Sequence[int], exit_price: float, exit_ts: int,
                  funding_points: Sequence[Tuple[int, float]], state: dict) -> dict:
    reason = "TIME_EXIT"
    for minute in scan_minutes:
        bar = bars[minute]
        high, low = finite(bar[2]), finite(bar[3])
        if side > 0:
            stop_hit = low <= entry_price * (1.0 - SL_PCT / 100.0)
            take_hit = high >= entry_price * (1.0 + TP_PCT / 100.0)
            stop_price, take_price = entry_price * (1.0 - SL_PCT / 100.0), entry_price * (1.0 + TP_PCT / 100.0)
        else:
            stop_hit = high >= entry_price * (1.0 + SL_PCT / 100.0)
            take_hit = low <= entry_price * (1.0 - TP_PCT / 100.0)
            stop_price, take_price = entry_price * (1.0 + SL_PCT / 100.0), entry_price * (1.0 - TP_PCT / 100.0)
        if stop_hit or take_hit:
            exit_price, reason = (stop_price, "PRICE_STOP") if stop_hit else (take_price, "PRICE_TAKE_PROFIT")
            exit_ts = int(bar[0]) + 30 * 60_000
            break
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(funding_points, entry_ts, exit_ts)
    return {
        "strategy": "V49_STANDALONE_RESIDUAL_ENGINE",
        "route": window,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "edgeProxyBps": edge,
        "residualBps": finite(state["residual"]),
        "recentResidualBps": finite(state["recent"]),
        "broadRecentBps": finite(state["broad"]),
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_window_trades(candidate: Candidate, day: str, open_feature: Dict[str, dict], intraday_rows: Dict[str, dict],
                        funding: Dict[str, Sequence[Tuple[int, float]]]) -> List[dict]:
    trades = []
    selected = open_signal(candidate, open_feature)
    if selected is not None:
        symbol, side, edge, state = selected
        row = open_feature[symbol]
        trades.append(execute_trade(day, "OPEN_1030", symbol, side, edge, finite(row["entry"]), int(row["entryTs"]),
                                    row["bars"], (630, 660), finite(row["bars"][690][1]), int(row["bars"][690][0]),
                                    row["fundingPoints"], state))
    for window, entry_minute, exit_minute, scan_minutes in (
        ("MID_1230", 750, 810, (750, 780)),
        ("CLOSE_1500", 900, 930, (900, 930)),
    ):
        selected = intraday_signal(candidate, intraday_rows, entry_minute)
        if selected is None:
            continue
        symbol, side, edge, state = selected
        bars = intraday_rows[symbol]["bars"]
        exit_price = finite(bars[exit_minute][1]) if exit_minute == 810 else finite(bars[930][4])
        exit_ts = int(bars[exit_minute][0]) if exit_minute == 810 else int(bars[930][0]) + 30 * 60_000
        trades.append(execute_trade(day, window, symbol, side, edge, finite(state["entry"]), int(state["entryTs"]),
                                    bars, scan_minutes, exit_price, exit_ts, funding.get(symbol, []), state))
    return sorted(trades, key=lambda row: int(row["entryTs"]))


def build_trades(candidate: Candidate, days: Sequence[str], open_features: Dict[str, dict], intraday: Dict[str, Dict[str, dict]],
                 funding: Dict[str, Sequence[Tuple[int, float]]]) -> List[dict]:
    rows = []
    for day in days:
        day_rows = {symbol: intraday[symbol][day] for symbol in v14.SYMBOLS}
        rows.extend(build_window_trades(candidate, day, open_features[day], day_rows, funding))
    return rows


def route(raw: Sequence[dict], cost_bps: float, days: Sequence[str]) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by_day = defaultdict(list)
    for row in raw:
        if str(row["day"]) in allowed:
            by_day[str(row["day"])].append(row)
    events, stats = [], Counter()
    for day in sorted(allowed):
        daily_net = 0.0
        previous_symbol = None
        for row in sorted(by_day.get(day, []), key=lambda item: int(item["entryTs"])):
            if daily_net <= -0.02:
                stats["DAILY_LOSS_BLOCKED"] += 1
                continue
            if previous_symbol == str(row["symbol"]):
                stats["SAME_SYMBOL_BLOCKED"] += 1
                continue
            value = v14.net_trade_return(row, cost_bps)
            if value is None:
                stats["COST_EDGE_REJECTED"] += 1
                continue
            events.append({**row, "netReturn": value})
            daily_net += value
            previous_symbol = str(row["symbol"])
            stats[str(row["route"])] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]))), dict(stats)


def scenario_set(raw: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(raw, cost, days)
        results[name] = v22.metrics(events)
        routing[name] = stats
    return results, routing


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda i: finite(events[i]["netReturn"]))
    return [row for i, row in enumerate(events) if i != index]


def remove_best_month(events: Sequence[dict]) -> List[dict]:
    monthly = defaultdict(float)
    for row in events:
        monthly[str(row["day"])[:7]] += finite(row["netReturn"])
    if not monthly:
        return []
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [row for row in events if str(row["day"])[:7] != month]


def audit(raw: Sequence[dict], target: Sequence[str], development: Sequence[str], validation: Sequence[str],
          final: Sequence[str], holdout: Sequence[str]) -> dict:
    full, routing = scenario_set(raw, target)
    dev, _ = scenario_set(raw, development)
    val, _ = scenario_set(raw, validation)
    fin, _ = scenario_set(raw, final)
    hol, _ = scenario_set(raw, holdout)
    normal_events, _ = route(raw, SCENARIOS["NORMAL"], target)
    p95_events, _ = route(raw, SCENARIOS["P95"], target)
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightTrades": val["NORMAL"]["trades"] >= 8,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "validationProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumThreeTrades": hol["NORMAL"]["trades"] >= 3,
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "standaloneNormalAtLeast50Pct": full["NORMAL"]["compoundedReturnPct"] >= 50.0,
        "standaloneP95AtLeast30Pct": full["P95"]["compoundedReturnPct"] >= 30.0,
        "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedPositive": v22.metrics(remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedPositive": v22.metrics(remove_best_month(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(remove_best_month(p95_events))["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {"full": full, "development": dev, "validation": val, "finalReused": fin, "holdout": hol,
            "routing": routing, "checks": checks, "allChecksPassed": all(checks.values())}


def development_pass(result: dict) -> bool:
    row = result["development"]["NORMAL"]
    return result["development"]["P95"]["compoundedReturnPct"] > 0 and row["compoundedReturnPct"] > 0 and row["trades"] >= 20 and (row["profitFactor"] or 0.0) >= 1.2 and row["maxDrawdownPct"] >= -12.0


def validation_pass(result: dict) -> bool:
    row = result["validation"]["NORMAL"]
    return row["trades"] >= 8 and row["compoundedReturnPct"] > 0 and result["validation"]["P95"]["compoundedReturnPct"] > 0 and (row["profitFactor"] or 0.0) >= 1.2


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, _aligned, aligned_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    market = v14.v11.v9.load_market(cache_root / "aster-market")
    open_rows, open_diag = v39.parse_market(market, warmup)
    intraday, intraday_diag = v46.load_intraday(market, warmup)
    common = [day for day in warmup if all(day in open_rows[s] and day in intraday[s] for s in v14.SYMBOLS)]
    funding_raw = v14.funding_mod.load_funding(cache_root / "funding")
    funding = {symbol: v14.funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    open_features = v39.build_features(common, open_rows, funding)
    target = [day for day in common if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)

    diagnostics = []
    development_survivors = []
    for candidate in CANDIDATES:
        raw = build_trades(candidate, common, open_features, intraday, funding)
        result = audit(raw, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        diagnostics.append({"candidate": asdict(candidate), "rawTrades": len(raw), "audit": result})
        if development_pass(result):
            development_survivors.append((candidate, raw, result))
    development_survivors.sort(key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"], reverse=True)
    validation_survivors = [item for item in development_survivors[:40] if validation_pass(item[2])]
    validation_survivors.sort(key=lambda item: item[2]["validation"]["NORMAL"]["compoundedReturnPct"] + item[2]["validation"]["P95"]["compoundedReturnPct"], reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V49_NO_VALIDATED_STANDALONE_50PCT_ENGINE"
    winner_payload = None
    if winner is not None:
        candidate, raw, result = winner
        status = "ASTER_ONLY_V49_STANDALONE_50PCT_SHADOW_LEAD" if result["allChecksPassed"] else "ASTER_ONLY_V49_VALIDATION_WINNER_FAILED_FINAL_HURDLES"
        winner_payload = {"candidate": asdict(candidate), "rawTrades": len(raw), "audit": result}
    diagnostics.sort(key=lambda row: row["audit"]["full"]["NORMAL"]["compoundedReturnPct"] + row["audit"]["full"]["P95"]["compoundedReturnPct"], reverse=True)
    return v14.rounded({
        "version": 49,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "topDiagnostics": diagnostics[:20],
        "period": {"startInclusiveUtc": v19.BT_START.isoformat(), "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(), "calendarDays": 365, "sessions": len(target), "holdoutSessions": len(holdout)},
        "architecture": {"venue": "ASTER_ONLY", "singleEconomicThesis": "CROSS_SECTIONAL_IDIOSYNCRATIC_RESIDUAL_MOMENTUM", "windows": list(WINDOWS), "maximumConcurrentGross": 1.0, "maximumConcurrentPositions": 1, "maximumSequentialTradesPerDay": 3, "otherStrategyReturnsIncluded": False, "v11EqIncluded": False, "v19Included": False, "v48Included": False, "hyperliquidUsed": False},
        "selectionDiscipline": {"candidateCountFrozenBeforeExecution": True, "developmentSelectsTopForty": True, "validationSelectsAtMostOne": True, "finalAndHoldoutUsedForSelection": False, "productionPromotionAllowed": False},
        "data": {"aligned": aligned_diag, "open": open_diag, "intraday": intraday_diag, "commonSessions": len(common)},
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False, "v11EqChanged": False, "v19Changed": False, "v48Changed": False},
    })


def report(result: dict) -> str:
    lines = ["# Aster-only V49 Standalone Residual Engine", "", f"Status: **{result['status']}**", "", f"Candidates: {result['candidateCount']}", f"Development survivors: {result['developmentSurvivors']}", f"Validation survivors: {result['validationSurvivors']}", "", "No V11-EQ, V19 or V48 return is included in any result.", ""]
    if result["winner"]:
        lines.append(f"Winner: `{result['winner']['candidate']['candidate_id']}`")
        for name, row in result["winner"]["audit"]["full"].items():
            lines.append(f"- {name}: {row['compoundedReturnPct']:.4f}% / PF {row['profitFactor']} / DD {row['maxDrawdownPct']:.4f}% / {row['trades']} trades")
    else:
        lines.append("No standalone candidate passed chronological Validation and all final hurdles.")
    lines += ["", "Research only. Production, LIVE, VPS and orders are unchanged.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="../.cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default="../.research-state/aster-only-v49-standalone")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve(); output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({"status": result["status"], "winner": result["winner"], "top": result["topDiagnostics"][:3]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
