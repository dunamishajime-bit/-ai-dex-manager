from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13_HISTORICAL_PROXY"
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
ASTER_SYMBOL = {symbol: f"{symbol}USDT" for symbol in SYMBOLS}
XYZ_COIN = {symbol: f"xyz:{symbol}" for symbol in SYMBOLS}
ASTER_KLINES_URL = "https://fapi.asterdex.com/fapi/v1/klines"
XYZ_INFO_URL = "https://api.hyperliquid.xyz/info"
UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
FIXED_END_UTC = dt.datetime(2026, 7, 24, 0, 0, tzinfo=UTC)
INTERVAL_MS = {"1m": 60_000, "15m": 15 * 60_000}
MAX_XYZ_CANDLES = 5000
ENTRY_EDGE_BPS = 12.0
NOTIONAL_USD = 100.0
QUEUE_PLUS_ORDER_USD = 350.0
TWO_MAKER_COSTS = {"FORWARD_MEDIAN": 6.0, "NORMAL": 10.0, "P95": 17.0, "SEVERE": 30.0}
FORCED_TAKER_COSTS = {"FORWARD_MEDIAN": 10.0, "NORMAL": 16.0, "P95": 26.0, "SEVERE": 45.0}
FILL_MODELS = ("OPEN_CROSS_STRICT", "INTRABAR_TOUCH_UPPER")
MAKER_VENUES = ("ASTER", "XYZ")


def finite(value: object) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def request_json(url: str, payload: Optional[dict] = None, timeout: int = 35):
    headers = {"Accept": "application/json", "User-Agent": "DisDex-V13-Historical-Proxy/1.0"}
    body = None
    method = "GET"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        method = "POST"
    error: Optional[Exception] = None
    for attempt in range(6):
        try:
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            error = exc
            time.sleep(min(8.0, 0.7 * (2 ** attempt)))
    raise RuntimeError(f"request failed after retries: {url}: {error}")


def start_ms(interval: str) -> int:
    return int(FIXED_END_UTC.timestamp() * 1000) - MAX_XYZ_CANDLES * INTERVAL_MS[interval]


def end_ms() -> int:
    return int(FIXED_END_UTC.timestamp() * 1000) - 1


def cache_read(path: Path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def cache_write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def fetch_aster(symbol: str, interval: str, cache_dir: Path) -> List[list]:
    path = cache_dir / f"aster-{symbol}-{interval}-{FIXED_END_UTC.date()}.json"
    cached = cache_read(path)
    if isinstance(cached, list):
        return cached
    cursor = start_ms(interval)
    stop = end_ms()
    rows: List[list] = []
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": ASTER_SYMBOL[symbol],
            "interval": interval,
            "startTime": cursor,
            "endTime": stop,
            "limit": 1500,
        })
        page = request_json(f"{ASTER_KLINES_URL}?{query}")
        clean = [row for row in page if isinstance(row, list) and len(row) >= 6]
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row[0]) for row in clean) + INTERVAL_MS[interval]
        if next_cursor <= cursor or len(clean) < 1500:
            break
        cursor = next_cursor
        time.sleep(0.05)
    dedup = {int(row[0]): row for row in rows if start_ms(interval) <= int(row[0]) <= stop}
    result = [dedup[key] for key in sorted(dedup)]
    cache_write(path, result)
    return result


def fetch_xyz_meta(cache_dir: Path) -> dict:
    path = cache_dir / "xyz-meta.json"
    cached = cache_read(path)
    if isinstance(cached, dict):
        return cached
    payload = request_json(XYZ_INFO_URL, {"type": "meta", "dex": "xyz"})
    cache_write(path, payload)
    return payload


