"""Probe Binance USD-M daily metrics archives using design-period dates only.

Research infrastructure only. No strategy evaluation and no post-2026-07-01
Fresh OOS data access. The goal is to establish whether a genuinely new public
information source is reproducibly available for future clean-sheet research.
"""
from __future__ import annotations

import csv
import io
import json
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT")
DATES = ("2023-07-01", "2024-07-01", "2025-07-01", "2026-06-30")
BASE = "https://data.binance.vision/data/futures/um/daily/metrics"


def fetch(symbol: str, date: str) -> dict:
    name = f"{symbol}-metrics-{date}.zip"
    url = f"{BASE}/{symbol}/{name}"
    req = urllib.request.Request(url, headers={"User-Agent": "research-schema-probe/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        return {"symbol": symbol, "date": date, "url": url, "available": False, "httpStatus": exc.code}
    except Exception as exc:
        return {"symbol": symbol, "date": date, "url": url, "available": False, "error": type(exc).__name__}
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if not csv_names:
                return {"symbol": symbol, "date": date, "url": url, "available": True, "zipBytes": len(payload), "error": "NO_CSV"}
            raw = zf.read(csv_names[0]).decode("utf-8-sig", errors="replace")
    except Exception as exc:
        return {"symbol": symbol, "date": date, "url": url, "available": True, "zipBytes": len(payload), "error": f"ZIP:{type(exc).__name__}"}
    rows = list(csv.reader(io.StringIO(raw)))
    header = rows[0] if rows else []
    sample = rows[1] if len(rows) > 1 else []
    return {
        "symbol": symbol,
        "date": date,
        "url": url,
        "available": True,
        "zipBytes": len(payload),
        "csvName": csv_names[0],
        "rowCount": max(0, len(rows) - 1),
        "header": header,
        "sampleFieldCount": len(sample),
        "sample": sample,
    }


def main() -> None:
    results = [fetch(s, d) for s in SYMBOLS for d in DATES]
    available = [r for r in results if r.get("available") and r.get("header")]
    headers = sorted({tuple(r["header"]) for r in available})
    out = {
        "researchLine": "BINANCE_USDM_METRICS_SCHEMA_PROBE",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "strategyEvaluationPerformed": False,
        "post20260701DataUsed": False,
        "freshOosRead": False,
        "symbols": list(SYMBOLS),
        "dates": list(DATES),
        "availableCount": len(available),
        "totalProbes": len(results),
        "distinctHeaders": [list(h) for h in headers],
        "results": results,
    }
    root = Path(".research-state"); root.mkdir(parents=True, exist_ok=True)
    (root / "binance-usdm-metrics-schema-probe.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    lines = ["# Binance USD-M Metrics Schema Probe", "", f"Available: {len(available)}/{len(results)}", ""]
    for h in headers:
        lines.append("- Header: " + " | ".join(h))
    lines.append("")
    for r in results:
        lines.append(f"- {r['symbol']} {r['date']}: available={r.get('available')} rows={r.get('rowCount')} status={r.get('httpStatus')} error={r.get('error')}")
    lines += ["", "Schema probe only. No strategy evaluation. No post-2026-07-01 Fresh OOS data read."]
    (root / "binance-usdm-metrics-schema-probe.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))
    if len(available) < 10:
        raise SystemExit(f"INSUFFICIENT_METRICS_ARCHIVE_COVERAGE:{len(available)}/{len(results)}")


if __name__ == "__main__":
    main()
