from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_disdex_one_day_microstructure_v29 as v29


FEATURE_FAMILIES = {
    "BOOK": ["bookImbalance5Bps", "bookImbalance10Bps", "bookImbalance25Bps", "depthRatio10Log"],
    "FLOW": ["takerImbalance"],
    "BASIS": ["basisBps"],
    "FUNDING": ["fundingRate"],
    "SPREAD": ["spreadCompression"],
}


def avg(values: List[float]) -> Optional[float]:
    return statistics.fmean(values) if values else None


def tail_spread(events: List[dict], feature: str, horizon: str, low: float, high: float) -> dict:
    low_events = [event for event in events if v29.safe_float(event.get(feature), float("nan")) <= low]
    high_events = [event for event in events if v29.safe_float(event.get(feature), float("nan")) >= high]
    low_returns = [v29.safe_float(event[f"return_{horizon}"]) for event in low_events if event.get(f"return_{horizon}") is not None]
    high_returns = [v29.safe_float(event[f"return_{horizon}"]) for event in high_events if event.get(f"return_{horizon}") is not None]
    return {
        "lowEvents": len(low_returns),
        "highEvents": len(high_returns),
        "lowMeanBps": avg(low_returns),
        "highMeanBps": avg(high_returns),
        "spreadBps": (avg(high_returns) - avg(low_returns)) if low_returns and high_returns else None,
    }


def segment_validation(events: List[dict], feature: str, horizon: str, low: float, high: float, sign: int) -> dict:
    by_segment: Dict[str, List[dict]] = defaultdict(list)
    for event in events:
        by_segment[str(event["segmentId"])].append(event)
    signed_spreads = []
    for segment_events in by_segment.values():
        item = tail_spread(segment_events, feature, horizon, low, high)
        if item["spreadBps"] is not None:
            signed_spreads.append(sign * item["spreadBps"])
    return {
        "segmentsWithBothTails": len(signed_spreads),
        "meanSignedSpreadBps": avg(signed_spreads),
        "medianSignedSpreadBps": statistics.median(signed_spreads) if signed_spreads else None,
        "positiveSegmentPct": (sum(1 for value in signed_spreads if value > 0) / len(signed_spreads) * 100.0) if signed_spreads else None,
    }


