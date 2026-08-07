from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt

freq = crypto_bt.freq
core = crypto_bt.core
v86 = crypto_bt.v86
v89 = crypto_bt.v89
v90 = crypto_bt.v90
v95 = crypto_bt.v95

START = dt.datetime(2025, 8, 13, tzinfo=UTC)
DEV_END = dt.datetime(2026, 1, 1, tzinfo=UTC)
HOLDOUT_START = dt.datetime(2026, 3, 11, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
DEV_END_MS = int(DEV_END.timestamp() * 1000)
HOLDOUT_START_MS = int(HOLDOUT_START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)


@dataclass(frozen=True)
class AdaptiveConfig:
    config_id: str
    lookback_buckets: int
    loss_threshold: float
    loss_scale: float
    drawdown_threshold: float
    drawdown_scale: float


ADAPTIVE_VARIANTS: Tuple[Optional[AdaptiveConfig], ...] = (
    None,
    AdaptiveConfig("FAST_LOSS_GATE", 10, -0.015, 0.35, -0.040, 0.50),
    AdaptiveConfig("MEDIUM_LOSS_GATE", 20, -0.025, 0.50, -0.060, 0.50),
)

GROWTH_VARIANTS: Tuple[Tuple[str, Optional[v86.GrowthConfig]], ...] = (
    ("NO_STRONG_BOOST", None),
    ("PRODUCTION_STRONG", v95.STRONG_CONFIG),
    ("MODERATE_STRONG", v86.GrowthConfig(10.0, 0.0, -4.0, 1.35, None, 2, 0.15)),
    ("SELECTIVE_STRONG", v86.GrowthConfig(20.0, 0.0, -2.0, 1.20, 80.0, 3, 0.15)),
)


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, tuple):
        return [rounded(item) for item in value]
    return value


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def configure_period() -> None:
    core.CORE_END = END_MS
    core.v4.END = END_MS


def add_candidate(target: Dict[Tuple, freq.CoreCandidate], candidate: freq.CoreCandidate) -> None:
    key = (
        round(candidate.vote_threshold, 6),
        round(candidate.volume_floor, 6),
        int(candidate.bear_confirm_bars),
        round(candidate.weight_tolerance, 6),
        round(candidate.turnover_threshold, 6),
        int(candidate.stale_bars),
    )
    if key not in target:
        target[key] = candidate


def core_candidates() -> List[freq.CoreCandidate]:
    result: Dict[Tuple, freq.CoreCandidate] = {}
    baseline = crypto_bt.NEW
    add_candidate(result, baseline)

    for vote in (0.35, 0.40, 0.45, 0.50, 0.55):
        add_candidate(result, freq.CoreCandidate(f"VOTE_{int(vote*100)}", vote_threshold=vote, volume_floor=0.50, bear_confirm_bars=4, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))
    for volume in (0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 1.00):
        add_candidate(result, freq.CoreCandidate(f"VOL_{int(volume*100)}", vote_threshold=0.50, volume_floor=volume, bear_confirm_bars=4, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))
    for bear in (1, 2, 3, 4, 6):
        add_candidate(result, freq.CoreCandidate(f"BEAR_{bear}", vote_threshold=0.50, volume_floor=0.50, bear_confirm_bars=bear, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))

    stabilizers = (
        ("FASTEST", 0.01, 0.025, 4),
        ("FAST", 0.025, 0.05, 6),
        ("PROD", 0.05, 0.075, 12),
        ("SMOOTH", 0.075, 0.15, 16),
    )
    for name, tolerance, turnover, stale in stabilizers:
        add_candidate(result, freq.CoreCandidate(f"STAB_{name}", vote_threshold=0.50, volume_floor=0.50, bear_confirm_bars=4, weight_tolerance=tolerance, turnover_threshold=turnover, stale_bars=stale))

    # Recent-market family: faster bear recognition plus lower latency in target changes.
    # This is a deliberately bounded grid rather than an unconstrained same-history search.
    for vote in (0.40, 0.45, 0.50):
        for volume in (0.40, 0.50, 0.60, 0.70):
            for bear in (1, 2, 3):
                for name, tolerance, turnover, stale in stabilizers[:3]:
                    add_candidate(
                        result,
                        freq.CoreCandidate(
                            f"RECENT_V{int(vote*100)}_VOL{int(volume*100)}_B{bear}_{name}",
                            vote_threshold=vote,
                            volume_floor=volume,
                            bear_confirm_bars=bear,
                            weight_tolerance=tolerance,
                            turnover_threshold=turnover,
                            stale_bars=stale,
                        ),
                    )
    return list(result.values())


