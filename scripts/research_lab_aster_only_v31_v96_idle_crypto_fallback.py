from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.parse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_crypto_v11_v13d_one_year_bt as portfolio
import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V31_V96_IDLE_CRYPTO_FALLBACK"
BT_START = dt.datetime(2025, 7, 25, tzinfo=UTC)
BT_END = dt.datetime(2026, 7, 25, tzinfo=UTC)
WARMUP_START = BT_START - dt.timedelta(days=60)
START_MS = int(BT_START.timestamp() * 1000)
END_MS = int(BT_END.timestamp() * 1000)
WARMUP_MS = int(WARMUP_START.timestamp() * 1000)
BAR_MS = 30 * 60 * 1000
HOUR_MS = 60 * 60 * 1000
DAY_MS = 24 * HOUR_MS
HOLDOUT_START = "2026-07-01"
DAILY_LOSS_LOCK = -0.02
MAX_GROSS = 1.0
UNIVERSE = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
    "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "AAVEUSDT",
)
ALT_UNIVERSE = tuple(symbol for symbol in UNIVERSE if symbol != "BTCUSDT")
COSTS = {"NORMAL": 16.0, "P95": 24.0, "SEVERE": 60.0}
STOCK_COSTS = {"NORMAL": 40.0, "P95": 44.0, "SEVERE": 100.0}


@dataclass(frozen=True)
class RiskProfile:
    name: str
    take_profit_pct: float
    stop_loss_pct: float


