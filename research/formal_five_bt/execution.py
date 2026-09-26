"""Fail-closed historical fills and protective-order resolution."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from typing import Iterable, Literal


Action = Literal["BUY", "SELL"]
PositionSide = Literal["LONG", "SHORT"]


@dataclass(frozen=True, slots=True)
class HistoricalBook:
    source: str
    exchange: str
    instrument_id: str
    event_time_ms: int
    received_time_ms: int
    bids: tuple[tuple[float, float], ...]
    asks: tuple[tuple[float, float], ...]
    sequence_verified: bool
    snapshot_verified: bool
    content_sha256: str
    proxy: bool = False

    @property
    def verified(self) -> bool:
        return self.sequence_verified and self.snapshot_verified


@dataclass(frozen=True, slots=True)
class FillResult:
    status: str
    reason: str
    action: Action
    quantity: float
    filled_quantity: float
    average_price: float | None
    reference_mid: float | None
    slippage_bps: float | None
    book_sha256: str | None
    source: str | None
    proxy: bool


@dataclass(frozen=True, slots=True)
class ExitResolution:
    exit_price: float | None
    reason: str
    ambiguous_bar: bool
    status: str


def _sha_book(book: HistoricalBook) -> str:
    raw = json.dumps({
        "source": book.source, "exchange": book.exchange, "instrument_id": book.instrument_id,
        "event_time_ms": book.event_time_ms, "received_time_ms": book.received_time_ms,
        "bids": book.bids, "asks": book.asks, "sequence_verified": book.sequence_verified,
        "snapshot_verified": book.snapshot_verified, "proxy": book.proxy,
    }, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def market_order_fill(
    action: Action,
    quantity: float,
    book: HistoricalBook | None,
    *,
    decision_time_ms: int,
    expected_instrument: str,
    max_age_ms: int,
    maximum_slippage_bps: float | None = None,
) -> FillResult:
    """Walk visible depth. Missing or unverifiable books never receive a fill."""
    if action not in {"BUY", "SELL"}:
        raise ValueError("action must be BUY or SELL")
    if not math.isfinite(quantity) or quantity <= 0:
        raise ValueError("quantity must be positive and finite")
    if max_age_ms < 0 or decision_time_ms <= 0:
        raise ValueError("invalid fill time constraints")

    def blocked(reason: str) -> FillResult:
        return FillResult("BLOCKED", reason, action, quantity, 0.0, None, None, None,
                          _sha_book(book) if book else None, book.source if book else None,
                          bool(book and book.proxy))

    if book is None:
        return blocked("BOOK_MISSING")
    if not book.verified:
        return blocked("BOOK_SNAPSHOT_OR_SEQUENCE_UNVERIFIED")
    if book.instrument_id != expected_instrument:
        return blocked("BOOK_INSTRUMENT_MISMATCH")
    if book.event_time_ms > decision_time_ms or book.received_time_ms > decision_time_ms:
        return blocked("BOOK_LOOKAHEAD")
    if decision_time_ms - book.event_time_ms > max_age_ms:
        return blocked("BOOK_STALE")
    if not book.bids or not book.asks:
        return blocked("BOOK_SIDE_MISSING")
    if any(not math.isfinite(price) or not math.isfinite(size) or price <= 0 or size <= 0
           for side in (book.bids, book.asks) for price, size in side):
        return blocked("BOOK_LEVEL_INVALID")
    if any(left[0] < right[0] for left, right in zip(book.bids, book.bids[1:])):
        return blocked("BIDS_NOT_BEST_FIRST")
    if any(left[0] > right[0] for left, right in zip(book.asks, book.asks[1:])):
        return blocked("ASKS_NOT_BEST_FIRST")
    best_bid, best_ask = book.bids[0][0], book.asks[0][0]
    if best_ask < best_bid:
        return blocked("CROSSED_BOOK")
    reference_mid = (best_bid + best_ask) / 2
    levels = book.asks if action == "BUY" else book.bids
    remaining = quantity
    notional = 0.0
    filled = 0.0
    for price, available in levels:
        take = min(remaining, available)
        if take <= 0:
            continue
        notional += take * price
        filled += take
        remaining -= take
        if remaining <= max(1e-12, quantity * 1e-12):
            break
    if remaining > max(1e-12, quantity * 1e-12):
        return FillResult("BLOCKED", "INSUFFICIENT_VISIBLE_DEPTH", action, quantity,
                          filled, None, reference_mid, None, _sha_book(book), book.source, book.proxy)
    average = notional / filled
    raw_slippage = (average / reference_mid - 1) * 10_000
    slippage = raw_slippage if action == "BUY" else -raw_slippage
    if maximum_slippage_bps is not None and slippage > maximum_slippage_bps:
        return FillResult("BLOCKED", "MAX_SLIPPAGE_EXCEEDED", action, quantity, filled,
                          average, reference_mid, slippage, _sha_book(book), book.source, book.proxy)
    return FillResult("FILLED", "DEPTH_WALKED", action, quantity, filled, average,
                      reference_mid, slippage, _sha_book(book), book.source, book.proxy)


def limit_order_fill(*, trade_through_verified: bool, trade_through_price: float | None) -> tuple[str, str, float | None]:
    """A resting maker order fills only with timestamped trade-through evidence."""
    if not trade_through_verified or trade_through_price is None:
        return "NOT_FILLED", "QUEUE_POSITION_UNVERIFIED", None
    if not math.isfinite(trade_through_price) or trade_through_price <= 0:
        return "BLOCKED", "TRADE_THROUGH_PRICE_INVALID", None
    return "FILLED", "VERIFIED_TRADE_THROUGH", trade_through_price


def resolve_ohlc_exit(
    side: PositionSide,
    *,
    bar_open: float,
    bar_high: float,
    bar_low: float,
    bar_close: float,
    stop_price: float | None,
    target_price: float | None,
    time_exit: bool = False,
) -> ExitResolution:
    """Resolve OHLC exits conservatively; a bar touching both exits hits stop first."""
    values = (bar_open, bar_high, bar_low, bar_close)
    if side not in {"LONG", "SHORT"} or not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("invalid side or OHLC bar")
    if bar_high < max(bar_open, bar_close, bar_low) or bar_low > min(bar_open, bar_close, bar_high):
        return ExitResolution(None, "INVALID_OHLC", False, "NOT_VERIFIABLE")
    if stop_price is not None and (not math.isfinite(stop_price) or stop_price <= 0):
        raise ValueError("stop_price must be positive and finite")
    if target_price is not None and (not math.isfinite(target_price) or target_price <= 0):
        raise ValueError("target_price must be positive and finite")
    stop_hit = (bar_low <= stop_price) if side == "LONG" and stop_price is not None else (bar_high >= stop_price) if stop_price is not None else False
    target_hit = (bar_high >= target_price) if side == "LONG" and target_price is not None else (bar_low <= target_price) if target_price is not None else False
    if stop_hit and target_hit:
        return ExitResolution(stop_price, "STOP_ADVERSE_AMBIGUOUS", True, "RESOLVED_CONSERVATIVELY")
    if stop_hit:
        return ExitResolution(stop_price, "HARD_STOP", False, "RESOLVED")
    if target_hit:
        return ExitResolution(target_price, "TAKE_PROFIT", False, "RESOLVED")
    if time_exit:
        return ExitResolution(bar_close, "TIME_EXIT", False, "RESOLVED")
    return ExitResolution(None, "NO_EXIT", False, "OPEN")


def funding_cashflow(notional_usd: float, side: PositionSide, funding_rate: float) -> float:
    """Return signed position cashflow at funding time (positive means credit)."""
    if not math.isfinite(notional_usd) or notional_usd < 0 or not math.isfinite(funding_rate):
        raise ValueError("invalid funding inputs")
    return -notional_usd * funding_rate if side == "LONG" else notional_usd * funding_rate