def prepare_core(candidate: freq.CoreCandidate, raw: dict) -> dict:
    raw_targets = freq.raw_targets_for(candidate, raw)
    targets, stabilization = v90.stabilize(
        raw_targets,
        raw["times"],
        v90.Config(candidate.weight_tolerance, candidate.turnover_threshold, candidate.stale_bars),
    )
    normal_cost = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_cost = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    normal_base = core.core_rows(config, raw["times"], normal_cost, features)
    severe_base = core.core_rows(config, raw["times"], severe_cost, features)
    context = v89.context_for(targets, raw, normal_cost, features)
    return {
        "normalBase": normal_base,
        "severeBase": severe_base,
        "context": context,
        "frequency": freq.count_core_frequency(targets, raw["times"], stabilization),
        "stabilization": stabilization,
    }


def adaptive_scale(rows: Sequence[dict], config: Optional[AdaptiveConfig]) -> List[dict]:
    if config is None:
        return [dict(row, adaptiveScale=1.0, adaptiveConfig="NONE") for row in rows]
    equity = peak = 1.0
    history: List[float] = []
    output: List[dict] = []
    for row in rows:
        recent = compound(history[-config.lookback_buckets:]) if history else 0.0
        drawdown = equity / peak - 1.0
        scale = 1.0
        reasons: List[str] = []
        if len(history) >= config.lookback_buckets and recent <= config.loss_threshold:
            scale = min(scale, config.loss_scale)
            reasons.append("RECENT_LOSS")
        if drawdown <= config.drawdown_threshold:
            scale = min(scale, config.drawdown_scale)
            reasons.append("FAST_DD")
        value = float(row["return"]) * scale
        item = dict(row)
        item["return"] = value
        item["gross"] = float(row.get("gross", 0.0)) * scale
        item["maxGross"] = float(row.get("maxGross", row.get("gross", 0.0))) * scale
        item["adaptiveScale"] = scale
        item["adaptiveConfig"] = config.config_id
        item["adaptiveReasons"] = reasons
        output.append(item)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        history.append(value)
    return output


def window_metrics(rows: Sequence[dict], start: int, end: int) -> dict:
    metric = crypto_bt.metric(list(rows), start, end)
    active = [row for row in rows if start <= int(row["ts"]) < end]
    active_gross = [float(row.get("gross", 0.0)) for row in active]
    months: Dict[str, List[float]] = {}
    for row in active:
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(month, []).append(float(row["return"]))
    month_returns = {key: compound(values) * 100.0 for key, values in months.items()}
    positive_months = sum(value > 0 for value in month_returns.values())
    return {
        **metric,
        "activeBucketRatio": (sum(value > 0.05 for value in active_gross) / len(active_gross)) if active_gross else 0.0,
        "averageGross": (sum(active_gross) / len(active_gross)) if active_gross else 0.0,
        "positiveMonthRatio": (positive_months / len(month_returns)) if month_returns else 0.0,
        "monthlyReturnsPct": month_returns,
    }


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def selection_eligible(row: dict) -> bool:
    dev = row["development"]["normal"]
    dev_s = row["development"]["severe"]
    val = row["validation"]["normal"]
    val_s = row["validation"]["severe"]
    return bool(
        finite(dev["compoundedReturnPct"]) > -3.0
        and finite(dev_s["compoundedReturnPct"]) > -5.0
        and finite(val["compoundedReturnPct"]) > 0.0
        and finite(val_s["compoundedReturnPct"]) > 0.0
        and finite(val.get("profitFactor")) > 1.02
        and finite(val.get("maxDrawdownPct"), -99.0) >= -12.0
        and finite(val.get("activeBucketRatio")) >= 0.15
    )


def selection_score(row: dict) -> float:
    if not selection_eligible(row):
        return -1e12
    dev = row["development"]["normal"]
    dev_s = row["development"]["severe"]
    val = row["validation"]["normal"]
    val_s = row["validation"]["severe"]
    pf_bonus = max(0.0, min(2.0, finite(val.get("profitFactor")) - 1.0)) * 5.0
    return (
        0.35 * finite(dev["compoundedReturnPct"])
        + 0.65 * finite(val["compoundedReturnPct"])
        + 0.15 * finite(dev_s["compoundedReturnPct"])
        + 0.35 * finite(val_s["compoundedReturnPct"])
        + pf_bonus
        - 0.20 * abs(finite(val["maxDrawdownPct"]))
        - 0.10 * abs(finite(dev["maxDrawdownPct"]))
    )