RISK_PROFILES = (
    RiskProfile("R1", 1.00, 0.70),
    RiskProfile("R2", 1.50, 1.00),
    RiskProfile("R3", 2.00, 1.20),
)


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    a: float
    b: float
    c: str
    maximum_holding_hours: int
    risk_name: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    [
        Candidate(
            f"BTC_LEAD_ALT_LAG__B{btc:g}__L{lag:g}__H{hold}__{risk.name}",
            "BTC_LEAD_ALT_LAG", btc, lag, "NONE", hold, risk.name,
        )
        for btc in (30.0, 50.0, 80.0)
        for lag in (20.0, 40.0)
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
    + [
        Candidate(
            f"CROSS_SECTION_MOM__H{lookback:g}__Z{z:g}__{regime}__HOLD{hold}__{risk.name}",
            "CROSS_SECTION_MOM", lookback, z, regime, hold, risk.name,
        )
        for lookback in (2.0, 4.0, 8.0)
        for z in (1.0, 1.5, 2.0)
        for regime in ("NONE", "BTC_ALIGNED", "BTC_STABLE")
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
    + [
        Candidate(
            f"FUNDING_SQUEEZE_CONT__F{funding:g}__M{momentum:g}__H{hold}__{risk.name}",
            "FUNDING_SQUEEZE_CONT", funding, momentum, "NONE", hold, risk.name,
        )
        for funding in (0.20, 0.50, 1.00)
        for momentum in (40.0, 80.0, 120.0)
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
    + [
        Candidate(
            f"VOLUME_BREAKOUT_CONT__R{return_bps:g}__V{volume:g}__L{lookback:g}__H{hold}__{risk.name}",
            "VOLUME_BREAKOUT_CONT", return_bps, volume, str(int(lookback)), hold, risk.name,
        )
        for return_bps in (40.0, 80.0)
        for volume in (1.50, 2.00)
        for lookback in (12.0, 24.0)
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
    + [
        Candidate(
            f"EXHAUSTION_FADE__Z{z:g}__B{btc_stable:g}__V{volume:g}__H{hold}__{risk.name}",
            "EXHAUSTION_FADE", z, btc_stable, str(volume), hold, risk.name,
        )
        for z in (2.0, 2.5)
        for btc_stable in (50.0, 100.0)
        for volume in (1.50, 2.00)
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
    + [
        Candidate(
            f"VOL_COMPRESSION_BREAK__P{percentile:g}__R{return_bps:g}__H{hold}__{risk.name}",
            "VOL_COMPRESSION_BREAK", percentile, return_bps, "NONE", hold, risk.name,
        )
        for percentile in (25.0, 40.0)
        for return_bps in (30.0, 50.0)
        for hold in (1, 2, 4)
        for risk in RISK_PROFILES
    ]
)

RISK_MAP = {profile.name: profile for profile in RISK_PROFILES}


@dataclass(frozen=True)
class Bar:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    return value


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


def fetch_aster_klines(symbol: str, cache_dir: Path) -> List[list]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-30m-{WARMUP_START.date()}-{BT_END.date()}.json"
    cached = portfolio.v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[list] = []
    cursor = WARMUP_MS
    stop = END_MS - 1
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": symbol,
            "interval": "30m",
            "startTime": cursor,
            "endTime": stop,
            "limit": 1500,
        })
        page = portfolio.v13base.request_json(f"{portfolio.v13base.ASTER_KLINES_URL}?{query}")
        clean = [row for row in page if isinstance(row, list) and len(row) >= 6] if isinstance(page, list) else []
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row[0]) for row in clean) + BAR_MS
        if next_cursor <= cursor or len(clean) < 1500:
            break
        cursor = next_cursor
        time.sleep(0.04)
    dedup = {int(row[0]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    portfolio.v13base.cache_write(path, result)
    return result


def fetch_aster_funding(symbol: str, cache_dir: Path) -> List[dict]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-funding-{WARMUP_START.date()}-{BT_END.date()}.json"
    cached = portfolio.v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[dict] = []
    cursor = WARMUP_MS
    stop = END_MS - 1
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": symbol,
            "startTime": cursor,
            "endTime": stop,
            "limit": 1000,
        })
        page = portfolio.v13base.request_json(f"{portfolio.v13hold.ASTER_FUNDING_URL}?{query}")
        clean = [row for row in page if isinstance(row, dict) and row.get("fundingTime") is not None] if isinstance(page, list) else []
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row["fundingTime"]) for row in clean) + 1
        if next_cursor <= cursor or len(clean) < 1000:
            break
        cursor = next_cursor
        time.sleep(0.04)
    dedup = {int(row["fundingTime"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    portfolio.v13base.cache_write(path, result)
    return result


def load_market(cache_dir: Path) -> Tuple[Dict[str, List[Bar]], Dict[str, List[Tuple[int, float]]], dict]:
    raw_bars: Dict[str, List[list]] = {}
    raw_funding: Dict[str, List[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs = []
        for symbol in UNIVERSE:
            jobs.append(("bars", symbol, pool.submit(fetch_aster_klines, symbol, cache_dir / "bars")))
            jobs.append(("funding", symbol, pool.submit(fetch_aster_funding, symbol, cache_dir / "funding")))
        for kind, symbol, future in jobs:
            payload = future.result()
            (raw_bars if kind == "bars" else raw_funding)[symbol] = payload
            print(f"loaded V31 {kind} {symbol}: {len(payload)}")

    bars: Dict[str, List[Bar]] = {}
    funding: Dict[str, List[Tuple[int, float]]] = {}
    diagnostics = {"symbols": {}}
    for symbol in UNIVERSE:
        parsed = []
        for row in raw_bars[symbol]:
            values = [finite(row[index], math.nan) for index in (1, 2, 3, 4, 5)]
            if not all(math.isfinite(value) for value in values) or min(values[:4]) <= 0 or values[4] < 0:
                continue
            parsed.append(Bar(int(row[0]), values[0], values[1], values[2], values[3], values[4]))
        bars[symbol] = sorted(parsed, key=lambda item: item.ts)
        points = []
        for row in raw_funding[symbol]:
            ts = int(row.get("fundingTime", 0))
            rate = finite(row.get("fundingRate", row.get("funding")), math.nan)
            if ts > 0 and math.isfinite(rate):
                points.append((ts, rate))
        funding[symbol] = sorted(points)
        diagnostics["symbols"][symbol] = {
            "bars": len(bars[symbol]),
            "fundingPoints": len(funding[symbol]),
            "firstBar": bars[symbol][0].ts if bars[symbol] else None,
            "lastBar": bars[symbol][-1].ts if bars[symbol] else None,
        }
    return bars, funding, diagnostics


def latest_funding_bps(points: Sequence[Tuple[int, float]], timestamp: int) -> Optional[float]:
    times = [item[0] for item in points]
    index = bisect.bisect_right(times, timestamp) - 1
    if index < 0 or timestamp - points[index][0] > 36 * HOUR_MS:
        return None
    return points[index][1] * 10_000.0


def funding_between(points: Sequence[Tuple[int, float]], start_ts: int, end_ts: int) -> float:
    return sum(rate for ts, rate in points if start_ts <= ts < end_ts)


def rolling_returns(bars: Sequence[Bar], end_index: int, horizon: int, samples: int) -> List[float]:
    values = []
    cursor = end_index
    for _ in range(samples):
        if cursor - horizon < 0:
            break
        start = bars[cursor - horizon].close
        end = bars[cursor].close
        if start > 0:
            values.append((end / start - 1.0) * 10_000.0)
        cursor -= horizon
    return values


def percentile_rank(values: Sequence[float], current: float) -> float:
    if not values:
        return 100.0
    return sum(value <= current for value in values) / len(values) * 100.0


def build_features(bars: Dict[str, List[Bar]], funding: Dict[str, List[Tuple[int, float]]]) -> Tuple[List[int], Dict[int, Dict[str, dict]], dict]:
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    timestamps = [
        bar.ts for bar in bars["BTCUSDT"]
        if START_MS <= bar.ts < END_MS
        and dt.datetime.fromtimestamp(bar.ts / 1000, tz=UTC).minute == 0
        and dt.datetime.fromtimestamp(bar.ts / 1000, tz=UTC).hour % 2 == 0
    ]
    features: Dict[int, Dict[str, dict]] = {}
    skipped = Counter()
    for ts in timestamps:
        day_rows: Dict[str, dict] = {}
        for symbol in UNIVERSE:
            index = index_maps[symbol].get(ts)
            rows = bars[symbol]
            if index is None or index < 700 or index + 8 >= len(rows):
                skipped[f"{symbol}:history_or_future"] += 1
                continue
            prior = index - 1
            def ret(bar_count: int) -> float:
                return (rows[prior].close / rows[prior - bar_count].close - 1.0) * 10_000.0

            ret1 = ret(2)
            ret2 = ret(4)
            ret4 = ret(8)
            ret8 = ret(16)
            recent_volume = sum(item.volume for item in rows[index - 4:index])
            volume_windows = [
                sum(item.volume for item in rows[j - 4:j])
                for j in range(index - 4, max(4, index - 196), -4)
                if j - 4 >= 0
            ]
            median_volume = statistics.median(volume_windows) if volume_windows else 0.0
            volume_ratio = recent_volume / median_volume if median_volume > 0 else 0.0

            prior_4h = rolling_returns(rows, prior - 8, 8, 40)
            mean_4h = statistics.mean(prior_4h) if prior_4h else 0.0
            sigma_4h = statistics.pstdev(prior_4h) if len(prior_4h) >= 20 else 0.0
            z4 = (ret4 - mean_4h) / sigma_4h if sigma_4h > 1e-9 else 0.0

            log_returns = [
                math.log(rows[j].close / rows[j - 1].close)
                for j in range(index - 23, index)
                if rows[j - 1].close > 0 and rows[j].close > 0
            ]
            vol12 = statistics.pstdev(log_returns) if len(log_returns) >= 20 else 0.0
            historical_vol = []
            for endpoint in range(index - 24, max(25, index - 696), -24):
                sample = [
                    math.log(rows[j].close / rows[j - 1].close)
                    for j in range(endpoint - 23, endpoint)
                    if rows[j - 1].close > 0 and rows[j].close > 0
                ]
                if len(sample) >= 20:
                    historical_vol.append(statistics.pstdev(sample))
            vol_percentile = percentile_rank(historical_vol, vol12)

            high12 = max(item.high for item in rows[index - 25:index - 1])
            low12 = min(item.low for item in rows[index - 25:index - 1])
            high24 = max(item.high for item in rows[index - 49:index - 1])
            low24 = min(item.low for item in rows[index - 49:index - 1])
            close = rows[prior].close
            day_rows[symbol] = {
                "index": index,
                "entryTs": ts,
                "ret1hBps": ret1,
                "ret2hBps": ret2,
                "ret4hBps": ret4,
                "ret8hBps": ret8,
                "z4h": z4,
                "volumeRatio": volume_ratio,
                "vol12h": vol12,
                "volPercentile": vol_percentile,
                "breakout12": 1 if close > high12 else (-1 if close < low12 else 0),
                "breakout24": 1 if close > high24 else (-1 if close < low24 else 0),
                "fundingBps": latest_funding_bps(funding[symbol], ts),
            }
        if len(day_rows) >= 6 and "BTCUSDT" in day_rows:
            features[ts] = day_rows
        else:
            skipped["panel_incomplete"] += 1
    return sorted(features), features, {"decisionSlots": len(features), "skipped": dict(skipped)}


def configure_portfolio_period() -> None:
    portfolio.PERIOD_START = BT_START
    portfolio.PERIOD_END = BT_END
    portfolio.START_MS = START_MS
    portfolio.END_MS = END_MS


def value_from_keys(row: dict, keys: Sequence[str]) -> Optional[int]:
    for key in keys:
        if row.get(key) is not None:
            try:
                return int(row[key])
            except (TypeError, ValueError):
                pass
    return None


def merge_intervals(intervals: Sequence[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    ordered = sorted((start, end, source) for start, end, source in intervals if end > start)
    if not ordered:
        return []
    merged: List[Tuple[int, int, str]] = []
    start, end, sources = ordered[0][0], ordered[0][1], {ordered[0][2]}
    for next_start, next_end, source in ordered[1:]:
        if next_start <= end:
            end = max(end, next_end)
            sources.add(source)
        else:
            merged.append((start, end, "+".join(sorted(sources))))
            start, end, sources = next_start, next_end, {source}
    merged.append((start, end, "+".join(sorted(sources))))
    return merged


def v96_state(cache_root: Path) -> Tuple[dict, List[Tuple[int, int, str]], dict]:
    configure_portfolio_period()
    crypto = portfolio.build_crypto()
    intervals: List[Tuple[int, int, str]] = []
    raw_trades = portfolio.crypto_bt.v69.scale_trades(portfolio.crypto_bt.v96.TARGET_V67_GROSS)
    extracted = 0
    for row in raw_trades:
        entry = value_from_keys(row, ("entry_ts", "entryTs", "entry_time", "entryTime"))
        exit_ts = value_from_keys(row, ("exit_ts", "exitTs", "exit_time", "exitTime"))
        if entry is None or exit_ts is None or exit_ts <= START_MS or entry >= END_MS:
            continue
        intervals.append((max(WARMUP_MS, entry), min(END_MS, exit_ts), "V96_TRADE"))
        extracted += 1

    active_rows = sorted(
        (int(row["ts"]), finite(row.get("gross")))
        for row in crypto["normal"]
        if finite(row.get("gross")) > 0
    )
    if active_rows:
        group_start = active_rows[0][0] - HOUR_MS
        group_end = active_rows[0][0] + HOUR_MS
        for ts, _gross in active_rows[1:]:
            if ts <= group_end + 2 * HOUR_MS:
                group_end = max(group_end, ts + HOUR_MS)
            else:
                intervals.append((max(WARMUP_MS, group_start), min(END_MS, group_end), "V96_GROSS_ROWS"))
                group_start, group_end = ts - HOUR_MS, ts + HOUR_MS
        intervals.append((max(WARMUP_MS, group_start), min(END_MS, group_end), "V96_GROSS_ROWS"))
    merged = merge_intervals(intervals)
    diagnostics = {
        "rawScaledTrades": len(raw_trades),
        "extractedTradeIntervals": extracted,
        "positiveGrossRows": len(active_rows),
        "mergedIntervals": len(merged),
        "cryptoDiagnostics": crypto.get("diagnostics", {}),
    }
    return crypto, merged, diagnostics


def stock_state(cache_root: Path) -> Tuple[List[dict], List[dict], List[Tuple[int, int, str]], dict]:
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root)
    warmup_days = [day for day in days if WARMUP_START.date().isoformat() <= day < BT_END.date().isoformat()]
    v11_rows, v11_diag = v22.build_v11eq(warmup_days, aligned)
    v19_rows = v22.build_fallback(warmup_days, aligned)
    intervals = [
        (int(row["entryTs"]), int(row["exitTs"]), str(row.get("strategy", "STOCK")))
        for row in [*v11_rows, *v19_rows]
        if int(row["exitTs"]) > START_MS and int(row["entryTs"]) < END_MS
    ]
    return v11_rows, v19_rows, merge_intervals(intervals), {
        "market": diagnostics,
        "v11": v11_diag,
        "v11Rows": len(v11_rows),
        "v19Rows": len(v19_rows),
    }


def overlaps(intervals: Sequence[Tuple[int, int, str]], start: int, end: int) -> bool:
    for left, right, _source in intervals:
        if left >= end:
            break
        if start < right and end > left:
            return True
    return False


def interval_sources(intervals: Sequence[Tuple[int, int, str]], start: int, end: int) -> List[str]:
    return sorted({source for left, right, source in intervals if left < end and start < right})


def signal(candidate: Candidate, rows: Dict[str, dict]) -> Optional[Tuple[str, int, float, dict]]:
    btc = rows["BTCUSDT"]
    eligible: List[Tuple[float, str, int, float, dict]] = []

    if candidate.family == "BTC_LEAD_ALT_LAG":
        btc_return = finite(btc["ret2hBps"])
        if abs(btc_return) < candidate.a:
            return None
        direction = 1 if btc_return > 0 else -1
        for symbol in ALT_UNIVERSE:
            if symbol not in rows:
                continue
            alt_return = finite(rows[symbol]["ret2hBps"])
            lag = abs(btc_return) - direction * alt_return
            if direction * alt_return < -20.0 or lag < candidate.b:
                continue
            edge = max(0.0, lag - 5.0)
            eligible.append((lag + abs(btc_return), symbol, direction, edge, {"btcReturnBps": btc_return, "altReturnBps": alt_return, "lagBps": lag}))

    elif candidate.family == "CROSS_SECTION_MOM":
        field = {2.0: "ret2hBps", 4.0: "ret4hBps", 8.0: "ret8hBps"}[candidate.a]
        values = [(symbol, finite(row[field])) for symbol, row in rows.items() if symbol != "BTCUSDT"]
        if len(values) < 5:
            return None
        mean = statistics.mean(value for _symbol, value in values)
        sigma = statistics.pstdev(value for _symbol, value in values)
        if sigma <= 1e-9:
            return None
        btc_return = finite(btc[field])
        for symbol, value in values:
            zscore = (value - mean) / sigma
            if abs(zscore) < candidate.b:
                continue
            direction = 1 if zscore > 0 else -1
            if candidate.c == "BTC_ALIGNED" and direction * btc_return < 20.0:
                continue
            if candidate.c == "BTC_STABLE" and abs(btc_return) > 100.0:
                continue
            edge = max(0.0, abs(value - mean) - 5.0)
            eligible.append((abs(zscore) * 100.0 + abs(value - mean), symbol, direction, edge, {"field": field, "valueBps": value, "crossMeanBps": mean, "zscore": zscore, "btcReturnBps": btc_return}))

    elif candidate.family == "FUNDING_SQUEEZE_CONT":
        for symbol, row in rows.items():
            funding = row.get("fundingBps")
            momentum = finite(row["ret2hBps"])
            if funding is None or abs(finite(funding)) < candidate.a or abs(momentum) < candidate.b:
                continue
            if finite(funding) * momentum >= 0:
                continue
            direction = 1 if momentum > 0 else -1
            edge = max(0.0, abs(momentum) + abs(finite(funding)) * 4.0 - 5.0)
            eligible.append((abs(momentum) + abs(finite(funding)) * 20.0, symbol, direction, edge, {"momentumBps": momentum, "fundingBps": funding}))

    elif candidate.family == "VOLUME_BREAKOUT_CONT":
        lookback = int(candidate.c)
        breakout_field = "breakout12" if lookback == 12 else "breakout24"
        for symbol, row in rows.items():
            breakout = int(row[breakout_field])
            momentum = finite(row["ret2hBps"])
            volume_ratio = finite(row["volumeRatio"])
            if breakout == 0 or breakout * momentum <= 0:
                continue
            if abs(momentum) < candidate.a or volume_ratio < candidate.b:
                continue
            edge = max(0.0, abs(momentum) + max(0.0, volume_ratio - 1.0) * 20.0 - 5.0)
            eligible.append((abs(momentum) + volume_ratio * 25.0, symbol, breakout, edge, {"momentumBps": momentum, "volumeRatio": volume_ratio, "lookbackHours": lookback}))

    elif candidate.family == "EXHAUSTION_FADE":
        btc_stable = candidate.b
        volume_threshold = float(candidate.c)
        if abs(finite(btc["ret4hBps"])) > btc_stable:
            return None
        for symbol, row in rows.items():
            zscore = finite(row["z4h"])
            volume_ratio = finite(row["volumeRatio"])
            if abs(zscore) < candidate.a or volume_ratio < volume_threshold:
                continue
            direction = -1 if zscore > 0 else 1
            edge = max(0.0, abs(finite(row["ret4hBps"])) * 0.50 + max(0.0, volume_ratio - 1.0) * 15.0 - 5.0)
            eligible.append((abs(zscore) * 100.0 + volume_ratio * 20.0, symbol, direction, edge, {"z4h": zscore, "return4hBps": row["ret4hBps"], "volumeRatio": volume_ratio, "btcReturn4hBps": btc["ret4hBps"]}))

    elif candidate.family == "VOL_COMPRESSION_BREAK":
        for symbol, row in rows.items():
            percentile = finite(row["volPercentile"])
            momentum = finite(row["ret1hBps"])
            if percentile > candidate.a or abs(momentum) < candidate.b:
                continue
            direction = 1 if momentum > 0 else -1
            edge = max(0.0, abs(momentum) + (candidate.a - percentile) * 0.50 - 5.0)
            eligible.append((abs(momentum) + (100.0 - percentile), symbol, direction, edge, {"volPercentile": percentile, "return1hBps": momentum}))
    else:
        raise ValueError(candidate.family)

    if not eligible:
        return None
    _strength, symbol, direction, edge, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, direction, edge, detail


def simulate_trade(candidate: Candidate, symbol: str, side: int, edge: float, detail: dict, ts: int, bars: Dict[str, List[Bar]], funding: Dict[str, List[Tuple[int, float]]], index_maps: Dict[str, Dict[int, int]]) -> Optional[dict]:
    index = index_maps[symbol].get(ts)
    rows = bars[symbol]
    if index is None:
        return None
    maximum_bars = candidate.maximum_holding_hours * 2
    if index + maximum_bars > len(rows):
        return None
    risk = RISK_MAP[candidate.risk_name]
    entry = rows[index].open
    take_profit = entry * (1.0 + side * risk.take_profit_pct / 100.0)
    stop_loss = entry * (1.0 - side * risk.stop_loss_pct / 100.0)
    exit_price = rows[index + maximum_bars - 1].close
    exit_ts = rows[index + maximum_bars - 1].ts + BAR_MS
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"

    for offset in range(maximum_bars):
        bar = rows[index + offset]
        if side > 0:
            stop_hit = bar.low <= stop_loss
            target_hit = bar.high >= take_profit
        else:
            stop_hit = bar.high >= stop_loss
            target_hit = bar.low <= take_profit
        if stop_hit:
            exit_price = stop_loss
            exit_ts = bar.ts + BAR_MS
            exit_reason = "STOP"
            break
        if target_hit:
            exit_price = take_profit
            exit_ts = bar.ts + BAR_MS
            exit_reason = "TAKE_PROFIT"
            break

    price_return = side * (exit_price / entry - 1.0)
    funding_return = (-side) * funding_between(funding[symbol], ts, exit_ts)
    return {
        "strategy": "V31_IDLE_CRYPTO_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat(),
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - ts) / HOUR_MS),
        "entryPrice": entry,
        "exitPrice": exit_price,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "edgeProxyBps": edge,
        "exitReason": exit_reason,
        "signalDetail": detail,
    }


def build_candidate_trades(candidate: Candidate, slots: Sequence[int], features: Dict[int, Dict[str, dict]], bars: Dict[str, List[Bar]], funding: Dict[str, List[Tuple[int, float]]], blockers: Sequence[Tuple[int, int, str]]) -> Tuple[List[dict], dict]:
    index_maps = {symbol: {bar.ts: index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    trades: List[dict] = []
    rejected = Counter()
    active_until = -1
    for ts in slots:
        if ts < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_exit = ts + candidate.maximum_holding_hours * HOUR_MS
        if overlaps(blockers, ts, maximum_exit):
            rejected["PRIORITY_OCCUPANCY"] += 1
            continue
        selected = signal(candidate, features[ts])
        if selected is None:
            continue
        symbol, side, edge, detail = selected
        trade = simulate_trade(candidate, symbol, side, edge, detail, ts, bars, funding, index_maps)
        if trade is None:
            rejected["MISSING_FUTURE_BARS"] += 1
            continue
        if overlaps(blockers, int(trade["entryTs"]), int(trade["exitTs"])):
            rejected["ACTUAL_EXIT_PRIORITY_OVERLAP"] += 1
            continue
        trades.append(trade)
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


def accepted_rows(trades: Sequence[dict], cost_bps: float, selected_days: Optional[Sequence[str]] = None) -> Tuple[List[dict], Counter]:
    allowed = None if selected_days is None else set(selected_days)
    result = []
    rejected: Counter = Counter()
    for trade in trades:
        if allowed is not None and str(trade["day"]) not in allowed:
            continue
        if finite(trade["edgeProxyBps"]) - cost_bps < 10.0:
            rejected["NET_EDGE_BELOW_10BPS"] += 1
            continue
        value = finite(trade["grossReturn"]) - cost_bps / 10_000.0
        result.append({**trade, "netReturn": value, "return": value, "ts": int(trade["exitTs"]), "priority": 4})
    return result, rejected


def metrics(events: Sequence[dict]) -> dict:
    ordered = sorted(events, key=lambda row: (int(row["ts"]), int(row.get("priority", 0))))
    values = [finite(row.get("return", row.get("netReturn"))) for row in ordered]
    positive_by_symbol: Dict[str, float] = defaultdict(float)
    positive_total = 0.0
    monthly: Dict[str, float] = defaultdict(lambda: 1.0)
    hours = 0.0
    for row, value in zip(ordered, values):
        symbol = str(row.get("symbol") or row.get("strategy") or "UNKNOWN")
        if value > 0:
            positive_by_symbol[symbol] += value
            positive_total += value
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        monthly[month] *= max(0.001, 1.0 + value)
        hours += finite(row.get("holdingHours"))
    compounded = product(values) * 100.0
    return {
        "events": len(values),
        "trades": len(values),
        "compoundedReturnPct": compounded,
        "cagrPct": compounded,
        "profitFactor": profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageEventBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "medianEventBps": statistics.median(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "capitalHours": hours,
        "netBpsPerCapitalHour": sum(values) * 10_000.0 / hours if hours > 0 else 0.0,
        "maximumPositiveProfitSymbolShare": max(positive_by_symbol.values()) / positive_total if positive_total > 0 and positive_by_symbol else 0.0,
        "symbolCounts": dict(sorted(Counter(str(row.get("symbol") or row.get("strategy") or "UNKNOWN") for row in ordered).items())),
        "monthlyReturnPct": {month: (value - 1.0) * 100.0 for month, value in sorted(monthly.items())},
    }


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda idx: finite(events[idx].get("return", events[idx].get("netReturn"))))
    return [row for idx, row in enumerate(events) if idx != index]


def remove_best_month(events: Sequence[dict]) -> Tuple[List[dict], Optional[str]]:
    if not events:
        return [], None
    monthly: Dict[str, float] = defaultdict(float)
    for row in events:
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        monthly[month] += finite(row.get("return", row.get("netReturn")))
    month = max(monthly, key=lambda item: (monthly[item], item))
    return [row for row in events if dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m") != month], month


def daily_loss_filter(events: Sequence[dict]) -> Tuple[List[dict], dict]:
    ordered = sorted(events, key=lambda row: (int(row["ts"]), int(row.get("priority", 0))))
    output = []
    stats = Counter()
    current_day = None
    day_return = 0.0
    locked = False
    for row in ordered:
        day = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day, day_return, locked = day, 0.0, False
        if locked:
            stats[f"{row.get('strategy', 'UNKNOWN')}_SKIPPED_DAILY_LOSS"] += 1
            continue
        output.append(row)
        value = finite(row.get("return", row.get("netReturn")))
        day_return = (1.0 + day_return) * (1.0 + value) - 1.0
        if day_return <= DAILY_LOSS_LOCK:
            locked = True
            stats["DAILY_LOSS_LOCKS"] += 1
    return output, dict(stats)


def filter_priority_stock(events: Sequence[dict], v96_intervals: Sequence[Tuple[int, int, str]]) -> Tuple[List[dict], int]:
    output = []
    blocked = 0
    for row in events:
        start, end = int(row["entryTs"]), int(row["exitTs"])
        if overlaps(v96_intervals, start, end):
            blocked += 1
            continue
        output.append(row)
    return output, blocked


def stock_events_for_scenario(v11_rows: Sequence[dict], v19_rows: Sequence[dict], days: Sequence[str], cost_bps: float, v96_intervals: Sequence[Tuple[int, int, str]]) -> Tuple[List[dict], dict]:
    routed, routing = v22.route(v11_rows, v19_rows, cost_bps, days, True)
    filtered, blocked = filter_priority_stock(routed, v96_intervals)
    events = [
        {**row, "return": finite(row["netReturn"]), "ts": int(row["exitTs"]), "priority": 3}
        for row in filtered
    ]
    return events, {"routing": routing, "blockedByV96": blocked}


def v96_events(crypto: dict, scenario: str, days: Sequence[str]) -> List[dict]:
    key = "severe" if scenario == "SEVERE" else "normal"
    allowed = set(days)
    result = []
    for row in crypto[key]:
        ts = int(row["ts"])
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day not in allowed:
            continue
        result.append({
            "strategy": "CRYPTO_V96",
            "symbol": "V96_PORTFOLIO",
            "ts": ts,
            "return": finite(row["return"]),
            "priority": 2,
        })
    return result


def unified_metrics(crypto: dict, v11_rows: Sequence[dict], v19_rows: Sequence[dict], candidate_rows: Sequence[dict], days: Sequence[str], scenario: str, v96_intervals: Sequence[Tuple[int, int, str]]) -> Tuple[dict, dict]:
    stock, stock_diag = stock_events_for_scenario(v11_rows, v19_rows, days, STOCK_COSTS[scenario], v96_intervals)
    candidate, candidate_rejects = accepted_rows(candidate_rows, COSTS[scenario], days)
    events = [*v96_events(crypto, scenario, days), *stock, *candidate]
    filtered, daily_diag = daily_loss_filter(events)
    return metrics(filtered), {
        "v96Events": sum(row["strategy"] == "CRYPTO_V96" for row in filtered),
        "stockEvents": sum(row.get("strategy") in {"V11_EQ", "ASTER_ONLY_V15"} or row.get("route") in {"V11_EQ_PRIMARY", "V19_FALLBACK"} for row in filtered),
        "candidateEvents": sum(row.get("strategy") == "V31_IDLE_CRYPTO_FALLBACK" for row in filtered),
        "candidateRejects": dict(candidate_rejects),
        "stock": stock_diag,
        "daily": daily_diag,
    }


def standalone_scenarios(trades: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, rejects = {}, {}
    for scenario, cost in COSTS.items():
        rows, rejected = accepted_rows(trades, cost, days)
        filtered, daily_diag = daily_loss_filter(rows)
        results[scenario] = metrics(filtered)
        rejects[scenario] = {"costGate": dict(rejected), "daily": daily_diag}
    return results, rejects


def calendar_days(start: dt.datetime, end: dt.datetime) -> List[str]:
    result = []
    cursor = start.date()
    while cursor < end.date():
        result.append(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return result


def split_days(days: Sequence[str]) -> dict:
    count = len(days)
    dev = int(count * 0.60)
    val = int(count * 0.80)
    return {
        "DEVELOPMENT": list(days[:dev]),
        "VALIDATION": list(days[dev:val]),
        "FINAL_REUSED": list(days[val:]),
    }


def development_pass(result: dict) -> bool:
    normal, p95 = result["NORMAL"], result["P95"]
    return (
        normal["trades"] >= 30
        and normal["compoundedReturnPct"] >= 20.0
        and p95["compoundedReturnPct"] >= 10.0
        and (normal["profitFactor"] or 0.0) >= 1.30
        and normal["maxDrawdownPct"] >= -12.0
    )


def validation_pass(standalone: dict, unified: dict, baseline: dict) -> bool:
    normal, p95 = standalone["NORMAL"], standalone["P95"]
    return (
        normal["trades"] >= 10
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) >= 1.20
        and unified["NORMAL"]["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"]
        and unified["P95"]["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"]
    )


def selection_score(standalone: dict, unified: dict, baseline: dict) -> float:
    return (
        standalone["NORMAL"]["compoundedReturnPct"]
        + standalone["P95"]["compoundedReturnPct"]
        + unified["NORMAL"]["compoundedReturnPct"] - baseline["NORMAL"]["compoundedReturnPct"]
        + unified["P95"]["compoundedReturnPct"] - baseline["P95"]["compoundedReturnPct"]
        - 0.5 * abs(standalone["NORMAL"]["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    portfolio.verify_source(portfolio.V11_ROOT, portfolio.V11_SOURCE_SHA)
    portfolio.verify_source(portfolio.V13_ROOT, portfolio.V13_SOURCE_SHA)
    bars, funding, market_diag = load_market(cache_root / "crypto-market")
    slots, features, feature_diag = build_features(bars, funding)
    crypto, v96_intervals, v96_diag = v96_state(cache_root / "v96")
    v11_rows, v19_rows, stock_intervals, stock_diag = stock_state(cache_root / "stock")
    priority_intervals = merge_intervals([*v96_intervals, *stock_intervals])

    all_days = calendar_days(BT_START, BT_END)
    pre_holdout = [day for day in all_days if day < HOLDOUT_START]
    holdout = [day for day in all_days if day >= HOLDOUT_START]
    splits = split_days(pre_holdout)

    baseline = {}
    baseline_diag = {}
    for scenario in COSTS:
        baseline[scenario], baseline_diag[scenario] = unified_metrics(
            crypto, v11_rows, v19_rows, [], all_days, scenario, v96_intervals
        )

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        trades, build_diag = build_candidate_trades(candidate, slots, features, bars, funding, priority_intervals)
        development, _ = standalone_scenarios(trades, splits["DEVELOPMENT"])
        diagnostic = {
            "candidate": asdict(candidate),
            "rawTrades": len(trades),
            "development": development,
            "buildDiagnostics": build_diag,
        }
        diagnostics.append(diagnostic)
        if development_pass(development):
            development_survivors.append((candidate, trades, development, build_diag))

    development_survivors.sort(
        key=lambda item: item[2]["NORMAL"]["compoundedReturnPct"] + item[2]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = []
    validation_diagnostics = []
    for candidate, trades, development, build_diag in development_survivors[:60]:
        validation, validation_rejects = standalone_scenarios(trades, splits["VALIDATION"])
        unified = {}
        unified_diag = {}
        baseline_validation = {}
        for scenario in COSTS:
            unified[scenario], unified_diag[scenario] = unified_metrics(
                crypto, v11_rows, v19_rows, trades, splits["VALIDATION"], scenario, v96_intervals
            )
            baseline_validation[scenario], _ = unified_metrics(
                crypto, v11_rows, v19_rows, [], splits["VALIDATION"], scenario, v96_intervals
            )
        item = {
            "candidate": asdict(candidate),
            "development": development,
            "validation": validation,
            "validationUnified": unified,
            "validationBaseline": baseline_validation,
            "validationRejects": validation_rejects,
            "unifiedDiagnostics": unified_diag,
            "rawTrades": len(trades),
            "buildDiagnostics": build_diag,
        }
        validation_diagnostics.append(item)
        if validation_pass(validation, unified, baseline_validation):
            validation_survivors.append((candidate, trades, item))

    validation_survivors.sort(
        key=lambda item: selection_score(item[2]["validation"], item[2]["validationUnified"], item[2]["validationBaseline"]),
        reverse=True,
    )
    winner = validation_survivors[0] if validation_survivors else None
    winner_payload = None
    status = "ASTER_ONLY_V31_NO_VALIDATED_V96_IDLE_CRYPTO_FALLBACK"

    if winner is not None:
        candidate, trades, selected = winner
        full, full_rejects = standalone_scenarios(trades, all_days)
        final, final_rejects = standalone_scenarios(trades, splits["FINAL_REUSED"])
        holdout_result, holdout_rejects = standalone_scenarios(trades, holdout)
        unified_full = {}
        unified_full_diag = {}
        for scenario in COSTS:
            unified_full[scenario], unified_full_diag[scenario] = unified_metrics(
                crypto, v11_rows, v19_rows, trades, all_days, scenario, v96_intervals
            )
        normal_rows, _ = accepted_rows(trades, COSTS["NORMAL"], all_days)
        p95_rows, _ = accepted_rows(trades, COSTS["P95"], all_days)
        normal_rows, _ = daily_loss_filter(normal_rows)
        p95_rows, _ = daily_loss_filter(p95_rows)
        normal_without_month, normal_month = remove_best_month(normal_rows)
        p95_without_month, p95_month = remove_best_month(p95_rows)
        overlap_count = sum(
            overlaps(priority_intervals, int(row["entryTs"]), int(row["exitTs"]))
            for row in trades
        )
        checks = {
            "normalReturnAtLeast50Pct": full["NORMAL"]["compoundedReturnPct"] >= 50.0,
            "p95ReturnAtLeast30Pct": full["P95"]["compoundedReturnPct"] >= 30.0,
            "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.50,
            "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
            "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
            "validationMinimumTenTrades": selected["validation"]["NORMAL"]["trades"] >= 10,
            "validationNormalAndP95Positive": selected["validation"]["NORMAL"]["compoundedReturnPct"] > 0 and selected["validation"]["P95"]["compoundedReturnPct"] > 0,
            "validationProfitFactorAtLeast1_2": (selected["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
            "finalNormalAndP95Positive": final["NORMAL"]["compoundedReturnPct"] > 0 and final["P95"]["compoundedReturnPct"] > 0,
            "holdoutMinimumThreeTrades": holdout_result["NORMAL"]["trades"] >= 3,
            "holdoutNormalAndP95Positive": holdout_result["NORMAL"]["compoundedReturnPct"] > 0 and holdout_result["P95"]["compoundedReturnPct"] > 0,
            "bestTradeRemovedNormalAndP95Positive": metrics(remove_best(normal_rows))["compoundedReturnPct"] > 0 and metrics(remove_best(p95_rows))["compoundedReturnPct"] > 0,
            "bestMonthRemovedNormalAndP95Positive": metrics(normal_without_month)["compoundedReturnPct"] > 0 and metrics(p95_without_month)["compoundedReturnPct"] > 0,
            "severeNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
            "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
            "unifiedNormalAboveBaseline": unified_full["NORMAL"]["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"],
            "unifiedP95AboveBaseline": unified_full["P95"]["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"],
            "unifiedDrawdownNotWorseByMoreThanTwoPoints": unified_full["NORMAL"]["maxDrawdownPct"] >= baseline["NORMAL"]["maxDrawdownPct"] - 2.0,
            "zeroPriorityOverlap": overlap_count == 0,
        }
        accepted = all(checks.values())
        status = "ASTER_ONLY_V31_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V31_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "accepted": accepted,
            "checks": checks,
            "fullStandalone": full,
            "finalReusedStandalone": final,
            "holdoutStandalone": holdout_result,
            "unifiedFull": unified_full,
            "baselineUnified": baseline,
            "selection": selected,
            "rawTrades": len(trades),
            "priorityOverlapCount": overlap_count,
            "robustness": {
                "normalBestTradeRemoved": metrics(remove_best(normal_rows)),
                "p95BestTradeRemoved": metrics(remove_best(p95_rows)),
                "normalBestMonthRemoved": {"month": normal_month, "metrics": metrics(normal_without_month)},
                "p95BestMonthRemoved": {"month": p95_month, "metrics": metrics(p95_without_month)},
            },
            "rejects": {"full": full_rejects, "final": final_rejects, "holdout": holdout_rejects},
            "unifiedDiagnostics": unified_full_diag,
        }

    diagnostics.sort(
        key=lambda item: item["development"]["NORMAL"]["compoundedReturnPct"] + item["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_diagnostics.sort(
        key=lambda item: selection_score(item["validation"], item["validationUnified"], item["validationBaseline"]),
        reverse=True,
    )

    return rounded({
        "version": 31,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baselineUnified": baseline,
        "baselineDiagnostics": baseline_diag,
        "topDevelopmentDiagnostics": diagnostics[:12],
        "topValidationDiagnostics": validation_diagnostics[:12],
        "period": {
            "startInclusiveUtc": BT_START.isoformat(),
            "endExclusiveUtc": BT_END.isoformat(),
            "calendarDays": (BT_END - BT_START).days,
            "decisionSlots": len(slots),
            "developmentDays": len(splits["DEVELOPMENT"]),
            "validationDays": len(splits["VALIDATION"]),
            "finalDays": len(splits["FINAL_REUSED"]),
            "holdoutDays": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "universe": list(UNIVERSE),
            "maximumConcurrentGross": MAX_GROSS,
            "maximumConcurrentPositions": 1,
            "maximumHoldingHours": 4,
            "decisionGridHoursUtc": [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
            "v96Priority": True,
            "v11EqPriority": True,
            "v19Priority": True,
            "forcedUtilization": False,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopSixty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": {
            "market": market_diag,
            "features": feature_diag,
            "v96": v96_diag,
            "stock": stock_diag,
            "priorityIntervals": {
                "v96": len(v96_intervals),
                "stock": len(stock_intervals),
                "merged": len(priority_intervals),
            },
        },
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
        "# Aster-only V31 V96-Idle Crypto Fallback", "",
        f"Status: **{result['status']}**", "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}", "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Standalone Normal: {winner['fullStandalone']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Standalone P95: {winner['fullStandalone']['P95']['compoundedReturnPct']:.6f}%",
            f"Standalone DD: {winner['fullStandalone']['NORMAL']['maxDrawdownPct']:.6f}%",
            f"Unified Normal: {winner['unifiedFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Baseline Normal: {winner['baselineUnified']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Priority overlaps: {winner['priorityOverlapCount']}", "",
        ]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.", ""]
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
        "candidateCount": result["candidateCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "baselineUnified": result["baselineUnified"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
        "topValidationDiagnostics": result["topValidationDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
