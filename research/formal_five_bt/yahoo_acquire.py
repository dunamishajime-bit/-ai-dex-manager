"""Read-only Yahoo Finance 60-minute equity data acquisition for V52 research.

Outputs only to a caller-specified local directory. Raw provider pages are
hashed but deliberately not committed or redistributed through this package.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time as wallclock
from typing import Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .calendars import is_nyse_core_open, nyse_close_utc
from .yahoo_v52 import STOCKS, load_yahoo_bars

NY = ZoneInfo("America/New_York")
BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
Fetch = Callable[[str], bytes]


def _fetch(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; BT-research/1.0)", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urlopen(req, timeout=25) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            wallclock.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def yahoo_hourly_page(symbol: str, begin: datetime, end: datetime, fetch: Fetch = _fetch
                      ) -> tuple[list[dict], dict]:
    if symbol not in STOCKS or begin.tzinfo is None or end.tzinfo is None or not begin < end:
        raise ValueError("V52_YAHOO_INVALID_QUERY")
    params = urlencode({
        "period1": int(begin.timestamp()), "period2": int(end.timestamp()),
        "interval": "60m", "includePrePost": "false", "events": "splits,div",
    })
    url = BASE + symbol + "?" + params
    raw = fetch(url)
    source_hash = hashlib.sha256(raw).hexdigest()
    payload = json.loads(raw)
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"V52_YAHOO_PROVIDER_REJECTED:{chart['error'].get('code', 'UNKNOWN')}")
    results = chart.get("result") or []
    if len(results) != 1:
        raise ValueError("V52_YAHOO_EMPTY_OR_MALFORMED_PAGE")
    item = results[0]
    meta = item.get("meta") or {}
    if meta.get("currency") != "USD" or meta.get("exchangeTimezoneName") != "America/New_York":
        raise ValueError("V52_YAHOO_UNEXPECTED_CURRENCY_OR_EXCHANGE")
    timestamps = item.get("timestamp") or []
    quotes = ((item.get("indicators") or {}).get("quote") or [])
    if len(quotes) != 1:
        raise ValueError("V52_YAHOO_QUOTE_SERIES_MISSING")
    q = quotes[0]
    if any(len(q.get(name) or []) != len(timestamps) for name in ("open", "high", "low", "close", "volume")):
        raise ValueError("V52_YAHOO_QUOTE_LENGTH_MISMATCH")
    records = []
    for n, seconds in enumerate(timestamps):
        start = datetime.fromtimestamp(seconds, timezone.utc)
        if not (begin <= start < end) or not is_nyse_core_open(start + timedelta(seconds=1)):
            continue
        close_time = nyse_close_utc(start.astimezone(NY).date())
        if close_time is None:
            continue
        end_at = min(start + timedelta(hours=1), close_time)
        if end_at <= start:
            continue
        if any(q[key][n] is None for key in ("open", "high", "low", "close", "volume")):
            continue
        records.append({
            "source": "YAHOO_FINANCE", "symbol": symbol, "interval": "60m",
            "event_time_ms": int(start.timestamp() * 1000),
            "bar_end_time_ms": int(end_at.timestamp() * 1000),
            "open": q["open"][n], "high": q["high"][n],
            "low": q["low"][n], "close": q["close"][n],
            "volume": q["volume"][n], "source_sha256": source_hash,
        })
    return records, {
        "provider": "Yahoo Finance v8 chart", "symbol": symbol, "interval": "60m",
        "requested_start_utc": begin.isoformat(), "requested_end_utc": end.isoformat(),
        "actual_rows": len(records), "response_sha256": source_hash,
        "corporate_action_splits": item.get("events", {}).get("splits", {}),
    }


def acquire_yahoo_v52(root: Path, begin: date = date(2025, 8, 10),
                      end_exclusive: date = date(2026, 8, 11),
                      fetch: Fetch = _fetch) -> dict:
    if end_exclusive <= begin:
        raise ValueError("V52_YAHOO_BAD_PERIOD")
    root.mkdir(parents=True, exist_ok=True)
    coverage: dict = {"model": "YAHOO_60M_PRICE_ONLY", "status": "PARTIAL_UNTIL_CHECKED",
                      "symbols": {}, "start": begin.isoformat(), "end_exclusive": end_exclusive.isoformat()}
    for symbol in sorted(STOCKS):
        cursor = datetime.combine(begin, time(), timezone.utc)
        final = datetime.combine(end_exclusive, time(), timezone.utc)
        pages = []
        merged = []
        while cursor < final:
            until = min(cursor + timedelta(days=30), final)
            try:
                rows, page = yahoo_hourly_page(symbol, cursor, until, fetch=fetch)
                merged.extend(rows)
                pages.append(page)
                if fetch is _fetch:
                    wallclock.sleep(0.6)  # Avoid bursty public Yahoo chart calls.
            except Exception as error:
                pages.append({"start_utc": cursor.isoformat(), "end_utc": until.isoformat(),
                              "status": "NOT_VERIFIABLE_ACQUISITION_ERROR", "reason": str(error)[:180]})
            cursor = until
        merged.sort(key=lambda row: row["event_time_ms"])
        output = root / "normalized" / "yahoo" / "60m" / f"{symbol}.jsonl"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"".join(
            (json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
            for row in merged))
        try:
            accepted = load_yahoo_bars(output, symbol)
            expected_starts: set[int] = set()
            day = begin
            while day < end_exclusive:
                close_at = nyse_close_utc(day)
                if close_at is not None:
                    candle = datetime.combine(day, time(9, 30), NY).astimezone(timezone.utc)
                    while candle < close_at:
                        expected_starts.add(int(candle.timestamp() * 1000))
                        candle += timedelta(hours=1)
                day += timedelta(days=1)
            actual_starts = {bar.start_ms for bar in accepted}
            missing_hours = len(expected_starts - actual_starts)
            extra_hours = len(actual_starts - expected_starts)
            page_errors = sum("status" in page for page in pages)
            status = ("COVERAGE_COMPLETE" if not (missing_hours or extra_hours or page_errors)
                      else "COVERAGE_PARTIAL")
        except (ValueError, KeyError, TypeError) as error:
            accepted, status = (), f"NOT_VERIFIABLE:{error}"
            missing_hours, extra_hours, page_errors = None, None, sum("status" in page for page in pages)
        coverage["symbols"][symbol] = {
            "status": status, "rows": len(accepted), "first_bar_ms": accepted[0].start_ms if accepted else None,
            "last_bar_end_ms": accepted[-1].end_ms if accepted else None,
            "missing_session_hours": missing_hours, "unexpected_session_hours": extra_hours,
            "page_errors": page_errors, "normalized_sha256":
            hashlib.sha256(output.read_bytes()).hexdigest(), "pages": pages,
        }
    dest = root / "yahoo-v52-coverage.json"
    dest.write_text(json.dumps(coverage, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return coverage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2025, 8, 10))
    parser.add_argument("--end-exclusive", type=date.fromisoformat, default=date(2026, 8, 11))
    args = parser.parse_args()
    result = acquire_yahoo_v52(args.output_root, args.start, args.end_exclusive)
    print(json.dumps({"symbols": {s: {"status": r["status"], "rows": r["rows"]}
                                  for s, r in result["symbols"].items()}}, sort_keys=True))


if __name__ == "__main__":
    main()