def evaluate_variant(
    candidate: freq.CoreCandidate,
    prepared: dict,
    growth_id: str,
    growth: Optional[v86.GrowthConfig],
    adaptive: Optional[AdaptiveConfig],
) -> tuple[dict, List[dict], List[dict]]:
    normal_controlled, normal_diag = v86.controlled_core(prepared["normalBase"], prepared["context"], growth)
    severe_controlled, severe_diag = v86.controlled_core(prepared["severeBase"], prepared["context"], growth)
    normal = adaptive_scale(normal_controlled, adaptive)
    severe = adaptive_scale(severe_controlled, adaptive)
    adaptive_id = adaptive.config_id if adaptive else "NONE"
    variant_id = f"{candidate.candidate_id}__{growth_id}__{adaptive_id}"
    summary = {
        "variantId": variant_id,
        "coreCandidate": asdict(candidate),
        "growthId": growth_id,
        "growthConfig": asdict(growth) if growth else None,
        "adaptiveConfig": asdict(adaptive) if adaptive else None,
        "frequency": prepared["frequency"],
        "development": {
            "normal": window_metrics(normal, START_MS, DEV_END_MS),
            "severe": window_metrics(severe, START_MS, DEV_END_MS),
        },
        "validation": {
            "normal": window_metrics(normal, DEV_END_MS, HOLDOUT_START_MS),
            "severe": window_metrics(severe, DEV_END_MS, HOLDOUT_START_MS),
        },
        "holdout": {
            "normal": window_metrics(normal, HOLDOUT_START_MS, END_MS),
            "severe": window_metrics(severe, HOLDOUT_START_MS, END_MS),
        },
        "full": {
            "normal": window_metrics(normal, START_MS, END_MS),
            "severe": window_metrics(severe, START_MS, END_MS),
        },
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }
    summary["selectionEligible"] = selection_eligible(summary)
    summary["selectionScorePreHoldout"] = selection_score(summary)
    return summary, normal, severe


