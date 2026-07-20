from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
core = v69.core
DEV_END = core.v4.START_2026


@dataclass(frozen=True)
class TargetConfig:
    confirmation_bars: int
    weight_tolerance: float
    minimum_hold_bars: int
    rebalance_cadence_bars: int

    @property
    def config_id(self) -> str:
        return (
            f"C{self.confirmation_bars}_T{int(self.weight_tolerance*100)}"
            f"_H{self.minimum_hold_bars}_R{self.rebalance_cadence_bars}"
        )


def configs() -> List[TargetConfig]:
    return [
        TargetConfig(*values)
        for values in itertools.product(
            (1, 2, 3),
            (0.05, 0.10, 0.15),
            (1, 2, 4),
            (1, 2),
        )
    ]


def signature(target: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted(
        (symbol, 1 if float(weight) > 0 else -1)
        for symbol, weight in target.items()
        if abs(float(weight)) > 1e-12
    ))


def stabilize(
    raw_targets: Dict[int, Dict[str, float]],
    times: List[int],
    config: TargetConfig,
) -> tuple[Dict[int, Dict[str, float]], dict]:
    result: Dict[int, Dict[str, float]] = {}
    active: Dict[str, float] = {}
    active_since = 0
    pending_signature: Tuple[Tuple[str, int], ...] = ()
    pending_target: Dict[str, float] = {}
    pending_count = 0
    reversal_wait_target: Dict[str, float] | None = None
    accepted_changes = ignored_weight_changes = exits = entries = reversals = 0
    for index, ts in enumerate(times):
        desired = dict(raw_targets.get(ts, {}))
        desired_signature = signature(desired)
        active_signature = signature(active)

        if reversal_wait_target is not None:
            active = dict(reversal_wait_target)
            active_since = index
            reversal_wait_target = None
            entries += 1
            accepted_changes += 1
            result[ts] = dict(active)
            continue

        if desired_signature != active_signature:
            if desired_signature == pending_signature:
                pending_count += 1
                pending_target = desired
            else:
                pending_signature = desired_signature
                pending_target = desired
                pending_count = 1
            required = config.confirmation_bars
            if pending_count >= required:
                opposite = bool(
                    active_signature
                    and desired_signature
                    and any(
                        symbol in dict(active_signature)
                        and dict(active_signature)[symbol] != direction
                        for symbol, direction in desired_signature
                    )
                )
                if active and opposite:
                    active = {}
                    reversal_wait_target = dict(pending_target)
                    reversals += 1
                    exits += 1
                elif not desired_signature:
                    active = {}
                    exits += 1
                elif not active:
                    active = dict(pending_target)
                    active_since = index
                    entries += 1
                elif index - active_since >= config.minimum_hold_bars:
                    active = dict(pending_target)
                    active_since = index
                else:
                    result[ts] = dict(active)
                    continue
                accepted_changes += 1
                pending_signature = ()
                pending_target = {}
                pending_count = 0
        else:
            pending_signature = ()
            pending_target = {}
            pending_count = 0
            if active and index % config.rebalance_cadence_bars == 0:
                updated = dict(active)
                for symbol in set(active) | set(desired):
                    old = float(active.get(symbol, 0.0))
                    new = float(desired.get(symbol, 0.0))
                    if abs(new - old) >= config.weight_tolerance:
                        if abs(new) <= 1e-12:
                            updated.pop(symbol, None)
                        else:
                            updated[symbol] = new
                        accepted_changes += 1
                    elif abs(new - old) > 1e-12:
                        ignored_weight_changes += 1
                active = updated
        result[ts] = dict(active)

    raw_turnover = stabilized_turnover = 0.0
    previous_raw: Dict[str, float] = {}
    previous_stable: Dict[str, float] = {}
    for ts in times:
        raw = dict(raw_targets.get(ts, {}))
        stable = dict(result.get(ts, {}))
        raw_turnover += core.v4.turnover(previous_raw, raw) if raw != previous_raw else 0.0
        stabilized_turnover += core.v4.turnover(previous_stable, stable) if stable != previous_stable else 0.0
        previous_raw = raw
        previous_stable = stable
    return result, {
        "rawTurnover": raw_turnover,
        "stabilizedTurnover": stabilized_turnover,
        "turnoverReductionPct": (
            (1.0 - stabilized_turnover / raw_turnover) * 100.0 if raw_turnover > 0 else 0.0
        ),
        "acceptedChanges": accepted_changes,
        "ignoredWeightChanges": ignored_weight_changes,
        "entries": entries,
        "exits": exits,
        "reversals": reversals,
    }


