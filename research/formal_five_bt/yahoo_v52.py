"""Yahoo Finance hourly price-only V52 research fills (never exchange-verified fills).

A V52 signal must come from the audited LIVE decision bridge; Yahoo candles are
used only for the user-requested modeled execution price. Never synthesize a V52
signal from Yahoo candles or turn a scheduled check into a trade.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

from .calendars import is_nyse_core_open

STOCKS = frozenset(("AMZN", "META", "MSFT", "NVDA", "TSLA"))
ROUTES = frozenset(("V11_EQ", "V50_POST_OPEN_BASIS"))
INITIAL_GAP_END_MS = int(datetime(2025, 9, 29, tzinfo=timezone.utc).timestamp() * 1000)
MAX_PRICE_AGE_MS = 15 * 60 * 1000


@dataclass(frozen=True, slots=True)
class YahooBar:
    symbol: str
    start_ms: int
    end_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    source_sha256: str


def load_yahoo_bars(path: Path, symbol: str) -> tuple[YahooBar, ...]:
    """Reject bad/misaligned candles and return chronological completed 60m bars.

    Data layout is produced by yahoo_acquire.py under normalized/yahoo/60m.
    No daily candle can serve as an intraday 10:30/11:30/12:30 execution quote.
    """
    if symbol not in STOCKS:
        raise ValueError("V52_UNKNOWN_EQUITY")
    rows: list[YahooBar] = []
    previous_start = -1
    for line in path.read_bytes().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("source") != "YAHOO_FINANCE" or row.get("interval") != "60m" or row.get("symbol") != symbol:
            raise ValueError("V52_YAHOO_INSTRUMENT_OR_INTERVAL_MISMATCH")
        start = int(row["event_time_ms"])
        end = int(row.get("bar_end_time_ms", start + 3_600_000))
        if start <= previous_start or end <= start or end > start + 3_600_000:
            raise ValueError("V52_YAHOO_DUPLICATE_OR_INVALID_TIMESTAMP")
        values = tuple(float(row[key]) for key in ("open", "high", "low", "close", "volume"))
        o, h, l, c, v = values
        if not all(map(math.isfinite, values)) or min(o, h, l, c) <= 0 or v < 0 or l > min(o, c) or h < max(o, c):
            raise ValueError("V52_YAHOO_INVALID_OHLCV")
        digest = str(row.get("source_sha256", ""))
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("V52_YAHOO_SOURCE_HASH_MISSING")
        rows.append(YahooBar(symbol, start, end, o, h, l, c, v, digest))
        previous_start = start
    return tuple(rows)


def model_v52_signal(
    signal: Mapping[str, Any],
    bars: Sequence[YahooBar],
    *,
    omit_initial_gap: bool = True,
    maximum_age_ms: int = MAX_PRICE_AGE_MS,
) -> dict[str, Any]:
    """Model immediate execution using the last *completed* same-session candle.

    This is a deliberate price-only research assumption, not proof of an Aster
    fill, historical order-book liquidity, basis gate, maker queue or slippage.
    """
    result: dict[str, Any] = {
        "strategy_id": "V52", "execution_model": "YAHOO_60M_PRICE_ONLY",
        "fill_verified": False, "realized_pnl_usdt": None,
        "price_usd": None, "price_source_sha256": None,
    }
    if signal.get("status") != "SIGNAL":
        return {**result, "status": "NOT_A_LIVE_SIGNAL"}
    route = str(signal.get("route") or (signal.get("signal") or {}).get("route") or "")
    symbol = str(signal.get("equity_reference_symbol") or signal.get("symbol") or "").upper().removesuffix("USDT")
    if route not in ROUTES or symbol not in STOCKS:
        return {**result, "status": "UNVERIFIED_SIGNAL_ROUTE_OR_SYMBOL"}
    try:
        ts = int(signal["decision_ts_ms"])
    except (KeyError, TypeError, ValueError):
        return {**result, "status": "UNVERIFIED_SIGNAL_TIME"}
    result.update({"route": route, "symbol": symbol, "decision_ts_ms": ts})
    if omit_initial_gap and ts < INITIAL_GAP_END_MS:
        return {**result, "status": "SKIPPED_INITIAL_50_DAY_GAP"}
    at = datetime.fromtimestamp(ts / 1000, timezone.utc)
    if not is_nyse_core_open(at):
        return {**result, "status": "SKIPPED_NYSE_CLOSED"}
    if maximum_age_ms < 0:
        raise ValueError("maximum_age_ms must be nonnegative")
    completed = [bar for bar in bars if bar.symbol == symbol]
    ends = [bar.end_ms for bar in completed]
    if ends != sorted(ends) or len(ends) != len(set(ends)):
        raise ValueError("V52_YAHOO_UNSORTED_OR_DUPLICATE_BARS")
    index = bisect_right(ends, ts) - 1
    if index < 0:
        return {**result, "status": "NOT_VERIFIABLE_NO_ASOF_YAHOO_PRICE"}
    bar = completed[index]
    if ts - bar.end_ms > maximum_age_ms:
        return {**result, "status": "NOT_VERIFIABLE_STALE_YAHOO_PRICE"}
    local_signal_day = at.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).date()
    local_bar_day = datetime.fromtimestamp(bar.end_ms / 1000, timezone.utc).astimezone(
        __import__("zoneinfo").ZoneInfo("America/New_York")).date()
    if local_signal_day != local_bar_day:
        return {**result, "status": "NOT_VERIFIABLE_DIFFERENT_SESSION"}
    return {
        **result, "status": "MODELED_PRICE_FILL", "price_usd": bar.close,
        "price_source_sha256": bar.source_sha256, "price_bar_start_ms": bar.start_ms,
        "price_bar_end_ms": bar.end_ms, "price_age_ms": ts - bar.end_ms,
        "model_assumption": "Immediate decision-time fill at last completed Yahoo 60m close; no book, queue, spread or fees inferred",
    }


def load_v52_signal_scan(path: Path, expected_runtime_sha: str) -> tuple[list[dict[str, Any]], str]:
    """Accept only a scanner output with an explicit matching audited SHA."""
    manifest = path.parent.parent / "signal-scan-manifest.json"
    if not manifest.is_file():
        raise ValueError("V52_SIGNAL_SCAN_MANIFEST_MISSING")
    record = json.loads(manifest.read_text(encoding="utf-8"))
    if record.get("runtime_sha") != expected_runtime_sha:
        raise ValueError("V52_SIGNAL_SCAN_RUNTIME_SHA_MISMATCH")
    raw = path.read_bytes()
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if any(row.get("strategy_id", "V52") != "V52" for row in rows):
        raise ValueError("V52_SIGNAL_SCAN_CONTAINS_WRONG_STRATEGY")
    return rows, hashlib.sha256(raw).hexdigest()
