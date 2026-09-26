"""NYSE core-session calendar used by the V52 backtest."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


NYSE_SOURCE_URL = "https://www.nyse.com/markets/hours-calendars"
_EASTERN = ZoneInfo("America/New_York")

# NYSE holiday dates published in the official 2025/2026 calendars.
_HOLIDAYS = {
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17), date(2025, 4, 18),
    date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1),
    date(2025, 11, 27), date(2025, 12, 25),
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
}
_EARLY_CLOSES = {
    date(2025, 7, 3), date(2025, 11, 28), date(2025, 12, 24),
    date(2026, 11, 27), date(2026, 12, 24),
}
_REGULAR_OPEN = time(9, 30)


def nyse_close_utc(session_date: date) -> datetime | None:
    """Return the official core close in UTC, or None if the market is shut."""
    if session_date.weekday() >= 5 or session_date in _HOLIDAYS:
        return None
    close = time(13, 0) if session_date in _EARLY_CLOSES else time(16, 0)
    return datetime.combine(session_date, close, tzinfo=_EASTERN).astimezone(timezone.utc)


def is_nyse_core_open(at_utc: datetime) -> bool:
    if at_utc.tzinfo is None or at_utc.utcoffset() is None:
        raise ValueError("NYSE calendar input must be timezone-aware")
    local = at_utc.astimezone(_EASTERN)
    close_utc = nyse_close_utc(local.date())
    if close_utc is None:
        return False
    open_local = datetime.combine(local.date(), _REGULAR_OPEN, tzinfo=_EASTERN)
    return open_local <= local < close_utc.astimezone(_EASTERN)


def next_nyse_session(session_date: date) -> date:
    candidate = session_date + timedelta(days=1)
    while nyse_close_utc(candidate) is None:
        candidate += timedelta(days=1)
    return candidate
