from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import v96_stock_cross_venue_maker_v13_hold_duration as hold

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13_PROFIT_PURSUIT"
INTERVAL = "30m"
STEP_MS = 30 * 60 * 1000
TARGET_EXIT_MINUTE = 15 * 60
EARLY_EXIT_MINUTE = 14 * 60 + 30
EARLY_DECISION_MINUTE = 14 * 60
ENTRY_CUTOFF_MINUTE = 10 * 60 + 30
MIN_DEVELOPMENT_CYCLES = 10
MIN_VALIDATION_CYCLES = 5

hold.base.INTERVAL_MS[INTERVAL] = STEP_MS

ENTRY_MODES = (
    "BOTH",
    "ASYMMETRIC",
    "BUY_ONLY",
)
EXIT_MODES = (
    "FIXED_1500",
    "LATE_TP30",
    "LATE_HALF_CONVERGENCE",
    "LATE_ZERO_OR_6",
    "LATE_ANY_PROFIT",
)
EXIT_PRIORITY = {name: index for index, name in enumerate(EXIT_MODES)}


def local_parts(ts_ms: int) -> Tuple[str, int, int]:
    local = dt.datetime.fromtimestamp(ts_ms / 1000, tz=hold.base.UTC).astimezone(hold.base.NY)
    return local.date().isoformat(), local.hour * 60 + local.minute, local.weekday()