def fetch_xyz(symbol: str, interval: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"xyz-{symbol}-{interval}-{FIXED_END_UTC.date()}.json"
    cached = cache_read(path)
    if isinstance(cached, list):
        return cached
    payload = request_json(XYZ_INFO_URL, {
        "type": "candleSnapshot",
        "req": {
            "coin": XYZ_COIN[symbol],
            "interval": interval,
            "startTime": start_ms(interval),
            "endTime": end_ms(),
        },
    })
    rows = payload if isinstance(payload, list) else []
    dedup = {int(row["t"]): row for row in rows if isinstance(row, dict) and row.get("t") is not None}
    result = [dedup[key] for key in sorted(dedup)]
    cache_write(path, result)
    return result


def parse_aster(rows: Sequence[list]) -> Dict[int, dict]:
    result: Dict[int, dict] = {}
    for row in rows:
        values = [finite(row[index]) for index in (1, 2, 3, 4, 5)]
        if any(value is None for value in values):
            continue
        open_price, high, low, close, volume = values
        if min(open_price, high, low, close) <= 0 or volume < 0:
            continue
        result[int(row[0])] = {
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    return result


def parse_xyz(rows: Sequence[dict]) -> Dict[int, dict]:
    result: Dict[int, dict] = {}
    for row in rows:
        values = [finite(row.get(key)) for key in ("o", "h", "l", "c", "v")]
        if any(value is None for value in values) or row.get("t") is None:
            continue
        open_price, high, low, close, volume = values
        if min(open_price, high, low, close) <= 0 or volume < 0:
            continue
        result[int(row["t"])] = {
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    return result


def regular_bar_start(ts_ms: int) -> bool:
    local = dt.datetime.fromtimestamp(ts_ms / 1000, tz=UTC).astimezone(NY)
    minute = local.hour * 60 + local.minute
    return local.weekday() < 5 and 570 <= minute < 960


def day_string(ts_ms: int) -> str:
    return dt.datetime.fromtimestamp(ts_ms / 1000, tz=UTC).astimezone(NY).date().isoformat()


def side_for(spread_bps: float, venue: str) -> int:
    aster_side = -1 if spread_bps > 0 else 1
    return aster_side if venue == "ASTER" else -aster_side


def fill_reached(side: int, quote: float, bar: dict, fill_model: str) -> bool:
    if fill_model == "OPEN_CROSS_STRICT":
        return bar["open"] <= quote if side > 0 else bar["open"] >= quote
    return bar["low"] <= quote if side > 0 else bar["high"] >= quote


def build_trades(
    interval: str,
    symbol: str,
    aster: Dict[int, dict],
    xyz: Dict[int, dict],
    maker_venue: str,
    fill_model: str,
) -> List[dict]:
    step = INTERVAL_MS[interval]
    common = sorted(set(aster) & set(xyz))
    common_set = set(common)
    rows: List[dict] = []
    next_free_ts = -1
    for signal_ts in common:
        quote_ts = signal_ts + step
        exit_ts = quote_ts + step
        if signal_ts < next_free_ts:
            continue
        if quote_ts not in common_set or exit_ts not in common_set:
            continue
        if not regular_bar_start(quote_ts) or not regular_bar_start(exit_ts):
            continue
        a_signal, x_signal = aster[signal_ts], xyz[signal_ts]
        spread_bps = (a_signal["close"] / x_signal["close"] - 1.0) * 10_000.0
        if abs(spread_bps) < ENTRY_EDGE_BPS:
            continue
        maker_signal = a_signal if maker_venue == "ASTER" else x_signal
        maker_quote_bar = aster[quote_ts] if maker_venue == "ASTER" else xyz[quote_ts]
        hedge_quote_bar = xyz[quote_ts] if maker_venue == "ASTER" else aster[quote_ts]
        maker_exit_bar = aster[exit_ts] if maker_venue == "ASTER" else xyz[exit_ts]
        hedge_exit_bar = xyz[exit_ts] if maker_venue == "ASTER" else aster[exit_ts]
        maker_side = side_for(spread_bps, maker_venue)
        hedge_side = -maker_side
        quote_price = maker_signal["close"]
        volume_capacity_usd = maker_quote_bar["volume"] * maker_quote_bar["close"]
        if volume_capacity_usd < QUEUE_PLUS_ORDER_USD:
            continue
        if not fill_reached(maker_side, quote_price, maker_quote_bar, fill_model):
            continue
        quantity = NOTIONAL_USD / quote_price
        hedge_open = hedge_quote_bar["open"]
        maker_exit = maker_exit_bar["open"]
        hedge_exit = hedge_exit_bar["open"]
        gross_pnl = quantity * (
            maker_side * (maker_exit - quote_price)
            + hedge_side * (hedge_exit - hedge_open)
        )
        gross_bps = gross_pnl / NOTIONAL_USD * 10_000.0
        rows.append({
            "interval": interval,
            "symbol": symbol,
            "day": day_string(quote_ts),
            "signalTs": signal_ts,
            "quoteTs": quote_ts,
            "exitTs": exit_ts,
            "makerVenue": maker_venue,
            "fillModel": fill_model,
            "spreadBps": spread_bps,
            "makerSide": "BUY" if maker_side > 0 else "SELL",
            "makerQuotePrice": quote_price,
            "hedgeOpenPrice": hedge_open,
            "makerExitPrice": maker_exit,
            "hedgeExitPrice": hedge_exit,
            "quantity": quantity,
            "makerBarVolumeCapacityUsd": volume_capacity_usd,
            "grossBps": gross_bps,
        })
        next_free_ts = exit_ts + step
    return rows


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    if losses > 1e-12:
        return gains / losses
    return 999.0 if gains > 0 else None


def percentile(values: Sequence[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lo, hi = math.floor(position), math.ceil(position)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - position) + ordered[hi] * (position - lo)


def summarize(trades: Sequence[dict], cost_bps: float) -> dict:
    nets = [float(row["grossBps"]) - cost_bps for row in trades]
    by_symbol = {symbol: 0.0 for symbol in SYMBOLS}
    for row, net in zip(trades, nets):
        by_symbol[row["symbol"]] += net
    positive_total = sum(max(0.0, value) for value in by_symbol.values())
    max_share = (
        max((max(0.0, value) for value in by_symbol.values()), default=0.0) / positive_total
        if positive_total > 0 else None
    )
    return {
        "cycles": len(nets),
        "sessions": len({row["day"] for row in trades}),
        "averageNetBps": statistics.mean(nets) if nets else None,
        "medianNetBps": statistics.median(nets) if nets else None,
        "p05NetBps": percentile(nets, 0.05),
        "minimumNetBps": min(nets) if nets else None,
        "maximumNetBps": max(nets) if nets else None,
        "positiveNetRate": sum(value > 0 for value in nets) / len(nets) if nets else None,
        "profitFactor": profit_factor(nets),
        "totalNetBps": sum(nets),
        "bySymbolNetBps": by_symbol,
        "maxPositiveProfitContributionShare": max_share,
    }


def split_days(trades: Sequence[dict]) -> dict:
    days = sorted({row["day"] for row in trades})
    if len(days) < 5:
        return {"FULL_ONLY": (days[0], days[-1])} if days else {}
    dev_end = max(1, int(len(days) * 0.60))
    val_end = max(dev_end + 1, int(len(days) * 0.80))
    return {
        "DEVELOPMENT": (days[0], days[dev_end - 1]),
        "VALIDATION": (days[dev_end], days[val_end - 1]),
        "HOLDOUT": (days[val_end], days[-1]),
    }


def subset(trades: Sequence[dict], bounds: Tuple[str, str]) -> List[dict]:
    return [row for row in trades if bounds[0] <= row["day"] <= bounds[1]]


def scenario_report(trades: Sequence[dict], costs: Dict[str, float]) -> dict:
    splits = split_days(trades)
    return {
        "full": {name: summarize(trades, cost) for name, cost in costs.items()},
        "periods": {
            period: {name: summarize(subset(trades, bounds), cost) for name, cost in costs.items()}
            for period, bounds in splits.items()
        },
        "periodBounds": splits,
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


def historical_status(results: dict) -> str:
    strict_rows = []
    for maker in MAKER_VENUES:
        node = results["1m"][maker]["OPEN_CROSS_STRICT"]["forcedTakerCosts"]["full"]
        strict_rows.append(node)
    if any(row["NORMAL"]["cycles"] < 20 for row in strict_rows):
        return "V13_HISTORICAL_PROXY_INSUFFICIENT_STRICT_FILLS"
    passed = all(
        row[scenario]["averageNetBps"] is not None and row[scenario]["averageNetBps"] > 0
        for row in strict_rows for scenario in ("NORMAL", "P95", "SEVERE")
    ) and all(
        row["NORMAL"]["positiveNetRate"] is not None and row["NORMAL"]["positiveNetRate"] >= 0.55
        for row in strict_rows
    )
    if passed:
        return "V13_HISTORICAL_PROXY_POSITIVE_FORWARD_EXECUTION_STILL_REQUIRED"
    if all((row["NORMAL"]["averageNetBps"] or 0.0) <= 0 for row in strict_rows):
        return "V13_HISTORICAL_PROXY_FAILED_NORMAL_ECONOMICS"
    return "V13_HISTORICAL_PROXY_MIXED_INCONCLUSIVE"


def analyze(cache_dir: Path) -> dict:
    xyz_meta = fetch_xyz_meta(cache_dir)
    universe = xyz_meta.get("universe") if isinstance(xyz_meta, dict) else []
    meta_names = sorted(str(row.get("name")) for row in universe or [] if isinstance(row, dict) and row.get("name"))
    missing = [symbol for symbol in SYMBOLS if XYZ_COIN[symbol] not in meta_names]
    if missing:
        return {
            "strategyId": STRATEGY_ID,
            "status": "V13_HISTORICAL_PROXY_SYMBOL_COVERAGE_FAILED",
            "missingSymbols": missing,
            "metaNames": meta_names,
        }

    raw: Dict[Tuple[str, str, str], Sequence] = {}
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for interval in INTERVAL_MS:
            for symbol in SYMBOLS:
                jobs.append(("ASTER", interval, symbol, pool.submit(fetch_aster, symbol, interval, cache_dir)))
                jobs.append(("XYZ", interval, symbol, pool.submit(fetch_xyz, symbol, interval, cache_dir)))
        for venue, interval, symbol, future in jobs:
            raw[(venue, interval, symbol)] = future.result()
            print(f"loaded {venue} {symbol} {interval}: {len(raw[(venue, interval, symbol)])}")

    parsed: Dict[Tuple[str, str, str], Dict[int, dict]] = {}
    diagnostics = {interval: {symbol: {} for symbol in SYMBOLS} for interval in INTERVAL_MS}
    for interval in INTERVAL_MS:
        for symbol in SYMBOLS:
            aster = parse_aster(raw[("ASTER", interval, symbol)])
            xyz = parse_xyz(raw[("XYZ", interval, symbol)])
            parsed[("ASTER", interval, symbol)] = aster
            parsed[("XYZ", interval, symbol)] = xyz
            common = sorted(set(aster) & set(xyz))
            regular_days = sorted({day_string(ts) for ts in common if regular_bar_start(ts)})
            diagnostics[interval][symbol] = {
                "asterBars": len(aster),
                "xyzBars": len(xyz),
                "alignedBars": len(common),
                "regularSessions": len(regular_days),
                "firstAligned": dt.datetime.fromtimestamp(common[0] / 1000, tz=UTC).isoformat() if common else None,
                "lastAligned": dt.datetime.fromtimestamp(common[-1] / 1000, tz=UTC).isoformat() if common else None,
            }

    all_trades: List[dict] = []
    results = {}
    for interval in INTERVAL_MS:
        results[interval] = {}
        for maker in MAKER_VENUES:
            results[interval][maker] = {}
            for fill_model in FILL_MODELS:
                trades = []
                for symbol in SYMBOLS:
                    trades.extend(build_trades(
                        interval,
                        symbol,
                        parsed[("ASTER", interval, symbol)],
                        parsed[("XYZ", interval, symbol)],
                        maker,
                        fill_model,
                    ))
                trades.sort(key=lambda row: (row["quoteTs"], row["symbol"]))
                all_trades.extend(trades)
                results[interval][maker][fill_model] = {
                    "role": (
                        "60-second historical price-path execution proxy"
                        if interval == "1m" else
                        "15-minute structural persistence diagnostic; not V13 execution parity"
                    ),
                    "twoMakerCosts": scenario_report(trades, TWO_MAKER_COSTS),
                    "forcedTakerCosts": scenario_report(trades, FORCED_TAKER_COSTS),
                }

    payload = {
        "version": 13,
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "fixedDataEndUtc": FIXED_END_UTC.isoformat(),
        "status": "PENDING",
        "universe": list(SYMBOLS),
        "data": {
            "source": "Aster public klines plus Hyperliquid XYZ candleSnapshot",
            "xyzMaximumCandlesPerInterval": MAX_XYZ_CANDLES,
            "intervals": list(INTERVAL_MS),
            "diagnostics": diagnostics,
        },
        "frozenProxyRules": {
            "entryDislocationBps": ENTRY_EDGE_BPS,
            "initialNotionalUsd": NOTIONAL_USD,
            "minimumMakerBarVolumeCapacityUsd": QUEUE_PLUS_ORDER_USD,
            "makerVenuesEvaluatedSeparately": list(MAKER_VENUES),
            "fillModels": {
                "OPEN_CROSS_STRICT": "next bar open must already be at or through the prior completed-bar maker quote",
                "INTRABAR_TOUCH_UPPER": "next bar high/low may touch the maker quote; optimistic fill upper bound",
            },
            "onePositionPerSymbol": True,
            "oneIntervalHold": True,
            "costBps": {"twoMaker": TWO_MAKER_COSTS, "forcedTaker": FORCED_TAKER_COSTS},
            "retuning": False,
        },
        "results": results,
        "limitations": [
            "Historical candles do not contain displayed queue, cancellations ahead, aggressor direction, exact top-of-book, or a 250 ms hedge path.",
            "OPEN_CROSS_STRICT is a conservative price-cross proxy but does not prove a full maker fill after queue consumption.",
            "INTRABAR_TOUCH_UPPER is an optimistic fill upper bound and must never be treated as executable evidence.",
            "The 1-minute test approximates the frozen 60-second inventory horizon; the 15-minute test is structural only.",
            "Hyperliquid exposes only the most recent 5000 candles for each interval, so the 1-minute sample is necessarily short.",
            "No result can replace the fixed Forward order-book and trade-print validation.",
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
    payload["status"] = historical_status(results)
    return rounded(payload)


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    trades = result.pop("trades", [])
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "trades.json").write_text(json.dumps(trades, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V13 Historical Proxy Backtest",
        "",
        f"- Status: **{result['status']}**",
        f"- Fixed data end: `{result.get('fixedDataEndUtc')}`",
        "- Production / LIVE / VPS / Crypto V96 / V11 / Forward collector changed: **NO**",
        "",
        "## 1-minute execution proxy",
        "",
        "| Maker venue | Fill model | Cycles | Sessions | Forced Normal avg bps | Forced P95 avg bps | Forced Severe avg bps | Normal positive rate |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for maker in MAKER_VENUES:
        for fill_model in FILL_MODELS:
            full = result["results"]["1m"][maker][fill_model]["forcedTakerCosts"]["full"]
            normal, p95, severe = full["NORMAL"], full["P95"], full["SEVERE"]
            lines.append(
                f"| {maker} | {fill_model} | {normal['cycles']} | {normal['sessions']} | "
                f"{normal['averageNetBps']} | {p95['averageNetBps']} | {severe['averageNetBps']} | "
                f"{normal['positiveNetRate']} |"
            )
    lines += [
        "",
        "## Interpretation boundary",
        "",
        "The 1-minute result tests whether the cross-venue price path leaves enough gross edge after V13 forced-close cost envelopes. It does not reconstruct queue priority or a 250 ms hedge.",
        "",
        "The 15-minute result is included only as a longer-history structural diagnostic and is not execution parity with V13.",
    ]
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    ts = int(dt.datetime(2026, 7, 23, 14, 0, tzinfo=UTC).timestamp() * 1000)
    step = 60_000
    aster = {
        ts: {"open": 101.0, "high": 101.2, "low": 100.8, "close": 101.0, "volume": 1000.0},
        ts + step: {"open": 101.0, "high": 101.1, "low": 100.9, "close": 101.0, "volume": 1000.0},
        ts + 2 * step: {"open": 100.5, "high": 100.6, "low": 100.4, "close": 100.5, "volume": 1000.0},
    }
    xyz = {
        ts: {"open": 100.0, "high": 100.1, "low": 99.9, "close": 100.0, "volume": 1000.0},
        ts + step: {"open": 100.0, "high": 100.1, "low": 99.9, "close": 100.0, "volume": 1000.0},
        ts + 2 * step: {"open": 100.2, "high": 100.3, "low": 100.1, "close": 100.2, "volume": 1000.0},
    }
    trades = build_trades("1m", "AMZN", aster, xyz, "ASTER", "OPEN_CROSS_STRICT")
    assert len(trades) == 1
    assert trades[0]["makerSide"] == "SELL"
    assert trades[0]["grossBps"] > 0
    assert summarize(trades, 16.0)["cycles"] == 1
    assert fill_reached(1, 100.0, {"open": 101.0, "low": 99.0, "high": 102.0}, "INTRABAR_TOUCH_UPPER")
    print("V13 historical proxy self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v13-historical-proxy")
    parser.add_argument("--output-dir", default=".research-state/v13-historical-proxy")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cache_dir))
    write_outputs(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
