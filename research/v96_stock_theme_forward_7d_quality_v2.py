from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence
from zoneinfo import ZoneInfo

import v96_stock_theme_forward_7d_validate as base7
import v96_stock_theme_forward_validate as base

NY = ZoneInfo("America/New_York")
EXTRA_ENDPOINT_KEYS = ("ticker24h", "klines1m")
CORE_ENDPOINT_KEYS = ("premium", "openInterest", "depth", "bookTicker", "lastPrice")
EXECUTION_NOTIONALS = ("100", "500", "1000")


def finite(value: Any) -> Optional[float]:
    return base.finite(value)


def percentile(values: Sequence[float], fraction: float) -> Optional[float]:
    return base.percentile(list(values), fraction)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def iter_snapshots(input_dir: Path) -> Iterable[dict]:
    for path in sorted(input_dir.rglob("snapshots-*.jsonl.gz")):
        yield from base7.read_jsonl_gz(path)


def endpoint_ok(row: dict, key: str) -> bool:
    item = row.get(key)
    return bool(isinstance(item, dict) and item.get("ok"))


def endpoint_latency(row: dict, key: str) -> Optional[float]:
    item = row.get(key)
    return finite(item.get("latencyMs")) if isinstance(item, dict) else None


def session_bucket(timestamp_ms: int) -> str:
    local = dt.datetime.fromtimestamp(timestamp_ms / 1000.0, tz=dt.timezone.utc).astimezone(NY)
    minutes = local.hour * 60 + local.minute
    if local.weekday() >= 5:
        return "CLOSED"
    if 570 <= minutes < 600:
        return "OPEN_30M"
    if 600 <= minutes < 930:
        return "REGULAR_CORE"
    if 930 <= minutes < 960:
        return "CLOSE_30M"
    if 240 <= minutes < 570:
        return "PREMARKET"
    if 960 <= minutes < 1200:
        return "AFTER_HOURS"
    return "CLOSED"


def summarize_latencies(values: Dict[str, List[float]]) -> Dict[str, dict]:
    return {
        key: {
            "samples": len(samples),
            "p50Ms": statistics.median(samples) if samples else None,
            "p95Ms": percentile(samples, 0.95),
            "maxMs": max(samples) if samples else None,
        }
        for key, samples in sorted(values.items())
    }


def summarize_execution(values: Dict[str, Dict[str, List[float]]]) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for notional, sides in sorted(values.items(), key=lambda item: int(item[0])):
        result[notional] = {}
        for side, samples in sorted(sides.items()):
            result[notional][side] = {
                "samples": len(samples),
                "medianSlippageBps": statistics.median(samples) if samples else None,
                "p95SlippageBps": percentile(samples, 0.95),
                "maxSlippageBps": max(samples) if samples else None,
            }
    return result


def timestamp_gaps(by_symbol: Dict[str, List[int]]) -> dict:
    symbols: Dict[str, dict] = {}
    all_gaps: List[float] = []
    for symbol, timestamps in sorted(by_symbol.items()):
        ordered = sorted(set(ts for ts in timestamps if ts > 0))
        gaps = [(later - earlier) / 1000.0 for earlier, later in zip(ordered, ordered[1:])]
        all_gaps.extend(gaps)
        symbols[symbol] = {
            "samples": len(ordered),
            "maxGapSeconds": max(gaps) if gaps else None,
            "gapsOver90Seconds": sum(gap > 90.0 for gap in gaps),
            "gapsOver10Minutes": sum(gap > 600.0 for gap in gaps),
        }
    return {
        "symbols": symbols,
        "globalMaxGapSeconds": max(all_gaps) if all_gaps else None,
        "globalP95GapSeconds": percentile(all_gaps, 0.95),
        "gapsOver90Seconds": sum(gap > 90.0 for gap in all_gaps),
        "gapsOver10Minutes": sum(gap > 600.0 for gap in all_gaps),
    }