def fixed_clock_ts(reference_ts: int, minute: int) -> int:
    local = dt.datetime.fromtimestamp(reference_ts / 1000, tz=hold.base.UTC).astimezone(hold.base.NY)
    target = local.replace(hour=minute // 60, minute=minute % 60, second=0, microsecond=0)
    return int(target.astimezone(hold.base.UTC).timestamp() * 1000)


def contiguous_regular(common_set: set[int], start_ts: int, end_ts: int) -> bool:
    day = hold.base.day_string(start_ts)
    cursor = start_ts
    while cursor <= end_ts:
        if cursor not in common_set:
            return False
        if not hold.base.regular_bar_start(cursor):
            return False
        if hold.base.day_string(cursor) != day:
            return False
        cursor += STEP_MS
    return True


def load_data(cache_dir: Path) -> Tuple[dict, dict]:
    raw: Dict[Tuple[str, str], Sequence] = {}
    funding_raw: Dict[Tuple[str, str], Sequence] = {}
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for symbol in hold.base.SYMBOLS:
            jobs.extend([
                ("ASTER", symbol, "bars", pool.submit(hold.base.fetch_aster, symbol, INTERVAL, cache_dir)),
                ("XYZ", symbol, "bars", pool.submit(hold.base.fetch_xyz, symbol, INTERVAL, cache_dir)),
                ("ASTER", symbol, "funding", pool.submit(hold.fetch_aster_funding, symbol, cache_dir)),
                ("XYZ", symbol, "funding", pool.submit(hold.fetch_xyz_funding, symbol, cache_dir)),
            ])
        for venue, symbol, kind, future in jobs:
            payload = future.result()
            if kind == "bars":
                raw[(venue, symbol)] = payload
            else:
                funding_raw[(venue, symbol)] = payload
            print(f"loaded {venue} {symbol} {kind}: {len(payload)}")

    parsed = {}
    diagnostics = {}
    for symbol in hold.base.SYMBOLS:
        aster = hold.base.parse_aster(raw[("ASTER", symbol)])
        xyz = hold.base.parse_xyz(raw[("XYZ", symbol)])
        aster_funding = hold.parse_funding(
            funding_raw[("ASTER", symbol)], "fundingTime", ("fundingRate", "funding")
        )
        xyz_funding = hold.parse_funding(
            funding_raw[("XYZ", symbol)], "time", ("fundingRate", "funding")
        )
        common = sorted(set(aster) & set(xyz))
        parsed[symbol] = {
            "aster": aster,
            "xyz": xyz,
            "asterFunding": aster_funding,
            "xyzFunding": xyz_funding,
            "common": common,
            "commonSet": set(common),
        }
        regular_days = sorted({hold.base.day_string(ts) for ts in common if hold.base.regular_bar_start(ts)})
        diagnostics[symbol] = {
            "asterBars": len(aster),
            "xyzBars": len(xyz),
            "alignedBars": len(common),
            "regularSessions": len(regular_days),
            "firstAligned": dt.datetime.fromtimestamp(common[0] / 1000, tz=hold.base.UTC).isoformat() if common else None,
            "lastAligned": dt.datetime.fromtimestamp(common[-1] / 1000, tz=hold.base.UTC).isoformat() if common else None,
        }
    return parsed, diagnostics


def entry_allowed(mode: str, maker_side: int, quote_minute: int) -> bool:
    if quote_minute > ENTRY_CUTOFF_MINUTE:
        return False
    if mode == "BUY_ONLY":
        return maker_side > 0
    if mode == "ASYMMETRIC":
        return maker_side > 0 or quote_minute == 10 * 60
    return True


def candidate_at(symbol: str, signal_ts: int, mode: str, data: dict) -> Optional[dict]:
    node = data[symbol]
    aster = node["aster"]
    xyz = node["xyz"]
    common_set = node["commonSet"]
    quote_ts = signal_ts + STEP_MS
    if signal_ts not in common_set or quote_ts not in common_set:
        return None
    if not hold.base.regular_bar_start(signal_ts) or not hold.base.regular_bar_start(quote_ts):
        return None
    _, quote_minute, _ = local_parts(quote_ts)
    aster_signal = aster[signal_ts]
    xyz_signal = xyz[signal_ts]
    spread_bps = (aster_signal["close"] / xyz_signal["close"] - 1.0) * 10_000.0
    if abs(spread_bps) < hold.base.ENTRY_EDGE_BPS:
        return None
    maker_side = -1 if spread_bps > 0 else 1
    if not entry_allowed(mode, maker_side, quote_minute):
        return None
    target_exit_ts = fixed_clock_ts(quote_ts, TARGET_EXIT_MINUTE)
    if target_exit_ts <= quote_ts:
        return None
    if not contiguous_regular(common_set, quote_ts, target_exit_ts):
        return None
    maker_quote = aster_signal["close"]
    maker_quote_bar = aster[quote_ts]
    capacity = maker_quote_bar["volume"] * maker_quote_bar["close"]
    if capacity < hold.base.QUEUE_PLUS_ORDER_USD:
        return None
    if not hold.base.fill_reached(maker_side, maker_quote, maker_quote_bar, "OPEN_CROSS_STRICT"):
        return None
    return {
        "symbol": symbol,
        "signalTs": signal_ts,
        "quoteTs": quote_ts,
        "targetExitTs": target_exit_ts,
        "spreadBps": spread_bps,
        "makerSide": maker_side,
        "makerQuotePrice": maker_quote,
        "hedgeOpenPrice": xyz[quote_ts]["open"],
        "makerBarVolumeCapacityUsd": capacity,
    }


def realized_price_bps(candidate: dict, exit_ts: int, data: dict, use_close: bool = False) -> float:
    node = data[candidate["symbol"]]
    field = "close" if use_close else "open"
    maker_side = candidate["makerSide"]
    hedge_side = -maker_side
    quantity = hold.base.NOTIONAL_USD / candidate["makerQuotePrice"]
    pnl = quantity * (
        maker_side * (node["aster"][exit_ts][field] - candidate["makerQuotePrice"])
        + hedge_side * (node["xyz"][exit_ts][field] - candidate["hedgeOpenPrice"])
    )
    return pnl / hold.base.NOTIONAL_USD * 10_000.0


def choose_exit(candidate: dict, exit_mode: str, data: dict) -> Tuple[int, str, Optional[float]]:
    target_exit_ts = candidate["targetExitTs"]
    if exit_mode == "FIXED_1500":
        return target_exit_ts, "FIXED_1500", None
    early_exit_ts = fixed_clock_ts(candidate["quoteTs"], EARLY_EXIT_MINUTE)
    decision_ts = fixed_clock_ts(candidate["quoteTs"], EARLY_DECISION_MINUTE)
    node = data[candidate["symbol"]]
    if decision_ts < candidate["quoteTs"] or early_exit_ts <= candidate["quoteTs"]:
        return target_exit_ts, "FIXED_1500", None
    if decision_ts not in node["commonSet"] or early_exit_ts not in node["commonSet"]:
        return target_exit_ts, "FIXED_1500", None
    decision_price_bps = realized_price_bps(candidate, decision_ts, data, use_close=True)
    decision_spread = (
        node["aster"][decision_ts]["close"] / node["xyz"][decision_ts]["close"] - 1.0
    ) * 10_000.0
    initial = candidate["spreadBps"]
    trigger = False
    if exit_mode == "LATE_TP30":
        trigger = decision_price_bps >= 30.0
    elif exit_mode == "LATE_HALF_CONVERGENCE":
        trigger = abs(decision_spread) <= 0.5 * abs(initial)
    elif exit_mode == "LATE_ZERO_OR_6":
        trigger = decision_spread * initial <= 0.0 or abs(decision_spread) <= 6.0
    elif exit_mode == "LATE_ANY_PROFIT":
        trigger = decision_price_bps > 0.0
    if trigger:
        return early_exit_ts, exit_mode, decision_price_bps
    return target_exit_ts, "FIXED_1500", decision_price_bps


def realize(candidate: dict, entry_mode: str, exit_mode: str, data: dict) -> dict:
    node = data[candidate["symbol"]]
    exit_ts, exit_reason, decision_price_bps = choose_exit(candidate, exit_mode, data)
    maker_side = candidate["makerSide"]
    hedge_side = -maker_side
    price_bps = realized_price_bps(candidate, exit_ts, data)
    aster_funding_bps = -maker_side * hold.funding_between(
        node["asterFunding"], candidate["quoteTs"], exit_ts
    ) * 10_000.0
    xyz_funding_bps = -hedge_side * hold.funding_between(
        node["xyzFunding"], candidate["quoteTs"], exit_ts
    ) * 10_000.0
    gross_bps = price_bps + aster_funding_bps + xyz_funding_bps
    day, quote_minute, _ = local_parts(candidate["quoteTs"])
    return {
        "candidateId": f"{entry_mode}__{exit_mode}",
        "entryMode": entry_mode,
        "exitMode": exit_mode,
        "symbol": candidate["symbol"],
        "day": day,
        "signalTs": candidate["signalTs"],
        "quoteTs": candidate["quoteTs"],
        "exitTs": exit_ts,
        "quoteMinuteNy": quote_minute,
        "spreadBps": candidate["spreadBps"],
        "makerSide": "BUY" if maker_side > 0 else "SELL",
        "makerQuotePrice": candidate["makerQuotePrice"],
        "hedgeOpenPrice": candidate["hedgeOpenPrice"],
        "makerExitPrice": node["aster"][exit_ts]["open"],
        "hedgeExitPrice": node["xyz"][exit_ts]["open"],
        "makerBarVolumeCapacityUsd": candidate["makerBarVolumeCapacityUsd"],
        "holdingMinutes": (exit_ts - candidate["quoteTs"]) // 60_000,
        "exitReason": exit_reason,
        "decisionPriceBps": decision_price_bps,
        "priceGrossBps": price_bps,
        "asterFundingBps": aster_funding_bps,
        "xyzFundingBps": xyz_funding_bps,
        "grossBps": gross_bps,
    }


def simulate(entry_mode: str, exit_mode: str, data: dict) -> List[dict]:
    all_signals = sorted(set().union(*(set(node["common"]) for node in data.values())))
    rows: List[dict] = []
    portfolio_free_ts = -1
    for signal_ts in all_signals:
        if signal_ts < portfolio_free_ts:
            continue
        simultaneous = []
        for symbol in hold.base.SYMBOLS:
            candidate = candidate_at(symbol, signal_ts, entry_mode, data)
            if candidate is not None:
                simultaneous.append(candidate)
        if not simultaneous:
            continue
        selected = max(simultaneous, key=lambda row: (abs(row["spreadBps"]), row["symbol"]))
        trade = realize(selected, entry_mode, exit_mode, data)
        rows.append(trade)
        portfolio_free_ts = trade["exitTs"] + STEP_MS
    return rows


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    if losses > 1e-12:
        return gains / losses
    return 999.0 if gains > 0 else None


def summarize(trades: Sequence[dict], cost_bps: float) -> dict:
    nets = [float(row["grossBps"]) - cost_bps for row in trades]
    return {
        "cycles": len(nets),
        "sessions": len({row["day"] for row in trades}),
        "averageGrossBps": statistics.mean(float(row["grossBps"]) for row in trades) if trades else None,
        "averageNetBps": statistics.mean(nets) if nets else None,
        "medianNetBps": statistics.median(nets) if nets else None,
        "positiveNetRate": sum(value > 0 for value in nets) / len(nets) if nets else None,
        "profitFactor": profit_factor(nets),
        "totalNetBps": sum(nets),
        "minimumNetBps": min(nets) if nets else None,
        "maximumNetBps": max(nets) if nets else None,
        "averageHoldingMinutes": statistics.mean(float(row["holdingMinutes"]) for row in trades) if trades else None,
        "earlyExitRate": sum(row["exitReason"] != "FIXED_1500" for row in trades) / len(trades) if trades else None,
    }


def fixed_bounds(days: Sequence[str]) -> dict:
    ordered = sorted(set(days))
    dev_end = max(1, int(len(ordered) * 0.60))
    val_end = max(dev_end + 1, int(len(ordered) * 0.80))
    return {
        "DEVELOPMENT": (ordered[0], ordered[dev_end - 1]),
        "VALIDATION": (ordered[dev_end], ordered[val_end - 1]),
        "HOLDOUT": (ordered[val_end], ordered[-1]),
    }


def subset(trades: Sequence[dict], bounds: Tuple[str, str]) -> List[dict]:
    return [row for row in trades if bounds[0] <= row["day"] <= bounds[1]]


def scenario_report(trades: Sequence[dict], bounds: dict, costs: Dict[str, float]) -> dict:
    return {
        "full": {name: summarize(trades, cost) for name, cost in costs.items()},
        "periods": {
            period: {name: summarize(subset(trades, period_bounds), cost) for name, cost in costs.items()}
            for period, period_bounds in bounds.items()
        },
    }


def score(node: dict) -> float:
    normal = node["NORMAL"]
    p95 = node["P95"]
    severe = node["SEVERE"]
    return (
        float(normal.get("averageNetBps") or -999.0)
        + float(p95.get("averageNetBps") or -999.0)
        + 0.5 * float(severe.get("averageNetBps") or -999.0)
        + 2.0 * ((normal.get("profitFactor") or 0.0) - 1.0)
    )


def concentration(trades: Sequence[dict], cost_bps: float) -> dict:
    totals = {symbol: 0.0 for symbol in hold.base.SYMBOLS}
    counts = {symbol: 0 for symbol in hold.base.SYMBOLS}
    for row in trades:
        totals[row["symbol"]] += float(row["grossBps"]) - cost_bps
        counts[row["symbol"]] += 1
    positive = {symbol: max(0.0, value) for symbol, value in totals.items()}
    positive_sum = sum(positive.values())
    return {
        "cyclesBySymbol": counts,
        "netBpsBySymbol": totals,
        "maxPositiveProfitContributionShare": max(positive.values()) / positive_sum if positive_sum > 0 else None,
    }


def portfolio_metrics(trades: Sequence[dict], cost_bps: float) -> dict:
    by_day: Dict[str, float] = defaultdict(float)
    for row in trades:
        by_day[row["day"]] += (float(row["grossBps"]) - cost_bps) / 10_000.0
    equity = peak = 1.0
    max_dd = 0.0
    for day in sorted(by_day):
        equity *= max(0.001, 1.0 + by_day[day])
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "activeDays": len(by_day),
    }


