"""Content-level validation manifest for sealed Binance USD-M daily metrics.

Unlike the lightweight archive-existence probe, this runs the exact frozen
`download_day` parser/validator against every required symbol/day, but records
all failures instead of aborting on the first symbol coverage gate. No strategy
is evaluated and no Fresh-OOS URL can be generated because archive_url remains
the frozen firewall from the base fetcher.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
from collections import Counter
from pathlib import Path
from typing import Any

import research_fetch_binance_usdm_metrics_history as base

MAX_WORKERS = 8
RETRIES = 6
MIN_DAY_COVERAGE = 0.98
OUTPUT = Path("research-output/usdm-metrics-content-validation/manifest.json")


def ranges(days: list[dt.date]) -> list[dict[str, Any]]:
    if not days:
        return []
    ordered = sorted(set(days)); out=[]; start=prev=ordered[0]
    for day in ordered[1:]:
        if day == prev + dt.timedelta(days=1):
            prev=day; continue
        out.append(record_range(start, prev)); start=prev=day
    out.append(record_range(start, prev)); return out


def record_range(start: dt.date, end: dt.date) -> dict[str, Any]:
    return {
        "start": start.isoformat(),
        "endInclusive": end.isoformat(),
        "endExclusive": (end + dt.timedelta(days=1)).isoformat(),
        "days": (end-start).days+1,
    }


def error_class(item: dict[str, Any]) -> str:
    if item.get("httpStatus") == 404:
        return "HTTP_404"
    raw = str(item.get("error") or "UNKNOWN")
    if raw.startswith("HTTP_"):
        return raw
    return raw.split(":", 1)[0]


def main() -> None:
    base.self_test_firewall()
    base.RETRIES = RETRIES
    days = list(base.day_range(base.START, base.END))
    tasks = [(s,d) for s in base.SYMBOLS for d in days]
    results: list[dict[str, Any]]=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs={pool.submit(base.download_day,s,d):(s,d) for s,d in tasks}
        for n,fut in enumerate(concurrent.futures.as_completed(futs),1):
            item=fut.result()
            # Hourly payload is intentionally discarded; this artifact is a
            # coverage/error audit, not a cache and not a strategy input.
            item.pop("hourly", None)
            results.append(item)
            if n%250==0 or n==len(tasks):
                ok=sum(bool(x.get("available")) for x in results)
                print(f"CONTENT_VALIDATION_PROGRESS:{n}/{len(tasks)}:valid={ok}", flush=True)

    valid_sets: dict[str,set[dt.date]]={}
    symbols: dict[str,Any]={}
    for symbol in base.SYMBOLS:
        rows=sorted((x for x in results if x["symbol"]==symbol), key=lambda x:x["day"])
        valid=[dt.date.fromisoformat(x["day"]) for x in rows if x.get("available")]
        invalid=[x for x in rows if not x.get("available")]
        valid_sets[symbol]=set(valid)
        classes=Counter(error_class(x) for x in invalid)
        invalid_days=[dt.date.fromisoformat(x["day"]) for x in invalid]
        valid_ranges=ranges(valid)
        symbols[symbol]={
            "expectedDays":len(days),
            "validDays":len(valid),
            "validDayCoverage":len(valid)/len(days),
            "coverageGateThreshold":MIN_DAY_COVERAGE,
            "coverageGatePass":len(valid)/len(days)>=MIN_DAY_COVERAGE,
            "invalidDays":len(invalid),
            "errorClassCounts":dict(sorted(classes.items())),
            "invalidRecords":invalid,
            "invalidRanges":ranges(invalid_days),
            "validRanges":valid_ranges,
            "longestValidRange":max(valid_ranges,key=lambda x:x["days"],default=None),
        }

    common=set(days)
    for symbol in base.SYMBOLS:
        common &= valid_sets[symbol]
    common_ranges=ranges(list(common))
    manifest={
        "manifestVersion":"v1",
        "source":"binance-data-vision-usdm-daily-metrics-exact-parser",
        "researchOnly":True,
        "productionChanged":False,
        "vpsChanged":False,
        "liveChanged":False,
        "realTradingEnabled":False,
        "strategyEvaluationPerformed":False,
        "v7Executed":False,
        "freshOosRead":False,
        "post20260701DataUsed":False,
        "start":base.START.isoformat(),
        "endExclusive":base.END.isoformat(),
        "parser":"research_fetch_binance_usdm_metrics_history.download_day",
        "parserRetries":RETRIES,
        "workers":MAX_WORKERS,
        "existingCoverageGate":{"minimumPerSymbolDayCoverage":MIN_DAY_COVERAGE,"allSymbolsPass":all(symbols[s]["coverageGatePass"] for s in base.SYMBOLS)},
        "commonValidDays":len(common),
        "commonValidDayCoverage":len(common)/len(days),
        "commonValidRanges":common_ranges,
        "longestCommonValidRange":max(common_ranges,key=lambda x:x["days"],default=None),
        "policy":{"lowerCoverageGate":False,"forwardFillInvalidDays":False,"selectIntervalAfterStrategyResults":False,"freshOosBoundaryMayMove":False},
        "symbols":symbols,
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(manifest,indent=2,sort_keys=True),encoding="utf-8")
    print("CONTENT_VALIDATION_MANIFEST_WRITTEN:"+str(OUTPUT))
    print(json.dumps({
        "allSymbolsPass":manifest["existingCoverageGate"]["allSymbolsPass"],
        "commonValidDays":manifest["commonValidDays"],
        "commonValidDayCoverage":manifest["commonValidDayCoverage"],
        "longestCommonValidRange":manifest["longestCommonValidRange"],
        "errors":{s:symbols[s]["errorClassCounts"] for s in base.SYMBOLS},
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
