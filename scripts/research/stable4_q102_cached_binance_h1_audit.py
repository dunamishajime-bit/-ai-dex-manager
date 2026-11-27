"""Validate cached public Binance monthly H1 archives for limited Q102 research.

Only BTCUSDT and SOLUSDT; 2025-03-01 through 2026-10-01 exclusive.
Monthly ZIP files and SHA256 must match the prior saved research manifest.
Never interpolate, patch, or use exchange credentials. Writes only a new
caller-owned H1 JSON file per symbol. No trading authority.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import zipfile

UTC = dt.timezone.utc
H = 3_600_000
START = int(dt.datetime(2025, 3, 1, tzinfo=UTC).timestamp() * 1000)
END = int(dt.datetime(2026, 10, 1, tzinfo=UTC).timestamp() * 1000)
SYMBOLS = ("BTCUSDT", "SOLUSDT")
MONTHS = [(year, month) for year in (2025, 2026)
          for month in range(1, 13)
          if (year, month) >= (2025, 3) and (year, month) <= (2026, 9)]


def load_one(root: Path, symbol: str, manifest: dict) -> tuple[list[dict], list[dict]]:
    out = []
    files = []
    for year, month in MONTHS:
        name = f"{symbol}-1h-{year}-{month:02d}.zip"
        meta = manifest.get(name)
        if not meta or meta.get("status") != "OK":
            raise ValueError("Q102_CACHED_BINANCE_ARCHIVE_MANIFEST_MISSING:" + name)
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Q102_CACHED_BINANCE_ARCHIVE_MISSING:" + name)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != meta.get("sha256") or len(raw) != meta.get("bytes"):
            raise ValueError("Q102_CACHED_BINANCE_ARCHIVE_TAMPERED:" + name)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if z.namelist() != [name[:-4] + ".csv"]:
                raise ValueError("Q102_CACHED_BINANCE_ZIP_MEMBER_INVALID:" + name)
            csv_raw = z.read(z.namelist()[0])
        rows = list(csv.reader(io.StringIO(csv_raw.decode("utf8"))))
        if rows and rows[0][0] == "open_time":
            rows = rows[1:]
        if not rows:
            raise ValueError("Q102_CACHED_BINANCE_ARCHIVE_EMPTY:" + name)
        for row in rows:
            if len(row) < 8:
                raise ValueError("Q102_CACHED_BINANCE_CSV_ROW_MALFORMED")
            ts = int(row[0])
            if ts < START or ts >= END:
                raise ValueError("Q102_CACHED_BINANCE_OUTSIDE_WINDOW:" + name)
            if ts != START + len(out) * H:
                raise ValueError("Q102_CACHED_BINANCE_TIME_GAP:" + name)
            open_, high, low, close, base, quote = (
                float(row[1]), float(row[2]), float(row[3]),
                float(row[4]), float(row[5]), float(row[7]))
            if (not all(math.isfinite(v) for v in (open_, high, low, close, base, quote))
                or min(open_, low, close) <= 0 or base < 0 or quote < 0
                or high < max(open_, close) or low > min(open_, close)
                or int(row[6]) != ts + H - 1):
                raise ValueError("Q102_CACHED_BINANCE_INVALID_OHLC:" + str(ts))
            out.append({"timestampMs":ts, "open":open_, "high":high,
                        "low":low, "close":close, "baseVolume":base,
                        "quoteVolume":quote})
        files.append({"name":name, "zipSha256":digest, "rows":len(rows)})
    if len(out) != (END - START) // H:
        raise ValueError("Q102_CACHED_BINANCE_FULL_RANGE_INCOMPLETE")
    return out, files


def main() -> None:
    if len(sys.argv) != 3:
        raise ValueError("ARCHIVE_DIRECTORY_AND_OUTPUT_DIRECTORY_REQUIRED")
    root = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    if not root.is_dir() or not destination.is_dir():
        raise ValueError("SOURCE_OR_OUTPUT_DIRECTORY_UNAVAILABLE")
    manifest_raw = (root / "manifest.json").read_bytes()
    manifest_list = json.loads(manifest_raw)
    manifest = {row["name"]: row for row in manifest_list}
    parsed = {symbol: load_one(root, symbol, manifest) for symbol in SYMBOLS}
    outputs = {}
    for symbol, (rows, files) in parsed.items():
        target = destination / f"disdex_pr676_q102_binance_{symbol}_h1_20250301_20260930.json"
        raw = (json.dumps(rows, separators=(",", ":")) + "\n").encode("utf8")
        with target.open("xb") as out:
            out.write(raw)
        outputs[symbol] = {
            "path": str(target),
            "rows": len(rows),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "monthlyArchivesVerified": files,
        }
    print(json.dumps({
        "status": "Q102_LIMITED_BTC_SOL_H1_SOURCE_PARITY_DATA_READY",
        "sourceManifestSha256": hashlib.sha256(manifest_raw).hexdigest(),
        "periodUtc": [START, END],
        "symbols": list(SYMBOLS),
        "outputs": outputs,
        "orderAuthority": False,
        "productionEligible": False,
    }))


if __name__ == "__main__":
    main()
