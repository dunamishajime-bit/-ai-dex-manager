"""Diagnose sealed Binance USD-M metrics archive coverage without strategy evaluation.

Research infrastructure only. This probe never requests t >= 2026-07-01,
never reads Fresh OOS, never changes the frozen V7 strategy, and never lowers
the existing 98% per-symbol day coverage gate. It records 404 archive gaps
separately from unresolved transport failures and computes contiguous common
coverage across all required symbols.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import research_fetch_binance_usdm_metrics_history as base

UTC = dt.timezone.utc
START = base.START
END = base.END
SYMBOLS = base.SYMBOLS
MAX_WORKERS = 12
RETRIES = 5
MIN_DAY_COVERAGE = 0.98  # unchanged from the frozen cache builder
USER_AGENT = "research-usdm-metrics-coverage/1.0"
DEFAULT_OUTPUT = Path("research-output/usdm-metrics-coverage/manifest.json")


def _request_status(url: str, method: str) -> tuple[int | None, str | None]:
    headers = {"User-Agent": USER_AGENT}
    if method == "GET":
        headers["Range"] = "bytes=0-0"
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return int(getattr(response, "status", 200)), None
    except urllib.error.HTTPError as exc:
        return int(exc.code), None
    except Exception as exc:  # diagnostic: preserve exact error class/message
        return None, f"{type(exc).__name__}:{str(exc)[:240]}"


def probe_day(symbol: str, day: dt.date) -> dict[str, Any]:
    # base.archive_url is the frozen pre-OOS firewall. Do not recreate/bypass it.
    url = base.archive_url(symbol, day)
    last_error: str | None = None
    last_status: int | None = None
    methods: list[str] = []
    for attempt in range(1, RETRIES + 1):
        status, error = _request_status(url, "HEAD")
        methods.append("HEAD")
        if status in (200, 206):
            return {"symbol": symbol, "day": day.isoformat(), "available": True, "httpStatus": status, "method": "HEAD"}
        if status == 404:
            return {"symbol": symbol, "day": day.isoformat(), "available": False, "httpStatus": 404, "classification": "ARCHIVE_404"}

        # Some object/CDN paths reject HEAD while GET is valid. Use a one-byte
        # range probe so HEAD behavior is never mistaken for a missing archive.
        if status in (403, 405, 501) or status is None:
            get_status, get_error = _request_status(url, "GET")
            methods.append("GET_RANGE")
            if get_status in (200, 206):
                return {"symbol": symbol, "day": day.isoformat(), "available": True, "httpStatus": get_status, "method": "GET_RANGE"}
            if get_status == 404:
                return {"symbol": symbol, "day": day.isoformat(), "available": False, "httpStatus": 404, "classification": "ARCHIVE_404"}
            last_status = get_status if get_status is not None else status
            last_error = get_error or error or (f"HTTP_{last_status}" if last_status is not None else "UNKNOWN")
        else:
            last_status = status
            last_error = error or f"HTTP_{status}"
        if attempt < RETRIES:
            time.sleep(0.35 * attempt)

    return {
        "symbol": symbol,
        "day": day.isoformat(),
        "available": False,
        "httpStatus": last_status,
        "classification": "UNRESOLVED_TRANSPORT",
        "error": last_error,
        "methods": methods,
    }


def consecutive_ranges(days: list[dt.date]) -> list[dict[str, Any]]:
    if not days:
        return []
    ordered = sorted(set(days))
    out: list[dict[str, Any]] = []
    start = prev = ordered[0]
    for day in ordered[1:]:
        if day == prev + dt.timedelta(days=1):
            prev = day
            continue
        out.append(_range_record(start, prev))
        start = prev = day
    out.append(_range_record(start, prev))
    return out


def _range_record(start: dt.date, end_inclusive: dt.date) -> dict[str, Any]:
    days = (end_inclusive - start).days + 1
    return {
        "start": start.isoformat(),
        "endInclusive": end_inclusive.isoformat(),
        "endExclusive": (end_inclusive + dt.timedelta(days=1)).isoformat(),
        "days": days,
    }


def build_manifest() -> dict[str, Any]:
    base.self_test_firewall()
    days = list(base.day_range(START, END))
    tasks = [(symbol, day) for symbol in SYMBOLS for day in days]
    results: list[dict[str, Any]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(probe_day, symbol, day): (symbol, day) for symbol, day in tasks}
        for n, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if n % 250 == 0 or n == len(tasks):
                available = sum(bool(item.get("available")) for item in results)
                print(f"METRICS_COVERAGE_PROGRESS:{n}/{len(tasks)}:available={available}", flush=True)

    expected_days = len(days)
    symbol_records: dict[str, Any] = {}
    available_sets: dict[str, set[dt.date]] = {}
    for symbol in SYMBOLS:
        rows = sorted((r for r in results if r["symbol"] == symbol), key=lambda r: r["day"])
        available_days = [dt.date.fromisoformat(r["day"]) for r in rows if r.get("available")]
        archive_404 = [r["day"] for r in rows if r.get("classification") == "ARCHIVE_404"]
        unresolved = [r for r in rows if r.get("classification") == "UNRESOLVED_TRANSPORT"]
        available_sets[symbol] = set(available_days)
        coverage = len(available_days) / expected_days
        available_ranges = consecutive_ranges(available_days)
        missing_dates = sorted(set(days) - set(available_days))
        missing_ranges = consecutive_ranges(missing_dates)
        symbol_records[symbol] = {
            "expectedDays": expected_days,
            "availableDays": len(available_days),
            "dayCoverage": coverage,
            "coverageGateThreshold": MIN_DAY_COVERAGE,
            "coverageGatePass": coverage >= MIN_DAY_COVERAGE,
            "archive404Count": len(archive_404),
            "archive404Days": archive_404,
            "unresolvedCount": len(unresolved),
            "unresolved": unresolved,
            "missingRanges": missing_ranges,
            "availableRanges": available_ranges,
            "longestAvailableRange": max(available_ranges, key=lambda x: x["days"], default=None),
        }

    common = set(days)
    for symbol in SYMBOLS:
        common &= available_sets[symbol]
    common_ranges = consecutive_ranges(list(common))
    longest_common = max(common_ranges, key=lambda x: x["days"], default=None)

    all_gates_pass = all(symbol_records[s]["coverageGatePass"] for s in SYMBOLS)
    unresolved_total = sum(symbol_records[s]["unresolvedCount"] for s in SYMBOLS)
    manifest = {
        "manifestVersion": "v1",
        "source": "binance-data-vision-usdm-daily-metrics",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "strategyEvaluationPerformed": False,
        "v7Executed": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "start": START.isoformat(),
        "endExclusive": END.isoformat(),
        "expectedDaysPerSymbol": expected_days,
        "symbolsRequired": list(SYMBOLS),
        "existingCoverageGate": {"minimumPerSymbolDayCoverage": MIN_DAY_COVERAGE, "allSymbolsPass": all_gates_pass},
        "unresolvedTransportCount": unresolved_total,
        "commonAvailableDays": len(common),
        "commonDayCoverage": len(common) / expected_days,
        "commonAvailableRanges": common_ranges,
        "longestCommonAvailableRange": longest_common,
        "policy": {
            "forwardFillMissingDays": False,
            "lowerCoverageGate": False,
            "selectIntervalAfterStrategyResults": False,
            "freshOosBoundaryMayMove": False,
            "coverageOnlyMayPredeclareOldDataInterval": True,
        },
        "symbols": symbol_records,
    }
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    print("METRICS_COVERAGE_MANIFEST_WRITTEN:" + str(output))
    print(json.dumps({
        "allCoverageGatesPass": manifest["existingCoverageGate"]["allSymbolsPass"],
        "unresolvedTransportCount": manifest["unresolvedTransportCount"],
        "commonAvailableDays": manifest["commonAvailableDays"],
        "commonDayCoverage": manifest["commonDayCoverage"],
        "longestCommonAvailableRange": manifest["longestCommonAvailableRange"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
