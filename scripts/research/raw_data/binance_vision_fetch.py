from __future__ import annotations

import csv
import hashlib
import io
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import Bar, Funding

BASE_URL = "https://data.binance.vision/data/futures/um/monthly"
HOUR_MS = 3_600_000
SHA_RE = re.compile(r"^[a-fA-F0-9]{64}$")


def _timestamp(raw: str) -> int:
    value = int(raw)
    # Venue monthly archives specify millisecond times; guard against
    # microsecond/more granular future vendor files.
    if abs(value) >= 10**17:
        value //= 1_000_000
    elif abs(value) >= 10**14:
        value //= 1_000
    return value


def _months(start_ms: int, end_ms: int) -> list[str]:
    start = datetime.fromtimestamp(start_ms / 1000, timezone.utc)
    end = datetime.fromtimestamp((end_ms - 1) / 1000, timezone.utc)
    year, month = start.year, start.month
    months: list[str] = []
    while (year, month) <= (end.year, end.month):
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return months


def _get(url: str, *, retries: int = 4) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urlopen(Request(url, headers={
                "User-Agent": "DisDex-research-historical-replay/1.0",
            }), timeout=35) as stream:
                if stream.status != 200:
                    raise RuntimeError("PUBLIC_ARCHIVE_BAD_STATUS")
                return stream.read()
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            last_error = error
            if isinstance(error, HTTPError) and error.code in (400, 401, 403, 404, 410, 451):
                raise RuntimeError(f"ARCHIVE_UNAVAILABLE:{url}:{error.code}") from error
            time.sleep(min(8.0, 0.75 * 2 ** attempt))
    raise RuntimeError(f"ARCHIVE_FETCH_RETRIES_EXHAUSTED:{url}") from last_error


def _archive_url(symbol: str, month: str, kind: str) -> str:
    if kind == "klines":
        return f"{BASE_URL}/klines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if kind == "fundingRate":
        return f"{BASE_URL}/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    raise ValueError("UNSUPPORTED_ARCHIVE_KIND")


def _read_archive(
    symbol: str, month: str, kind: str, start_ms: int, end_ms: int,
) -> tuple[str, str, str, list[Any], dict[str, Any]]:
    url = _archive_url(symbol, month, kind)
    data = _get(url)
    checksum_data = _get(url + ".CHECKSUM")
    published_sha = checksum_data.decode("utf-8-sig").strip().split()[0]
    if not SHA_RE.fullmatch(published_sha):
        raise RuntimeError(f"INVALID_PUBLISHED_CHECKSUM:{url}")
    digest = hashlib.sha256(data).hexdigest()
    if published_sha.lower() != digest.lower():
        raise RuntimeError(f"PUBLISHED_CHECKSUM_MISMATCH:{url}")

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = [item for item in archive.namelist() if item.endswith(".csv") and not item.startswith("__MACOSX")]
        if len(entries) != 1:
            raise RuntimeError(f"ARCHIVE_CSV_MEMBERS_INVALID:{url}")
        with archive.open(entries[0]) as stream:
            reader = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))
            rows: list[Any] = []
            for raw in reader:
                if kind == "klines":
                    ts = _timestamp(raw["open_time"])
                    if start_ms <= ts < end_ms:
                        rows.append(Bar(
                            symbol, ts, float(raw["open"]), float(raw["high"]),
                            float(raw["low"]), float(raw["close"]), float(raw["volume"]),
                        ))
                else:
                    ts = _timestamp(raw["calc_time"])
                    if start_ms <= ts < end_ms:
                        rows.append(Funding(symbol, ts, float(raw["last_funding_rate"])))
    evidence = {
        "symbol": symbol, "month": month, "type": kind,
        "zipSha256": digest, "publishedChecksumVerified": True,
        "csvRowsInPeriod": len(rows), "archiveUrl": url,
    }
    return symbol, month, kind, rows, evidence


def fetch_binance_vision_bundle(
    symbols: list[str], start_ms: int, end_ms: int, *, workers: int = 6,
) -> dict[str, Any]:
    """Download official public historical monthlies. No exchange credentials.

    Source SHA-256 is checked against each official .CHECKSUM file before
    parsing. Entire monthlies are cut to the EXACT UTC interval, then sorted,
    with no forward-fill or silent deduplication.
    """
    if end_ms <= start_ms or (end_ms - start_ms) % HOUR_MS or not symbols:
        raise ValueError("INVALID_REPLAY_WINDOW")
    if any(not re.fullmatch(r"[A-Z0-9]{5,30}", symbol) for symbol in symbols):
        raise ValueError("INVALID_REPLAY_SYMBOL")
    months = _months(start_ms, end_ms)
    tasks = [(symbol, month, kind, start_ms, end_ms)
             for symbol in sorted(symbols) for month in months
             for kind in ("klines", "fundingRate")]
    completed: dict[tuple[str, str, str], tuple[list[Any], dict[str, Any]]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_read_archive, *task): task for task in tasks}
        for future in as_completed(futures):
            symbol, month, kind, rows, evidence = future.result()
            completed[(symbol, month, kind)] = (rows, evidence)
    bars: dict[str, list[Bar]] = {}
    funding: dict[str, list[Funding]] = {}
    evidence_rows = []
    for symbol in sorted(symbols):
        for month in months:
            for kind in ("klines", "fundingRate"):
                rows, evidence = completed[(symbol, month, kind)]
                target = bars if kind == "klines" else funding
                target.setdefault(symbol, []).extend(rows)
                evidence_rows.append(evidence)
        bars[symbol].sort(key=lambda row: row.ts_ms)
        funding[symbol].sort(key=lambda row: row.ts_ms)
    return {
        "source": {
            "provider": "Binance USD-M Futures public Vision monthly archives",
            "base_url": BASE_URL,
            "authenticated": False,
            "publishedChecksumVerifiedForAllArchives": True,
            "archiveCount": len(evidence_rows),
            "archives": evidence_rows,
        },
        "period": {"start_ms": start_ms, "end_ms": end_ms},
        "interval": "1h", "interval_ms": HOUR_MS,
        "bars": bars, "funding": funding,
    }
