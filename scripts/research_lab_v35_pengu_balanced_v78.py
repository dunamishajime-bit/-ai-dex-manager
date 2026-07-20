from __future__ import annotations

import json
import os
from pathlib import Path

import research_lab_v35_confirmed_target_nested_risk_v77 as v77
import research_lab_v35_pengu_balanced_v76 as v76


def rewrite_outputs() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source = state_dir / "v35-pengu-balanced-v76.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["version"] = 78
    payload["strategyId"] = "V35_CONFIRMED_CORE_PLUS_PENGU_BALANCED_V78"
    payload["status"] = (
        "V35_CONFIRMED_PENGU_BALANCED_FULL_PASS"
        if payload.get("selected") and payload.get("v35CoreRobustPass")
        else "NO_V35_CONFIRMED_PENGU_BALANCED_PORTFOLIO"
    )
    payload["coreTargetConfirmation"] = {
        "bars12h": v77.TARGET_CONFIRMATION_BARS,
        "weightTolerance": v77.WEIGHT_TOLERANCE,
    }
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-pengu-balanced-v78.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    selected = payload.get("selectedResult")
    report = [
        "# V35 Confirmed Core + PENGU Balanced V78",
        "",
        f"- Status: **{payload['status']}**",
        f"- Selected: **{payload.get('selected') or 'NONE'}**",
        f"- V35 confirmed Core robust pass: **{'YES' if payload.get('v35CoreRobustPass') else 'NO'}**",
        f"- V35 Core: {payload['v35Core']['full']['compoundedReturnPct']}% / Severe {payload['v35Core']['fullSevere']['compoundedReturnPct']}% / DD {payload['v35Core']['full']['maxDrawdownPct']}%",
    ]
    if selected:
        report.extend([
            f"- Combined: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Combined Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
            f"- Large-wave excluded: {selected['excluded']['compoundedReturnPct']}%",
            f"- Large-wave excluded Severe: {selected['excludedSevere']['compoundedReturnPct']}%",
            f"- Holdout: {selected['holdout']['compoundedReturnPct']}% / Severe {selected['holdoutSevere']['compoundedReturnPct']}%",
            f"- Holdout excluded: {selected['holdoutExcluded']['compoundedReturnPct']}% / Severe {selected['holdoutExcludedSevere']['compoundedReturnPct']}%",
            f"- Observed max Gross: {selected['full']['observedMaxConcurrentGross']}",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-pengu-balanced-v78.md").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


def main() -> None:
    v76.v75 = v77
    v76.main()
    rewrite_outputs()


if __name__ == "__main__":
    main()
