from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_major_core_nested_v73 as stats
import research_lab_v35_fixed_signal_nested_risk_v75 as v75

_ORIGINAL_BUILD = v75.build_v35_fixed_targets
TARGET_CONFIRMATION_BARS = 2
WEIGHT_TOLERANCE = 0.05
CORE_GROSS_CAP = 1.40


def risk_space() -> List[stats.RiskConfig]:
    result = []
    for bull in (0.65, 0.75, 0.90):
        for bear in (0.25, 0.50):
            for stop in (3.5, 5.0):
                for target_vol in (35.0, 45.0, 55.0):
                    for max_symbol in (0.50, 0.65):
                        for dd_start in (0.10, 0.15):
                            result.append(stats.RiskConfig(bull, bear, stop, target_vol, max_symbol, dd_start))
    return result


def baseline_risk() -> stats.RiskConfig:
    return stats.RiskConfig(0.75, 0.50, 5.0, 45.0, 0.65, 0.15)


def signature(target: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted((symbol, 1 if value > 0 else -1) for symbol, value in target.items() if abs(value) > 1e-12))


def confirmed_targets(bars, funding, times):
    raw, features = _ORIGINAL_BUILD(bars, funding, times)
    active: Dict[str, float] = {}
    pending_signature: Tuple[Tuple[str, int], ...] = ()
    pending_count = 0
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        desired = dict(raw.get(ts, {}))
        desired_signature = signature(desired)
        active_signature = signature(active)
        if desired_signature != active_signature:
            if desired_signature == pending_signature:
                pending_count += 1
            else:
                pending_signature = desired_signature
                pending_count = 1
            if pending_count >= TARGET_CONFIRMATION_BARS:
                active = desired
                pending_signature = ()
                pending_count = 0
        else:
            pending_signature = ()
            pending_count = 0
            updated = dict(active)
            for symbol in set(active) | set(desired):
                old = active.get(symbol, 0.0)
                new = desired.get(symbol, 0.0)
                if abs(new - old) >= WEIGHT_TOLERANCE:
                    if abs(new) <= 1e-12:
                        updated.pop(symbol, None)
                    else:
                        updated[symbol] = new
            active = updated
        result[ts] = dict(active)
    return result, features


def rewrite_outputs() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source = state_dir / "v35-fixed-signal-nested-risk-v75.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["version"] = 77
    payload["strategyId"] = "V35_CONFIRMED_TARGET_NESTED_RISK_V77"
    payload["status"] = (
        "V35_CONFIRMED_TARGET_RISK_ROBUST_PASS"
        if payload.get("robustPass")
        else "V35_CONFIRMED_TARGET_RESEARCH_ONLY"
    )
    payload["targetConfirmation"] = {
        "bars12h": TARGET_CONFIRMATION_BARS,
        "weightTolerance": WEIGHT_TOLERANCE,
        "signalRetuned": False,
        "purpose": "Reduce target churn and Severe execution sensitivity without changing V35 Entry logic.",
    }
    payload["riskSpecification"]["coreGrossCap"] = CORE_GROSS_CAP
    payload["forwardFreeze"]["strategyId"] = "V35_CONFIRMED_TARGET_NESTED_RISK_V77"
    payload["forwardFreeze"]["targetConfirmationBars12h"] = TARGET_CONFIRMATION_BARS
    payload["forwardFreeze"]["weightTolerance"] = WEIGHT_TOLERANCE
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-confirmed-target-nested-risk-v77.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (state_dir / "v35-confirmed-target-v77-forward-freeze.json").write_text(
        json.dumps(payload["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Confirmed Target + Nested Risk V77",
        "",
        f"- Status: **{payload['status']}**",
        "- V35 Entry/Signal retuned: **NO**",
        f"- Target confirmation: {TARGET_CONFIRMATION_BARS} completed 12h bars",
        f"- Weight tolerance: {WEIGHT_TOLERANCE * 100.0}%",
        f"- Outer OOS: {payload['outerOos']['compoundedReturnPct']}% / DD {payload['outerOos']['maxDrawdownPct']}%",
        f"- Outer OOS Severe: {payload['outerOosSevere']['compoundedReturnPct']}% / DD {payload['outerOosSevere']['maxDrawdownPct']}%",
        f"- Positive folds: {payload['positiveOuterFolds']}/5; Severe {payload['positiveOuterSevereFolds']}/5",
        f"- Full: {payload['full']['compoundedReturnPct']}% / CAGR {payload['full']['cagrPct']}% / DD {payload['full']['maxDrawdownPct']}%",
        f"- Full Severe: {payload['fullSevere']['compoundedReturnPct']}% / DD {payload['fullSevere']['maxDrawdownPct']}%",
        f"- DSR probability: {payload['multipleTesting']['deflatedSharpe']['probability']}",
        f"- Reality Check p: {payload['multipleTesting']['whiteRealityCheckAndSpaAgainstCash']['realityCheckP']}",
        f"- SPA approximation p: {payload['multipleTesting']['whiteRealityCheckAndSpaAgainstCash']['spaApproxP']}",
        f"- 30-day permutation p: {payload['multipleTesting']['monthlyDecisionBlockPermutation']['pValue']}",
        "",
        f"- Selected risk: `{stats.RiskConfig(**payload['selectedRisk']).config_id}`",
        f"- Core Gross cap: {CORE_GROSS_CAP}",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-confirmed-target-nested-risk-v77.md").write_text("\n".join(report), encoding="utf-8")
    freeze_source = state_dir / "v35-fixed-signal-v75-forward-freeze.json"
    freeze_source.write_text(json.dumps(payload["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n".join(report))


def main() -> None:
    v75.risk_space = risk_space
    v75.baseline_risk = baseline_risk
    v75.build_v35_fixed_targets = confirmed_targets
    v75.CORE_GROSS_CAP = CORE_GROSS_CAP
    v75.main()
    rewrite_outputs()


if __name__ == "__main__":
    main()
