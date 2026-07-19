from __future__ import annotations

import bisect
import datetime as dt
import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


HISTORY_RELATIVE = Path("aster-market-intelligence-v19") / "history"
CORE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]
ANALYSIS_SYMBOLS = CORE_SYMBOLS + ["LINKUSDT", "AVAXUSDT", "PENGUUSDT"]
HORIZONS_SECONDS = {"5m": 300, "10m": 600}
MIN_EVENT_SPACING_MS = 60_000
MAX_WINDOW_MS = 24 * 60 * 60 * 1000
SEGMENT_GAP_MS = 20_000

RAW_FEATURES = [
    "bookImbalance5Bps",
    "bookImbalance10Bps",
    "bookImbalance25Bps",
    "takerImbalance",
    "basisBps",
    "fundingRate",
    "spreadCompression",
    "depthRatio10Log",
]


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def percentile(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * q
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    fraction = index - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def pearson(xs: List[float], ys: List[float]) -> Optional[float]:
    if len(xs) != len(ys) or len(xs) < 20:
        return None
    xm = statistics.fmean(xs)
    ym = statistics.fmean(ys)
    numerator = sum((x - xm) * (y - ym) for x, y in zip(xs, ys))
    xv = sum((x - xm) ** 2 for x in xs)
    yv = sum((y - ym) ** 2 for y in ys)
    denominator = math.sqrt(xv * yv)
    return numerator / denominator if denominator > 0 else None


def ranks(values: List[float]) -> List[float]:
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    output = [0.0] * len(values)
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][1] == ordered[index][1]:
            end += 1
        rank = (index + end - 1) / 2.0
        for cursor in range(index, end):
            output[ordered[cursor][0]] = rank
        index = end
    return output


def spearman(xs: List[float], ys: List[float]) -> Optional[float]:
    if len(xs) < 20:
        return None
    return pearson(ranks(xs), ranks(ys))


