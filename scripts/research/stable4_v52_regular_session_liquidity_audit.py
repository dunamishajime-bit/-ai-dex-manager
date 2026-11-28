"""Regular NY equity-session coverage of archived V52 ASTER 5m candles.

Data-quality audit, NOT broker execution, signed fill, live order authorization,
or proof that a positive-volume candle was executable at a quoted price.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
UTC = timezone.utc
BASES = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
WINDOW_START = int(datetime(2025, 10, 1, tzinfo=UTC).timestamp() * 1000)
WINDOW_END = int(datetime(2026, 10, 1, tzinfo=UTC).timestamp() * 1000)
M5 = 300_000


def classify(timestamp_ms: int, volume: float) -> str:
    """Use New York wall clock with DST; US exchange holidays not guessed."""
    if not isinstance(timestamp_ms, int) or timestamp_ms % M5 or not math.isfinite(volume) or volume < 0:
        raise ValueError("V52_INVALID_M5_TIMESTAMP_OR_VOLUME")
    ny = datetime.fromtimestamp(timestamp_ms / 1000, UTC).astimezone(NY)
    regular = ny.weekday() < 5 and time(9, 30) <= ny.time() < time(16, 0)
    if not regular:
        return "OUTSIDE_WEEKDAY_REGULAR_SESSION_UNVERIFIED"
    if volume == 0:
        return "REGULAR_SESSION_ZERO_VOLUME_NO_EXECUTION_EVIDENCE"
    return "REGULAR_SESSION_POSITIVE_VOLUME_NOT_FILL_CERTIFIED"


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audit_ticker(path: Path, expected_sha: str) -> dict:
    if not path.is_file() or path.is_symlink():
        raise ValueError("V52_ARCHIVED_M5_INPUT_MISSING")
    actual_sha = sha_file(path)
    if actual_sha != expected_sha:
        raise ValueError("V52_ARCHIVED_M5_SOURCE_SHA_MISMATCH")
    counts = defaultdict(int)
    regular_days = defaultdict(lambda: {"observed": 0, "positive": 0})
    first = last = None
    previous = None
    with gzip.open(path, "rt", encoding="utf8") as stream:
        for line in stream:
            row = json.loads(line)
            if not isinstance(row, list) or len(row) < 8:
                raise ValueError("V52_ARCHIVED_M5_SHAPE_INVALID")
            ts = row[0]
            if not isinstance(ts, int) or not WINDOW_START <= ts < WINDOW_END:
                raise ValueError("V52_ARCHIVED_M5_TIME_INVALID")
            values = [float(row[i]) for i in (1, 2, 3, 4, 5)]
            op, high, low, close, volume = values
            if (not all(math.isfinite(v) for v in values) or min(op, low, close) <= 0
                    or low > min(op, close) or high < max(op, close)
                    or previous is not None and ts != previous + M5):
                raise ValueError("V52_ARCHIVED_M5_SEQUENCE_OR_OHLC_INVALID")
            if int(row[6]) != ts + M5 - 1:
                raise ValueError("V52_ARCHIVED_M5_CLOSE_TIME_INVALID")
            status = classify(ts, volume)
            counts[status] += 1
            if status.startswith("REGULAR_SESSION_"):
                day = datetime.fromtimestamp(ts / 1000, UTC).astimezone(NY).date().isoformat()
                regular_days[day]["observed"] += 1
                regular_days[day]["positive"] += int(volume > 0)
            if first is None:
                first = ts
            last = previous = ts
    total = sum(counts.values())
    if first != WINDOW_START or last != WINDOW_END - M5 or total != (WINDOW_END - WINDOW_START) // M5:
        raise ValueError("V52_ARCHIVED_M5_ANNUAL_COVERAGE_INCOMPLETE")
    zero_regular = counts["REGULAR_SESSION_ZERO_VOLUME_NO_EXECUTION_EVIDENCE"]
    positive_regular = counts["REGULAR_SESSION_POSITIVE_VOLUME_NOT_FILL_CERTIFIED"]
    weekdays = len(regular_days)
    full_zero_days = sum(1 for day in regular_days.values() if day["positive"] == 0)
    partial_days = sum(1 for day in regular_days.values() if day["observed"] != 78)
    return {
        "sourceSha256": actual_sha, "totalM5": total,
        "regularSessionWeekdayM5": zero_regular + positive_regular,
        "regularSessionZeroVolumeM5": zero_regular,
        "regularSessionPositiveVolumeM5": positive_regular,
        "regularSessionZeroVolumePct": round(100 * zero_regular / max(1, zero_regular + positive_regular), 4),
        "outsideWeekdayRegularSessionM5": counts["OUTSIDE_WEEKDAY_REGULAR_SESSION_UNVERIFIED"],
        "weekdayCalendarDaysWithoutHolidayAdjustment": weekdays,
        "weekdayDaysWithNoPositiveVolume": full_zero_days,
        "weekdayDaysNot78Bars": partial_days,
        "positiveVolumeMeansExecutable": False,
        "signedQuoteOrFillProven": False,
    }


def evaluate(data_root: Path, coverage_file: Path | dict) -> dict:
    coverage = coverage_file if isinstance(coverage_file, dict) else json.loads(coverage_file.read_text(encoding="utf8"))
    if (coverage.get("schema") != "stable4-v52-stock-m5-h1-coverage-audit/v1"
            or coverage.get("status") != "COVERAGE_REVIEW_ONLY"
            or coverage.get("orderAuthority") is not False):
        raise ValueError("V52_COVERAGE_SOURCE_UNVERIFIED")
    found = {}
    for ticker in BASES:
        row = coverage["perTicker"][ticker]["asterM5"]
        archive = data_root / "V11_ASTER_5M_FULLPERIOD_20261111" / row["file"]
        found[ticker] = audit_ticker(archive, row["sha256"])
    return {
        "schema": "stable4-v52-regular-session-liquidity-audit/v1",
        "status": "PARTIAL_MARKET_COVERAGE_NOT_EXECUTION_PROOF",
        "windowUtc": ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"],
        "marketSessionBasis": "America/New_York M-F 09:30-16:00; holidays and early closes NOT adjusted",
        "perTicker": found,
        "limitations": [
            "A regular-session positive-volume 5m candle is not a signed executable bid/ask or fill",
            "NYSE/Nasdaq holidays and early closes are not removed; zero-volume days remain visible",
            "No strategy signal, venue quote/depth, funding, slippage, fees, gross or DD re-execution",
            "No authenticated account mark, protected STOP or owner-signed source certificate",
        ],
        "allSevenNativeReplay": False,
        "v52SourceEntryOrFillParityProven": False,
        "rootCertificateIssued": False,
        "orderAuthority": False,
        "productionEligible": False,
    }


def verify_report(report: dict, original_coverage: dict) -> None:
    """Reject forged volume, venue, runner or LIVE claims in archived research."""
    if (report.get("schema") != "stable4-v52-regular-session-liquidity-audit/v1"
            or report.get("status") != "PARTIAL_MARKET_COVERAGE_NOT_EXECUTION_PROOF"
            or report.get("orderAuthority") is not False
            or report.get("productionEligible") is not False
            or report.get("allSevenNativeReplay") is not False
            or report.get("v52SourceEntryOrFillParityProven") is not False
            or report.get("rootCertificateIssued") is not False
            or set(report.get("perTicker", {})) != set(BASES)
            or set(original_coverage.get("perTicker", {})) != set(BASES)):
        raise ValueError("V52_LIQUIDITY_REPORT_RELEASE_SCOPE_INVALID")
    for ticker in BASES:
        row = report["perTicker"][ticker]
        pinned = original_coverage["perTicker"][ticker]["asterM5"]
        positive = row.get("regularSessionPositiveVolumeM5")
        zero = row.get("regularSessionZeroVolumeM5")
        regular = row.get("regularSessionWeekdayM5")
        outside = row.get("outsideWeekdayRegularSessionM5")
        if (not all(type(v) is int and v >= 0 for v in (positive, zero, regular, outside))
                or row.get("sourceSha256") != pinned.get("sha256")
                or row.get("totalM5") != pinned.get("rows")
                or row.get("totalM5") != (WINDOW_END - WINDOW_START)//M5
                or positive + zero != regular
                or regular + outside != row["totalM5"]
                or regular != 261 * 78
                or row.get("positiveVolumeMeansExecutable") is not False
                or row.get("signedQuoteOrFillProven") is not False
                or row.get("weekdayCalendarDaysWithoutHolidayAdjustment") != 261
                or row.get("weekdayDaysNot78Bars") != 0
                or row.get("weekdayDaysWithNoPositiveVolume", -1) < 0
                or row.get("weekdayDaysWithNoPositiveVolume", 999) > 261
                or not math.isclose(row.get("regularSessionZeroVolumePct", -1),
                                    round(100 * zero / regular, 4), abs_tol=0.00001)):
            raise ValueError("V52_LIQUIDITY_ROW_OR_PROVENANCE_INVALID:" + ticker)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        raise ValueError("V52_DATA_ROOT_AND_EVIDENCE_PATH_REQUIRED")
    print(json.dumps(evaluate(Path(sys.argv[1]), Path(sys.argv[2])), sort_keys=True))