def contract_coverage(input_dir: Path) -> dict:
    paths = sorted(input_dir.rglob("contracts-*.json"))
    observed: set[str] = set()
    missing: set[str] = set()
    statuses: Dict[str, Any] = {}
    clock_skews: List[float] = []
    for path in paths:
        item = read_json(path)
        observed.update(str(symbol).upper() for symbol in item.get("observedSymbols", []))
        missing.update(str(symbol).upper() for symbol in item.get("missingSymbols", []))
        skew = finite(item.get("clockSkewMs"))
        if skew is not None:
            clock_skews.append(skew)
        for contract in item.get("contracts", []):
            if isinstance(contract, dict):
                statuses[str(contract.get("symbol", "")).upper()] = contract.get("status")
    expected = set(base.EXPECTED_SYMBOLS)
    return {
        "files": len(paths),
        "observedSymbols": sorted(observed),
        "missingSymbols": sorted((expected - observed) | missing),
        "statuses": statuses,
        "clockSkewMedianMs": statistics.median(clock_skews) if clock_skews else None,
        "clockSkewMaxAbsMs": max((abs(value) for value in clock_skews), default=None),
        "coveragePass": bool(paths and observed == expected and not missing),
    }


def extended_quality(input_dir: Path) -> dict:
    total = 0
    v2_rows = 0
    legacy_rows = 0
    endpoint_attempts: Dict[str, int] = defaultdict(int)
    endpoint_failures: Dict[str, int] = defaultdict(int)
    latencies: Dict[str, List[float]] = defaultdict(list)
    minute_bar_rows = 0
    activity_rows = 0
    router_counts: Dict[str, int] = defaultdict(int)
    session_counts: Dict[str, int] = defaultdict(int)
    by_symbol: Dict[str, List[int]] = defaultdict(list)
    execution_values: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    execution_fillable: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    execution_attempts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for row in iter_snapshots(input_dir):
        total += 1
        schema = int(row.get("schemaVersion", 1) or 1)
        if schema >= 2:
            v2_rows += 1
        else:
            legacy_rows += 1
        symbol = str(row.get("symbol", "")).upper()
        timestamp_ms = int(row.get("capturedAtMs", 0) or 0)
        if symbol and timestamp_ms > 0:
            by_symbol[symbol].append(timestamp_ms)
            session_counts[session_bucket(timestamp_ms)] += 1
        for key in CORE_ENDPOINT_KEYS:
            endpoint_attempts[key] += 1
            if not endpoint_ok(row, key):
                endpoint_failures[key] += 1
            latency = endpoint_latency(row, key)
            if latency is not None:
                latencies[key].append(latency)
        if schema < 2:
            continue
        for key in EXTRA_ENDPOINT_KEYS:
            endpoint_attempts[key] += 1
            if not endpoint_ok(row, key):
                endpoint_failures[key] += 1
            latency = endpoint_latency(row, key)
            if latency is not None:
                latencies[key].append(latency)
        derived = row.get("derived") if isinstance(row.get("derived"), dict) else {}
        if isinstance(derived.get("latestMinuteBar"), dict):
            minute_bar_rows += 1
        activity = derived.get("marketActivity") if isinstance(derived.get("marketActivity"), dict) else {}
        if any(activity.get(key) is not None for key in ("quoteVolume24h", "baseVolume24h", "tradeCount24h")):
            activity_rows += 1
        clock = row.get("marketClock") if isinstance(row.get("marketClock"), dict) else {}
        for key in ("usRegularSession", "stockEntryAllowedByClock", "cryptoEntryAllowedByClock", "transitionWindow"):
            if bool(clock.get(key)):
                router_counts[key] += 1
        execution = derived.get("execution") if isinstance(derived.get("execution"), dict) else {}
        notionals = execution.get("quoteNotionals") if isinstance(execution.get("quoteNotionals"), dict) else {}
        for notional in EXECUTION_NOTIONALS:
            sides = notionals.get(notional) if isinstance(notionals.get(notional), dict) else {}
            for side in ("buy", "sell"):
                estimate = sides.get(side) if isinstance(sides.get(side), dict) else {}
                execution_attempts[notional][side] += 1
                if bool(estimate.get("fillable")):
                    execution_fillable[notional][side] += 1
                    value = finite(estimate.get("slippageBpsFromMid"))
                    if value is not None:
                        execution_values[notional][side].append(value)

    endpoint_summary = {}
    for key in sorted(endpoint_attempts):
        attempts = endpoint_attempts[key]
        failures = endpoint_failures[key]
        endpoint_summary[key] = {
            "attempts": attempts,
            "failures": failures,
            "successPct": ((attempts - failures) / attempts * 100.0) if attempts else None,
        }
    fill_summary: Dict[str, dict] = {}
    for notional in EXECUTION_NOTIONALS:
        fill_summary[notional] = {}
        for side in ("buy", "sell"):
            attempts = execution_attempts[notional][side]
            fills = execution_fillable[notional][side]
            fill_summary[notional][side] = {
                "attempts": attempts,
                "fillable": fills,
                "fillablePct": (fills / attempts * 100.0) if attempts else None,
            }
    contracts = contract_coverage(input_dir)
    extra_success = [endpoint_summary.get(key, {}).get("successPct") for key in EXTRA_ENDPOINT_KEYS]
    extended_pass = bool(
        v2_rows > 0
        and contracts["coveragePass"]
        and all(value is not None and value >= 98.0 for value in extra_success)
        and minute_bar_rows / v2_rows >= 0.98
        and activity_rows / v2_rows >= 0.98
    )
    return {
        "status": "EXTENDED_FORWARD_DATA_QUALITY_PASS" if extended_pass else "EXTENDED_FORWARD_DATA_QUALITY_INCOMPLETE_OR_FAIL",
        "extendedDataQualityPass": extended_pass,
        "snapshots": {"total": total, "schemaV2": v2_rows, "legacy": legacy_rows},
        "endpoints": endpoint_summary,
        "latencies": summarize_latencies(latencies),
        "minuteBarCoveragePctV2": (minute_bar_rows / v2_rows * 100.0) if v2_rows else None,
        "marketActivityCoveragePctV2": (activity_rows / v2_rows * 100.0) if v2_rows else None,
        "marketClockCounts": dict(sorted(router_counts.items())),
        "sessionCounts": dict(sorted(session_counts.items())),
        "executionFillability": fill_summary,
        "executionSlippage": summarize_execution(execution_values),
        "acquisitionGaps": timestamp_gaps(by_symbol),
        "contracts": contracts,
        "limitations": [
            "Legacy schema-v1 snapshots remain valid for core microstructure but do not contain volume, contract metadata, or simulated depth fills.",
            "GitHub scheduled workflow start times are not guaranteed; acquisition gaps are measured explicitly.",
            "Clock eligibility is evidence only and does not place orders or alter the current V96 strategy.",
        ],
    }


