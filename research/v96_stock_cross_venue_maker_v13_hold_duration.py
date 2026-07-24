from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import v96_stock_cross_venue_maker_v13_historical_proxy as base

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13_LONGER_HOLD"
INTERVAL = "30m"
STEP_MS = 30 * 60 * 1000
HOLD_MINUTES = (30, 60, 120, 180, 240, 300)
MAKER_VENUES = ("ASTER", "XYZ")
ASTER_FUNDING_URL = "https://fapi.asterdex.com/fapi/v1/fundingRate"
MIN_DEVELOPMENT_CYCLES = 20
MIN_REVIEW_CYCLES = 8
MIN_REVIEW_SESSIONS = 4

base.INTERVAL_MS[INTERVAL] = STEP_MS


def finite(value: object) -> Optional[float]:
    return base.finite(value)


def fetch_aster_funding(symbol: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"aster-{symbol}-funding-{base.FIXED_END_UTC.date()}.json"
    cached = base.cache_read(path)
    if isinstance(cached, list):
        return cached
    cursor = base.start_ms(INTERVAL)
    stop = base.end_ms()
    rows: List[dict] = []
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": base.ASTER_SYMBOL[symbol],
            "startTime": cursor,
            "endTime": stop,
            "limit": 1000,
        })
        payload = base.request_json(f"{ASTER_FUNDING_URL}?{query}")
        page = [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []
        if not page:
            break
        rows.extend(page)
        latest = max(int(row.get("fundingTime", 0)) for row in page)
        next_cursor = latest + 1
        if next_cursor <= cursor or len(page) < 1000:
            break
        cursor = next_cursor
        time.sleep(0.05)
    dedup = {int(row["fundingTime"]): row for row in rows if int(row.get("fundingTime", 0)) > 0}
    result = [dedup[key] for key in sorted(dedup)]
    base.cache_write(path, result)
    return result


def fetch_xyz_funding(symbol: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"xyz-{symbol}-funding-{base.FIXED_END_UTC.date()}.json"
    cached = base.cache_read(path)
    if isinstance(cached, list):
        return cached
    cursor = base.start_ms(INTERVAL)
    stop = base.end_ms()
    rows: List[dict] = []
    for _ in range(40):
        payload = base.request_json(base.XYZ_INFO_URL, {
            "type": "fundingHistory",
            "coin": base.XYZ_COIN[symbol],
            "startTime": cursor,
            "endTime": stop,
        })
        page = [row for row in payload if isinstance(row, dict) and row.get("time") is not None] if isinstance(payload, list) else []
        if not page:
            break
        rows.extend(page)
        next_cursor = max(int(row["time"]) for row in page) + 1
        if next_cursor <= cursor or next_cursor > stop or len(page) < 500:
            break
        cursor = next_cursor
        time.sleep(0.05)
    dedup = {int(row["time"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    base.cache_write(path, result)
    return result


def parse_funding(rows: Sequence[dict], time_key: str, rate_keys: Sequence[str]) -> List[Tuple[int, float]]:
    result: List[Tuple[int, float]] = []
    for row in rows:
        ts = int(row.get(time_key, 0))
        rate = None
        for key in rate_keys:
            rate = finite(row.get(key))
            if rate is not None:
                break
        if ts > 0 and rate is not None:
            result.append((ts, rate))
    return sorted(result)


def funding_between(points: Sequence[Tuple[int, float]], start_ts: int, end_ts: int) -> float:
    return sum(rate for ts, rate in points if start_ts <= ts < end_ts)


def contiguous_regular(common_set: set[int], quote_ts: int, exit_ts: int) -> bool:
    cursor = quote_ts
    quote_day = base.day_string(quote_ts)
    while cursor <= exit_ts:
        if cursor not in common_set or not base.regular_bar_start(cursor) or base.day_string(cursor) != quote_day:
            return False
        cursor += STEP_MS
    return True


def build_trades(
    symbol: str,
    aster: Dict[int, dict],
    xyz: Dict[int, dict],
    aster_funding: Sequence[Tuple[int, float]],
    xyz_funding: Sequence[Tuple[int, float]],
    maker_venue: str,
    hold_minutes: int,
) -> List[dict]:
    hold_bars = hold_minutes // 30
    common = sorted(set(aster) & set(xyz))
    common_set = set(common)
    rows: List[dict] = []
    next_free_ts = -1
    for signal_ts in common:
        quote_ts = signal_ts + STEP_MS
        exit_ts = quote_ts + hold_bars * STEP_MS
        if signal_ts < next_free_ts:
            continue
        if not base.regular_bar_start(signal_ts):
            continue
        if not contiguous_regular(common_set, quote_ts, exit_ts):
            continue
        a_signal, x_signal = aster[signal_ts], xyz[signal_ts]
        spread_bps = (a_signal["close"] / x_signal["close"] - 1.0) * 10_000.0
        if abs(spread_bps) < base.ENTRY_EDGE_BPS:
            continue
        maker_signal = a_signal if maker_venue == "ASTER" else x_signal
        maker_quote_bar = aster[quote_ts] if maker_venue == "ASTER" else xyz[quote_ts]
        hedge_quote_bar = xyz[quote_ts] if maker_venue == "ASTER" else aster[quote_ts]
        maker_exit_bar = aster[exit_ts] if maker_venue == "ASTER" else xyz[exit_ts]
        hedge_exit_bar = xyz[exit_ts] if maker_venue == "ASTER" else aster[exit_ts]
        maker_side = base.side_for(spread_bps, maker_venue)
        hedge_side = -maker_side
        quote_price = maker_signal["close"]
        volume_capacity_usd = maker_quote_bar["volume"] * maker_quote_bar["close"]
        if volume_capacity_usd < base.QUEUE_PLUS_ORDER_USD:
            continue
        if not base.fill_reached(maker_side, quote_price, maker_quote_bar, "OPEN_CROSS_STRICT"):
            continue
        quantity = base.NOTIONAL_USD / quote_price
        hedge_open = hedge_quote_bar["open"]
        maker_exit = maker_exit_bar["open"]
        hedge_exit = hedge_exit_bar["open"]
        gross_price_pnl = quantity * (
            maker_side * (maker_exit - quote_price)
            + hedge_side * (hedge_exit - hedge_open)
        )
        aster_side = maker_side if maker_venue == "ASTER" else hedge_side
        xyz_side = hedge_side if maker_venue == "ASTER" else maker_side
        aster_funding_bps = -aster_side * funding_between(aster_funding, quote_ts, exit_ts) * 10_000.0
        xyz_funding_bps = -xyz_side * funding_between(xyz_funding, quote_ts, exit_ts) * 10_000.0
        price_gross_bps = gross_price_pnl / base.NOTIONAL_USD * 10_000.0
        gross_bps = price_gross_bps + aster_funding_bps + xyz_funding_bps
        rows.append({
            "candidateId": f"{maker_venue}_MAKER_H{hold_minutes}",
            "symbol": symbol,
            "day": base.day_string(quote_ts),
            "signalTs": signal_ts,
            "quoteTs": quote_ts,
            "exitTs": exit_ts,
            "makerVenue": maker_venue,
            "holdMinutes": hold_minutes,
            "spreadBps": spread_bps,
            "makerSide": "BUY" if maker_side > 0 else "SELL",
            "makerQuotePrice": quote_price,
            "hedgeOpenPrice": hedge_open,
            "makerExitPrice": maker_exit,
            "hedgeExitPrice": hedge_exit,
            "quantity": quantity,
            "makerBarVolumeCapacityUsd": volume_capacity_usd,
            "priceGrossBps": price_gross_bps,
            "asterFundingBps": aster_funding_bps,
            "xyzFundingBps": xyz_funding_bps,
            "grossBps": gross_bps,
        })
        next_free_ts = exit_ts + STEP_MS
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
        "averagePriceGrossBps": statistics.mean(float(row["priceGrossBps"]) for row in trades) if trades else None,
        "averageFundingBps": statistics.mean(float(row["asterFundingBps"]) + float(row["xyzFundingBps"]) for row in trades) if trades else None,
        "averageNetBps": statistics.mean(nets) if nets else None,
        "medianNetBps": statistics.median(nets) if nets else None,
        "positiveNetRate": sum(value > 0 for value in nets) / len(nets) if nets else None,
        "profitFactor": profit_factor(nets),
        "totalNetBps": sum(nets),
        "minimumNetBps": min(nets) if nets else None,
        "maximumNetBps": max(nets) if nets else None,
    }


def split_bounds(days: Sequence[str]) -> dict:
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


def report_candidate(trades: Sequence[dict], bounds: dict, costs: Dict[str, float]) -> dict:
    return {
        "full": {name: summarize(trades, cost) for name, cost in costs.items()},
        "periods": {
            period: {name: summarize(subset(trades, interval), cost) for name, cost in costs.items()}
            for period, interval in bounds.items()
        },
    }


def period_pass(node: dict, min_cycles: int) -> bool:
    normal = node["NORMAL"]
    return bool(
        normal["cycles"] >= min_cycles
        and normal["sessions"] >= MIN_REVIEW_SESSIONS
        and all(node[name]["averageNetBps"] is not None and node[name]["averageNetBps"] > 0 for name in ("NORMAL", "P95", "SEVERE"))
        and normal["positiveNetRate"] is not None
        and normal["positiveNetRate"] >= 0.55
        and (normal["profitFactor"] or 0.0) > 1.0
    )


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
    raw: Dict[Tuple[str, str], Sequence] = {}
    funding_raw: Dict[Tuple[str, str], Sequence] = {}
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for symbol in base.SYMBOLS:
            jobs.extend([
                ("ASTER", symbol, "bars", pool.submit(base.fetch_aster, symbol, INTERVAL, cache_dir)),
                ("XYZ", symbol, "bars", pool.submit(base.fetch_xyz, symbol, INTERVAL, cache_dir)),
                ("ASTER", symbol, "funding", pool.submit(fetch_aster_funding, symbol, cache_dir)),
                ("XYZ", symbol, "funding", pool.submit(fetch_xyz_funding, symbol, cache_dir)),
            ])
        for venue, symbol, kind, future in jobs:
            payload = future.result()
            if kind == "bars":
                raw[(venue, symbol)] = payload
            else:
                funding_raw[(venue, symbol)] = payload
            print(f"loaded {venue} {symbol} {kind}: {len(payload)}")

    parsed: Dict[Tuple[str, str], Dict[int, dict]] = {}
    funding: Dict[Tuple[str, str], List[Tuple[int, float]]] = {}
    diagnostics: Dict[str, dict] = {}
    all_days = set()
    for symbol in base.SYMBOLS:
        aster = base.parse_aster(raw[("ASTER", symbol)])
        xyz = base.parse_xyz(raw[("XYZ", symbol)])
        parsed[("ASTER", symbol)] = aster
        parsed[("XYZ", symbol)] = xyz
        funding[("ASTER", symbol)] = parse_funding(funding_raw[("ASTER", symbol)], "fundingTime", ("fundingRate",))
        funding[("XYZ", symbol)] = parse_funding(funding_raw[("XYZ", symbol)], "time", ("fundingRate", "funding"))
        common = sorted(set(aster) & set(xyz))
        regular_days = sorted({base.day_string(ts) for ts in common if base.regular_bar_start(ts)})
        all_days.update(regular_days)
        diagnostics[symbol] = {
            "asterBars": len(aster),
            "xyzBars": len(xyz),
            "alignedBars": len(common),
            "regularSessions": len(regular_days),
            "asterFundingRows": len(funding[("ASTER", symbol)]),
            "xyzFundingRows": len(funding[("XYZ", symbol)]),
            "firstAligned": dt.datetime.fromtimestamp(common[0] / 1000, tz=base.UTC).isoformat() if common else None,
            "lastAligned": dt.datetime.fromtimestamp(common[-1] / 1000, tz=base.UTC).isoformat() if common else None,
        }
    days = sorted(all_days)
    bounds = split_bounds(days)

    candidates: Dict[str, dict] = {}
    all_trades: List[dict] = []
    for maker in MAKER_VENUES:
        for hold_minutes in HOLD_MINUTES:
            candidate_id = f"{maker}_MAKER_H{hold_minutes}"
            trades: List[dict] = []
            for symbol in base.SYMBOLS:
                trades.extend(build_trades(symbol, parsed[("ASTER", symbol)], parsed[("XYZ", symbol)], funding[("ASTER", symbol)], funding[("XYZ", symbol)], maker, hold_minutes))
            trades.sort(key=lambda row: (row["quoteTs"], row["symbol"]))
            all_trades.extend(trades)
            forced = report_candidate(trades, bounds, base.FORCED_TAKER_COSTS)
            two_maker = report_candidate(trades, bounds, base.TWO_MAKER_COSTS)
            development_pass = period_pass(forced["periods"]["DEVELOPMENT"], MIN_DEVELOPMENT_CYCLES)
            validation_pass = development_pass and period_pass(forced["periods"]["VALIDATION"], MIN_REVIEW_CYCLES)
            candidates[candidate_id] = {
                "makerVenue": maker,
                "holdMinutes": hold_minutes,
                "developmentPass": development_pass,
                "validationPass": validation_pass,
                "forcedTakerCosts": forced,
                "twoMakerCosts": two_maker,
            }

    validation_pool = [candidate_id for candidate_id, node in candidates.items() if node["validationPass"]]
    selected = None
    if validation_pool:
        selected_id = max(validation_pool, key=lambda candidate_id: (
            candidates[candidate_id]["forcedTakerCosts"]["periods"]["VALIDATION"]["SEVERE"]["averageNetBps"],
            candidates[candidate_id]["forcedTakerCosts"]["periods"]["VALIDATION"]["NORMAL"]["averageNetBps"],
            -candidates[candidate_id]["holdMinutes"],
        ))
        selected_node = candidates[selected_id]
        holdout = selected_node["forcedTakerCosts"]["periods"]["HOLDOUT"]
        selected = {
            "candidateId": selected_id,
            "selectedWithoutHoldout": True,
            "holdoutPass": period_pass(holdout, MIN_REVIEW_CYCLES),
            "metrics": selected_node,
        }

    any_development = any(node["developmentPass"] for node in candidates.values())
    if selected and selected["holdoutPass"]:
        status = "V13_LONGER_HOLD_HISTORICAL_LEAD_FORWARD_EXECUTION_REQUIRED"
    elif validation_pool:
        status = "V13_LONGER_HOLD_VALIDATION_LEAD_FAILED_HOLDOUT"
    elif any_development:
        status = "V13_LONGER_HOLD_DEVELOPMENT_LEAD_FAILED_VALIDATION"
    else:
        status = "V13_LONGER_HOLD_NO_DEVELOPMENT_EDGE"

    result = {
        "version": "13H",
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(base.UTC).isoformat(),
        "fixedDataEndUtc": base.FIXED_END_UTC.isoformat(),
        "universe": list(base.SYMBOLS),
        "data": {
            "interval": INTERVAL,
            "maximumCandlesPerSymbol": base.MAX_XYZ_CANDLES,
            "regularSessions": len(days),
            "periodBounds": bounds,
            "diagnostics": diagnostics,
        },
        "frozenTest": {
            "entryDislocationBps": base.ENTRY_EDGE_BPS,
            "initialNotionalUsd": base.NOTIONAL_USD,
            "minimumMakerBarVolumeCapacityUsd": base.QUEUE_PLUS_ORDER_USD,
            "fillModel": "OPEN_CROSS_STRICT",
            "holdMinutes": list(HOLD_MINUTES),
            "makerVenues": list(MAKER_VENUES),
            "candidateCount": len(candidates),
            "selection": "Development pass, Validation screen, one Holdout evaluation",
            "thresholdRetuning": False,
            "symbolRetuning": False,
            "directionRetuning": False,
            "primaryCostProfile": "FORCED_TAKER",
            "forcedTakerCostBps": base.FORCED_TAKER_COSTS,
            "twoMakerSensitivityCostBps": base.TWO_MAKER_COSTS,
            "fundingIncluded": True,
        },
        "candidates": candidates,
        "developmentPassingCandidateIds": sorted(candidate_id for candidate_id, node in candidates.items() if node["developmentPass"]),
        "validationPassingCandidateIds": sorted(validation_pool),
        "selected": selected,
        "limitations": [
            "Thirty-minute candles cannot reproduce displayed queue, aggressor direction, partial fills, exact bid/ask, or the 250 ms hedge path.",
            "The strict open-cross model is a conservative price-path proxy, not proof of Maker execution.",
            "The 73-session history overlaps the previously inspected V12/V12B period and is not an independent Holdout.",
            "Funding is included from public histories, but exact funding notional and mark-price timing are approximated relative to the 100 USD initial notional.",
            "No historical result replaces the frozen Forward book-and-trade validation.",
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
        "trades": all_trades,
    }
    return rounded(result)


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    trades = result.pop("trades", [])
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "trades.json").write_text(json.dumps(trades, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V13 Longer-Hold Historical Proxy",
        "",
        f"- Status: **{result['status']}**",
        f"- Sessions: {result['data']['regularSessions']}",
        f"- Development passes: {', '.join(result['developmentPassingCandidateIds']) or 'none'}",
        f"- Validation passes: {', '.join(result['validationPassingCandidateIds']) or 'none'}",
        "- Production / LIVE / VPS / Crypto V96 / V11 / Forward collector changed: **NO**",
        "",
        "| Candidate | Dev Normal | Val Normal | Holdout Normal | Full Normal | Full Severe |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for candidate_id, node in sorted(result["candidates"].items()):
        forced = node["forcedTakerCosts"]
        lines.append(f"| {candidate_id} | {forced['periods']['DEVELOPMENT']['NORMAL']['averageNetBps']} | {forced['periods']['VALIDATION']['NORMAL']['averageNetBps']} | {forced['periods']['HOLDOUT']['NORMAL']['averageNetBps']} | {forced['full']['NORMAL']['averageNetBps']} | {forced['full']['SEVERE']['averageNetBps']} |")
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    start = 1_784_901_600_000
    bars_a = {}
    bars_x = {}
    for index in range(12):
        ts = start + index * STEP_MS
        bars_a[ts] = {"open": 102.0, "high": 103.0, "low": 100.0, "close": 102.0, "volume": 10.0}
        bars_x[ts] = {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 10.0}
    bars_a[start + 5 * STEP_MS]["open"] = 100.0
    trades = build_trades("AMZN", bars_a, bars_x, [], [], "ASTER", 120)
    assert trades and trades[0]["holdMinutes"] == 120
    assert trades[0]["grossBps"] > 0
    assert period_pass({
        "NORMAL": {"cycles": 20, "sessions": 5, "averageNetBps": 1.0, "positiveNetRate": 0.6, "profitFactor": 1.2},
        "P95": {"averageNetBps": 0.5},
        "SEVERE": {"averageNetBps": 0.1},
    }, 20)
    print("V13 longer-hold self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v13-hold-duration")
    parser.add_argument("--output-dir", default=".research-state/v13-hold-duration")
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
        "developmentPassing": result["developmentPassingCandidateIds"],
        "validationPassing": result["validationPassingCandidateIds"],
        "selected": result["selected"]["candidateId"] if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
