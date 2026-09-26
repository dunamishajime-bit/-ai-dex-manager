"""Immutable, provenance-carrying market observations and fail-closed checks."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import math
import re
from typing import Iterable, Sequence


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class Observation:
    exchange: str
    instrument_id: str
    contract_type: str
    event_time_ms: int
    source_time_ms: int
    received_time_ms: int | None
    content_sha256: str


@dataclass(frozen=True, slots=True)
class Bar(Observation):
    interval_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class Quote(Observation):
    bid: float
    ask: float
    bid_size: float
    ask_size: float


@dataclass(frozen=True, slots=True)
class BookObservation(Observation):
    event_type: str
    first_update_id: int | None
    final_update_id: int | None
    prev_final_update_id: int | None
    bids: tuple[tuple[float, float], ...]
    asks: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class FundingObservation(Observation):
    funding_rate: float
    mark_price: float | None = None


@dataclass(frozen=True, slots=True)
class FxRate(Observation):
    rate_jpy_per_usd: float


@dataclass(frozen=True, slots=True)
class CoverageIssue:
    code: str
    event_time_ms: int | None
    detail: str
    blocking: bool = True


@dataclass(frozen=True, slots=True)
class FxConversion:
    amount_jpy: float
    amount_usdt: float
    rate_jpy_per_usd: float
    rate_time_ms: int
    rate_sha256: str


def _finite_positive(value: float) -> bool:
    return math.isfinite(value) and value > 0


def validate_series(
    records: Sequence[Observation],
    expected_interval_ms: int | None,
    listed_from_ms: int | None = None,
    listed_until_ms: int | None = None,
    *,
    asof_ms: int | None = None,
    max_age_ms: int | None = None,
    expected_native_instrument: str | None = None,
    expected_contract_type: str | None = None,
) -> list[CoverageIssue]:
    """Return all integrity, coverage, staleness, and look-ahead issues.

    ``event_time_ms`` is the exchange event timestamp, while ``source_time_ms``
    is the exchange bar-close/transaction timestamp. The caller must include
    the decision cut-off whenever the series is used to decide or execute.
    """
    issues: list[CoverageIssue] = []
    if expected_interval_ms is not None and expected_interval_ms <= 0:
        raise ValueError("expected_interval_ms must be positive or None")
    if listed_from_ms is not None and listed_until_ms is not None and listed_until_ms < listed_from_ms:
        raise ValueError("listed_until_ms precedes listed_from_ms")

    observed_times = [record.event_time_ms for record in records]
    seen: set[int] = set()
    previous: int | None = None
    for record in records:
        ts = record.event_time_ms
        if ts in seen:
            issues.append(CoverageIssue("DUPLICATE_TIMESTAMP", ts, "multiple records share event timestamp"))
        seen.add(ts)
        if previous is not None and ts < previous:
            issues.append(CoverageIssue("OUT_OF_ORDER", ts, f"timestamp {ts} follows {previous}"))
        previous = ts

        if not _SHA256.fullmatch(record.content_sha256):
            issues.append(CoverageIssue("INVALID_CONTENT_HASH", ts, "content_sha256 is not lowercase SHA256"))
        if not record.exchange or not record.instrument_id or not record.contract_type:
            issues.append(CoverageIssue("MISSING_PROVENANCE", ts, "exchange, native instrument, and contract type are required"))
        if expected_native_instrument is not None and record.instrument_id != expected_native_instrument:
            issues.append(CoverageIssue(
                "INSTRUMENT_MISMATCH", ts,
                f"expected native instrument {expected_native_instrument}, got {record.instrument_id}",
            ))
        if expected_contract_type is not None and record.contract_type != expected_contract_type:
            issues.append(CoverageIssue(
                "CONTRACT_TYPE_MISMATCH", ts,
                f"expected {expected_contract_type}, got {record.contract_type}",
            ))
        if listed_from_ms is not None and ts < listed_from_ms:
            issues.append(CoverageIssue("BEFORE_LISTING", ts, "record precedes verified instrument listing"))
        if listed_until_ms is not None and ts > listed_until_ms:
            issues.append(CoverageIssue("AFTER_DELISTING", ts, "record follows verified instrument delisting"))
        if asof_ms is not None:
            if ts >= asof_ms:
                issues.append(CoverageIssue("FUTURE_OR_ASOF_LEAK", ts, f"event timestamp is not before decision time {asof_ms}"))
            if record.source_time_ms > asof_ms:
                issues.append(CoverageIssue("SOURCE_TIME_AFTER_ASOF", ts, f"source timestamp exceeds decision time {asof_ms}"))
            if record.received_time_ms is not None and record.received_time_ms > asof_ms:
                issues.append(CoverageIssue("RECEIVE_TIME_AFTER_ASOF", ts, f"receive timestamp exceeds decision time {asof_ms}"))

        if isinstance(record, Bar):
            if record.interval_ms <= 0:
                issues.append(CoverageIssue("INVALID_INTERVAL", ts, "bar interval must be positive"))
            elif expected_interval_ms is not None and record.interval_ms != expected_interval_ms:
                issues.append(CoverageIssue("INTERVAL_MISMATCH", ts, f"expected {expected_interval_ms}ms, got {record.interval_ms}ms"))
            if expected_interval_ms is not None and ts % expected_interval_ms:
                issues.append(CoverageIssue("MISALIGNED_TIMESTAMP", ts, f"event timestamp is not aligned to {expected_interval_ms}ms"))
            prices = (record.open, record.high, record.low, record.close, record.volume)
            if not all(math.isfinite(value) for value in prices) or min(prices[:4]) <= 0 or record.volume < 0:
                issues.append(CoverageIssue("INVALID_OHLC", ts, "bar prices/volume are non-finite or outside valid range"))
            elif record.high < max(record.open, record.close, record.low) or record.low > min(record.open, record.close, record.high):
                issues.append(CoverageIssue("INVALID_OHLC", ts, "bar high/low do not contain open, close, and low/high"))
        elif isinstance(record, Quote):
            if not all(_finite_positive(value) for value in (record.bid, record.ask)) or record.ask < record.bid:
                issues.append(CoverageIssue("INVALID_QUOTE", ts, "bid/ask are invalid or crossed"))
            if any(not math.isfinite(value) or value < 0 for value in (record.bid_size, record.ask_size)):
                issues.append(CoverageIssue("INVALID_QUOTE_SIZE", ts, "quote sizes must be finite and non-negative"))
        elif isinstance(record, BookObservation):
            if record.event_type not in {"snapshot", "update"}:
                issues.append(CoverageIssue("INVALID_BOOK_EVENT", ts, f"unknown book event type {record.event_type}"))
            if not record.bids or not record.asks:
                issues.append(CoverageIssue("INCOMPLETE_BOOK", ts, "both bid and ask sides are required"))
            if any(not _finite_positive(price) or not math.isfinite(size) or size < 0 for side in (record.bids, record.asks) for price, size in side):
                issues.append(CoverageIssue("INVALID_BOOK_LEVEL", ts, "book levels require positive prices and non-negative finite size"))
            if record.event_type == "update":
                if record.first_update_id is not None and record.prev_final_update_id is not None and record.first_update_id > record.prev_final_update_id + 1:
                    issues.append(CoverageIssue("BOOK_SEQUENCE_GAP", ts, "update first id skips beyond previous final id"))
                if record.prev_final_update_id is not None and record.final_update_id is not None and record.final_update_id <= record.prev_final_update_id:
                    issues.append(CoverageIssue("BOOK_SEQUENCE_GAP", ts, "update final id does not advance past previous final id"))
        elif isinstance(record, FundingObservation):
            if not math.isfinite(record.funding_rate):
                issues.append(CoverageIssue("INVALID_FUNDING", ts, "funding rate is not finite"))
            if record.mark_price is not None and not _finite_positive(record.mark_price):
                issues.append(CoverageIssue("INVALID_MARK_PRICE", ts, "mark price must be positive and finite"))
        elif isinstance(record, FxRate):
            if not _finite_positive(record.rate_jpy_per_usd):
                issues.append(CoverageIssue("INVALID_FX_RATE", ts, "JPY per USD rate must be positive and finite"))

    if expected_interval_ms is not None and observed_times:
        lower = listed_from_ms if listed_from_ms is not None else min(observed_times)
        upper = listed_until_ms if listed_until_ms is not None else max(observed_times)
        first = ((lower + expected_interval_ms - 1) // expected_interval_ms) * expected_interval_ms
        actual = set(observed_times)
        for ts in range(first, upper + 1, expected_interval_ms):
            if ts not in actual:
                issues.append(CoverageIssue("MISSING_INTERVAL", ts, f"no observation at expected interval {ts}"))

    if asof_ms is not None and max_age_ms is not None:
        if max_age_ms < 0:
            raise ValueError("max_age_ms must not be negative")
        eligible_times = [ts for ts in observed_times if ts < asof_ms]
        if eligible_times and asof_ms - max(eligible_times) > max_age_ms:
            latest = max(eligible_times)
            issues.append(CoverageIssue("STALE", latest, f"latest eligible event is {asof_ms - latest}ms old"))
        elif not eligible_times:
            issues.append(CoverageIssue("STALE", None, "no observation exists strictly before as-of time"))

    if records and isinstance(records[0], BookObservation):
        snapshot_seen = False
        last_final: int | None = None
        for record in records:
            if not isinstance(record, BookObservation):
                issues.append(CoverageIssue("MIXED_RECORD_TYPES", record.event_time_ms, "book series includes non-book observation"))
                continue
            if record.event_type == "snapshot":
                snapshot_seen = True
                last_final = record.final_update_id
                continue
            if record.event_type == "update":
                if not snapshot_seen:
                    issues.append(CoverageIssue("BOOK_UPDATE_WITHOUT_SNAPSHOT", record.event_time_ms, "book update has no preceding snapshot"))
                if last_final is not None and record.prev_final_update_id is not None and record.prev_final_update_id != last_final:
                    issues.append(CoverageIssue("BOOK_SEQUENCE_GAP", record.event_time_ms, f"previous final id {record.prev_final_update_id} does not match {last_final}"))
                last_final = record.final_update_id

    return sorted(issues, key=lambda issue: (issue.event_time_ms if issue.event_time_ms is not None else -1, issue.code, issue.detail))


def _utc_ms(value: datetime) -> int:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("event time must be timezone-aware")
    return int(value.astimezone(timezone.utc).timestamp() * 1000)


def deposit_usdt(amount_jpy: float, at_utc: datetime, fx_series: Iterable[FxRate]) -> FxConversion:
    """Convert JPY deposit at the latest FRED DEXJPUS value available as of time."""
    if not math.isfinite(amount_jpy) or amount_jpy <= 0:
        raise ValueError("amount_jpy must be positive and finite")
    at_ms = _utc_ms(at_utc)
    eligible = [
        rate for rate in fx_series
        if rate.instrument_id == "DEXJPUS"
        and rate.exchange.upper() == "FRED"
        and rate.event_time_ms <= at_ms
        and rate.source_time_ms <= at_ms
        and rate.received_time_ms is not None
        and rate.received_time_ms <= at_ms
        and _finite_positive(rate.rate_jpy_per_usd)
        and _SHA256.fullmatch(rate.content_sha256)
    ]
    if not eligible:
        raise ValueError("no FX observation available as of event")
    selected = max(eligible, key=lambda rate: (rate.event_time_ms, rate.source_time_ms))
    return FxConversion(
        amount_jpy=float(amount_jpy),
        amount_usdt=float(amount_jpy) / selected.rate_jpy_per_usd,
        rate_jpy_per_usd=selected.rate_jpy_per_usd,
        rate_time_ms=selected.event_time_ms,
        rate_sha256=selected.content_sha256,
    )
