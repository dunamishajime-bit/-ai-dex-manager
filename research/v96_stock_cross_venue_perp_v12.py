from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import v96_stock_basis_mature_v9 as v9
import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_CROSS_VENUE_PERP_V12"
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
ASTER_SYMBOL = {symbol: f"{symbol}USDT" for symbol in SYMBOLS}
XYZ_COIN = {symbol: f"xyz:{symbol}" for symbol in SYMBOLS}
INTERVAL = "30m"
INTERVAL_MS = 30 * 60 * 1000
SIGNAL_MINUTE = 600
ENTRY_MINUTE = 630
CHECK_CLOSE_STARTS = (660, 720, 780, 840, 900)
EXIT_OPEN_MINUTES = (690, 750, 810, 870, 930)
CONVERGENCE_BPS = 10.0
SPREAD_STOP_MULTIPLE = 1.5
THRESHOLDS_BPS = (10.0, 25.0, 50.0, 100.0)
DIRECTION_MODES = ("BOTH", "ASTER_PREMIUM_ONLY", "ASTER_DISCOUNT_ONLY")
EXIT_MODES = ("TIME", "CONVERGENCE")
XYZ_URL = "https://api.hyperliquid.xyz/info"

# Aster uses the already-observed stock execution assumptions. XYZ adds its
# current public fee tier plus conservative Slippage allowances.
XYZ_ONE_WAY_BPS = {
    "FORWARD_MEDIAN": 3.0,
    "NORMAL": 8.0,
    "FORWARD_P95": 12.0,
    "SEVERE": 25.0,
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_bps: float
    direction_mode: str
    exit_mode: str


CANDIDATES = tuple(
    Candidate(
        candidate_id=f"{direction}__{exit_mode}__T{int(threshold)}",
        family=f"{direction}__{exit_mode}",
        threshold_bps=threshold,
        direction_mode=direction,
        exit_mode=exit_mode,
    )
    for direction in DIRECTION_MODES
    for exit_mode in EXIT_MODES
    for threshold in THRESHOLDS_BPS
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def post_info(payload: dict, timeout: int = 35):
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        XYZ_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "DisDex-V96-Stock-Cross-Venue-V12/1.0",
        },
        method="POST",
    )
    error: Optional[Exception] = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            error = exc
            time.sleep(min(10.0, 0.8 * (2 ** attempt)))
    raise RuntimeError(f"Hyperliquid info request failed: {payload.get('type')}: {error}")


def load_xyz_meta(cache_dir: Path) -> dict:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "xyz-meta.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        payload = post_info({"type": "meta", "dex": "xyz"})
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    universe = payload.get("universe") if isinstance(payload, dict) else None
    names = sorted(str(row.get("name")) for row in universe or [] if isinstance(row, dict) and row.get("name"))
    return {"payload": payload, "names": names}


