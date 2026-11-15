"""Read-only source-identical V52 AMZN SHORT Yahoo gate.
Only native pure helper bodies are copied; NO HTTP, venue order, startup,
credential, disk/state or LIVE methods. For artificial source checking only.
The underlying native source is not changed.
"""
from __future__ import annotations
import calendar
import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo
UTC = timezone.utc
NY = ZoneInfo("America/New_York")
HOUR_MS = 60 * 60 * 1000
DEFAULT_THRESHOLD_PCT = 1.0
DEFAULT_MAX_AGE_MS = 2 * HOUR_MS
THRESHOLD_EPSILON_PCT = 1e-9


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
