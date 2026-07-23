from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90
import research_lab_v96_frequency_uplift as freq

core = v69.core
FLOORS = (0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75)


def build_rows(floor: float, raw: dict) -> tuple[Dict[int, Dict[str, float]], dict, List[dict], List[dict]]:
    candidate = freq.CoreCandidate(f"CORE_VOLUME_{int(round(floor * 100)):02d}", volume_floor=floor)
    raw_targets = freq.raw_targets_for(candidate, raw)
    targets, stabilization = v90.stabilize(
        raw_targets,
        raw["times"],
        v90.Config(candidate.weight_tolerance, candidate.turnover_threshold, candidate.stale_bars),
    )
    base_core = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    base_rows = core.core_rows(config, raw["times"], base_core, features)
    severe_rows = core.core_rows(config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, base_core, features)
    normal, _normal_diag = v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe, _severe_diag = v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    return targets, stabilization, normal, severe


def month_returns(rows: List[dict], start: int, end: int) -> Dict[str, float]:
    groups: Dict[str, List[float]] = {}
    for row in rows:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        key = dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        groups.setdefault(key, []).append(float(row["return"]))
    result: Dict[str, float] = {}
    for key, values in groups.items():
        equity = 1.0
        for value in values:
            equity *= max(0.001, 1.0 + value)
        result[key] = equity - 1.0
    return result


def remove_best_month(rows: List[dict], start: int, end: int) -> List[dict]:
    monthly = month_returns(rows, start, end)
    if not monthly:
        return list(rows)
    best = max(monthly, key=monthly.get)
    return [
        {**row, "return": 0.0}
        if start <= int(row["ts"]) < end
        and dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m") == best
        else dict(row)
        for row in rows
    ]


def remove_best_bucket(rows: List[dict], start: int, end: int) -> List[dict]:
    candidates = [index for index, row in enumerate(rows) if start <= int(row["ts"]) < end]
    if not candidates:
        return list(rows)
    best = max(candidates, key=lambda index: float(rows[index]["return"]))
    result = [dict(row) for row in rows]
    result[best]["return"] = 0.0
    return result


def evaluate(floor: float, raw: dict) -> dict:
    targets, stabilization, normal, severe = build_rows(floor, raw)
    years = {}
    for year in (2023, 2024, 2025, 2026):
        start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end = core.CORE_END if year == 2026 else int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        years[str(year)] = {
            "normal": v69.metrics(normal, start, end),
            "severe": v69.metrics(severe, start, end),
        }
    monthly = month_returns(normal, core.CORE_START, core.CORE_END)
    positive_months = [value for value in monthly.values() if value > 0]
    return {
        "floor": floor,
        "frequency": freq.count_core_frequency(targets, raw["times"], stabilization),
        "development": v69.metrics(normal, core.CORE_START, core.v4.START_2026),
        "developmentSevere": v69.metrics(severe, core.CORE_START, core.v4.START_2026),
        "reused2026H1": v69.metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, core.v4.START_2026, core.CORE_END),
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "removeBestMonth": v69.metrics(remove_best_month(normal, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": v69.metrics(remove_best_month(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "removeBestBucket": v69.metrics(remove_best_bucket(normal, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "removeBestBucketSevere": v69.metrics(remove_best_bucket(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END),
        "largestPositiveMonthSharePct": max(positive_months) / sum(positive_months) * 100.0 if positive_months else None,
        "years": years,
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    results = [evaluate(floor, raw) for floor in FLOORS]
    baseline = next(item for item in results if abs(item["floor"] - 0.70) < 1e-9)
    lead = next(item for item in results if abs(item["floor"] - 0.50) < 1e-9)
    neighbors = [item for item in results if item["floor"] in (0.45, 0.50, 0.55, 0.60)]
    neighbor_pass = all(
        item["development"]["compoundedReturnPct"] > baseline["development"]["compoundedReturnPct"]
        and item["developmentSevere"]["compoundedReturnPct"] > baseline["developmentSevere"]["compoundedReturnPct"]
        and item["reused2026H1"]["compoundedReturnPct"] > 0
        and item["reused2026H1Severe"]["compoundedReturnPct"] > 0
        for item in neighbors
    )
    year_pass = all(
        lead["years"][str(year)]["normal"]["compoundedReturnPct"] > 0
        for year in (2023, 2024, 2025, 2026)
    ) and lead["years"]["2026"]["severe"]["compoundedReturnPct"] > 0
    removal_pass = bool(
        lead["removeBestMonthSevere"]["compoundedReturnPct"] > 0
        and lead["removeBestBucketSevere"]["compoundedReturnPct"] > 0
        and (lead["largestPositiveMonthSharePct"] or 100.0) <= 40.0
    )
    performance_pass = bool(
        lead["frequency"]["orderEvents"] > baseline["frequency"]["orderEvents"]
        and lead["development"]["compoundedReturnPct"] > baseline["development"]["compoundedReturnPct"]
        and lead["developmentSevere"]["compoundedReturnPct"] > baseline["developmentSevere"]["compoundedReturnPct"]
        and lead["full"]["compoundedReturnPct"] > baseline["full"]["compoundedReturnPct"]
        and lead["fullSevere"]["compoundedReturnPct"] > baseline["fullSevere"]["compoundedReturnPct"]
        and lead["full"]["maxDrawdownPct"] >= baseline["full"]["maxDrawdownPct"] - 1.0
        and lead["fullSevere"]["maxDrawdownPct"] >= baseline["fullSevere"]["maxDrawdownPct"] - 1.0
    )
    status = "CORE_VOLUME50_HISTORICAL_STABLE_LEAD_SHADOW_ONLY" if neighbor_pass and year_pass and removal_pass and performance_pass else "CORE_VOLUME50_NOT_ROBUST"
    payload = rounded({
        "version": 1,
        "strategyId": "V96_CORE_VOLUME_FLOOR_050_RESEARCH_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "neighborPass": neighbor_pass,
        "yearPass": year_pass,
        "removalPass": removal_pass,
        "performancePass": performance_pass,
        "baselineFloor": 0.70,
        "leadFloor": 0.50,
        "results": results,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The 0.50 floor was identified on already inspected history and is not independent holdout evidence.",
            "2026H1 is reused evidence.",
            "Order events are target/rebalance events, not exchange fill records.",
            "Any promotion requires a new strategy ID and fresh Forward Shadow evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-core-volume-floor-validation.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Core Volume-floor Validation",
        "",
        f"- Status: **{status}**",
        f"- Neighbor stability: **{'PASS' if neighbor_pass else 'FAIL'}**",
        f"- Year consistency: **{'PASS' if year_pass else 'FAIL'}**",
        f"- Removal/concentration: **{'PASS' if removal_pass else 'FAIL'}**",
        f"- Frequency/performance: **{'PASS' if performance_pass else 'FAIL'}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Floor | Order events | Dev | Dev severe | Full | Full severe | DD | 2026H1 | 2026H1 severe | Best month removed severe |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in payload["results"]:
        report.append(
            f"| {item['floor']} | {item['frequency']['orderEvents']} | {item['development']['compoundedReturnPct']}% | "
            f"{item['developmentSevere']['compoundedReturnPct']}% | {item['full']['compoundedReturnPct']}% | "
            f"{item['fullSevere']['compoundedReturnPct']}% | {item['full']['maxDrawdownPct']}% | "
            f"{item['reused2026H1']['compoundedReturnPct']}% | {item['reused2026H1Severe']['compoundedReturnPct']}% | "
            f"{item['removeBestMonthSevere']['compoundedReturnPct']}% |"
        )
    (state_dir / "v96-core-volume-floor-validation.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
