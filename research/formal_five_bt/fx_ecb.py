"""Official ECB USD/JPY daily reference cross, retained as an explicit FX fallback.

The audited formal baseline expects FRED DEXJPUS. ECB fallback is a *different*
source and must never be misreported as FRED-parity or same-day executable FX.
Use USD/EUR and JPY/EUR daily ECB reference rates from a shared observation
date, and mark the cross available only on the following UTC calendar date.
"""
from __future__ import annotations

from bisect import bisect_right
import argparse
import csv
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Callable
from urllib.request import Request, urlopen

ECB_API = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY.EUR.SP00.A"
HOUR = 3_600_000
DAY = 24 * HOUR


def _download(url: str) -> bytes:
    request = Request(url, headers={
        "Accept": "text/csv", "User-Agent": "DisDex-Research-Backtest/1.0",
    })
    with urlopen(request, timeout=45) as response:
        return response.read()


def parse_ecb_cross(payload: bytes) -> list[dict[str, object]]:
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")))
        if not reader.fieldnames or not {"TIME_PERIOD", "CURRENCY", "OBS_VALUE"}.issubset(reader.fieldnames):
            raise ValueError("ECB_CSV_REQUIRED_COLUMNS_MISSING")
        pairs: dict[date, dict[str, float]] = {}
        for row in reader:
            currency = str(row.get("CURRENCY") or "").upper().strip()
            if currency not in {"USD", "JPY"}:
                continue
            period = date.fromisoformat(str(row["TIME_PERIOD"]))
            try:
                rate = float(row["OBS_VALUE"])
            except (TypeError, ValueError):
                continue
            if not math.isfinite(rate) or rate <= 0:
                raise ValueError(f"ECB_RATE_INVALID:{period}:{currency}")
            observed = pairs.setdefault(period, {})
            if currency in observed:
                raise ValueError(f"ECB_DUPLICATE_OBSERVATION:{period}:{currency}")
            observed[currency] = rate
        result = []
        for observed_date, values in sorted(pairs.items()):
            if set(values) != {"USD", "JPY"}:
                continue
            cross = values["JPY"] / values["USD"]
            if not math.isfinite(cross) or cross <= 0:
                raise ValueError("ECB_CROSS_RATE_INVALID")
            available_date = observed_date + timedelta(days=1)
            available_ts = int(datetime.combine(available_date, time(), timezone.utc).timestamp() * 1000)
            result.append({
                "source": "ECB_CROSS_EUR", "instrument": "USDJPY",
                "observation_date": observed_date.isoformat(),
                "event_time_ms": available_ts, "source_time_ms": available_ts,
                "rate_jpy_per_usd": cross,
            })
        if not result:
            raise ValueError("ECB_CROSS_NO_MATCHED_OBSERVATIONS")
        return result
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ValueError("ECB_CSV_UNREADABLE") from exc


def acquire_ecb_cross(
    data_root: str | Path, *, start: date = date(2025, 1, 1),
    end: date = date(2026, 8, 11),
    fetch: Callable[[str], bytes] = _download,
) -> dict[str, object]:
    if end < start:
        raise ValueError("ECB_DATE_RANGE_INVALID")
    root = Path(data_root)
    url = f"{ECB_API}?startPeriod={start.isoformat()}&endPeriod={end.isoformat()}&format=csvdata"
    raw = fetch(url)
    observations = parse_ecb_cross(raw)
    # Reject a truncated API response masquerading as a complete full-year
    # source. Both daily series cover many non-holiday workdays each year.
    if (end - start).days >= 365 and len(observations) < 250:
        raise ValueError("ECB_CROSS_INSUFFICIENT_OBSERVATIONS")
    raw_path = root / "raw/ecb/EXR_USD_JPY_EUR.csv"
    normalized_path = root / "normalized/ecb/usdjpy-cross.jsonl"
    for path in (raw_path, normalized_path):
        path.parent.mkdir(parents=True, exist_ok=True)
    normalized = ("".join(json.dumps(row, sort_keys=True) + "\n" for row in observations)).encode()
    raw_path.write_bytes(raw)
    normalized_path.write_bytes(normalized)
    manifest = {
        "status": "ACQUIRED_ECB_REFERENCE_CROSS_NOT_FRED_PARITY",
        "series": ["EXR.D.USD.EUR.SP00.A", "EXR.D.JPY.EUR.SP00.A"],
        "official_source_url": url,
        "observation_count": len(observations),
        "first_observed_date": observations[0]["observation_date"],
        "last_observed_date": observations[-1]["observation_date"],
        "availability_rule": "NEXT_CALENDAR_DAY_00_UTC_NO_SAME_DAY_LOOKAHEAD",
        "raw_path": "raw/ecb/EXR_USD_JPY_EUR.csv",
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
        "normalized_path": "normalized/ecb/usdjpy-cross.jsonl",
        "normalized_sha256": hashlib.sha256(normalized).hexdigest(),
    }
    (root / "ecb-fx-cross-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def load_ecb_cross(data_root: str | Path) -> list[tuple[int, float]]:
    root = Path(data_root)
    manifest = json.loads((root / "ecb-fx-cross-manifest.json").read_text())
    if manifest.get("status") != "ACQUIRED_ECB_REFERENCE_CROSS_NOT_FRED_PARITY":
        raise ValueError("ECB_CROSS_MANIFEST_NOT_VERIFIED")
    raw = (root / manifest["normalized_path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest["normalized_sha256"]:
        raise ValueError("ECB_CROSS_NORMALIZED_HASH_MISMATCH")
    result = []
    previous = -1
    for line in raw.decode().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        ts, rate = int(row["event_time_ms"]), float(row["rate_jpy_per_usd"])
        if (row.get("source") != "ECB_CROSS_EUR" or row.get("instrument") != "USDJPY"
                or ts <= previous or not math.isfinite(rate) or rate <= 0):
            raise ValueError("ECB_CROSS_ROW_PROVENANCE_INVALID")
        result.append((ts, rate))
        previous = ts
    if len(result) != manifest["observation_count"]:
        raise ValueError("ECB_CROSS_ROW_COUNT_MISMATCH")
    return result


def asof_jpy_per_usd(series: list[tuple[int, float]], timestamp_ms: int,
                     *, maximum_staleness_days: int = 8) -> float:
    times = [row[0] for row in series]
    i = bisect_right(times, timestamp_ms) - 1
    if i < 0 or timestamp_ms - times[i] > maximum_staleness_days * DAY:
        raise ValueError(f"VERIFIABLE_ASOF_ECB_FX_UNAVAILABLE:{timestamp_ms}")
    return series[i][1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2025, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 8, 11))
    args = parser.parse_args()
    result = acquire_ecb_cross(args.data_root, start=args.start, end=args.end)
    print(json.dumps({k: result[k] for k in (
        "status", "observation_count", "first_observed_date", "last_observed_date",
        "normalized_sha256", "availability_rule")}, sort_keys=True))


if __name__ == "__main__":
    main()