def compact_variant(row: dict) -> dict:
    return {
        "variantId": row["variantId"],
        "coreCandidate": row["coreCandidate"],
        "growthId": row["growthId"],
        "growthConfig": row["growthConfig"],
        "adaptiveConfig": row["adaptiveConfig"],
        "selectionEligible": row["selectionEligible"],
        "selectionScorePreHoldout": row["selectionScorePreHoldout"],
        "frequency": row["frequency"],
        "development": row["development"],
        "validation": row["validation"],
        "holdout": row["holdout"],
        "full": row["full"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-regime-redesign")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    configure_period()
    raw = v89.build_raw()
    candidates = core_candidates()

    all_rows: List[dict] = []
    replay_by_id: Dict[str, Tuple[List[dict], List[dict]]] = {}
    for candidate in candidates:
        prepared = prepare_core(candidate, raw)
        for growth_id, growth in GROWTH_VARIANTS:
            for adaptive in ADAPTIVE_VARIANTS:
                row, normal, severe = evaluate_variant(candidate, prepared, growth_id, growth, adaptive)
                all_rows.append(row)
                replay_by_id[row["variantId"]] = (normal, severe)

    baseline_id = f"{crypto_bt.NEW.candidate_id}__PRODUCTION_STRONG__NONE"
    baseline = next(row for row in all_rows if row["variantId"] == baseline_id)
    ranked = sorted(all_rows, key=lambda row: (finite(row["selectionScorePreHoldout"], -1e12), row["variantId"]), reverse=True)
    eligible = [row for row in ranked if row["selectionEligible"]]
    selected = eligible[0] if eligible else baseline
    selected_normal, selected_severe = replay_by_id[selected["variantId"]]

    hold = selected["holdout"]["normal"]
    hold_s = selected["holdout"]["severe"]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    base_full = baseline["full"]["normal"]
    base_full_s = baseline["full"]["severe"]
    pass_holdout = bool(
        selected["variantId"] != baseline_id
        and finite(hold["compoundedReturnPct"]) >= 5.0
        and finite(hold_s["compoundedReturnPct"]) > 0.0
        and finite(hold.get("profitFactor")) > 1.05
        and finite(hold.get("maxDrawdownPct"), -99.0) >= -12.0
        and finite(full["compoundedReturnPct"]) >= finite(base_full["compoundedReturnPct"]) + 10.0
        and finite(full_s["compoundedReturnPct"]) > finite(base_full_s["compoundedReturnPct"])
    )
    status = "V96_RECENT_REGIME_REDESIGN_PASS" if pass_holdout else "NO_RECENT_ROBUST_IMPROVEMENT"

    result = rounded({
        "version": 1,
        "strategyId": "V96_RECENT_REGIME_REDESIGN_V1",
        "status": status,
        "period": {
            "startInclusive": START.isoformat(),
            "developmentEndExclusive": DEV_END.isoformat(),
            "holdoutStartInclusive": HOLDOUT_START.isoformat(),
            "endExclusive": END.isoformat(),
        },
        "selectionPolicy": {
            "holdoutUsedForRanking": False,
            "rankingData": "2025-08-13 through 2026-03-10 only",
            "holdout": "2026-03-11 through 2026-08-02",
            "purpose": "Adapt V96 to the current one-year regime without selecting on the final five-month holdout.",
        },
        "candidateCounts": {
            "coreCandidates": len(candidates),
            "growthVariants": len(GROWTH_VARIANTS),
            "adaptiveVariants": len(ADAPTIVE_VARIANTS),
            "totalVariants": len(all_rows),
            "selectionEligible": len(eligible),
        },
        "baseline": compact_variant(baseline),
        "selected": compact_variant(selected),
        "selectedPassesFreshHoldout": pass_holdout,
        "topPreHoldoutCandidates": [compact_variant(row) for row in ranked[:25]],
        "selectedReplay": {
            "strategyId": "V96_RECENT_ADAPTIVE_V1" if pass_holdout else "V96_BASELINE_FALLBACK",
            "variantId": selected["variantId"],
            "normal": [dict(row) for row in selected_normal if START_MS <= int(row["ts"]) < END_MS],
            "severe": [dict(row) for row in selected_severe if START_MS <= int(row["ts"]) < END_MS],
            "diagnostics": {
                "legacyPenguIncluded": False,
                "candidate": selected["coreCandidate"],
                "growthId": selected["growthId"],
                "adaptiveConfig": selected["adaptiveConfig"],
            },
        },
        "checks": {
            "holdoutNotUsedForRanking": True,
            "selectedValidationPositive": finite(selected["validation"]["normal"]["compoundedReturnPct"]) > 0,
            "selectedFreshHoldoutPositive": finite(hold["compoundedReturnPct"]) > 0,
            "selectedFreshHoldoutSeverePositive": finite(hold_s["compoundedReturnPct"]) > 0,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
        "limitations": [
            "This is a recent-regime redesign study, not permission to replace the running strategy.",
            "The final holdout is fresh relative to this new parameter search, but the underlying market history has been observed elsewhere in the project.",
            "Candidate families are intentionally bounded to avoid an unconstrained optimizer over the same 355-day sample.",
            "Any production promotion requires an immutable new strategy ID and forward execution evidence.",
        ],
    })

    (output / "v96-recent-regime-redesign.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Recent Regime Redesign",
        "",
        f"- Status: **{status}**",
        f"- Variants: {len(all_rows)} (eligible before holdout: {len(eligible)})",
        f"- Baseline: {baseline_id}",
        f"- Selected: **{selected['variantId']}**",
        "",
        "## Baseline",
        f"- Full Normal: {baseline['full']['normal']['compoundedReturnPct']}% / PF {baseline['full']['normal'].get('profitFactor')} / DD {baseline['full']['normal']['maxDrawdownPct']}%",
        f"- Holdout Normal: {baseline['holdout']['normal']['compoundedReturnPct']}% / PF {baseline['holdout']['normal'].get('profitFactor')} / DD {baseline['holdout']['normal']['maxDrawdownPct']}%",
        f"- Holdout Severe: {baseline['holdout']['severe']['compoundedReturnPct']}%",
        "",
        "## Selected",
        f"- Development Normal: {selected['development']['normal']['compoundedReturnPct']}%",
        f"- Validation Normal: {selected['validation']['normal']['compoundedReturnPct']}% / Severe {selected['validation']['severe']['compoundedReturnPct']}%",
        f"- Fresh Holdout Normal: **{selected['holdout']['normal']['compoundedReturnPct']}%** / PF {selected['holdout']['normal'].get('profitFactor')} / DD {selected['holdout']['normal']['maxDrawdownPct']}%",
        f"- Fresh Holdout Severe: **{selected['holdout']['severe']['compoundedReturnPct']}%**",
        f"- Full Normal: **{selected['full']['normal']['compoundedReturnPct']}%** / PF {selected['full']['normal'].get('profitFactor')} / DD {selected['full']['normal']['maxDrawdownPct']}%",
        f"- Full Severe: **{selected['full']['severe']['compoundedReturnPct']}%**",
        f"- Fresh Holdout pass: **{'YES' if pass_holdout else 'NO'}**",
        "",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-regime-redesign.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
