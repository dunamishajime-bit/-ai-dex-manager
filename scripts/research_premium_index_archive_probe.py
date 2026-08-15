"""Probe official Binance USD-M monthly premiumIndexKlines archive.

Data-infrastructure only. No strategy, signal, threshold, return, PnL, or trade
calculation. Numeric OHLC premium values are intentionally not emitted. The probe
records only HTTP/archive availability, row count, timestamp bounds, column count,
and whether timestamps are monotonic.

No post-2026-06 month is requested. No Fresh OOS, VPS, LIVE, orders, deployment,
or production mutation.
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT")
MONTHS = ("2021-01", "2021-07", "2022-01", "2022-07", "2023-07", "2024-07", "2025-07", "2026-06")
BASE = "https://data.binance.vision/data/futures/um/monthly/premiumIndexKlines/{symbol}/1h/{symbol}-1h-{month}.zip"


def fetch(symbol: str, month: str) -> dict:
    url = BASE.format(symbol=symbol, month=month)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "disdex-research-archive-probe/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            status = int(getattr(r, "status", 200))
    except urllib.error.HTTPError as e:
        return {"symbol": symbol, "month": month, "available": False, "httpStatus": int(e.code)}
    except Exception as e:
        return {"symbol": symbol, "month": month, "available": False, "errorType": type(e).__name__}

    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = [n for n in z.namelist() if not n.endswith("/")]
            if len(names) != 1:
                return {"symbol": symbol, "month": month, "available": True, "httpStatus": status, "archiveValid": False, "fileCount": len(names)}
            text = z.read(names[0]).decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows:
            return {"symbol": symbol, "month": month, "available": True, "httpStatus": status, "archiveValid": False, "rowCount": 0}

        # Binance archives may or may not contain a header. Detect by first field.
        first = rows[0]
        has_header = not first or not first[0].strip().lstrip("-").isdigit()
        data = rows[1:] if has_header else rows
        data = [r for r in data if r]
        timestamps = []
        for r in data:
            try:
                timestamps.append(int(r[0]))
            except Exception:
                pass
        monotonic = all(a < b for a, b in zip(timestamps, timestamps[1:])) if len(timestamps) > 1 else True
        return {
            "symbol": symbol,
            "month": month,
            "available": True,
            "httpStatus": status,
            "archiveValid": True,
            "hasHeader": has_header,
            "columnCount": len(data[0]) if data else len(first),
            "rowCount": len(data),
            "parsedTimestampCount": len(timestamps),
            "firstTimestamp": timestamps[0] if timestamps else None,
            "lastTimestamp": timestamps[-1] if timestamps else None,
            "timestampsStrictlyIncreasing": monotonic,
        }
    except Exception as e:
        return {"symbol": symbol, "month": month, "available": True, "httpStatus": status, "archiveValid": False, "errorType": type(e).__name__}


def main() -> None:
    results = [fetch(s, m) for s in SYMBOLS for m in MONTHS]
    available = [x for x in results if x.get("available") and x.get("archiveValid")]
    schema_counts = sorted({x.get("columnCount") for x in available})
    out = {
        "researchLine": "PREMIUM_INDEX_ARCHIVE_PROBE",
        "researchOnly": True,
        "dataInfrastructureOnly": True,
        "strategyEvaluated": False,
        "returnsCalculated": False,
        "numericPremiumValuesEmitted": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post202606DataRequested": False,
        "source": "BINANCE_OFFICIAL_DATA_COLLECTION_USDM_MONTHLY_PREMIUM_INDEX_KLINES_1H",
        "symbols": list(SYMBOLS),
        "months": list(MONTHS),
        "requested": len(results),
        "validArchives": len(available),
        "schemaColumnCounts": schema_counts,
        "allValidTimestampsMonotonic": all(x.get("timestampsStrictlyIncreasing", False) for x in available),
        "results": results,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "premium-index-archive-probe.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
