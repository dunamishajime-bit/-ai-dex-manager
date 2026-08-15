"""Build a research-only hourly Binance USD-M metrics cache.

Input archives are Binance public daily USD-M `metrics` ZIP files. The fetcher
is intentionally sealed to the already-inspected design interval
2023-07-01T00:00:00Z <= t < 2026-07-01T00:00:00Z. It refuses any post-boundary
request before URL generation, so rejected-pair Fresh OOS remains untouched.

The source files contain 5-minute snapshots. For each UTC candle hour we retain
the final snapshot inside that hour (normally HH:55), which is causal for a
signal evaluated after that hourly candle closes and entered on the next bar.

This module is research infrastructure only and is not imported by production,
VPS, LIVE, or order code.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

UTC = dt.timezone.utc
START = dt.datetime(2023, 7, 1, tzinfo=UTC)
END = dt.datetime(2026, 7, 1, tzinfo=UTC)  # exclusive; Fresh OOS starts here
SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT")
BASE = "https://data.binance.vision/data/futures/um/daily/metrics"
EXPECTED_HEADER = (
    "create_time",
    "symbol",
    "sum_open_interest",
    "sum_open_interest_value",
    "count_toptrader_long_short_ratio",
    "sum_toptrader_long_short_ratio",
    "count_long_short_ratio",
    "sum_taker_long_short_vol_ratio",
)
CACHE_VERSION = "v1"
DEFAULT_ROOT = Path(".cache/research-usdm-metrics-v1")
MAX_WORKERS = 32
RETRIES = 3


def day_range(start: dt.datetime, end: dt.datetime):
    cur = start.date()
    last = end.date()
    while cur < last:
        yield cur
        cur += dt.timedelta(days=1)


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


def archive_url(symbol: str, day: dt.date) -> str:
    if day < START.date() or day >= END.date():
        raise RuntimeError(f"METRICS_OOS_FIREWALL_BLOCK:{symbol}:{day.isoformat()}")
    date = day.isoformat()
    name = f"{symbol}-metrics-{date}.zip"
    return f"{BASE}/{symbol}/{name}"


def download_day(symbol: str, day: dt.date) -> dict[str, Any]:
    url = archive_url(symbol, day)
    last_error: str | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "research-usdm-metrics-cache/1.0"})
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
            if len(payload) < 100:
                raise RuntimeError(f"SMALL_ARCHIVE:{len(payload)}")
            with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
                if len(names) != 1:
                    raise RuntimeError(f"CSV_COUNT:{len(names)}")
                raw = zf.read(names[0]).decode("utf-8-sig", errors="strict")
            reader = csv.DictReader(io.StringIO(raw))
            header = tuple(reader.fieldnames or ())
            if header != EXPECTED_HEADER:
                raise RuntimeError("HEADER_MISMATCH:" + "|".join(header))
            rows = []
            for item in reader:
                ts = parse_time(item["create_time"])
                if ts.date() != day:
                    raise RuntimeError(f"CROSS_DAY_ROW:{ts.isoformat()}")
                if not (START <= ts < END):
                    raise RuntimeError(f"FRESH_OOS_ROW_BLOCK:{ts.isoformat()}")
                if item["symbol"].strip().upper() != symbol:
                    raise RuntimeError(f"SYMBOL_MISMATCH:{item['symbol']}:{symbol}")
                rows.append({
                    "ts": int(ts.timestamp() * 1000),
                    "openInterest": float(item["sum_open_interest"]),
                    "openInterestValue": float(item["sum_open_interest_value"]),
                    "topTraderCountLongShort": float(item["count_toptrader_long_short_ratio"]),
                    "topTraderPositionLongShort": float(item["sum_toptrader_long_short_ratio"]),
                    "globalLongShort": float(item["count_long_short_ratio"]),
                    "takerLongShortVol": float(item["sum_taker_long_short_vol_ratio"]),
                })
            if len(rows) < 250:
                raise RuntimeError(f"TOO_FEW_5M_ROWS:{len(rows)}")
            rows.sort(key=lambda r: r["ts"])
            hourly: dict[int, dict[str, Any]] = {}
            for row in rows:
                hour = int(row["ts"] // 3_600_000 * 3_600_000)
                hourly[hour] = row  # final 5m snapshot wins
            return {
                "symbol": symbol,
                "day": day.isoformat(),
                "url": url,
                "available": True,
                "rawRows": len(rows),
                "hourly": [dict(v, hourTs=k) for k, v in sorted(hourly.items())],
            }
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {"symbol": symbol, "day": day.isoformat(), "url": url, "available": False, "httpStatus": 404}
            last_error = f"HTTP_{exc.code}"
        except Exception as exc:
            last_error = f"{type(exc).__name__}:{str(exc)[:200]}"
        if attempt < RETRIES:
            time.sleep(0.25 * attempt)
    return {"symbol": symbol, "day": day.isoformat(), "url": url, "available": False, "error": last_error}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_existing(root: Path) -> dict[str, Any] | None:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if manifest.get("cacheVersion") != CACHE_VERSION:
        return None
    if manifest.get("start") != START.isoformat() or manifest.get("endExclusive") != END.isoformat():
        return None
    for symbol in SYMBOLS:
        meta = manifest.get("symbols", {}).get(symbol)
        path = root / f"{symbol}.hourly.json.gz"
        if not meta or not path.is_file() or sha256_file(path) != meta.get("sha256"):
            return None
    return manifest


def write_symbol(root: Path, symbol: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    path = root / f"{symbol}.hourly.json.gz"
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as fh:
        json.dump(rows, fh, separators=(",", ":"), sort_keys=True)
    return {
        "path": str(path),
        "rows": len(rows),
        "firstHourTs": rows[0]["hourTs"] if rows else None,
        "lastHourTs": rows[-1]["hourTs"] if rows else None,
        "sha256": sha256_file(path),
    }


def build(root: Path) -> dict[str, Any]:
    root.mkdir(parents=True, exist_ok=True)
    existing = validate_existing(root)
    if existing is not None:
        print("METRICS_EXACT_CACHE_READY")
        return existing

    days = list(day_range(START, END))
    tasks = [(s, d) for s in SYMBOLS for d in days]
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(download_day, s, d): (s, d) for s, d in tasks}
        for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            result = fut.result()
            results.append(result)
            if n % 250 == 0 or n == len(tasks):
                ok = sum(bool(r.get("available")) for r in results)
                print(f"METRICS_FETCH_PROGRESS:{n}/{len(tasks)}:available={ok}", flush=True)

    by_symbol: dict[str, list[dict[str, Any]]] = {s: [] for s in SYMBOLS}
    missing_by_symbol: dict[str, list[str]] = {s: [] for s in SYMBOLS}
    raw_rows_by_symbol = {s: 0 for s in SYMBOLS}
    for result in results:
        symbol = result["symbol"]
        if result.get("available"):
            raw_rows_by_symbol[symbol] += int(result.get("rawRows", 0))
            by_symbol[symbol].extend(result.get("hourly", []))
        else:
            missing_by_symbol[symbol].append(result["day"])

    expected_days = len(days)
    expected_hours = expected_days * 24
    symbol_meta: dict[str, Any] = {}
    for symbol in SYMBOLS:
        # Dedupe by causal hour key, then require near-complete coverage.
        dedup = {int(row["hourTs"]): row for row in by_symbol[symbol]}
        rows = [dedup[k] for k in sorted(dedup)]
        if rows and int(rows[-1]["hourTs"]) >= int(END.timestamp() * 1000):
            raise RuntimeError(f"FRESH_OOS_CACHE_CONTAMINATION:{symbol}:{rows[-1]['hourTs']}")
        day_coverage = (expected_days - len(missing_by_symbol[symbol])) / expected_days
        hour_coverage = len(rows) / expected_hours
        if day_coverage < 0.98:
            raise RuntimeError(f"METRICS_DAY_COVERAGE_FAIL:{symbol}:{day_coverage:.6f}:{len(missing_by_symbol[symbol])}")
        if hour_coverage < 0.97:
            raise RuntimeError(f"METRICS_HOUR_COVERAGE_FAIL:{symbol}:{hour_coverage:.6f}:{len(rows)}/{expected_hours}")
        meta = write_symbol(root, symbol, rows)
        meta.update({
            "expectedDays": expected_days,
            "missingDays": missing_by_symbol[symbol],
            "dayCoverage": day_coverage,
            "expectedHours": expected_hours,
            "hourCoverage": hour_coverage,
            "raw5mRows": raw_rows_by_symbol[symbol],
        })
        symbol_meta[symbol] = meta

    manifest = {
        "cacheVersion": CACHE_VERSION,
        "source": "binance-data-vision-usdm-daily-metrics",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "strategyEvaluationPerformed": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "freshOosBoundaryExclusiveMs": int(END.timestamp() * 1000),
        "start": START.isoformat(),
        "endExclusive": END.isoformat(),
        "schema": list(EXPECTED_HEADER),
        "hourlyRule": "last 5m metrics snapshot inside each UTC candle hour",
        "symbols": symbol_meta,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def self_test_firewall() -> None:
    try:
        archive_url("AVAXUSDT", END.date())
    except RuntimeError as exc:
        if "METRICS_OOS_FIREWALL_BLOCK" not in str(exc):
            raise
        print("METRICS_OOS_FIREWALL_SELFTEST_PASS")
        return
    raise RuntimeError("METRICS_OOS_FIREWALL_SELFTEST_FAILED")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--firewall-self-test", action="store_true")
    args = parser.parse_args()
    if args.firewall_self_test:
        self_test_firewall()
        return
    build(Path(args.root))


if __name__ == "__main__":
    main()
