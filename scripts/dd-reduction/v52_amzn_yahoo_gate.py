"""V52 AMZN SHORT Yahoo reference-price entry gate.

The pure evaluator in this module deliberately accepts normalized bars so its
causal behavior can be tested without network access.  The live fetch wrapper
is AMZN-only and converts every expected source failure into a data-unavailable
decision.  Callers must scope that decision to the new AMZN SHORT entry path;
it must never stop V52 position management or other symbols.
"""

from __future__ import annotations

import calendar
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo


UTC = timezone.utc
NY = ZoneInfo("America/New_York")
HOUR_MS = 60 * 60 * 1000
DEFAULT_THRESHOLD_PCT = 1.0
DEFAULT_MAX_AGE_MS = 2 * HOUR_MS
THRESHOLD_EPSILON_PCT = 1e-9
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"


def _finite_positive(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _date_from_ms(value_ms: int) -> date:
    return datetime.fromtimestamp(int(value_ms) / 1000, tz=UTC).astimezone(NY).date()


def _observed_fixed_holiday(year: int, month: int, day: int) -> date:
    holiday = date(year, month, day)
    if holiday.weekday() == 5:
        return holiday - timedelta(days=1)
    if holiday.weekday() == 6:
        return holiday + timedelta(days=1)
    return holiday


def _nth_weekday(year: int, month: int, weekday: int, ordinal: int) -> date:
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (ordinal - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _easter_sunday(year: int) -> date:
    # Gregorian computus, sufficient for NYSE holiday dates.
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def nyse_holiday_dates(year: int) -> set[date]:
    """Return full-day NYSE holidays for the given calendar year.

    Half-days remain valid session dates and therefore are intentionally not
    excluded: the evaluator uses the latest confirmed Yahoo bar on that
    session, exactly as the research contract does.
    """

    holidays = {
        _observed_fixed_holiday(year, 1, 1),  # New Year's Day
        _nth_weekday(year, 1, 0, 3),  # Martin Luther King Jr. Day
        _nth_weekday(year, 2, 0, 3),  # Washington's Birthday
        _last_weekday(year, 5, 0),  # Memorial Day
        _nth_weekday(year, 9, 0, 1),  # Labor Day
        _nth_weekday(year, 11, 3, 4),  # Thanksgiving
        _observed_fixed_holiday(year, 12, 25),  # Christmas
    }
    # Juneteenth is an NYSE full-day holiday from 2022 onward.
    if year >= 2022:
        holidays.add(_observed_fixed_holiday(year, 6, 19))
    # Good Friday is the Friday before Easter and is a full NYSE holiday.
    holidays.add(_easter_sunday(year) - timedelta(days=2))
    # Independence Day is observed as a full holiday.
    holidays.add(_observed_fixed_holiday(year, 7, 4))
    return holidays


def is_nyse_session_date(value: date) -> bool:
    return value.weekday() < 5 and value not in nyse_holiday_dates(value.year)


def previous_nyse_session_date(value: date) -> date:
    cursor = value - timedelta(days=1)
    while not is_nyse_session_date(cursor):
        cursor -= timedelta(days=1)
    return cursor


def _is_regular_session_start(start_ms: int) -> bool:
    local = datetime.fromtimestamp(int(start_ms) / 1000, tz=UTC).astimezone(NY)
    if not is_nyse_session_date(local.date()):
        return False
    # Yahoo's 60m bars can be aligned at 09:30, 10:30, ... or 15:30 local.
    # Keep the whole regular-session start range and do not infer a synthetic
    # close from pre/post-market bars.
    return time(9, 30) <= local.timetz().replace(tzinfo=None) < time(16, 0)


def normalize_yahoo_h1_bars(bars: Iterable[dict[str, Any]]) -> list[dict[str, float | int]]:
    """Normalize and deterministically de-duplicate Yahoo H1 close rows."""

    by_start: dict[int, float] = {}
    for raw in bars:
        if not isinstance(raw, dict):
            continue
        try:
            start_ms = int(raw.get("start_ms", raw.get("startMs")))
        except (TypeError, ValueError):
            continue
        close = _finite_positive(raw.get("close"))
        if close is None or not _is_regular_session_start(start_ms):
            continue
        by_start[start_ms] = close
    return [{"start_ms": start_ms, "close": by_start[start_ms]} for start_ms in sorted(by_start)]


def _data_unavailable(*, decision_ms: int, error: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "DATA_UNAVAILABLE",
        "reason": "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE",
        "source": "YAHOO_CHART_H1_CONFIRMED",
        "thresholdPct": DEFAULT_THRESHOLD_PCT,
        "strictComparison": "latest_return_pct > threshold_pct",
        "decisionTs": int(decision_ms),
        "decisionNyDate": _date_from_ms(decision_ms).isoformat(),
    }
    if error:
        result["sourceError"] = str(error)[:240]
    return result


def evaluate_amzn_short_yahoo_gate(
    *,
    decision_ms: int,
    bars: Iterable[dict[str, Any]],
    threshold_pct: float = DEFAULT_THRESHOLD_PCT,
    max_age_ms: int = DEFAULT_MAX_AGE_MS,
) -> dict[str, Any]:
    """Evaluate the causal AMZN SHORT gate from normalized Yahoo H1 bars.

    Only bars whose one-hour interval has completed by ``decision_ms`` are
    eligible.  The previous reference is the latest bar from a strictly prior
    NYSE session date; same-day or future data can never become the baseline.
    """

    decision_ms = int(decision_ms)
    threshold_pct = float(threshold_pct)
    max_age_ms = max(0, int(max_age_ms))
    normalized = normalize_yahoo_h1_bars(bars)
    decision_date = _date_from_ms(decision_ms)
    if not normalized:
        return _data_unavailable(decision_ms=decision_ms)

    completed = [
        row
        for row in normalized
        if int(row["start_ms"]) + HOUR_MS <= decision_ms
    ]
    if not completed:
        return _data_unavailable(decision_ms=decision_ms)

    current_candidates = [
        row for row in completed if _date_from_ms(int(row["start_ms"])) == decision_date
    ]
    if not current_candidates:
        return _data_unavailable(decision_ms=decision_ms)
    latest = current_candidates[-1]
    latest_start = int(latest["start_ms"])
    latest_completed = latest_start + HOUR_MS
    if decision_ms - latest_completed > max_age_ms:
        return _data_unavailable(decision_ms=decision_ms)

    expected_previous_date = previous_nyse_session_date(decision_date)
    prior = [
        row
        for row in completed
        if _date_from_ms(int(row["start_ms"])) == expected_previous_date
    ]
    if not prior:
        return _data_unavailable(decision_ms=decision_ms)
    previous = prior[-1]
    previous_start = int(previous["start_ms"])
    previous_date = _date_from_ms(previous_start)
    latest_close = float(latest["close"])
    previous_close = float(previous["close"])
    return_pct = (latest_close / previous_close - 1.0) * 100.0
    # The contract is strict ``> +1.0%``.  The epsilon prevents binary
    # floating-point representation of an exact 1.0% ratio from becoming a
    # false block, while still treating any materially larger return as a
    # block.
    status = "BLOCK" if return_pct - threshold_pct > THRESHOLD_EPSILON_PCT else "PASS"
    reason = (
        "AMZN_SHORT_YAHOO_PREV_CLOSE_GT_1PCT"
        if status == "BLOCK"
        else "AMZN_SHORT_YAHOO_PREV_CLOSE_NOT_GT_1PCT"
    )
    return {
        "status": status,
        "reason": reason,
        "source": "YAHOO_CHART_H1_CONFIRMED",
        "thresholdPct": threshold_pct,
        "strictComparison": "latest_return_pct > threshold_pct",
        "decisionTs": decision_ms,
        "decisionNyDate": decision_date.isoformat(),
        "previousNySessionDate": previous_date.isoformat(),
        "previousNySessionLastClose": previous_close,
        "previousBarStartTs": previous_start,
        "previousBarCompletedTs": previous_start + HOUR_MS,
        "latestConfirmedYahooReferencePrice": latest_close,
        "latestBarStartTs": latest_start,
        "latestBarCompletedTs": latest_completed,
        "returnSincePreviousNySessionClosePct": return_pct,
    }


def _http_json(url: str, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DisDex-V52-AMZN-Yahoo-Gate/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read().decode("utf-8")
    decoded = json.loads(payload)
    if not isinstance(decoded, dict):
        raise ValueError("Yahoo chart response is not an object")
    return decoded


def fetch_yahoo_h1_bars(
    *,
    symbol: str = "AMZN",
    decision_ms: int | None = None,
    timeout_seconds: float = 5.0,
) -> list[dict[str, float | int]]:
    """Fetch only AMZN Yahoo H1 source rows required for the live gate."""

    if symbol.upper() != "AMZN":
        raise ValueError("AMZN-only Yahoo gate received a different symbol")
    query = urllib.parse.urlencode(
        {
            "interval": "60m",
            "range": os.getenv("DISDEX_V52_AMZN_YAHOO_RANGE", "10d"),
            "events": "div,splits",
            "includePrePost": "false",
        }
    )
    payload = _http_json(YAHOO_CHART_URL.format(symbol="AMZN") + "?" + query, timeout_seconds)
    chart = payload.get("chart")
    results = chart.get("result") if isinstance(chart, dict) else None
    result = results[0] if isinstance(results, list) and results else None
    if not isinstance(result, dict):
        raise ValueError("Yahoo chart result missing")
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes else None
    closes = quote.get("close") if isinstance(quote, dict) else None
    if not isinstance(timestamps, list) or not isinstance(closes, list):
        raise ValueError("Yahoo chart H1 timestamps/close missing")
    bars: list[dict[str, float | int]] = []
    for timestamp, close in zip(timestamps, closes):
        try:
            start_ms = int(timestamp) * 1000
        except (TypeError, ValueError):
            continue
        if decision_ms is not None and start_ms > int(decision_ms):
            continue
        value = _finite_positive(close)
        if value is not None:
            bars.append({"start_ms": start_ms, "close": value})
    return bars


def evaluate_live_amzn_short_yahoo_gate(
    *, decision_ms: int, timeout_seconds: float = 5.0
) -> dict[str, Any]:
    """Fetch and evaluate, but never raise a source failure to V52 caller."""

    try:
        bars = fetch_yahoo_h1_bars(decision_ms=decision_ms, timeout_seconds=timeout_seconds)
        return evaluate_amzn_short_yahoo_gate(decision_ms=decision_ms, bars=bars)
    except Exception as exc:  # expected source/API failures are AMZN-local fail-closed
        return _data_unavailable(decision_ms=int(decision_ms), error=type(exc).__name__)