def removal_tests(trades: Sequence[dict], cost_bps: float) -> dict:
    if not trades:
        return {}
    values = [float(row["grossBps"]) - cost_bps for row in trades]
    best_index = max(range(len(trades)), key=lambda index: values[index])
    best_removed = [row for index, row in enumerate(trades) if index != best_index]
    monthly: Dict[str, List[dict]] = defaultdict(list)
    for row in trades:
        monthly[row["day"][:7]].append(row)
    best_month = max(monthly, key=lambda month: sum(float(row["grossBps"]) - cost_bps for row in monthly[month]))
    month_removed = [row for row in trades if row["day"][:7] != best_month]
    return {
        "bestTrade": {
            "symbol": trades[best_index]["symbol"],
            "day": trades[best_index]["day"],
            "netBps": values[best_index],
        },
        "bestTradeRemoved": summarize(best_removed, cost_bps),
        "bestMonth": best_month,
        "bestMonthRemoved": summarize(month_removed, cost_bps),
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, tuple):
        return [rounded(item) for item in value]
    return value


def analyze(cache_dir: Path) -> dict:
    data, diagnostics = load_data(cache_dir)
    available_days = sorted({
        hold.base.day_string(ts)
        for node in data.values()
        for ts in node["common"]
        if hold.base.regular_bar_start(ts)
    })
    bounds = fixed_bounds(available_days)

    entry_results = {}
    for entry_mode in ENTRY_MODES:
        trades = simulate(entry_mode, "FIXED_1500", data)
        entry_results[entry_mode] = scenario_report(trades, bounds, hold.base.FORCED_TAKER_COSTS)

    development_eligible = []
    for entry_mode, report in entry_results.items():
        node = report["periods"]["DEVELOPMENT"]
        if (
            node["NORMAL"]["cycles"] >= MIN_DEVELOPMENT_CYCLES
            and (node["NORMAL"].get("averageNetBps") or -999.0) > 0
            and (node["P95"].get("averageNetBps") or -999.0) > 0
        ):
            development_eligible.append((score(node), entry_mode))
    selected_entry = max(development_eligible)[1] if development_eligible else "ASYMMETRIC"

    exit_results = {}
    exit_trades = {}
    for exit_mode in EXIT_MODES:
        trades = simulate(selected_entry, exit_mode, data)
        exit_trades[exit_mode] = trades
        exit_results[exit_mode] = scenario_report(trades, bounds, hold.base.FORCED_TAKER_COSTS)

    validation_eligible = []
    for exit_mode, report in exit_results.items():
        node = report["periods"]["VALIDATION"]
        if (
            node["NORMAL"]["cycles"] >= MIN_VALIDATION_CYCLES
            and (node["NORMAL"].get("averageNetBps") or -999.0) > 0
            and (node["P95"].get("averageNetBps") or -999.0) > 0
        ):
            validation_eligible.append((score(node), -EXIT_PRIORITY[exit_mode], exit_mode))
    selected_exit = max(validation_eligible)[2] if validation_eligible else "FIXED_1500"
    selected_trades = exit_trades[selected_exit]

    selected_forced = scenario_report(selected_trades, bounds, hold.base.FORCED_TAKER_COSTS)
    selected_two_maker = scenario_report(selected_trades, bounds, hold.base.TWO_MAKER_COSTS)
    holdout = selected_forced["periods"]["HOLDOUT"]
    full_normal = selected_forced["full"]["NORMAL"]
    concentration_normal = concentration(selected_trades, hold.base.FORCED_TAKER_COSTS["NORMAL"])

    holdout_pass = bool(
        holdout["NORMAL"]["cycles"] >= MIN_VALIDATION_CYCLES
        and all((holdout[name].get("averageNetBps") or -999.0) > 0 for name in ("NORMAL", "P95", "SEVERE"))
        and (holdout["NORMAL"].get("positiveNetRate") or 0.0) >= 0.55
        and (holdout["NORMAL"].get("profitFactor") or 0.0) > 1.0
    )
    concentration_pass = bool(
        concentration_normal["maxPositiveProfitContributionShare"] is not None
        and concentration_normal["maxPositiveProfitContributionShare"] <= 0.40
    )
    status = (
        "V13G_REUSED_HISTORY_LEAD_FORWARD_EXECUTION_REQUIRED"
        if holdout_pass and concentration_pass
        else "V13G_REUSED_HISTORY_LEAD_REMAINS_CONCENTRATED_OR_STRESS_WEAK"
    )

    return rounded({
        "version": 13,
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(hold.base.UTC).isoformat(),
        "fixedDataEndUtc": hold.base.FIXED_END_UTC.isoformat(),
        "status": status,
        "universe": list(hold.base.SYMBOLS),
        "data": {
            "interval": INTERVAL,
            "regularSessions": len(available_days),
            "firstSession": available_days[0],
            "lastSession": available_days[-1],
            "diagnostics": diagnostics,
        },
        "chronology": bounds,
        "entryTournament": {
            "modes": list(ENTRY_MODES),
            "selectedOnDevelopment": selected_entry,
            "results": entry_results,
        },
        "exitTournament": {
            "modes": list(EXIT_MODES),
            "selectedOnValidation": selected_exit,
            "results": exit_results,
        },
        "selected": {
            "entryMode": selected_entry,
            "exitMode": selected_exit,
            "forcedTakerCosts": selected_forced,
            "twoMakerSensitivity": selected_two_maker,
            "concentrationNormal": concentration_normal,
            "portfolioNormal": portfolio_metrics(selected_trades, hold.base.FORCED_TAKER_COSTS["NORMAL"]),
            "removalNormal": removal_tests(selected_trades, hold.base.FORCED_TAKER_COSTS["NORMAL"]),
            "holdoutPass": holdout_pass,
            "concentrationPass": concentration_pass,
            "fullNormalPositiveRate": full_normal.get("positiveNetRate"),
        },
        "rules": {
            "makerVenue": "ASTER",
            "hedgeVenue": "XYZ",
            "entryDislocationBps": hold.base.ENTRY_EDGE_BPS,
            "entryCutoffNy": "10:30",
            "onePositionTotal": True,
            "simultaneousSelection": "largest absolute spread among symbols available at the same timestamp only",
            "asymmetricDirection": "Aster discount BUY at 10:00/10:30; Aster premium SELL only at 10:00",
            "targetExitNy": "15:00",
            "lateDecision": "at completed 14:00 bar, if pair price PnL is at least 30 bps, exit at 14:30",
            "fundingIncluded": True,
            "noOvernight": True,
            "lookaheadSelection": False,
        },
        "selectionDiscipline": {
            "entryStructure": "Development only",
            "exitOverlay": "Validation only",
            "finalEvaluation": "Holdout once within this workflow",
            "independentHoldoutClaim": False,
            "reason": "the 74-session V12/V12B history and prior duration results were already inspected",
            "nearbyRetuningAllowed": False,
        },
        "limitations": [
            "Historical candles cannot reconstruct displayed queue, cancellations, aggressor direction, partial fills, exact bid/ask or the 250 ms hedge path.",
            "The final period is reused historical evidence, not an independent untouched Holdout.",
            "Two-Maker costs are sensitivity only because a historical second Maker fill cannot be proven.",
            "No result authorizes Production or LIVE; untouched Forward execution evidence is mandatory.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11Changed": False,
            "forwardCollectorChanged": False,
        },
        "trades": selected_trades,
    })


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    trades = result.pop("trades", [])
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "trades.json").write_text(json.dumps(trades, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    selected = result.get("selected", {})
    lines = [
        "# V13 Profit Pursuit Historical Tournament",
        "",
        f"- Status: **{result.get('status')}**",
        f"- Entry selected on Development: **{selected.get('entryMode')}**",
        f"- Exit selected on Validation: **{selected.get('exitMode')}**",
        "- Production / LIVE / VPS / Crypto V96 / V11 / Forward collector changed: **NO**",
    ]
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert ENTRY_CUTOFF_MINUTE == 630
    assert TARGET_EXIT_MINUTE == 900
    assert EARLY_DECISION_MINUTE == 840
    assert EARLY_EXIT_MINUTE == 870
    assert entry_allowed("ASYMMETRIC", 1, 630)
    assert not entry_allowed("ASYMMETRIC", -1, 630)
    assert entry_allowed("ASYMMETRIC", -1, 600)
    assert not entry_allowed("BOTH", 1, 660)
    assert EXIT_PRIORITY["LATE_TP30"] < EXIT_PRIORITY["LATE_ZERO_OR_6"]
    print("V13 profit-pursuit self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v13-profit-pursuit")
    parser.add_argument("--output-dir", default=".research-state/v13-profit-pursuit")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cache_dir))
    write_outputs(result, Path(args.output_dir))
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "entryMode": result["selected"]["entryMode"],
        "exitMode": result["selected"]["exitMode"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
