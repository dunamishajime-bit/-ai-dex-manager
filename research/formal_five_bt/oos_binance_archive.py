"""Acquire genuine 2024-08-10..2025-08-09 Binance USD-M histories without Aster data.

Binance's public monthly ZIP archive is used because futures REST can return
HTTP 451 from GitHub Actions. All downloads are read-only, public market data.
Historical symbol eligibility is based on actual available archive months,
not the present-day active-contract catalog. Missing months remain missing.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import csv
import hashlib
import io
import json
import math
import re
import time as wallclock
import zipfile

from .acquire import extract_universes
from .manifest import load_manifest
from .acquire import MANIFEST_PATH

BASE = "https://data.binance.vision/data/futures/um/monthly"
START = date(2024, 8, 10)
END = date(2025, 8, 10)  # exclusive; no overlap with initial 2025-08-10 sample
WARMUP = date(2024, 1, 1)
HOUR = 3_600_000

def stamp(day):
    return int(datetime.combine(day, time.min, timezone.utc).timestamp() * 1000)

def months(first, last_exclusive):
    year, month = first.year, first.month
    while (year, month) <= (last_exclusive.year, last_exclusive.month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month > 12:
            year += 1
            month = 1

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, indent=2, allow_nan=False) + "\n")

def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(r, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n" for r in rows).encode()
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()

def fetch(url, *, retries=3):
    for attempt in range(retries + 1):
        try:
            with urlopen(Request(url, headers={"User-Agent": "DisDex-OOS-Research/1.0"}), timeout=45) as r:
                return r.read()
        except HTTPError as e:
            if e.code in (403, 404, 451):
                return None
            if e.code not in (408, 429, 500, 502, 503, 504) or attempt == retries:
                raise RuntimeError(f"ARCHIVE_HTTP_{e.code}") from e
        except (TimeoutError, URLError, OSError):
            if attempt == retries:
                raise
        wallclock.sleep(min(2 ** attempt, 8))
    raise RuntimeError("ARCHIVE_DOWNLOAD_FAILED")

def archive_url(symbol, ym, kind):
    if kind == "klines":
        filename = f"{symbol}-1h-{ym}.zip"
        return f"{BASE}/klines/{symbol}/1h/{filename}"
    filename = f"{symbol}-fundingRate-{ym}.zip"
    return f"{BASE}/fundingRate/{symbol}/{filename}"

def unpack_csv(payload, *, name):
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        members = [m for m in z.namelist() if m.endswith(".csv")]
        if len(members) != 1:
            raise ValueError(f"ARCHIVE_CSV_COUNT:{name}:{len(members)}")
        return list(csv.reader(io.StringIO(z.read(members[0]).decode("utf-8-sig"))))

def millis(value):
    n = int(float(value))
    if n > 10**15:  # Binance microsecond UTC epochs after 2025-01-01
        n //= 1000
    if not (10**12 < n < 10**13):
        raise ValueError(f"INVALID_UTC_MILLISECONDS:{str(value)[:25]}")
    return n

def h1_rows(rows, symbol):
    out = []
    for row in rows:
        if not row or not row[0] or not str(row[0]).strip().isdigit():
            continue  # published header variant
        if len(row) < 8:
            raise ValueError(f"INCOMPLETE_BINANCE_H1_ROW:{symbol}")
        t = millis(row[0])
        o, h, lo, close, base, quote = [float(row[i]) for i in (1, 2, 3, 4, 5, 7)]
        if not all(math.isfinite(x) for x in (o, h, lo, close, base, quote)):
            raise ValueError(f"NONFINITE_BINANCE_H1_ROW:{symbol}:{t}")
        if min(o, h, lo, close) <= 0 or lo > min(o, close) or h < max(o, close) or min(base, quote) < 0:
            raise ValueError(f"INVALID_BINANCE_H1_OHLC:{symbol}:{t}")
        out.append(dict(source="binance", exchange="BINANCE", instrument=symbol,
                        interval="1h", event_time_ms=t, close_time_ms=t + HOUR - 1,
                        open=o, high=h, low=lo, close=close,
                        base_volume=base, quote_volume=quote))
    return out

def funding_rows(rows, symbol):
    out = []
    header = None
    for row in rows:
        if not row or not any(str(s).strip() for s in row):
            continue
        normalized = [re.sub("[^a-z0-9]", "", str(v).lower()) for v in row]
        if header is None and any(x in normalized for x in ("fundingtime", "calctime", "fundingrate", "lastfundingrate")):
            header = normalized
            continue
        if header:
            ti = next((i for i, col in enumerate(header) if col in ("fundingtime", "calctime", "time")), None)
            ri = next((i for i, col in enumerate(header) if col in ("fundingrate", "lastfundingrate")), None)
        else:
            ti = next((i for i, col in enumerate(row) if str(col).strip().isdigit()
                       and len(str(col).strip()) in (13, 16)), None)
            ri = next((i for i in range(len(row)) if i != ti
                       and re.fullmatch(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?",str(row[i]).strip())
                       and abs(float(row[i])) < 0.2), None)
        if ti is None or ri is None or max(ti, ri) >= len(row):
            raise ValueError(f"UNKNOWN_BINANCE_FUNDING_CSV_FORMAT:{symbol}:{str(row)[:130]}")
        t = millis(row[ti])
        rate = float(row[ri])
        if not math.isfinite(rate) or abs(rate) > 0.2:
            raise ValueError(f"INVALID_FUNDING_RATE:{symbol}:{t}")
        out.append(dict(source="binance", exchange="BINANCE", instrument=symbol,
                        event_time_ms=t, funding_rate=rate))
    return out

def download_symbol(symbol, root):
    info = {"symbol": symbol, "venue": "binance", "market": "USD-M_PERPETUAL",
            "h1_months": {}, "funding_months": {}, "missing_h1_months": [],
            "missing_funding_months": []}
    kline_by_ts, funding_by_ts = {}, {}
    for ym in months(WARMUP, END):
        if ym == "2025-08":  # final 9 days are needed, monthly archive is available
            pass
        for kind in ("klines", "fundingRate"):
            url = archive_url(symbol, ym, "klines" if kind == "klines" else "funding")
            body = fetch(url)
            if body is None:
                info["missing_h1_months" if kind == "klines" else "missing_funding_months"].append(ym)
                continue
            # Verify the official SHA256 sidecar when available.
            checksum = fetch(url + ".CHECKSUM", retries=1)
            sha = hashlib.sha256(body).hexdigest()
            if checksum:
                expected = checksum.decode("utf-8-sig").strip().split()[0].lower()
                if not re.fullmatch("[0-9a-f]{64}", expected) or sha != expected:
                    raise ValueError(f"OFFICIAL_BINANCE_CHECKSUM_MISMATCH:{symbol}:{kind}:{ym}")
            rel = Path("raw") / "binance" / kind / symbol / f"{ym}.zip"
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            decoded = unpack_csv(body, name=str(rel))
            records = h1_rows(decoded, symbol) if kind == "klines" else funding_rows(decoded, symbol)
            dest = kline_by_ts if kind == "klines" else funding_by_ts
            for item in records:
                ts = item["event_time_ms"]
                if ts in dest and dest[ts] != item:
                    raise ValueError(f"CONFLICTING_ARCHIVE_OBSERVATION:{symbol}:{kind}:{ts}")
                dest[ts] = item
            info["h1_months" if kind == "klines" else "funding_months"][ym] = dict(
                source_url=url, original_zip_sha256=sha, checksum_verified=bool(checksum),
                raw_archive_path=rel.as_posix(), rows=len(records))
    start_ms, end_ms = stamp(WARMUP), stamp(END)
    h1 = [v for t, v in sorted(kline_by_ts.items()) if start_ms <= t < end_ms]
    funding = [v for t, v in sorted(funding_by_ts.items()) if start_ms <= t < end_ms]
    for kind, rows in (("klines", h1), ("funding", funding)):
        path = root / "normalized" / "binance" / kind / f"{symbol}.jsonl"
        info[kind + "_sha256"] = write_jsonl(path, rows)
    in_sample = [x for x in h1 if stamp(START) <= x["event_time_ms"] < stamp(END)]
    gaps = sum(b["event_time_ms"] - a["event_time_ms"] != HOUR for a, b in zip(h1, h1[1:]))
    info.update(h1_count=len(h1), in_period_h1=len(in_sample), funding_count=len(funding),
                h1_gap_count=gaps,
                first_h1=h1[0]["event_time_ms"] if h1 else None,
                last_h1=h1[-1]["event_time_ms"] if h1 else None,
                first_funding=funding[0]["event_time_ms"] if funding else None,
                last_funding=funding[-1]["event_time_ms"] if funding else None)
    return info

def acquire(root, max_workers=6):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    symbols = extract_universes()["crypto_union"]
    output = {"venue": "binance", "source": "OFFICIAL_BINANCE_PUBLIC_DATA_MONTHLY_USDM",
              "period_start": START.isoformat(), "period_end_inclusive": date(2025,8,9).isoformat(),
              "warmup_start": WARMUP.isoformat(), "runtime_sha": load_manifest(MANIFEST_PATH)["runtime_sha"],
              "symbols": {}, "status": "IN_PROGRESS",
              "no_aster_market_data": True,
              "provider": "https://data.binance.vision",
              "no_synthetic_bars": True}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(download_symbol, symbol, root): symbol for symbol in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                info = future.result()
            except Exception as e:
                info = {"symbol": symbol, "status": "FAILED",
                        "error": type(e).__name__ + ":" + str(e)[:250]}
            output["symbols"][symbol] = info
            write_json(root / "acquisition-progress.json", output)
            print("BINANCE_ARCHIVE_SYMBOL", symbol, info.get("h1_count",0),
                  info.get("funding_count",0), info.get("error","OK"), flush=True)
    missing = [s for s in ("BTCUSDT","FETUSDT","PENGUUSDT")
               if output["symbols"].get(s,{}).get("in_period_h1",0)==0]
    incomplete = [s for s,v in output["symbols"].items()
                  if v.get("h1_count",0)>0 and (v.get("funding_count",0)==0 or v.get("h1_gap_count",0)>0)]
    output.update(missing_mandatory=missing, incomplete_symbols=incomplete,
                  status="MARKET_DATA_PARTIAL" if missing or incomplete else "MARKET_DATA_ACQUIRED")
    write_json(root/"acquisition-manifest.json",output)
    if missing:
        raise ValueError("BINANCE_OOS_MANDATORY_MARKET_DATA_MISSING:"+",".join(missing))
    return output

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--max-workers",type=int,default=6)
    x=p.parse_args()
    result=acquire(x.root,max_workers=x.max_workers)
    print("OOS_ACQUISITION",json.dumps({"status":result["status"],
          "symbols":len(result["symbols"]),"incomplete":result["incomplete_symbols"]},sort_keys=True))
if __name__ == "__main__":
    main()
