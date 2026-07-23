from __future__ import annotations

import datetime as dt
import json
import math
import os
from dataclasses import asdict
from pathlib import Path

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v96_frequency_uplift as freq

core = v69.core

CANDIDATES = [
    freq.CoreCandidate("CURRENT_V70", volume_floor=0.70),
    freq.CoreCandidate("VOL50_BASE", volume_floor=0.50),
    freq.CoreCandidate("VOL50_T025", volume_floor=0.50, weight_tolerance=0.025),
    freq.CoreCandidate("VOL50_P10", volume_floor=0.50, turnover_threshold=0.10),
    freq.CoreCandidate("VOL50_S6", volume_floor=0.50, stale_bars=6),
    freq.CoreCandidate("VOL50_T025_P10", volume_floor=0.50, weight_tolerance=0.025, turnover_threshold=0.10),
    freq.CoreCandidate("VOL50_T025_S6", volume_floor=0.50, weight_tolerance=0.025, stale_bars=6),
    freq.CoreCandidate("VOL50_P10_S6", volume_floor=0.50, turnover_threshold=0.10, stale_bars=6),
    freq.CoreCandidate("VOL50_FAST", volume_floor=0.50, weight_tolerance=0.025, turnover_threshold=0.10, stale_bars=6),
    freq.CoreCandidate("VOL50_VFAST", volume_floor=0.50, weight_tolerance=0.01, turnover_threshold=0.05, stale_bars=4),
]


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
    results = [freq.evaluate_core(candidate, raw) for candidate in CANDIDATES]
    current = next(item for item in results if item["candidate"]["candidate_id"] == "CURRENT_V70")
    lead = next(item for item in results if item["candidate"]["candidate_id"] == "VOL50_BASE")
    for item in results:
        events = item["frequency"]["orderEvents"]
        item["upliftVsCurrentPct"] = (events / current["frequency"]["orderEvents"] - 1.0) * 100.0
        item["upliftVsVol50Pct"] = (events / lead["frequency"]["orderEvents"] - 1.0) * 100.0
        item["pass"] = bool(
            item["candidate"]["candidate_id"] not in {"CURRENT_V70", "VOL50_BASE"}
            and events >= math.ceil(current["frequency"]["orderEvents"] * 1.20)
            and item["development"]["compoundedReturnPct"] >= lead["development"]["compoundedReturnPct"] * 0.95
            and item["developmentSevere"]["compoundedReturnPct"] >= lead["developmentSevere"]["compoundedReturnPct"] * 0.90
            and item["development"]["maxDrawdownPct"] >= lead["development"]["maxDrawdownPct"] - 2.0
            and item["developmentSevere"]["maxDrawdownPct"] >= lead["developmentSevere"]["maxDrawdownPct"] - 2.0
            and item["reused2026H1"]["compoundedReturnPct"] > 0
            and item["reused2026H1Severe"]["compoundedReturnPct"] > 0
            and item["fullSevere"]["compoundedReturnPct"] > current["fullSevere"]["compoundedReturnPct"]
        )
    passed = [item["candidate"]["candidate_id"] for item in results if item["pass"]]
    status = "CORE_VOLUME50_FASTER_EXECUTION_LEAD_FOUND" if passed else "NO_ROBUST_CORE_VOLUME50_FASTER_EXECUTION"
    payload = rounded({
        "version": 1,
        "strategyId": "V96_CORE_VOLUME50_EXECUTION_SWEEP_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "passed": passed,
        "results": results,
        "selectionPolicy": {
            "minimumOrderEventUpliftVsCurrentPct": 20,
            "minimumDevReturnRetentionVsVolume50": 0.95,
            "minimumDevSevereRetentionVsVolume50": 0.90,
            "positiveReused2026NormalAndSevere": True,
            "fullSevereMustBeatCurrentV70": True,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "Volume 0.50 and these execution variants were evaluated on already inspected history.",
            "Order events are target/rebalance events, not exchange fills.",
            "Any surviving candidate remains Shadow-only and requires a new strategy ID and Forward clock.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-core-volume50-execution-sweep.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Core Volume50 Execution Sweep",
        "",
        f"- Status: **{status}**",
        f"- Passed: {', '.join(passed) if passed else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Candidate | Events | Uplift vs current | Dev | Dev severe | Full | Full severe | DD | 2026H1 | 2026H1 severe | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in payload["results"]:
        report.append(
            f"| {item['candidate']['candidate_id']} | {item['frequency']['orderEvents']} | {item['upliftVsCurrentPct']}% | "
            f"{item['development']['compoundedReturnPct']}% | {item['developmentSevere']['compoundedReturnPct']}% | "
            f"{item['full']['compoundedReturnPct']}% | {item['fullSevere']['compoundedReturnPct']}% | "
            f"{item['full']['maxDrawdownPct']}% | {item['reused2026H1']['compoundedReturnPct']}% | "
            f"{item['reused2026H1Severe']['compoundedReturnPct']}% | {'YES' if item['pass'] else 'NO'} |"
        )
    (state_dir / "v96-core-volume50-execution-sweep.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