def overlay_validation(events: List[dict], feature: str, horizon: str, low: float, high: float, sign: int) -> dict:
    confirm = []
    conflict = []
    for event in events:
        value = v29.safe_float(event.get(feature), float("nan"))
        if not math.isfinite(value):
            continue
        predicted = None
        if value >= high:
            predicted = sign
        elif value <= low:
            predicted = -sign
        if predicted is None or event.get(f"directional_{horizon}") is None:
            continue
        target = confirm if int(event["direction"]) == predicted else conflict
        target.append(event)

    def metrics(selected: List[dict]) -> dict:
        gross = [v29.safe_float(event[f"directional_{horizon}"]) for event in selected]
        net = [v29.safe_float(event[f"directionalNet_{horizon}"]) for event in selected]
        adverse = [v29.safe_float(event[f"adverse_{horizon}"]) for event in selected]
        return {
            "events": len(selected),
            "hitRatePct": (sum(1 for value in gross if value > 0) / len(gross) * 100.0) if gross else None,
            "averageGrossBps": avg(gross),
            "averageNetAfterTakerCostBps": avg(net),
            "averageAdverseBps": avg(adverse),
        }

    c = metrics(confirm)
    x = metrics(conflict)
    return {
        "confirm": c,
        "conflict": x,
        "grossImprovementBps": (c["averageGrossBps"] - x["averageGrossBps"]) if c["averageGrossBps"] is not None and x["averageGrossBps"] is not None else None,
        "hitRateImprovementPct": (c["hitRatePct"] - x["hitRatePct"]) if c["hitRatePct"] is not None and x["hitRatePct"] is not None else None,
        "adverseImprovementBps": (c["averageAdverseBps"] - x["averageAdverseBps"]) if c["averageAdverseBps"] is not None and x["averageAdverseBps"] is not None else None,
    }


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
    rows = v29.load_rows(state_dir)
    timestamps = [int(row["timestamp"]) for row in rows]
    start = min(timestamps)
    end = max(timestamps)
    split_at = start + (end - start) // 2
    events, segment_counts = v29.build_events(rows)

    results = []
    for symbol in v29.ANALYSIS_SYMBOLS:
        symbol_events = [event for event in events if event["symbol"] == symbol]
        development = [event for event in symbol_events if int(event["timestamp"]) < split_at]
        validation = [event for event in symbol_events if int(event["timestamp"]) >= split_at]
        for family, features in FEATURE_FAMILIES.items():
            for feature in features:
                for horizon in v29.HORIZONS_SECONDS:
                    dev = [event for event in development if event.get(feature) is not None and event.get(f"return_{horizon}") is not None]
                    val = [event for event in validation if event.get(feature) is not None and event.get(f"return_{horizon}") is not None]
                    dev_values = [v29.safe_float(event[feature]) for event in dev]
                    val_values = [v29.safe_float(event[feature]) for event in val]
                    low = v29.percentile(dev_values, 0.20)
                    high = v29.percentile(dev_values, 0.80)
                    if low is None or high is None:
                        continue
                    dev_tail = tail_spread(dev, feature, horizon, low, high)
                    raw_dev_spread = dev_tail["spreadBps"]
                    sign = 1 if (raw_dev_spread or 0) >= 0 else -1
                    val_tail = tail_spread(val, feature, horizon, low, high)
                    signed_validation = sign * val_tail["spreadBps"] if val_tail["spreadBps"] is not None else None
                    segment = segment_validation(val, feature, horizon, low, high, sign)
                    overlay = overlay_validation(val, feature, horizon, low, high, sign)
                    costs = [v29.safe_float(event.get("roundTrip1000Bps")) for event in val if event.get("roundTrip1000Bps") is not None]
                    median_cost = statistics.median(costs) if costs else None
                    unique_dev = len({round(value, 12) for value in dev_values})
                    unique_val = len({round(value, 12) for value in val_values})
                    feature_pass = (
                        len(dev) >= 40
                        and len(val) >= 40
                        and unique_dev >= 8
                        and unique_val >= 4
                        and dev_tail["lowEvents"] >= 8
                        and dev_tail["highEvents"] >= 8
                        and val_tail["lowEvents"] >= 8
                        and val_tail["highEvents"] >= 8
                        and raw_dev_spread is not None
                        and abs(raw_dev_spread) >= 2.0
                        and signed_validation is not None
                        and signed_validation >= 1.0
                        and segment["segmentsWithBothTails"] >= 5
                        and (segment["positiveSegmentPct"] or 0) >= 55.0
                    )
                    overlay_pass = (
                        overlay["confirm"]["events"] >= 10
                        and overlay["conflict"]["events"] >= 10
                        and (overlay["grossImprovementBps"] or -999) >= 1.0
                        and (overlay["hitRateImprovementPct"] or -999) >= 3.0
                        and (overlay["adverseImprovementBps"] or -999) >= 0.0
                    )
                    results.append({
                        "symbol": symbol,
                        "family": family,
                        "feature": feature,
                        "horizon": horizon,
                        "developmentPairs": len(dev),
                        "validationPairs": len(val),
                        "uniqueDevelopmentValues": unique_dev,
                        "uniqueValidationValues": unique_val,
                        "developmentThreshold20": low,
                        "developmentThreshold80": high,
                        "predictiveSign": "HIGH_FAVORS_UP" if sign > 0 else "HIGH_FAVORS_DOWN",
                        "development": dev_tail,
                        "validation": val_tail,
                        "signedValidationSpreadBps": signed_validation,
                        "validationSegmentStability": segment,
                        "validationOverlay": overlay,
                        "medianTakerRoundTrip1000Bps": median_cost,
                        "standaloneCostCoveragePct": (signed_validation / median_cost * 100.0) if signed_validation is not None and median_cost and median_cost > 0 else None,
                        "featureTemporalPass": feature_pass,
                        "executionOverlayPass": overlay_pass,
                    })

    feature_passes = [item for item in results if item["featureTemporalPass"]]
    overlay_passes = [item for item in results if item["executionOverlayPass"]]

    clusters = []
    for symbol in v29.ANALYSIS_SYMBOLS:
        for horizon in v29.HORIZONS_SECONDS:
            book = [item for item in feature_passes if item["symbol"] == symbol and item["horizon"] == horizon and item["family"] == "BOOK"]
            directions = defaultdict(list)
            for item in book:
                directions[item["predictiveSign"]].append(item["feature"])
            for direction, members in directions.items():
                if len(members) >= 2:
                    clusters.append({
                        "symbol": symbol,
                        "horizon": horizon,
                        "family": "BOOK",
                        "predictiveSign": direction,
                        "members": members,
                    })

    status = (
        "ONE_DAY_TEMPORAL_EXECUTION_CANDIDATE"
        if overlay_passes
        else ("ONE_DAY_TEMPORAL_FEATURE_CANDIDATE" if feature_passes else "ONE_DAY_TEMPORAL_CONFIRMATION_FAILED")
    )

    result = rounded({
        "version": 30,
        "strategyId": "DISDEX_TEMPORAL_MICROSTRUCTURE_V30",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "window": {
            "startUtc": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
            "splitUtc": dt.datetime.fromtimestamp(split_at / 1000, tz=dt.timezone.utc).isoformat(),
            "endUtc": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
            "rows": len(rows),
            "events": len(events),
            "segments": segment_counts,
        },
        "selectionProtocol": {
            "development": "first half of the restored latest 24-hour window",
            "validation": "second half only",
            "thresholds": "development p20/p80 frozen before validation",
            "direction": "sign of development top-minus-bottom return frozen before validation",
            "fundingGuard": "minimum unique values prevents a few funding timestamps from passing as a continuous feature",
            "noValidationRetuning": True,
        },
        "featurePasses": feature_passes,
        "executionOverlayPasses": overlay_passes,
        "bookFamilyClusters": clusters,
        "allResults": results,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "This uses one day split into development and validation; it is still too short for regime, day or week stability.",
            "Multiple feature/symbol/horizon hypotheses are reported, so even temporal passes remain exploratory until the fixed rule repeats on later days.",
            "Standalone cost coverage is informational; an execution VETO can add value without creating a standalone trade edge.",
            "No V6/V28 parameter, production file, VPS, account, position or live runner is changed.",
        ],
    })

    report = [
        "# Dis-Dex Manager Temporal Microstructure Audit V30",
        "",
        f"- Status: **{status}**",
        f"- Development: {result['window']['startUtc']} to {result['window']['splitUtc']}",
        f"- Validation: {result['window']['splitUtc']} to {result['window']['endUtc']}",
        f"- Rows: {result['window']['rows']}",
        f"- One-minute events: {result['window']['events']}",
        f"- Temporal feature passes: {len(feature_passes)}",
        f"- Execution overlay passes: {len(overlay_passes)}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Temporal feature passes",
        "",
        "| Symbol | Family | Feature | Horizon | Direction | Dev spread | Validation signed spread | Stable segments | Positive segments | Cost coverage |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in sorted(feature_passes, key=lambda row: row["signedValidationSpreadBps"], reverse=True):
        segment = item["validationSegmentStability"]
        report.append(
            f"| {item['symbol']} | {item['family']} | {item['feature']} | {item['horizon']} | {item['predictiveSign']} | "
            f"{item['development']['spreadBps']} bps | {item['signedValidationSpreadBps']} bps | "
            f"{segment['segmentsWithBothTails']} | {segment['positiveSegmentPct']}% | {item['standaloneCostCoveragePct']}% |"
        )
    report.extend([
        "",
        "## Execution-overlay passes",
        "",
        "| Symbol | Feature | Horizon | Confirm events | Conflict events | Gross improvement | Hit improvement | Adverse improvement |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for item in sorted(overlay_passes, key=lambda row: row["validationOverlay"]["grossImprovementBps"], reverse=True):
        overlay = item["validationOverlay"]
        report.append(
            f"| {item['symbol']} | {item['feature']} | {item['horizon']} | {overlay['confirm']['events']} | "
            f"{overlay['conflict']['events']} | {overlay['grossImprovementBps']} bps | "
            f"{overlay['hitRateImprovementPct']} pt | {overlay['adverseImprovementBps']} bps |"
        )
    report.extend([
        "",
        "## Book-family clusters",
        "",
        "| Symbol | Horizon | Direction | Members |",
        "| --- | --- | --- | --- |",
    ])
    for item in clusters:
        report.append(f"| {item['symbol']} | {item['horizon']} | {item['predictiveSign']} | {', '.join(item['members'])} |")
    report.extend([
        "",
        "## Gate",
        "",
        "A temporal pass keeps the rule as a fixed shadow candidate for the remaining collection period. It does not authorize Paper or Live use.",
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-temporal-microstructure-v30.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-temporal-microstructure-v30.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
