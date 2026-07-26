from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V39_OVERNIGHT_OPEN_ROUTER"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
LOOKBACK = 20
ENTRY_MINUTE = 630
PREOPEN_MINUTE = 540
SIGNAL_MINUTE = 600
PREVIOUS_CLOSE_MINUTE = 930
TP_PCT = 1.00
SL_PCT = 1.00
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    minimum_overnight_bps: float
    minimum_confirmation_bps: float
    minimum_overnight_zscore: float
    maximum_holding_hours: int


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{family}__O{overnight:g}__C{confirm:g}__Z{z:g}__H{hours}",
        family,
        overnight,
        confirm,
        z,
        hours,
    )
    for family in ("OVERNIGHT_CONTINUATION", "OPEN_REVERSAL")
    for overnight in (50.0, 100.0, 150.0)
    for confirm in (25.0, 50.0, 75.0)
    for z in (0.0, 1.5)
    for hours in (1, 2)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def parse_market(
    market: Dict[str, Dict[str, List[list]]],
    aligned_days: Sequence[str],
) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    result: Dict[str, Dict[str, dict]] = {symbol: {} for symbol in v14.SYMBOLS}
    diagnostics = {"symbols": {}}
    day_set = set(aligned_days)
    for symbol in v14.SYMBOLS:
        by_day: Dict[str, Dict[int, list]] = defaultdict(dict)
        rows = market[symbol]["trade"]
        for row in rows:
            if not isinstance(row, list) or len(row) < 6:
                continue
            ts = int(row[0])
            day, minute, _weekday = v14.v11.v9.local_parts(ts)
            if day not in day_set:
                continue
            if minute in {
                PREOPEN_MINUTE,
                SIGNAL_MINUTE,
                ENTRY_MINUTE,
                660,
                690,
                720,
                750,
                PREVIOUS_CLOSE_MINUTE,
            }:
                by_day[day][minute] = row
        completed = 0
        ordered_days = list(aligned_days)
        for index, day in enumerate(ordered_days):
            if index == 0:
                continue
            previous_day = ordered_days[index - 1]
            current = by_day.get(day, {})
            previous = by_day.get(previous_day, {})
            required_current = {PREOPEN_MINUTE, SIGNAL_MINUTE, ENTRY_MINUTE, 660, 690, 720, 750}
            if not required_current.issubset(current) or PREVIOUS_CLOSE_MINUTE not in previous:
                continue
            previous_close = finite(previous[PREVIOUS_CLOSE_MINUTE][4])
            preopen = finite(current[PREOPEN_MINUTE][4])
            signal = finite(current[SIGNAL_MINUTE][4])
            entry = finite(current[ENTRY_MINUTE][1])
            if min(previous_close, preopen, signal, entry) <= 0:
                continue
            result[symbol][day] = {
                "previousDay": previous_day,
                "previousClose": previous_close,
                "preopen": preopen,
                "signal": signal,
                "entry": entry,
                "entryTs": int(current[ENTRY_MINUTE][0]),
                "bars": {minute: current[minute] for minute in (630, 660, 690, 720, 750)},
            }
            completed += 1
        diagnostics["symbols"][symbol] = {
            "tradeBars": len(rows),
            "completeSessions": completed,
        }
    common_days = [
        day for day in aligned_days
        if all(day in result[symbol] for symbol in v14.SYMBOLS)
    ]
    diagnostics["commonSessions"] = len(common_days)
    return result, diagnostics


def build_features(
    days: Sequence[str], rows: Dict[str, Dict[str, dict]], funding: Dict[str, Sequence[Tuple[int, float]]]
) -> Dict[str, dict]:
    history: Dict[str, List[float]] = {symbol: [] for symbol in v14.SYMBOLS}
    features: Dict[str, dict] = {}
    for day in days:
        features[day] = {}
        for symbol in v14.SYMBOLS:
            row = rows[symbol][day]
            overnight = (finite(row["preopen"]) / finite(row["previousClose"]) - 1.0) * 10_000.0
            first_hour = (finite(row["signal"]) / finite(row["preopen"]) - 1.0) * 10_000.0
            previous = history[symbol][-LOOKBACK:]
            sigma = statistics.pstdev(previous) if len(previous) >= LOOKBACK else 0.0
            median = statistics.median(previous) if len(previous) >= LOOKBACK else 0.0
            zscore = (overnight - median) / sigma if sigma > 1e-9 else 0.0
            features[day][symbol] = {
                **row,
                "overnightBps": overnight,
                "firstHourBps": first_hour,
                "overnightMedianBps": median,
                "overnightSigmaBps": sigma,
                "overnightZscore": zscore,
                "historyReady": len(previous) >= LOOKBACK,
                "fundingPoints": funding.get(symbol, []),
            }
            history[symbol].append(overnight)
    return features