def analyze(input_dir: Path) -> dict:
    result = base7.analyze(input_dir)
    result["extendedQualityV2"] = extended_quality(input_dir)
    return result


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    base7.write_report(result, output_dir)
    extended = result["extendedQualityV2"]
    (output_dir / "v96-stock-theme-forward-7d-quality-v2.json").write_text(
        json.dumps(extended, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    gaps = extended["acquisitionGaps"]
    sessions = extended["sessionCounts"]
    lines = [
        "# V96 stock-theme Forward extended data quality v2",
        "",
        f"Status: **{extended['status']}**",
        "",
        f"- total snapshots: {extended['snapshots']['total']}",
        f"- schema-v2 snapshots: {extended['snapshots']['schemaV2']}",
        f"- legacy snapshots: {extended['snapshots']['legacy']}",
        f"- 1m bar coverage on v2: {extended['minuteBarCoveragePctV2']}",
        f"- 24h activity coverage on v2: {extended['marketActivityCoveragePctV2']}",
        f"- contract metadata pass: {extended['contracts']['coveragePass']}",
        f"- global max acquisition gap seconds: {gaps['globalMaxGapSeconds']}",
        f"- U.S. open 30m samples: {sessions.get('OPEN_30M', 0)}",
        f"- U.S. regular core samples: {sessions.get('REGULAR_CORE', 0)}",
        f"- U.S. close 30m samples: {sessions.get('CLOSE_30M', 0)}",
        "",
        "This report measures acquisition quality and execution feasibility only. It does not approve profitability or Production.",
    ]
    (output_dir / "v96-stock-theme-forward-7d-quality-v2.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    regular = int(dt.datetime(2026, 7, 22, 14, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
    opening = int(dt.datetime(2026, 7, 22, 13, 40, tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert session_bucket(regular) == "REGULAR_CORE"
    assert session_bucket(opening) == "OPEN_30M"
    assert percentile([1.0, 2.0, 3.0], 0.95) is not None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".research-state/v96-stock-theme-forward-data")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-theme-forward-report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    base7.self_test()
    self_test()
    if args.self_test:
        print("V96 stock-theme Forward extended quality v2 self-test: PASS")
        return 0
    result = analyze(Path(args.input_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    extended = result["extendedQualityV2"]
    print(json.dumps({
        "coreStatus": result["status"],
        "extendedStatus": extended["status"],
        "snapshots": extended["snapshots"],
        "sessionCounts": extended["sessionCounts"],
        "globalMaxGapSeconds": extended["acquisitionGaps"]["globalMaxGapSeconds"],
    }, ensure_ascii=False))
    return 0 if result["dataQualityPass"] and extended["extendedDataQualityPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
