from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Dict, List

UTC = dt.timezone.utc
BINANCE_ARCHIVE_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
CACHE_ROOT = Path.cwd() / ".cache" / "binance-public-data" / "um-monthly-klines"


def month_iter(start_ms: int, end_ms: int):
    current = dt.datetime.fromtimestamp(start_ms / 1000, tz=UTC).date().replace(day=1)
    final = dt.datetime.fromtimestamp((end_ms - 1) / 1000, tz=UTC).date().replace(day=1)
    while current <= final:
        yield current.strftime("%Y-%m")
        current = (current.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, attempts: int = 7, optional: bool = False) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return True
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        tmp = destination.with_suffix(destination.suffix + ".tmp")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "DisDex-Current-V96-V52-BT/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response, tmp.open("wb") as writer:
                shutil.copyfileobj(response, writer)
            if tmp.stat().st_size <= 0:
                raise RuntimeError(f"empty download: {url}")
            tmp.replace(destination)
            return True
        except urllib.error.HTTPError as error:
            last_error = error
            tmp.unlink(missing_ok=True)
            if optional and error.code == 404:
                return False
            if attempt == attempts:
                break
            time.sleep(min(60, 2 ** attempt))
        except Exception as error:
            last_error = error
            tmp.unlink(missing_ok=True)
            if attempt == attempts:
                break
            time.sleep(min(60, 2 ** attempt))
    if optional:
        return False
    raise RuntimeError(f"download failed after {attempts} attempts: {url}: {last_error}")


def verified_monthly_zip(symbol: str, month: str) -> Path | None:
    filename = f"{symbol}-1h-{month}.zip"
    directory = CACHE_ROOT / symbol
    archive_path = directory / filename
    checksum_path = directory / f"{filename}.CHECKSUM"
    url = f"{BINANCE_ARCHIVE_BASE}/{symbol}/1h/{filename}"
    if not download(url, archive_path, optional=True):
        return None
    if download(url + ".CHECKSUM", checksum_path, optional=True):
        expected = checksum_path.read_text(encoding="utf-8").strip().split()[0].lower()
        actual = sha256(archive_path)
        if expected != actual:
            archive_path.unlink(missing_ok=True)
            raise RuntimeError(f"checksum mismatch for {filename}: {actual} != {expected}")
    with zipfile.ZipFile(archive_path) as archive:
        bad = archive.testzip()
        if bad is not None:
            raise RuntimeError(f"corrupt member {bad} in {filename}")
    return archive_path


def archive_fetch_klines(pair: str, start: int, end: int) -> List[dict]:
    rows: Dict[int, dict] = {}
    print(f"Loading Binance public monthly klines for {pair}", flush=True)
    for month in month_iter(start, end):
        archive_path = verified_monthly_zip(pair, month)
        if archive_path is None:
            continue
        with zipfile.ZipFile(archive_path) as archive:
            members = [name for name in archive.namelist() if name.endswith(".csv")]
            if not members:
                raise RuntimeError(f"CSV missing in {archive_path.name}")
            with archive.open(members[0]) as binary:
                reader = csv.reader(io.TextIOWrapper(binary, encoding="utf-8"))
                for item in reader:
                    if len(item) < 6:
                        continue
                    try:
                        ts = int(item[0])
                    except (TypeError, ValueError):
                        continue
                    while ts > 10_000_000_000_000:
                        ts //= 1000
                    if start <= ts < end:
                        rows[ts] = {
                            "ts": ts,
                            "open": float(item[1]),
                            "high": float(item[2]),
                            "low": float(item[3]),
                            "close": float(item[4]),
                            "volume": float(item[5]),
                        }
    result = [rows[key] for key in sorted(rows)]
    if len(result) < 1000:
        raise RuntimeError(f"insufficient archive candles for {pair}: {len(result)}")
    print(f"Loaded {pair}: {len(result)} hourly candles", flush=True)
    return result


def install_historical_data_adapters(crypto_bt) -> None:
    original_fetch_json = crypto_bt.core.fetch_json
    request_state = {"last": 0.0}

    def resilient_fetch_json(path: str, params: dict, timeout: int = 40):
        last_error: Exception | None = None
        for attempt in range(1, 9):
            wait = 0.35 - (time.monotonic() - request_state["last"])
            if wait > 0:
                time.sleep(wait)
            try:
                result = original_fetch_json(path, params, timeout)
                request_state["last"] = time.monotonic()
                return result
            except urllib.error.HTTPError as error:
                last_error = error
                request_state["last"] = time.monotonic()
                if error.code not in {418, 429, 500, 502, 503, 504} or attempt == 8:
                    raise
                time.sleep(min(90, 3 * (2 ** (attempt - 1))))
            except Exception as error:
                last_error = error
                request_state["last"] = time.monotonic()
                if attempt == 8:
                    raise
                time.sleep(min(60, 2 ** attempt))
        raise RuntimeError(f"Aster request failed: {path}: {last_error}")

    crypto_bt.core.fetch_klines = archive_fetch_klines
    crypto_bt.core.fetch_json = resilient_fetch_json