def signal(candidate: Candidate, day_feature: Dict[str, dict]) -> Optional[Tuple[str, int, float]]:
    eligible: List[Tuple[float, str, int, float]] = []
    for symbol in v14.SYMBOLS:
        row = day_feature[symbol]
        overnight = finite(row["overnightBps"])
        confirmation = finite(row["firstHourBps"])
        zscore = finite(row["overnightZscore"])
        if not row["historyReady"]:
            continue
        if abs(overnight) < candidate.minimum_overnight_bps:
            continue
        if candidate.minimum_overnight_zscore > 0 and abs(zscore) < candidate.minimum_overnight_zscore:
            continue
        if abs(confirmation) < candidate.minimum_confirmation_bps:
            continue
        if candidate.family == "OVERNIGHT_CONTINUATION":
            if overnight * confirmation <= 0:
                continue
            side = 1 if confirmation > 0 else -1
        elif candidate.family == "OPEN_REVERSAL":
            if overnight * confirmation >= 0:
                continue
            side = 1 if confirmation > 0 else -1
        else:
            raise ValueError(candidate.family)
        edge = max(0.0, min(abs(overnight), abs(confirmation)) - 5.0)
        strength = abs(confirmation) + 0.5 * abs(overnight) + 25.0 * abs(zscore)
        eligible.append((strength, symbol, side, edge))
    if not eligible:
        return None
    _strength, symbol, side, edge = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge


def build_trade(candidate: Candidate, day: str, day_feature: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, day_feature)
    if selected is None:
        return None
    symbol, side, edge = selected
    row = day_feature[symbol]
    entry_price = finite(row["entry"])
    bars = row["bars"]
    exit_minute = 690 if candidate.maximum_holding_hours == 1 else 750
    chosen_price = finite(bars[exit_minute][1])
    chosen_ts = int(bars[exit_minute][0])
    reason = f"TIME_{candidate.maximum_holding_hours}H"
    scan_minutes = (630, 660) if candidate.maximum_holding_hours == 1 else (630, 660, 690, 720)
    for minute in scan_minutes:
        bar = bars[minute]
        high = finite(bar[2])
        low = finite(bar[3])
        if side > 0:
            stop_hit = low <= entry_price * (1.0 - SL_PCT / 100.0)
            take_hit = high >= entry_price * (1.0 + TP_PCT / 100.0)
            stop_price = entry_price * (1.0 - SL_PCT / 100.0)
            take_price = entry_price * (1.0 + TP_PCT / 100.0)
        else:
            stop_hit = high >= entry_price * (1.0 + SL_PCT / 100.0)
            take_hit = low <= entry_price * (1.0 - TP_PCT / 100.0)
            stop_price = entry_price * (1.0 + SL_PCT / 100.0)
            take_price = entry_price * (1.0 - TP_PCT / 100.0)
        if stop_hit or take_hit:
            # Conservative ambiguity rule: when both occur in one candle, assume stop first.
            if stop_hit:
                chosen_price, reason = stop_price, "PRICE_STOP"
            else:
                chosen_price, reason = take_price, "PRICE_TAKE_PROFIT"
            chosen_ts = int(bar[0]) + 30 * 60_000
            break
    entry_ts = int(row["entryTs"])
    price_return = side * (chosen_price / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        row["fundingPoints"], entry_ts, chosen_ts
    )
    return {
        "strategy": "V39_OVERNIGHT_OPEN",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": chosen_ts,
        "holdingHours": max(0.0, (chosen_ts - entry_ts) / 3_600_000.0),
        "overnightBps": finite(row["overnightBps"]),
        "firstHourBps": finite(row["firstHourBps"]),
        "overnightZscore": finite(row["overnightZscore"]),
        "edgeProxyBps": edge,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [
        trade
        for day in days
        if (trade := build_trade(candidate, day, features[day])) is not None
    ]


def route(
    v11_rows: Sequence[dict], v19_rows: Sequence[dict], overnight_rows: Sequence[dict],
    cost_bps: float, days: Sequence[str],
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by11 = {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed}
    by19 = {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed}
    by_over = {str(row["day"]): row for row in overnight_rows if str(row["day"]) in allowed}
    events: List[dict] = []
    stats: Counter = Counter()
    for day in sorted(allowed):
        primary = by11.get(day)
        if primary is not None:
            value = v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1

        daily_return = 0.0
        overnight = by_over.get(day)
        if overnight is not None:
            value = v22.trade_value(overnight, cost_bps)
            if value is not None:
                events.append({**overnight, "netReturn": value, "route": "V39_OVERNIGHT_OPEN"})
                stats["V39_OVERNIGHT_OPEN_SELECTED"] += 1
                daily_return = value
            else:
                stats["V39_COST_GATE_REJECTED"] += 1

        fallback = by19.get(day)
        if fallback is not None and daily_return > -0.02:
            if overnight is None or not any(
                row.get("day") == day and row.get("route") == "V39_OVERNIGHT_OPEN"
                for row in events[-1:]
            ) or int(events[-1]["exitTs"]) <= int(fallback["entryTs"]):
                value = v22.trade_value(fallback, cost_bps)
                if value is not None:
                    events.append({**fallback, "netReturn": value, "route": "V19_FALLBACK"})
                    stats["V19_FALLBACK_SELECTED"] += 1
                else:
                    stats["V19_FALLBACK_COST_GATE_REJECTED"] += 1
            else:
                stats["V19_OVERLAP_BLOCKED"] += 1
        elif fallback is not None:
            stats["V19_DAILY_LOSS_BLOCKED"] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def scenario_set(v11_rows, v19_rows, overnight_rows, days):
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(v11_rows, v19_rows, overnight_rows, cost, days)
        results[name] = v22.metrics(events)
        routing[name] = stats
    return results, routing


def component(events: Sequence[dict]) -> dict:
    return v22.metrics([row for row in events if row.get("route") != "V11_EQ_PRIMARY"])


def audit(v11_rows, v19_rows, overnight_rows, target, development, validation, final, holdout):
    full, routing = scenario_set(v11_rows, v19_rows, overnight_rows, target)
    dev, dev_route = scenario_set(v11_rows, v19_rows, overnight_rows, development)
    val, val_route = scenario_set(v11_rows, v19_rows, overnight_rows, validation)
    fin, _ = scenario_set(v11_rows, v19_rows, overnight_rows, final)
    hol, _ = scenario_set(v11_rows, v19_rows, overnight_rows, holdout)
    normal_events, _ = route(v11_rows, v19_rows, overnight_rows, SCENARIOS["NORMAL"], target)
    p95_events, _ = route(v11_rows, v19_rows, overnight_rows, SCENARIOS["P95"], target)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    fallback_normal, fallback_p95 = component(normal_events), component(p95_events)
    dev_over = int(dev_route["NORMAL"].get("V39_OVERNIGHT_OPEN_SELECTED", 0))
    val_over = int(val_route["NORMAL"].get("V39_OVERNIGHT_OPEN_SELECTED", 0))
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourOvernightTrades": val_over >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalAboveV22": full["NORMAL"]["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95AboveV22": full["P95"]["compoundedReturnPct"] > BASELINE_P95,
        "fallbackNormalAboveV19": fallback_normal["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19": fallback_p95["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v22.metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v22.metrics(normal_month_events)["compoundedReturnPct"] > 0 and v22.metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "developmentRouting": dev_route,
        "validationRouting": val_route,
        "developmentOvernightTrades": dev_over,
        "validationOvernightTrades": val_over,
        "fallbackFull": {"NORMAL": fallback_normal, "P95": fallback_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v22.metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v22.metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": v22.metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": v22.metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    return (
        result["developmentOvernightTrades"] >= 8
        and result["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"]
        and result["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"]
        and (result["development"]["NORMAL"]["profitFactor"] or 0.0) >= 1.30
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    return (
        result["validation"]["NORMAL"]["trades"] >= 8
        and result["validationOvernightTrades"] >= 4
        and result["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        and result["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"]
        and (result["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20
    )


def selection_score(result: dict, baseline: dict) -> float:
    return (
        result["validation"]["NORMAL"]["compoundedReturnPct"] - baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        + result["validation"]["P95"]["compoundedReturnPct"] - baseline["validation"]["P95"]["compoundedReturnPct"]
        + 0.20 * result["validationOvernightTrades"]
        - 0.25 * abs(result["validation"]["NORMAL"]["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, aligned_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    market = v14.v11.v9.load_market(cache_root / "aster-market")
    market_rows, market_diag = parse_market(market, warmup)
    common = [day for day in warmup if all(day in market_rows[symbol] for symbol in v14.SYMBOLS)]
    funding_raw = v14.funding_mod.load_funding(cache_root / "funding")
    funding = {symbol: v14.funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    features = build_features(common, market_rows, funding)
    target = [day for day in common if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    v19_rows = v22.build_fallback(warmup, aligned)
    baseline = v22.audit(
        v11_rows, v19_rows, target,
        splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True,
    )

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, common, features)
        result = audit(
            v11_rows, v19_rows, rows, target,
            splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout,
        )
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentOvernightTrades": result["developmentOvernightTrades"],
            "validationOvernightTrades": result["validationOvernightTrades"],
        })
        if development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))
    development_survivors.sort(
        key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = [
        item for item in development_survivors[:30]
        if validation_pass(item[2], baseline)
    ]
    validation_survivors.sort(key=lambda item: selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V39_NO_VALIDATED_OVERNIGHT_OPEN_ROUTER"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V39_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V39_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "accepted": accepted,
            "audit": result,
        }

    diagnostics.sort(
        key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v14.rounded({
        "version": 39,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "topDevelopmentDiagnostics": diagnostics[:15],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "signalSource": "ASTER_24H_OVERNIGHT_AND_OPENING_HOUR",
            "entryNy": "10:30",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "v11EqPriority": True,
            "v19SequentialWhenNonOverlapping": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopThirty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": {
            "aligned": aligned_diag,
            "aster24h": market_diag,
            "commonSessions": len(common),
        },
        "v11Diagnostics": v11_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V39 Overnight-Open Router",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner = result["winner"]
        audit_result = winner["audit"]
        lines.extend([
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {audit_result['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {audit_result['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {audit_result['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {audit_result['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation overnight trades: {audit_result['validationOvernightTrades']}",
            "",
        ])
    lines.extend(["Research only. No Production, LIVE, VPS or order state was changed.", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
