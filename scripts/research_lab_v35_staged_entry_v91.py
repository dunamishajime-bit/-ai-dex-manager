from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
core = v69.core
DEV_END = core.v4.START_2026


@dataclass(frozen=True)
class Config:
    weight_tolerance: float
    portfolio_turnover_threshold: float
    maximum_stale_bars: int
    probe_scale: float
    continuation_bars: int

    @property
    def config_id(self) -> str:
        return (
            f"T{int(round(self.weight_tolerance*1000))}"
            f"_P{int(round(self.portfolio_turnover_threshold*100))}"
            f"_S{self.maximum_stale_bars}_G{int(self.probe_scale*100)}"
            f"_C{self.continuation_bars}"
        )


def configs() -> List[Config]:
    return [
        Config(*values)
        for values in itertools.product(
            (0.05, 0.10, 0.15),
            (0.10, 0.20),
            (4, 6, 12),
            (0.25, 0.50, 0.75),
            (1, 2, 3),
        )
    ]


def signature(target: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return v90.signature(target)


def stabilize(
    raw_targets: Dict[int, Dict[str, float]],
    times: List[int],
    config: Config,
) -> tuple[Dict[int, Dict[str, float]], dict]:
    result: Dict[int, Dict[str, float]] = {}
    active_full: Dict[str, float] = {}
    active_signature: Tuple[Tuple[str, int], ...] = ()
    continuation_count = 0
    last_weight_rebalance = 0
    staged_buckets = full_buckets = signature_changes = 0
    ignored_changes = accepted_weight_rebalances = 0
    for index, ts in enumerate(times):
        desired = dict(raw_targets.get(ts, {}))
        desired_signature = signature(desired)
        if desired_signature != active_signature:
            active_signature = desired_signature
            active_full = desired
            continuation_count = 1 if desired_signature else 0
            last_weight_rebalance = index
            signature_changes += 1
        else:
            if desired_signature:
                continuation_count += 1
            proposed = dict(active_full)
            changed = False
            for symbol in set(active_full) | set(desired):
                old = float(active_full.get(symbol, 0.0))
                new = float(desired.get(symbol, 0.0))
                if abs(new - old) >= config.weight_tolerance:
                    if abs(new) <= 1e-12:
                        proposed.pop(symbol, None)
                    else:
                        proposed[symbol] = new
                    changed = True
                elif abs(new - old) > 1e-12:
                    ignored_changes += 1
            proposed_turnover = core.v4.turnover(active_full, proposed) if proposed != active_full else 0.0
            forced = index - last_weight_rebalance >= config.maximum_stale_bars
            if changed and (
                proposed_turnover >= config.portfolio_turnover_threshold or forced
            ):
                active_full = proposed
                last_weight_rebalance = index
                accepted_weight_rebalances += 1

        if not active_signature:
            active = {}
        elif continuation_count <= config.continuation_bars:
            active = {symbol: float(weight) * config.probe_scale for symbol, weight in active_full.items()}
            staged_buckets += 1
        else:
            active = dict(active_full)
            full_buckets += 1
        result[ts] = active

    raw_turnover = staged_turnover = 0.0
    previous_raw: Dict[str, float] = {}
    previous_staged: Dict[str, float] = {}
    for ts in times:
        raw = dict(raw_targets.get(ts, {}))
        staged = dict(result.get(ts, {}))
        raw_turnover += core.v4.turnover(previous_raw, raw) if raw != previous_raw else 0.0
        staged_turnover += core.v4.turnover(previous_staged, staged) if staged != previous_staged else 0.0
        previous_raw = raw
        previous_staged = staged
    return result, {
        "rawTurnover": raw_turnover,
        "stagedTurnover": staged_turnover,
        "turnoverReductionPct": (
            (1.0 - staged_turnover / raw_turnover) * 100.0 if raw_turnover > 0 else 0.0
        ),
        "signatureChanges": signature_changes,
        "stagedBuckets": staged_buckets,
        "fullBuckets": full_buckets,
        "ignoredWeightChanges": ignored_changes,
        "acceptedWeightRebalances": accepted_weight_rebalances,
    }


def simulate(config: Config, raw: dict) -> dict:
    targets, diagnostics = stabilize(raw["targets"], raw["times"], config)
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
    base_rows = core.core_rows(v35_config, raw["times"], base_core, features)
    severe_rows = core.core_rows(v35_config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, base_core, features)
    normal, normal_diag = v86.controlled_core(base_rows, context, None)
    severe, severe_diag = v86.controlled_core(severe_rows, context, None)
    return {
        "targets": targets,
        "normalRows": normal,
        "severeRows": severe,
        "staging": diagnostics,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def neighbor(left: Config, right: Config) -> bool:
    differences = sum([
        left.weight_tolerance != right.weight_tolerance,
        left.portfolio_turnover_threshold != right.portfolio_turnover_threshold,
        left.maximum_stale_bars != right.maximum_stale_bars,
        left.probe_scale != right.probe_scale,
        left.continuation_bars != right.continuation_bars,
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
        dev["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"] * 0.85
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"] * 1.20
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 2.0
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 2.0
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and simulation["staging"]["stagedBuckets"] >= 20
    )
    holdout_pass = bool(
        hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
        and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.65
        and hold["maxDrawdownPct"] >= -15.0
        and hold_severe["maxDrawdownPct"] >= -16.0
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
        "staging": simulation["staging"],
    }


def rank_key(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["reused2026H1Severe"]["compoundedReturnPct"],
        item["developmentSevere"]["maxDrawdownPct"],
        -item["config"]["continuation_bars"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    baseline_sim = v90.simulate(v90.Config(0.0, 0.0, 2), raw)
    baseline = {
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
    status = "V35_STAGED_ENTRY_PASS" if selected else "NO_V35_STAGED_ENTRY_PASS"
    result = rounded({
        "version": 91,
        "strategyId": "V35_STAGED_ENTRY_V91",
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
            "signalFamily": "Unchanged V35 target direction/signature.",
            "entry": "On a new non-empty target signature, start at 25-75% Gross and promote to Full only after 1-3 additional completed 12h targets keep the same direction.",
            "weightBand": "Same-direction small weight changes remain suppressed by the V90 no-trade band.",
            "reversal": "A changed target signature resets the staged-entry clock.",
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "Staged Entry modifies execution sizing and requires production parity review.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-staged-entry-v91.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Staged Entry V91",
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
            f"- Staged buckets: {selected['staging']['stagedBuckets']} / Turnover reduction {selected['staging']['turnoverReductionPct']}%",
            f"- Development: {selected['development']['compoundedReturnPct']}% / Severe {selected['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected['reused2026H1']['compoundedReturnPct']}% / Severe {selected['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Full: {selected['full']['compoundedReturnPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Full Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
        ])
    if not selected and best_2026:
        report.extend([
            "",
            f"- Best 2026 diagnostic: `{best_2026['configId']}`",
            f"- 2026H1: {best_2026['reused2026H1']['compoundedReturnPct']}% / Severe {best_2026['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Development: {best_2026['development']['compoundedReturnPct']}% / Severe {best_2026['developmentSevere']['compoundedReturnPct']}%",
            f"- Full: {best_2026['full']['compoundedReturnPct']}% / Severe {best_2026['fullSevere']['compoundedReturnPct']}%",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-staged-entry-v91.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