def load_rows(state_dir: Path) -> List[dict]:
    history_dir = state_dir / HISTORY_RELATIVE
    rows: List[dict] = []
    for path in sorted(history_dir.glob("*.ndjson")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            symbol = str(row.get("symbol", ""))
            timestamp = int(row.get("timestamp", 0) or 0)
            if symbol in ANALYSIS_SYMBOLS and timestamp > 0 and safe_float(row.get("mid")) > 0:
                rows.append(row)
    if not rows:
        raise RuntimeError("no cumulative V19 rows restored")
    latest = max(int(row["timestamp"]) for row in rows)
    start = latest - MAX_WINDOW_MS
    dedup: Dict[Tuple[str, int], dict] = {}
    for row in rows:
        timestamp = int(row["timestamp"])
        if timestamp >= start:
            dedup[(str(row["symbol"]), timestamp)] = row
    return sorted(dedup.values(), key=lambda row: (str(row["symbol"]), int(row["timestamp"])))


def segment_rows(symbol_rows: List[dict]) -> List[List[dict]]:
    groups: List[List[dict]] = []
    current: List[dict] = []
    previous_ts = 0
    previous_run = None
    for row in symbol_rows:
        timestamp = int(row["timestamp"])
        run_started = int(row.get("runStarted", 0) or 0)
        new_segment = (
            current
            and (
                timestamp - previous_ts > SEGMENT_GAP_MS
                or (previous_run and run_started and run_started != previous_run)
            )
        )
        if new_segment:
            groups.append(current)
            current = []
        current.append(dict(row))
        previous_ts = timestamp
        previous_run = run_started
    if current:
        groups.append(current)
    return [group for group in groups if len(group) >= 60]


def prior_index(timestamps: List[int], target: int, tolerance_ms: int = 15_000) -> Optional[int]:
    index = bisect.bisect_right(timestamps, target) - 1
    if index >= 0 and abs(timestamps[index] - target) <= tolerance_ms:
        return index
    return None


def future_index(timestamps: List[int], target: int, tolerance_ms: int = 20_000) -> Optional[int]:
    index = bisect.bisect_left(timestamps, target)
    choices = []
    if index < len(timestamps):
        choices.append(index)
    if index > 0:
        choices.append(index - 1)
    if not choices:
        return None
    best = min(choices, key=lambda item: abs(timestamps[item] - target))
    return best if abs(timestamps[best] - target) <= tolerance_ms else None


def enrich_segment(rows: List[dict]) -> None:
    spreads: List[float] = []
    timestamps = [int(row["timestamp"]) for row in rows]
    for index, row in enumerate(rows):
        spread = max(1e-9, safe_float(row.get("spreadBps"), 0.0))
        spreads.append(spread)
        lower_ts = timestamps[index] - 60_000
        lower = bisect.bisect_left(timestamps, lower_ts)
        history = spreads[lower:index + 1]
        median_spread = statistics.median(history) if history else spread
        row["spreadCompression"] = median_spread / spread - 1.0 if spread > 0 else 0.0
        bid = max(0.0, safe_float(row.get("bidDepth10Bps")))
        ask = max(0.0, safe_float(row.get("askDepth10Bps")))
        row["depthRatio10Log"] = math.log((bid + 1.0) / (ask + 1.0))


def feature_event_study(events: List[dict], feature: str, horizon: str, split_at: int) -> dict:
    usable = [event for event in events if event.get(feature) is not None and event.get(f"return_{horizon}") is not None]
    xs = [safe_float(event[feature]) for event in usable]
    ys = [safe_float(event[f"return_{horizon}"]) for event in usable]
    low = percentile(xs, 0.20)
    high = percentile(xs, 0.80)
    low_returns = [y for x, y in zip(xs, ys) if low is not None and x <= low]
    high_returns = [y for x, y in zip(xs, ys) if high is not None and x >= high]
    spread = statistics.fmean(high_returns) - statistics.fmean(low_returns) if low_returns and high_returns else None

    halves = {}
    for name, selected in {
        "firstHalf": [event for event in usable if int(event["timestamp"]) < split_at],
        "secondHalf": [event for event in usable if int(event["timestamp"]) >= split_at],
    }.items():
        half_x = [safe_float(event[feature]) for event in selected]
        half_y = [safe_float(event[f"return_{horizon}"]) for event in selected]
        half_low = percentile(half_x, 0.20)
        half_high = percentile(half_x, 0.80)
        lo = [y for x, y in zip(half_x, half_y) if half_low is not None and x <= half_low]
        hi = [y for x, y in zip(half_x, half_y) if half_high is not None and x >= half_high]
        halves[name] = {
            "pairs": len(selected),
            "pearson": pearson(half_x, half_y),
            "quintileSpreadBps": statistics.fmean(hi) - statistics.fmean(lo) if lo and hi else None,
        }
    first_spread = halves["firstHalf"]["quintileSpreadBps"]
    second_spread = halves["secondHalf"]["quintileSpreadBps"]
    stable_sign = (
        first_spread is not None
        and second_spread is not None
        and first_spread * second_spread > 0
    )
    return {
        "pairs": len(usable),
        "pearson": pearson(xs, ys),
        "spearman": spearman(xs, ys),
        "quintileSpreadBps": spread,
        "firstHalf": halves["firstHalf"],
        "secondHalf": halves["secondHalf"],
        "stableSignAcrossHalves": stable_sign,
    }


def category_metrics(events: List[dict], category: str, horizon: str) -> dict:
    selected = [event for event in events if event.get("category") == category and event.get(f"directional_{horizon}") is not None]
    returns = [safe_float(event[f"directional_{horizon}"]) for event in selected]
    net_returns = [safe_float(event[f"directionalNet_{horizon}"]) for event in selected]
    adverse = [safe_float(event[f"adverse_{horizon}"]) for event in selected]
    by_segment: Dict[str, List[float]] = defaultdict(list)
    for event in selected:
        by_segment[str(event["segmentId"])].append(safe_float(event[f"directional_{horizon}"]))
    segment_means = [statistics.fmean(values) for values in by_segment.values() if values]
    return {
        "events": len(selected),
        "segments": len(segment_means),
        "hitRatePct": sum(1 for value in returns if value > 0) / len(returns) * 100.0 if returns else None,
        "averageGrossBps": statistics.fmean(returns) if returns else None,
        "medianGrossBps": statistics.median(returns) if returns else None,
        "averageNetAfterTakerCostBps": statistics.fmean(net_returns) if net_returns else None,
        "averageAdverseBps": statistics.fmean(adverse) if adverse else None,
        "positiveSegmentPct": sum(1 for value in segment_means if value > 0) / len(segment_means) * 100.0 if segment_means else None,
    }


def build_events(rows: List[dict]) -> Tuple[List[dict], dict]:
    by_symbol: Dict[str, List[dict]] = defaultdict(list)
    for row in rows:
        by_symbol[str(row["symbol"])].append(row)

    events: List[dict] = []
    segment_counts: Dict[str, int] = {}
    for symbol, symbol_rows in by_symbol.items():
        segments = segment_rows(sorted(symbol_rows, key=lambda row: int(row["timestamp"])))
        segment_counts[symbol] = len(segments)
        for segment_number, segment in enumerate(segments):
            enrich_segment(segment)
            timestamps = [int(row["timestamp"]) for row in segment]
            last_sample_ts = 0
            for index, row in enumerate(segment):
                timestamp = int(row["timestamp"])
                if timestamp - last_sample_ts < MIN_EVENT_SPACING_MS:
                    continue
                prior = prior_index(timestamps, timestamp - 60_000)
                if prior is None:
                    continue
                current_mid = safe_float(row.get("mid"))
                prior_mid = safe_float(segment[prior].get("mid"))
                if current_mid <= 0 or prior_mid <= 0:
                    continue
                momentum_bps = (current_mid / prior_mid - 1.0) * 10_000.0
                if abs(momentum_bps) < 0.05:
                    continue
                direction = 1 if momentum_bps > 0 else -1
                aligned_book = direction * safe_float(row.get("bookImbalance10Bps")) > 0
                aligned_flow = direction * safe_float(row.get("takerImbalance")) > 0
                compressed = safe_float(row.get("spreadCompression")) > 0
                basis_abs = abs(safe_float(row.get("basisBps")))
                basis_ok = basis_abs <= 15.0
                score = sum([aligned_book, aligned_flow, compressed, basis_ok])
                category = "confirm" if score >= 3 else ("conflict" if score <= 1 else "neutral")
                cost = safe_float(row.get("roundTrip1000Bps"), 0.0)
                event = {
                    "timestamp": timestamp,
                    "symbol": symbol,
                    "segmentId": f"{symbol}:{int(row.get('runStarted', 0) or 0)}:{segment_number}",
                    "direction": direction,
                    "momentum60sBps": momentum_bps,
                    "category": category,
                    "confirmationScore": score,
                    "roundTrip1000Bps": cost,
                }
                for feature in RAW_FEATURES:
                    event[feature] = row.get(feature)
                valid = True
                for horizon, seconds in HORIZONS_SECONDS.items():
                    future = future_index(timestamps, timestamp + seconds * 1000)
                    if future is None:
                        event[f"return_{horizon}"] = None
                        event[f"directional_{horizon}"] = None
                        event[f"directionalNet_{horizon}"] = None
                        event[f"adverse_{horizon}"] = None
                        continue
                    future_mid = safe_float(segment[future].get("mid"))
                    raw_return = (future_mid / current_mid - 1.0) * 10_000.0
                    directional = direction * raw_return
                    path = [safe_float(item.get("mid")) for item in segment[index:future + 1] if safe_float(item.get("mid")) > 0]
                    path_directional = [direction * ((price / current_mid - 1.0) * 10_000.0) for price in path]
                    event[f"return_{horizon}"] = raw_return
                    event[f"directional_{horizon}"] = directional
                    event[f"directionalNet_{horizon}"] = directional - cost
                    event[f"adverse_{horizon}"] = min(path_directional) if path_directional else None
                if any(event.get(f"return_{horizon}") is not None for horizon in HORIZONS_SECONDS):
                    events.append(event)
                    last_sample_ts = timestamp
    return events, segment_counts


def rounded(value: object) -> object:
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    rows = load_rows(state_dir)
    timestamps = [int(row["timestamp"]) for row in rows]
    start = min(timestamps)
    end = max(timestamps)
    split_at = start + (end - start) // 2
    events, segment_counts = build_events(rows)

    feature_results: Dict[str, dict] = {}
    for symbol in ANALYSIS_SYMBOLS:
        symbol_events = [event for event in events if event["symbol"] == symbol]
        feature_results[symbol] = {}
        for feature in RAW_FEATURES:
            feature_results[symbol][feature] = {
                horizon: feature_event_study(symbol_events, feature, horizon, split_at)
                for horizon in HORIZONS_SECONDS
            }

    category_results: Dict[str, dict] = {}
    for symbol_group, symbols in {
        "CORE4": CORE_SYMBOLS,
        "ALL7": ANALYSIS_SYMBOLS,
        "PENGU": ["PENGUUSDT"],
    }.items():
        selected = [event for event in events if event["symbol"] in symbols]
        category_results[symbol_group] = {
            horizon: {
                category: category_metrics(selected, category, horizon)
                for category in ["confirm", "neutral", "conflict"]
            }
            for horizon in HORIZONS_SECONDS
        }

    veto_evidence = []
    for group in ["CORE4", "ALL7", "PENGU"]:
        for horizon in HORIZONS_SECONDS:
            confirm = category_results[group][horizon]["confirm"]
            conflict = category_results[group][horizon]["conflict"]
            if (confirm["events"] or 0) < 20 or (conflict["events"] or 0) < 20:
                continue
            gross_delta = (confirm["averageGrossBps"] or 0) - (conflict["averageGrossBps"] or 0)
            hit_delta = (confirm["hitRatePct"] or 0) - (conflict["hitRatePct"] or 0)
            adverse_delta = (confirm["averageAdverseBps"] or 0) - (conflict["averageAdverseBps"] or 0)
            passed = gross_delta >= 1.0 and hit_delta >= 5.0 and adverse_delta >= 0.5
            veto_evidence.append({
                "group": group,
                "horizon": horizon,
                "grossImprovementBps": gross_delta,
                "hitRateImprovementPct": hit_delta,
                "adverseImprovementBps": adverse_delta,
                "passedOneDayThreshold": passed,
            })

    stable_features = []
    for symbol, features in feature_results.items():
        for feature, horizons in features.items():
            for horizon, metrics in horizons.items():
                spread = metrics.get("quintileSpreadBps")
                if metrics.get("stableSignAcrossHalves") and spread is not None and abs(spread) >= 1.0 and metrics.get("pairs", 0) >= 40:
                    stable_features.append({
                        "symbol": symbol,
                        "feature": feature,
                        "horizon": horizon,
                        "quintileSpreadBps": spread,
                        "spearman": metrics.get("spearman"),
                    })
    stable_features.sort(key=lambda item: abs(item["quintileSpreadBps"]), reverse=True)
    passed_veto = [item for item in veto_evidence if item["passedOneDayThreshold"]]
    status = "ONE_DAY_VETO_CANDIDATE_OBSERVED" if passed_veto else ("ONE_DAY_FEATURE_SIGNAL_OBSERVED" if stable_features else "ONE_DAY_NO_STABLE_EDGE")

    result = rounded({
        "version": 29,
        "strategyId": "DISDEX_ONE_DAY_MICROSTRUCTURE_V29",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "window": {
            "startUtc": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
            "endUtc": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
            "calendarSpanHours": (end - start) / 3_600_000.0,
            "rows": len(rows),
            "eventsAfterOneMinuteThinning": len(events),
            "segments": segment_counts,
        },
        "method": {
            "purpose": "one-day descriptive microstructure audit for a future V28 execution/VETO overlay",
            "sampling": "one event per minute inside contiguous collection segments",
            "localDirectionProxy": "sign of trailing 60-second return; not a replacement for V6/V28 direction",
            "confirmRule": "at least 3 of aligned book, aligned taker flow, spread compression, abs(basis)<=15bps",
            "conflictRule": "at most 1 confirming condition",
            "horizons": HORIZONS_SECONDS,
            "cost": "row-level $1,000 taker round-trip estimate reported separately",
        },
        "featureEventStudy": feature_results,
        "categoryComparison": category_results,
        "vetoEvidence": veto_evidence,
        "passedVetoEvidence": passed_veto,
        "stableFeatures": stable_features[:30],
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "One calendar day cannot establish regime robustness, CAGR, PF or max drawdown.",
            "V6/V28 creates at most two 12-hour decisions per day, so local 60-second direction is used only to test execution-feature agreement and conflict.",
            "Five-second rows are autocorrelated; events are thinned to one minute and results also report independent contiguous collection segments.",
            "Feature thresholds are fixed before this run and are not retuned from the result.",
            "OI may remain unavailable because only public cross-venue proxies are attempted.",
        ],
    })

    report = [
        "# Dis-Dex Manager One-Day Microstructure Audit V29",
        "",
        f"- Status: **{status}**",
        f"- Window: {result['window']['startUtc']} to {result['window']['endUtc']}",
        f"- Rows: {result['window']['rows']}",
        f"- One-minute-thinned events: {result['window']['eventsAfterOneMinuteThinning']}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Confirmation vs conflict",
        "",
        "| Group | Horizon | Category | Events | Segments | Hit | Gross bps | Net after taker bps | Adverse bps | Positive segments |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for group, horizons in result["categoryComparison"].items():
        for horizon, categories in horizons.items():
            for category, metrics in categories.items():
                report.append(
                    f"| {group} | {horizon} | {category} | {metrics['events']} | {metrics['segments']} | "
                    f"{metrics['hitRatePct']}% | {metrics['averageGrossBps']} | {metrics['averageNetAfterTakerCostBps']} | "
                    f"{metrics['averageAdverseBps']} | {metrics['positiveSegmentPct']}% |"
                )
    report.extend([
        "",
        "## One-day VETO evidence",
        "",
        "| Group | Horizon | Gross improvement | Hit improvement | Adverse improvement | Pass |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ])
    for item in result["vetoEvidence"]:
        report.append(
            f"| {item['group']} | {item['horizon']} | {item['grossImprovementBps']} bps | "
            f"{item['hitRateImprovementPct']} pt | {item['adverseImprovementBps']} bps | {item['passedOneDayThreshold']} |"
        )
    report.extend([
        "",
        "## Stable feature observations",
        "",
        "| Symbol | Feature | Horizon | Quintile spread | Spearman |",
        "| --- | --- | --- | ---: | ---: |",
    ])
    for item in result["stableFeatures"][:20]:
        report.append(
            f"| {item['symbol']} | {item['feature']} | {item['horizon']} | {item['quintileSpreadBps']} bps | {item['spearman']} |"
        )
    report.extend([
        "",
        "## Interpretation gate",
        "",
        "This is a descriptive one-day execution-overlay audit only. A passing result may justify keeping a fixed rule for the remaining collection period; it cannot change V6/V28, Paper or Live eligibility.",
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-one-day-microstructure-v29.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-one-day-microstructure-v29.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