def build_raw() -> dict:
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars = {symbol: core.v4.resample_12h(raw[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = core.v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in core.v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
    projected = core.v6.precompute_projected_members(core.v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: core.v4.overlay_target(core.v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = core.v6.precompute_bear_targets([core.v20.HEDGE], times, bars, indexes)[core.v20.HEDGE.hedge_id]
    targets = core.v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    return {
        "bars": bars,
        "indexes": indexes,
        "funding": funding,
        "times": times,
        "targets": targets,
    }


def context_for(
    targets: Dict[int, Dict[str, float]],
    raw: dict,
    base_core: Dict[int, dict],
    features: Dict[int, dict],
) -> Dict[int, dict]:
    times = raw["times"]
    previous: Dict[str, float] = {}
    context: Dict[int, dict] = {}
    for position, ts in enumerate(times):
        desired = dict(targets.get(ts, {}))
        turnover = core.v4.turnover(previous, desired) if desired != previous else 0.0
        source_target = targets.get(times[position - 1], {}) if position > 0 else {}
        breadth = sum(
            1 for symbol, weight in source_target.items()
            if symbol != "BTC" and float(weight) > 0
        )
        context[ts] = {
            "turnover": turnover,
            "regime": int(base_core.get(ts, {}).get("regime", 0)),
            "breadth": breadth,
            "feature": dict(features.get(ts, {})),
        }
        previous = desired
    return context


def simulate(config: TargetConfig, raw: dict) -> dict:
    targets, stabilization = stabilize(raw["targets"], raw["times"], config)
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
    context = context_for(targets, raw, base_core, features)
    normal, normal_diag = v86.controlled_core(base_rows, context, None)
    severe, severe_diag = v86.controlled_core(severe_rows, context, None)
    return {
        "targets": targets,
        "normalRows": normal,
        "severeRows": severe,
        "context": context,
        "stabilization": stabilization,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def neighbor(left: TargetConfig, right: TargetConfig) -> bool:
    differences = sum([
        left.confirmation_bars != right.confirmation_bars,
        left.weight_tolerance != right.weight_tolerance,
        left.minimum_hold_bars != right.minimum_hold_bars,
        left.rebalance_cadence_bars != right.rebalance_cadence_bars,
    ])
    return differences <= 1


def evaluate(config: TargetConfig, raw: dict, baseline: dict) -> dict:
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
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"] * 1.10
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 2.0
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 2.0
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and simulation["stabilization"]["turnoverReductionPct"] >= 15.0
    )
    holdout_pass = bool(
        hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
        and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.70
        and hold["maxDrawdownPct"] >= -15.0
        and hold_severe["maxDrawdownPct"] >= -18.0
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
        "stabilization": simulation["stabilization"],
        "controlDiagnostics": simulation["controlDiagnostics"],
    }


def rank_key(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["stabilization"]["turnoverReductionPct"],
        item["developmentSevere"]["maxDrawdownPct"],
        item["development"]["maxDrawdownPct"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = build_raw()
    baseline_config = TargetConfig(1, 0.0, 1, 1)
    baseline_sim = simulate(baseline_config, raw)
    baseline = {
        "development": v69.metrics(baseline_sim["normalRows"], core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(baseline_sim["normalRows"], DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(baseline_sim["severeRows"], DEV_END, core.CORE_END),
        "full": v69.metrics(baseline_sim["normalRows"], core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, core.CORE_END),
        "stabilization": baseline_sim["stabilization"],
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
    status = "V35_TURNOVER_STABILIZER_PASS" if selected else "NO_V35_TURNOVER_STABILIZER_PASS"
    result = rounded({
        "version": 89,
        "strategyId": "V35_TURNOVER_STABILIZER_V89",
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
        "rule": {
            "confirmation": "Require repeated target direction/signature before changing exposure.",
            "weightBand": "Ignore per-symbol weight changes below the no-trade tolerance.",
            "minimumHold": "Avoid immediate target replacement during the minimum hold window.",
            "reversal": "Close current direction first and enter the opposite direction on the following 12h decision.",
            "signalFamilyRetuned": False,
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "The stabilizer changes execution timing and must be reconciled with the production allocator before promotion.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-turnover-stabilizer-v89.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Turnover Stabilizer V89",
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
            f"- Turnover reduction: {selected['stabilization']['turnoverReductionPct']}%",
            f"- Development: {selected['development']['compoundedReturnPct']}% / Severe {selected['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected['reused2026H1']['compoundedReturnPct']}% / Severe {selected['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Full: {selected['full']['compoundedReturnPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Full Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
        ])
    if not selected and best_2026:
        report.extend([
            "",
            f"- Best 2026 diagnostic: `{best_2026['configId']}`",
            f"- Turnover reduction: {best_2026['stabilization']['turnoverReductionPct']}%",
            f"- 2026H1: {best_2026['reused2026H1']['compoundedReturnPct']}% / Severe {best_2026['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Development: {best_2026['development']['compoundedReturnPct']}% / Severe {best_2026['developmentSevere']['compoundedReturnPct']}%",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-turnover-stabilizer-v89.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
