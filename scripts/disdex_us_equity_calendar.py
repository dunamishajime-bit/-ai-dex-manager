from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo


UTC = dt.timezone.utc
NEW_YORK = ZoneInfo("America/New_York")


def _observed_fixed(year: int, month: int, day: int) -> dt.date:
    holiday = dt.date(year, month, day)
    if holiday.weekday() == 5:  # Saturday -> Friday
        return holiday - dt.timedelta(days=1)
    if holiday.weekday() == 6:  # Sunday -> Monday
        return holiday + dt.timedelta(days=1)
    return holiday


def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> dt.date:
    first = dt.date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + dt.timedelta(days=offset + 7 * (occurrence - 1))


def _last_weekday(year: int, month: int, weekday: int) -> dt.date:
    if month == 12:
        next_month = dt.date(year + 1, 1, 1)
    else:
        next_month = dt.date(year, month + 1, 1)
    last = next_month - dt.timedelta(days=1)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)


def _easter_sunday(year: int) -> dt.date:
    """Return Gregorian Easter Sunday using the Meeus/Jones/Butcher algorithm."""
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
    return dt.date(year, month, day)


def _holidays_for_year(year: int) -> set[dt.date]:
    holidays: set[dt.date] = set()

    # Include adjacent years so New Year's observed on Dec 31/Jan 2 is
    # classified correctly at the year boundary.
    for fixed_year in (year - 1, year, year + 1):
        fixed = (
            (1, 1),   # New Year's Day
            (7, 4),   # Independence Day
            (12, 25), # Christmas Day
        )
        if fixed_year >= 2022:
            fixed = (*fixed, (6, 19))  # Juneteenth became a market holiday in 2022.
        for month, day in fixed:
            observed = _observed_fixed(fixed_year, month, day)
            if observed.year == year:
                holidays.add(observed)

    # NYSE/Nasdaq full-day holidays with floating dates.
    holidays.update({
        _nth_weekday(year, 1, 0, 3),   # Martin Luther King Jr. Day
        _nth_weekday(year, 2, 0, 3),   # Washington's Birthday
        _last_weekday(year, 5, 0),     # Memorial Day
        _nth_weekday(year, 9, 0, 1),   # Labor Day
        _nth_weekday(year, 11, 3, 4),  # Thanksgiving Day
        _easter_sunday(year) - dt.timedelta(days=2),  # Good Friday
    })
    return holidays


def is_us_equity_market_holiday(value: dt.date) -> bool:
    return value in _holidays_for_year(value.year)


def regular_us_equity_session(value: dt.datetime | None = None) -> bool:
    """Return true only during a weekday, non-holiday US regular session."""
    if value is None:
        local = dt.datetime.now(tz=UTC).astimezone(NEW_YORK)
    elif value.tzinfo is None:
        local = value.replace(tzinfo=NEW_YORK)
    else:
        local = value.astimezone(NEW_YORK)
    if local.weekday() >= 5 or is_us_equity_market_holiday(local.date()):
        return False
    seconds = local.hour * 3600 + local.minute * 60 + local.second
    return 9 * 3600 + 30 * 60 <= seconds < 16 * 3600
