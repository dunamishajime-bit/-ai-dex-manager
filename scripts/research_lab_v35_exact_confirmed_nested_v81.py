from __future__ import annotations

import json
import os
from pathlib import Path

import research_lab_v35_exact_confirmed_nested_v80 as v80

TARGET_CONFIRMATION_BARS = 3
WEIGHT_TOLERANCE = 0.10
GROSS_CAP = 1.40


def rewrite_outputs():
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source = state_dir / "v35-exact-confirmed-nested-v80.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["version"] = 81
    payload["strategyId"] = "V35_EXACT_CONFIRMED_NESTED_V81"
    payload["status"] = (
        "V35_EXACT_CONFIRMED_V81_ROBUST_PASS"
        if payload.get("robustPass")
        else "V35_EXACT_CONFIRMED_V81_RESEARCH_ONLY"
    )
    payload["targetConfirmation"] = {
        "bars12h": TARGET_CONFIRMATION_BARS,
        "weightTolerance": WEIGHT_TOLERANCE,
        "chosenBeforeThisRun": True,
        "purpose": "Reduce V35 target turnover and Severe execution sensitivity without changing the signal family.",
    }
    payload["riskSpecification"]["targetConfirmationBars12h"] = TARGET_CONFIRMATION_BARS
    payload["riskSpecification"]["weightTolerance"] = WEIGHT_TOLERANCE
    payload["forwardFreeze"]["strategyId"] = "V35_EXACT_CONFIRMED_NESTED_V81"
    payload["forwardFreeze"]["targetConfirmationBars12h"] = TARGET_CONFIRMATION_BARS
    payload["forwardFreeze"]["weightTolerance"] = WEIGHT_TOLERANCE
    (state_dir / "v35-exact-confirmed-nested-v81.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (state_dir / "v35-exact-confirmed-v81-forward-freeze.json").write_text(
        json.dumps(payload["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Exact Confirmed + Nested Overlay V81",
        "",
        f"- Status: **{payload['status']}**",
        "- Underlying V35 Signal family retuned: **NO**",
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
        f"- 30-day permutation p: {payload['multipleTesting']['thirtyDayCoreBundlePermutation']['pValue']}",
        "",
        f"- Selected Overlay: `{v80.v79.OverlayConfig(**payload['selectedOverlay']).config_id}`",
        f"- Gross cap: {GROSS_CAP}",
        "- Independent Core hard stop: NONE ADDED; exact V35 signal exit retained.",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-exact-confirmed-nested-v81.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    print("\n".join(report))


def main():
    v80.TARGET_CONFIRMATION_BARS = TARGET_CONFIRMATION_BARS
    v80.WEIGHT_TOLERANCE = WEIGHT_TOLERANCE
    v80.GROSS_CAP = GROSS_CAP
    v80.v79.GROSS_CAP = GROSS_CAP
    v80.main()
    rewrite_outputs()


if __name__ == "__main__":
    main()
