from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
core = v69.core
DEV_END = core.v4.START_2026
FIXED_TARGET_CONFIG = v90.Config(0.05, 0.20, 12)


@dataclass(frozen=True)
class Config:
    mom3_min: float
    mom20_min: float
    confirmation_bars: int
    scale: float
    hold_bars: int

    @property
    def config_id(self) -> str:
        return (
            f"M3{int(self.mom3_min)}_M20{int(self.mom20_min)}"
            f"_C{self.confirmation_bars}_S{int(self.scale*100)}_H{self.hold_bars}"
        )


def configs() -> List[Config]:
    return [
        Config(*values)
        for values in itertools.product(
            (2.0, 4.0, 6.0),
            (7.0, 10.0, 15.0),
            (1, 2, 3),
            (0.40, 0.60, 0.80),
            (1, 2, 4),
        )
    ]


def overheat(config: Config, item: dict) -> bool:
    feature = item.get("feature", {})
    return bool(
        int(item.get("regime", 0)) > 0
        and bool(feature.get("closeAboveSma20", False))
        and float(feature.get("mom3", 0.0)) >= config.mom3_min
        and float(feature.get("mom20", 0.0)) >= config.mom20_min
    )


def apply_guard(
    rows: List[dict],
    context: Dict[int, dict],
    config: Config,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    prior_item = {"regime": 0, "feature": {}}
    consecutive = 0
    remaining = 0
    guarded_buckets = triggers = 0
    for row in rows:
        if overheat(config, prior_item):
            consecutive += 1
        else:
            consecutive = 0
        if consecutive >= config.confirmation_bars:
            remaining = max(remaining, config.hold_bars)
            triggers += 1
            consecutive = 0
        scale = config.scale if remaining > 0 else 1.0
        if remaining > 0:
            guarded_buckets += 1
            remaining -= 1
        item = dict(row)
        item["return"] = float(item["return"]) * scale
        item["gross"] = float(item["gross"]) * scale
        item["guardScale"] = scale
        result.append(item)
        prior_item = context.get(int(row["ts"]), {"regime": 0, "feature": {}})
    return result, {
        "guardedBuckets": guarded_buckets,
        "guardedRatePct": guarded_buckets / len(result) * 100.0 if result else 0.0,
        "triggers": triggers,
    }


def simulate(config: Config, raw: dict) -> dict:
    targets, target_diag = v90.stabilize(raw["targets"], raw["times"], FIXED_TARGET_CONFIG)
    base_core = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_core = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(
        raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    v35_config = core.CoreConfig()
    normal_rows = core.core_rows(v35_config, raw["times"], base_core, features)
    severe_rows = core.core_rows(v35_config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, base_core, features)
    guarded_normal, normal_guard = apply_guard(normal_rows, context, config)
    guarded_severe, severe_guard = apply_guard(severe_rows, context, config)
    normal, normal_control = v86.controlled_core(guarded_normal, context, None)
    severe, severe_control = v86.controlled_core(guarded_severe, context, None)
    return {
        "normalRows": normal,
        "severeRows": severe,
        "targetDiagnostics": target_diag,
        "guardDiagnostics": {"normal": normal_guard, "severe": severe_guard},
        "controlDiagnostics": {"normal": normal_control, "severe": severe_control},
    }


def neighbor(left: Config, right: Config) -> bool:
    differences = sum([
        left.mom3_min != right.mom3_min,
        left.mom20_min != right.mom20_min,
        left.confirmation_bars != right.confirmation_bars,
        left.scale != right.scale,
        left.hold_bars != right.hold_bars,
    ])
    return differences <= 1


def evaluate(config: Config, raw: dict, baseline: dict) -> dict:
    simulation = simulate(config, raw)
    normal = simulation["normalRows"]
    severe = simulation["severeRows"]
    dev = v69.metrics(normal, core.CORE_START, DEV_END)
    dev_severe = v69.metrics(severe, core.CORE_START, DEV_END)
    hold = v69.metrics(normal, DEV_END, core.CORE_END)
    hold_severe = v69.metrics(severe, DEV_END, core.CORE_END)
    full = v69.metrics(normal, core.CORE_START, core.CORE_END)
    full_severe = v69.metrics(severe, core.CORE_START, core.CORE_END)
    development_pass = bool(
        dev["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"] * 0.90
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"]
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 1.5
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 1.5
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and simulation["guardDiagnostics"]["normal"]["guardedBuckets"] >= 10
    )
    holdout_pass = bool(
        hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
        and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.70
        and hold["maxDrawdownPct"] >= -15.0
        and hold_severe["maxDrawdownPct"] >= -15.0
        and full_severe["compoundedReturnPct"] >= baseline["fullSevere"]["compoundedReturnPct"]
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "developmentPass": development_pass,
        "holdoutPass": holdout_pass,
        "development": dev,
        "developmentSevere": dev_severe,
        "reused2026H1": hold,
        "reused2026H1Severe": hold_severe,
        "full": full,
        "fullSevere": full_severe,
        "targetDiagnostics": simulation["targetDiagnostics"],
        "guardDiagnostics": simulation["guardDiagnostics"],
    }


def rank_key(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["reused2026H1Severe"]["compoundedReturnPct"],
        item["developmentSevere"]["maxDrawdownPct"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    baseline_sim = v90.simulate(FIXED_TARGET_CONFIG, raw)
    baseline = {
        "targetConfig": asdict(FIXED_TARGET_CONFIG),
        "development": v69.metrics(baseline_sim["normalRows"], core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(baseline_sim["normalRows"], DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(baseline_sim["severeRows"], DEV_END, core.CORE_END),
        "full": v69.metrics(baseline_sim["normalRows"], core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, core.CORE_END),
    }
    candidates = [evaluate(config, raw, baseline) for config in configs()]
    development_passed = [item for item in candidates if item["developmentPass"]]
    lookup = {config.config_id: config for config in configs()}
    stable = [
        item for item in development_passed
        if sum(
            neighbor(lookup[item["configId"]], lookup[other["configId"]])
            for other in development_passed if other["configId"] != item["configId"]
        ) >= 2
    ]
    accepted = [item for item in stable if item["holdoutPass"]]
    accepted.sort(key=rank_key, reverse=True)
    selected = accepted[0] if accepted else None
    best_2026 = max(
        stable,
        key=lambda item: (
            item["reused2026H1Severe"]["compoundedReturnPct"],
            item["reused2026H1"]["compoundedReturnPct"],
            item["developmentSevere"]["compoundedReturnPct"],
        ),
        default=None,
    )
    status = "V35_EXHAUSTION_GUARD_PASS" if selected else "NO_V35_EXHAUSTION_GUARD_PASS"
    result = rounded({
        "version": 93,
        "strategyId": "V35_EXHAUSTION_GUARD_V93",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(candidates),
        "developmentPassedCount": len(development_passed),
        "stableDevelopmentCount": len(stable),
        "acceptedCount": len(accepted),
        "baseline": baseline,
        "selected": selected,
        "best2026Diagnostic": best_2026,
        "topAccepted": accepted[:30],
        "topDevelopment": sorted(stable, key=rank_key, reverse=True)[:40],
        "allCandidates": sorted(candidates, key=rank_key, reverse=True),
        "rule": {
            "inputTiming": "Use only the previous completed 12h feature state to decide the current bucket scale.",
            "trigger": "Require consecutive overheat states where Bull regime, SMA, mom3 and mom20 are all elevated.",
            "action": "Scale Core to 40-80% for 1-4 completed 12h buckets, then restore automatically.",
            "targetAllocator": "Fixed V90 T50_P20_S12 no-trade band.",
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "The exhaustion thresholds were historically searched and require frozen forward evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-exhaustion-guard-v93.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Exhaustion Guard V93",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / development {len(development_passed)} / stable {len(stable)} / accepted {len(accepted)}",
        f"- Baseline Full: {baseline['full']['compoundedReturnPct']}% / Severe {baseline['fullSevere']['compoundedReturnPct']}%",
        f"- Baseline 2026H1: {baseline['reused2026H1']['compoundedReturnPct']}% / Severe {baseline['reused2026H1Severe']['compoundedReturnPct']}%",
    ]
    if selected:
        report.extend([
            "",
            f"- Selected: **{selected['configId']}**",
            f"- Guarded buckets: {selected['guardDiagnostics']['normal']['guardedBuckets']}",
            f"- Development: {selected['development']['compoundedReturnPct']}% / Severe {selected['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected['reused2026H1']['compoundedReturnPct']}% / Severe {selected['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Full: {selected['full']['compoundedReturnPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Full Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
        ])
    if not selected and best_2026:
        report.extend([
            "",
            f"- Best 2026 diagnostic: `{best_2026['configId']}`",
            f"- Guarded buckets: {best_2026['guardDiagnostics']['normal']['guardedBuckets']}",
            f"- 2026H1: {best_2026['reused2026H1']['compoundedReturnPct']}% / Severe {best_2026['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Development: {best_2026['development']['compoundedReturnPct']}% / Severe {best_2026['developmentSevere']['compoundedReturnPct']}%",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-exhaustion-guard-v93.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