def fetch_xyz_candles(symbol: str, cache_dir: Path) -> List[dict]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"xyz-{symbol}-{INTERVAL}-{base.END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    payload = post_info({
        "type": "candleSnapshot",
        "req": {
            "coin": XYZ_COIN[symbol],
            "interval": INTERVAL,
            "startTime": int(base.START_UTC.timestamp() * 1000),
            "endTime": int(base.END_UTC.timestamp() * 1000) - 1,
        },
    })
    rows = payload if isinstance(payload, list) else []
    dedup = {int(row.get("t")): row for row in rows if isinstance(row, dict) and row.get("t") is not None}
    result = [dedup[key] for key in sorted(dedup)]
    path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def fetch_xyz_funding(symbol: str, cache_dir: Path) -> List[dict]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"xyz-{symbol}-funding-{base.END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    cursor = int(base.START_UTC.timestamp() * 1000)
    end_ms = int(base.END_UTC.timestamp() * 1000) - 1
    rows: List[dict] = []
    for _ in range(40):
        payload = post_info({
            "type": "fundingHistory",
            "coin": XYZ_COIN[symbol],
            "startTime": cursor,
            "endTime": end_ms,
        })
        page = payload if isinstance(payload, list) else []
        clean = [row for row in page if isinstance(row, dict) and row.get("time") is not None]
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row["time"]) for row in clean) + 1
        if next_cursor <= cursor or next_cursor > end_ms:
            break
        cursor = next_cursor
        if len(clean) < 500:
            break
        time.sleep(0.05)
    dedup = {int(row["time"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def load_xyz(cache_dir: Path) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], dict]:
    meta = load_xyz_meta(cache_dir)
    missing = [symbol for symbol in SYMBOLS if symbol not in meta["names"]]
    candles: Dict[str, List[dict]] = {}
    funding: Dict[str, List[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        candle_futures = {pool.submit(fetch_xyz_candles, symbol, cache_dir): symbol for symbol in SYMBOLS if symbol not in missing}
        for future in concurrent.futures.as_completed(candle_futures):
            symbol = candle_futures[future]
            candles[symbol] = future.result()
            print(f"loaded XYZ candles {symbol}: {len(candles[symbol])}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        funding_futures = {pool.submit(fetch_xyz_funding, symbol, cache_dir): symbol for symbol in SYMBOLS if symbol not in missing}
        for future in concurrent.futures.as_completed(funding_futures):
            symbol = funding_futures[future]
            funding[symbol] = future.result()
            print(f"loaded XYZ funding {symbol}: {len(funding[symbol])}")
    diagnostics = {
        "dex": "xyz",
        "metaNames": meta["names"],
        "missingSymbols": missing,
        "symbols": {
            symbol: {"candles": len(candles.get(symbol, [])), "fundingRows": len(funding.get(symbol, []))}
            for symbol in SYMBOLS
        },
    }
    return candles, funding, diagnostics


def parse_xyz_funding(rows: Sequence[dict]) -> List[Tuple[int, float]]:
    result = []
    for row in rows:
        ts = int(row.get("time", 0))
        rate = finite(row.get("fundingRate", row.get("funding", 0.0)), math.nan)
        if ts > 0 and math.isfinite(rate):
            result.append((ts, rate))
    return sorted(result)


def funding_between(points: Sequence[Tuple[int, float]], start_ts: int, end_ts: int) -> float:
    return sum(rate for ts, rate in points if start_ts < ts <= end_ts)


def xyz_row_map(rows: Sequence[dict]) -> Dict[int, dict]:
    result = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("t") is None:
            continue
        ts = int(row["t"])
        open_price = finite(row.get("o"))
        close_price = finite(row.get("c"))
        if min(open_price, close_price) <= 0:
            continue
        result[ts] = {"ts": ts, "open": open_price, "close": close_price}
    return result


def build_venue_days(
    rows: Dict[int, dict],
    funding_points: Sequence[Tuple[int, float]],
) -> Dict[str, dict]:
    required = {SIGNAL_MINUTE, ENTRY_MINUTE, *CHECK_CLOSE_STARTS, *EXIT_OPEN_MINUTES}
    by_day: Dict[str, dict] = defaultdict(dict)
    for ts, row in rows.items():
        day, minute, weekday = v9.local_parts(ts)
        if weekday >= 5 or minute not in required:
            continue
        by_day[day][minute] = row
    completed = {}
    for day, slots in by_day.items():
        if not required.issubset(slots):
            continue
        signal = slots[SIGNAL_MINUTE]
        entry = slots[ENTRY_MINUTE]
        checks = []
        for check_start, exit_minute in zip(CHECK_CLOSE_STARTS, EXIT_OPEN_MINUTES):
            check_bar = slots[check_start]
            exit_bar = slots[exit_minute]
            checks.append({
                "ts": check_bar["ts"] + INTERVAL_MS,
                "price": check_bar["close"],
                "exit": exit_bar["open"],
                "exitTs": exit_bar["ts"],
            })
        completed[day] = {
            "signal": signal["close"],
            "signalTs": signal["ts"] + INTERVAL_MS,
            "entry": entry["open"],
            "entryTs": entry["ts"],
            "checkpoints": checks,
            "fundingPoints": list(funding_points),
        }
    return completed


def load_aster(cache_dir: Path, funding_cache_dir: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    market = v9.load_market(cache_dir)
    raw_funding = funding_mod.load_funding(funding_cache_dir)
    result = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOLS:
        contract = ASTER_SYMBOL[symbol]
        trade = v9.row_map(market[contract]["trade"])
        funding_points = funding_mod.funding_points(raw_funding.get(contract, []))
        result[symbol] = build_venue_days(
            {ts: {"ts": ts, "open": finite(row[1]), "close": finite(row[4])} for ts, row in trade.items()},
            funding_points,
        )
        diagnostics["symbols"][symbol] = {
            "tradeBars": len(trade),
            "fundingRows": len(funding_points),
            "completeDays": len(result[symbol]),
        }
    return result, diagnostics


def build_xyz_days(
    candle_rows: Dict[str, List[dict]],
    funding_rows: Dict[str, List[dict]],
) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    result = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOLS:
        row_map = xyz_row_map(candle_rows.get(symbol, []))
        points = parse_xyz_funding(funding_rows.get(symbol, []))
        result[symbol] = build_venue_days(row_map, points)
        diagnostics["symbols"][symbol] = {
            "candleBars": len(row_map),
            "fundingRows": len(points),
            "completeDays": len(result[symbol]),
        }
    return result, diagnostics


def align(
    aster: Dict[str, Dict[str, dict]],
    xyz: Dict[str, Dict[str, dict]],
) -> Tuple[List[str], Dict[str, Dict[str, dict]], dict]:
    aligned = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOLS:
        common = sorted(set(aster.get(symbol, {})) & set(xyz.get(symbol, {})))
        rows = {}
        clock_rejected = 0
        for day in common:
            a = aster[symbol][day]
            x = xyz[symbol][day]
            if abs(a["signalTs"] - x["signalTs"]) > 60_000 or abs(a["entryTs"] - x["entryTs"]) > 60_000:
                clock_rejected += 1
                continue
            checkpoints = []
            valid = True
            for ac, xc in zip(a["checkpoints"], x["checkpoints"]):
                if abs(ac["ts"] - xc["ts"]) > 60_000 or abs(ac["exitTs"] - xc["exitTs"]) > 60_000:
                    valid = False
                    break
                checkpoints.append({
                    "ts": ac["ts"],
                    "spreadBps": (ac["price"] / xc["price"] - 1.0) * 10000.0,
                    "asterExit": ac["exit"],
                    "xyzExit": xc["exit"],
                    "exitTs": ac["exitTs"],
                })
            if not valid:
                clock_rejected += 1
                continue
            rows[day] = {
                "symbol": symbol,
                "spreadBps": (a["signal"] / x["signal"] - 1.0) * 10000.0,
                "entryTs": a["entryTs"],
                "asterEntry": a["entry"],
                "xyzEntry": x["entry"],
                "asterFunding": a["fundingPoints"],
                "xyzFunding": x["fundingPoints"],
                "checkpoints": checkpoints,
            }
        aligned[symbol] = rows
        diagnostics["symbols"][symbol] = {
            "commonDays": len(common),
            "alignedDays": len(rows),
            "clockRejected": clock_rejected,
            "firstDay": min(rows) if rows else None,
            "lastDay": max(rows) if rows else None,
        }
    available = [set(aligned[symbol]) for symbol in SYMBOLS if aligned[symbol]]
    days = sorted(set.intersection(*available)) if len(available) == len(SYMBOLS) else []
    return days, aligned, diagnostics


def direction_allowed(mode: str, spread_bps: float) -> bool:
    if mode == "ASTER_PREMIUM_ONLY":
        return spread_bps > 0
    if mode == "ASTER_DISCOUNT_ONLY":
        return spread_bps < 0
    return True


def select_row(candidate: Candidate, day: str, aligned: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    eligible = [
        aligned[symbol][day]
        for symbol in SYMBOLS
        if abs(finite(aligned[symbol][day]["spreadBps"])) >= candidate.threshold_bps
        and direction_allowed(candidate.direction_mode, finite(aligned[symbol][day]["spreadBps"]))
    ]
    return max(eligible, key=lambda row: abs(finite(row["spreadBps"]))) if eligible else None


def exit_for(row: dict, exit_mode: str) -> Tuple[dict, str]:
    entry_spread = finite(row["spreadBps"])
    final = row["checkpoints"][-1]
    if exit_mode == "TIME":
        return final, "TIME"
    for checkpoint in row["checkpoints"]:
        current = finite(checkpoint["spreadBps"])
        converged = abs(current) <= CONVERGENCE_BPS or current * entry_spread <= 0
        stopped = abs(current) >= SPREAD_STOP_MULTIPLE * abs(entry_spread)
        if converged:
            return checkpoint, "SPREAD_CONVERGED"
        if stopped:
            return checkpoint, "SPREAD_STOP"
    return final, "TIME"


def build_trade(candidate: Candidate, day: str, aligned: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    row = select_row(candidate, day, aligned)
    if row is None:
        return None
    checkpoint, reason = exit_for(row, candidate.exit_mode)
    spread = finite(row["spreadBps"])
    aster_side = -1 if spread > 0 else 1
    xyz_side = -aster_side
    aster_weight = xyz_weight = 0.5
    exit_ts = int(checkpoint["exitTs"])
    aster_price_return = aster_weight * aster_side * (finite(checkpoint["asterExit"]) / finite(row["asterEntry"]) - 1.0)
    xyz_price_return = xyz_weight * xyz_side * (finite(checkpoint["xyzExit"]) / finite(row["xyzEntry"]) - 1.0)
    aster_funding = aster_weight * (-aster_side) * funding_mod.funding_between(row["asterFunding"], row["entryTs"], exit_ts)
    xyz_funding = xyz_weight * (-xyz_side) * funding_between(row["xyzFunding"], row["entryTs"], exit_ts)
    gross_return = aster_price_return + xyz_price_return + aster_funding + xyz_funding
    return {
        "candidateId": candidate.candidate_id,
        "family": candidate.family,
        "entryDay": day,
        "exitDay": day,
        "symbol": row["symbol"],
        "entrySpreadBps": spread,
        "exitSpreadBps": finite(checkpoint["spreadBps"]),
        "asterSide": aster_side,
        "xyzSide": xyz_side,
        "asterGross": aster_weight,
        "xyzGross": xyz_weight,
        "entryTs": row["entryTs"],
        "exitTs": exit_ts,
        "exitReason": reason,
        "asterPriceReturn": aster_price_return,
        "xyzPriceReturn": xyz_price_return,
        "asterFundingReturn": aster_funding,
        "xyzFundingReturn": xyz_funding,
        "grossReturn": gross_return,
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
    xyz_bps = XYZ_ONE_WAY_BPS[scenario.name]
    values = []
    for trade in trades:
        aster_cost = 2.0 * finite(trade["asterGross"]) * scenario.turnover_bps / 10000.0
        xyz_cost = 2.0 * finite(trade["xyzGross"]) * xyz_bps / 10000.0
        values.append(multiplier * (finite(trade["grossReturn"]) - aster_cost - xyz_cost))
    return values


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
    premium = discount = 0
    for trade in trades:
        exit_counts[trade["exitReason"]] += 1
        symbol_counts[trade["symbol"]] += 1
        if trade["entrySpreadBps"] > 0:
            premium += 1
        else:
            discount += 1
    return {
        "trades": len(values),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "asterFundingSumPct": sum(finite(trade["asterFundingReturn"]) for trade in trades) * multiplier * 100.0,
        "xyzFundingSumPct": sum(finite(trade["xyzFundingReturn"]) for trade in trades) * multiplier * 100.0,
        "asterPriceSumPct": sum(finite(trade["asterPriceReturn"]) for trade in trades) * multiplier * 100.0,
        "xyzPriceSumPct": sum(finite(trade["xyzPriceReturn"]) for trade in trades) * multiplier * 100.0,
        "premiumTrades": premium,
        "discountTrades": discount,
        "exitReasons": dict(sorted(exit_counts.items())),
        "symbolCounts": dict(sorted(symbol_counts.items())),
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    return [trade for trade in trades if interval[0] <= trade["exitDay"] <= interval[1]]


def chronological_splits(days: Sequence[str]) -> dict:
    n = len(days)
    dev_end = max(1, int(n * 0.60))
    val_end = max(dev_end + 1, int(n * 0.80))
    return {
        "DEVELOPMENT": (days[0], days[dev_end - 1]),
        "VALIDATION": (days[dev_end], days[val_end - 1]),
        "HOLDOUT": (days[val_end], days[-1]),
    }


def score(result: dict) -> float:
    return (
        result["FORWARD_MEDIAN"]["compoundedReturnPct"]
        + result["NORMAL"]["compoundedReturnPct"]
        + 0.75 * result["FORWARD_P95"]["compoundedReturnPct"]
        + 0.5 * result["SEVERE"]["compoundedReturnPct"]
        + 4.0 * ((result["FORWARD_P95"].get("profitFactor") or 0.0) - 1.0)
    )


def strict_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 4
        and all(result[name]["compoundedReturnPct"] > 0 for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"))
        and (result["FORWARD_P95"].get("profitFactor") or 0.0) > 1.10
    )


def p95_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 4
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


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(aster_cache: Path, aster_funding_cache: Path, xyz_cache: Path) -> dict:
    aster, aster_diag = load_aster(aster_cache, aster_funding_cache)
    xyz_candles, xyz_funding, xyz_api_diag = load_xyz(xyz_cache)
    xyz, xyz_diag = build_xyz_days(xyz_candles, xyz_funding)
    days, aligned, alignment = align(aster, xyz)
    safety = {
        "mode": "RESEARCH_ONLY",
        "orderSubmissionAllowed": False,
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "cryptoV96Changed": False,
    }
    if len(days) < 30:
        return rounded({
            "version": 12,
            "strategyId": STRATEGY_ID,
            "status": "INSUFFICIENT_ALIGNED_CROSS_VENUE_HISTORY",
            "candidateCount": len(CANDIDATES),
            "familyCount": len(DIRECTION_MODES) * len(EXIT_MODES),
            "eligibleDays": len(days),
            "asterDiagnostics": aster_diag,
            "xyzApiDiagnostics": xyz_api_diag,
            "xyzDiagnostics": xyz_diag,
            "alignmentDiagnostics": alignment,
            "safety": safety,
        })
    splits = chronological_splits(days)
    all_trades = {
        candidate.candidate_id: [
            trade for day in days if (trade := build_trade(candidate, day, aligned)) is not None
        ]
        for candidate in CANDIDATES
    }
    families = {}
    passing_strict: List[str] = []
    passing_p95: List[str] = []
    for family in sorted({candidate.family for candidate in CANDIDATES}):
        rows = []
        for candidate in [item for item in CANDIDATES if item.family == family]:
            development = {
                scenario.name: metrics(subset(all_trades[candidate.candidate_id], splits["DEVELOPMENT"]), scenario)
                for scenario in base.SCENARIOS
            }
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development)})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: metrics(subset(all_trades[winner_id], splits["VALIDATION"]), scenario)
            for scenario in base.SCENARIOS
        }
        strict = strict_pass(validation)
        p95 = p95_pass(validation)
        if strict:
            passing_strict.append(winner_id)
        if p95:
            passing_p95.append(winner_id)
        families[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "strictValidationPass": strict,
            "p95ValidationPass": p95,
        }
    selected = None
    pool = passing_strict or passing_p95
    if pool:
        options = []
        for candidate_id in pool:
            validation = {
                scenario.name: metrics(subset(all_trades[candidate_id], splits["VALIDATION"]), scenario)
                for scenario in base.SCENARIOS
            }
            options.append((score(validation), candidate_id, validation))
        _, selected_id, validation = max(options)
        trades = all_trades[selected_id]
        selected = {
            "candidateId": selected_id,
            "strictValidationPass": selected_id in passing_strict,
            "p95ValidationPass": selected_id in passing_p95,
            "validation": validation,
            "gross1": {},
            "grossSensitivity": {},
            "concentration": {},
        }
        for scenario in base.SCENARIOS:
            selected["gross1"][scenario.name] = {
                "full": metrics(trades, scenario),
                "development": metrics(subset(trades, splits["DEVELOPMENT"]), scenario),
                "validation": metrics(subset(trades, splits["VALIDATION"]), scenario),
                "holdout": metrics(subset(trades, splits["HOLDOUT"]), scenario),
            }
            selected["concentration"][scenario.name] = {
                "bestTradeRemoved": metrics(remove_best_trade(trades, scenario), scenario),
                "bestMonthRemoved": metrics(remove_best_month(trades, scenario), scenario),
            }
        for multiplier in (1.0, 1.25, 1.5, 2.0):
            selected["grossSensitivity"][str(multiplier)] = {
                scenario.name: metrics(trades, scenario, multiplier)
                for scenario in base.SCENARIOS
            }
        selected["holdoutStrictPass"] = all(
            selected["gross1"][name]["holdout"]["trades"] >= 3
            and selected["gross1"][name]["holdout"]["compoundedReturnPct"] > 0
            for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE")
        )
        selected["holdoutP95Pass"] = all(
            selected["gross1"][name]["holdout"]["trades"] >= 3
            and selected["gross1"][name]["holdout"]["compoundedReturnPct"] > 0
            for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95")
        )
    if selected and selected["strictValidationPass"] and selected["holdoutStrictPass"]:
        status = "ROBUST_CROSS_VENUE_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["p95ValidationPass"] and selected["holdoutP95Pass"]:
        status = "P95_CROSS_VENUE_EDGE_FOUND_FAILS_SEVERE_SHADOW_ONLY"
    elif selected:
        status = "CROSS_VENUE_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_CROSS_VENUE_FAMILY"
    return rounded({
        "version": 12,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES),
        "familyCount": len(DIRECTION_MODES) * len(EXIT_MODES),
        "universe": list(SYMBOLS),
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1], "interval": INTERVAL},
        "splits": splits,
        "families": families,
        "strictValidationPassingWinnerIds": passing_strict,
        "p95ValidationPassingWinnerIds": passing_p95,
        "selected": selected,
        "costAssumptions": {
            "asterOneWayBps": {scenario.name: scenario.turnover_bps for scenario in base.SCENARIOS},
            "xyzOneWayBps": XYZ_ONE_WAY_BPS,
            "grossAllocation": {"Aster": 0.5, "XYZ": 0.5},
        },
        "asterDiagnostics": aster_diag,
        "xyzApiDiagnostics": xyz_api_diag,
        "xyzDiagnostics": xyz_diag,
        "alignmentDiagnostics": alignment,
        "selectionDiscipline": {
            "thresholdSelection": "DEVELOPMENT only",
            "familyScreening": "VALIDATION only",
            "finalEvaluation": "reused historical HOLDOUT once",
            "holdoutRetuningAllowed": False,
        },
        "limitations": [
            "Hyperliquid candleSnapshot exposes only the most recent 5000 candles, limiting the aligned history.",
            "Historical order-book depth and exact fill Slippage were represented through cost scenarios rather than reconstructed.",
            "Aster uses USDT collateral while XYZ uses USDC; USD/USDT/USDC basis is not separately modeled.",
            "The final period overlaps previously inspected Stock research and is not an independent Holdout.",
            "Two-venue execution requires independent collateral, synchronized fills and leg-risk controls.",
            "Gross multipliers above 1.0 are sensitivity only.",
        ],
        "safety": safety,
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-cross-venue-perp-v12.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Cross-Venue Perp V12",
        "",
        f"- Status: **{result['status']}**",
        f"- Candidates / families: {result['candidateCount']} / {result['familyCount']}",
        f"- Eligible aligned days: {result.get('dataWindow', {}).get('eligibleDays', result.get('eligibleDays', 0))}",
        "- Production / LIVE / VPS / Crypto V96 / orders changed: **NO**",
    ]
    if result.get("families"):
        lines += [
            "",
            "| Family | Winner | Dev median | Dev severe | Validation median | Validation P95 | Validation severe | Strict | P95 |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
        ]
        for family, item in result["families"].items():
            winner = next(
                row for row in item["developmentCandidates"]
                if row["candidate"]["candidate_id"] == item["winnerId"]
            )
            lines.append(
                f"| {family} | {item['winnerId']} | "
                f"{winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
                f"{winner['development']['SEVERE']['compoundedReturnPct']}% | "
                f"{item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
                f"{item['winnerValidation']['FORWARD_P95']['compoundedReturnPct']}% | "
                f"{item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | "
                f"{'YES' if item['strictValidationPass'] else 'NO'} | "
                f"{'YES' if item['p95ValidationPass'] else 'NO'} |"
            )
    if result.get("selected"):
        selected = result["selected"]
        lines += [
            "",
            "## Selected candidate",
            "",
            f"- Candidate: **{selected['candidateId']}**",
            f"- Validation strict pass: **{'YES' if selected['strictValidationPass'] else 'NO'}**",
            f"- Validation P95 pass: **{'YES' if selected['p95ValidationPass'] else 'NO'}**",
            f"- Holdout strict pass: **{'YES' if selected['holdoutStrictPass'] else 'NO'}**",
            f"- Holdout P95 pass: **{'YES' if selected['holdoutP95Pass'] else 'NO'}**",
        ]
    (output_dir / "v96-stock-cross-venue-perp-v12.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 24
    assert len({candidate.family for candidate in CANDIDATES}) == 6
    assert direction_allowed("ASTER_PREMIUM_ONLY", 10.0)
    assert not direction_allowed("ASTER_PREMIUM_ONLY", -10.0)
    assert direction_allowed("ASTER_DISCOUNT_ONLY", -10.0)
    assert abs(product([0.10, -0.05]) - 0.045) < 1e-12
    assert XYZ_ONE_WAY_BPS["SEVERE"] > XYZ_ONE_WAY_BPS["NORMAL"]
    print("V96 Stock Cross-Venue Perp V12 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aster-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--aster-funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--xyz-cache-dir", default=".cache/v96-stock-cross-venue-v12")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cross-venue-v12")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(
        Path(args.aster_cache_dir),
        Path(args.aster_funding_cache_dir),
        Path(args.xyz_cache_dir),
    )
    write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
