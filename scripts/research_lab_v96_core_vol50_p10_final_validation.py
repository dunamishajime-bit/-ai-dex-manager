from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90
import research_lab_v96_core_volume_floor_validation as floorval
import research_lab_v96_frequency_uplift as freq

core = v69.core
VOLUME_LEVELS = (0.45, 0.50, 0.55)
TURNOVER_LEVELS = (0.075, 0.10, 0.125)


def build(candidate: freq.CoreCandidate, raw: dict) -> tuple[Dict[int, Dict[str, float]], dict, List[dict], List[dict]]:
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


def evaluate(candidate: freq.CoreCandidate, raw: dict) -> dict:
    targets, stabilization, normal, severe = build(candidate, raw)
    years = {}
    for year in (2023, 2024, 2025, 2026):
        start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end = core.CORE_END if year == 2026 else int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        years[str(year)] = {
            "normal": v69.metrics(normal, start, end),
            "severe": v69.metrics(severe, start, end),
        }
    return {
        "candidate": asdict(candidate),
        "frequency": freq.count_core_frequency(targets, raw["times"], stabilization),
        "development": v69.metrics(normal, core.CORE_START, core.v4.START_2026),
        "developmentSevere": v69.metrics(severe, core.CORE_START, core.v4.START_2026),
        "reused2026H1": v69.metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, core.v4.START_2026, core.CORE_END),
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": v69.metrics(
            floorval.remove_best_month(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END
        ),
        "removeBestBucketSevere": v69.metrics(
            floorval.remove_best_bucket(severe, core.CORE_START, core.CORE_END), core.CORE_START, core.CORE_END
        ),
        "years": years,
    }


def passes(item: dict, current: dict) -> bool:
    return bool(
        item["frequency"]["orderEvents"] >= current["frequency"]["orderEvents"] * 1.20
        and item["full"]["compoundedReturnPct"] > current["full"]["compoundedReturnPct"]
        and item["fullSevere"]["compoundedReturnPct"] > current["fullSevere"]["compoundedReturnPct"]
        and item["full"]["maxDrawdownPct"] >= current["full"]["maxDrawdownPct"] - 1.0
        and item["fullSevere"]["maxDrawdownPct"] >= current["fullSevere"]["maxDrawdownPct"] - 1.0
        and item["reused2026H1"]["compoundedReturnPct"] > current["reused2026H1"]["compoundedReturnPct"]
        and item["reused2026H1Severe"]["compoundedReturnPct"] > 0
        and all(item["years"][str(year)]["normal"]["compoundedReturnPct"] > 0 for year in (2023, 2024, 2025, 2026))
        and item["removeBestMonthSevere"]["compoundedReturnPct"] > 0
        and item["removeBestBucketSevere"]["compoundedReturnPct"] > 0
    )


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
    current_candidate = freq.CoreCandidate("CURRENT_V70_P20", volume_floor=0.70, turnover_threshold=0.20)
    lead_candidate = freq.CoreCandidate("LEAD_V50_P10", volume_floor=0.50, turnover_threshold=0.10)
    grid = [
        freq.CoreCandidate(
            f"V{int(round(volume * 100)):02d}_P{int(round(turnover * 1000)):03d}",
            volume_floor=volume,
            turnover_threshold=turnover,
        )
        for volume in VOLUME_LEVELS
        for turnover in TURNOVER_LEVELS
    ]
    candidates = [current_candidate] + grid
    results = [evaluate(candidate, raw) for candidate in candidates]
    current = next(item for item in results if item["candidate"]["candidate_id"] == current_candidate.candidate_id)
    for item in results:
        item["pass"] = False if item is current else passes(item, current)
        item["eventUpliftPct"] = (
            item["frequency"]["orderEvents"] / current["frequency"]["orderEvents"] - 1.0
        ) * 100.0
    lead = next(item for item in results if item["candidate"]["candidate_id"] == lead_candidate.candidate_id)
    immediate_ids = {"V45_P100", "V50_P075", "V50_P100", "V50_P125", "V55_P100"}
    immediate = [item for item in results if item["candidate"]["candidate_id"] in immediate_ids]
    local_stability = len(immediate) == 5 and sum(bool(item["pass"]) for item in immediate) >= 4
    lead_pass = bool(lead["pass"])
    status = "CORE_V50_P10_HISTORICAL_LOCAL_STABLE_LEAD_SHADOW_ONLY" if lead_pass and local_stability else "CORE_V50_P10_NOT_STABLE"
    payload = rounded({
        "version": 1,
        "strategyId": "V96_CORE_VOLUME50_TURNOVER10_RESEARCH_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "leadPass": lead_pass,
        "localStability": local_stability,
        "passed": [item["candidate"]["candidate_id"] for item in results if item["pass"]],
        "results": results,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The lead and local grid were tested on already inspected history, not an independent holdout.",
            "2026H1 is reused evidence.",
            "Order events are target/rebalance events rather than confirmed exchange fills.",
            "A new strategy ID and fresh Forward Shadow clock are mandatory before any Production review.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-core-vol50-p10-final-validation.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Core Volume50 / Turnover10 Final Validation",
        "",
        f"- Status: **{status}**",
        f"- Lead pass: **{'PASS' if lead_pass else 'FAIL'}**",
        f"- Local stability: **{'PASS' if local_stability else 'FAIL'}**",
        f"- Passed grid: {', '.join(payload['passed']) if payload['passed'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Candidate | Events | Uplift | Full | Severe | DD | 2026H1 | 2026H1 severe | Best month removed severe | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in payload["results"]:
        report.append(
            f"| {item['candidate']['candidate_id']} | {item['frequency']['orderEvents']} | {item['eventUpliftPct']}% | "
            f"{item['full']['compoundedReturnPct']}% | {item['fullSevere']['compoundedReturnPct']}% | "
            f"{item['full']['maxDrawdownPct']}% | {item['reused2026H1']['compoundedReturnPct']}% | "
            f"{item['reused2026H1Severe']['compoundedReturnPct']}% | {item['removeBestMonthSevere']['compoundedReturnPct']}% | "
            f"{'YES' if item['pass'] else 'NO'} |"
        )
    (state_dir / "v96-core-vol50-p10-final-validation.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
