from __future__ import annotations

import json
import os
from pathlib import Path

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70

TARGET_LEVELS = (
    0.80, 0.85, 0.90, 0.95, 1.00, 1.05,
    1.10, 1.15, 1.20, 1.25, 1.30,
)

# This is a pre-cap MTM audit limit, not a portfolio acceptance limit.
# The validated 30% path had a 15.5364% maximum 12h bucket move.
# 130% proportional scaling implies about 67.3%; 75% keeps a safety margin.
v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v70.TARGET_LEVELS = TARGET_LEVELS


def main() -> None:
    v70.main()
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source_json = state_dir / "v35-core-pengu-v67-v70-dynamic-cap.json"
    source_md = state_dir / "v35-core-pengu-v67-v70-dynamic-cap.md"
    payload = json.loads(source_json.read_text(encoding="utf-8"))
    payload["version"] = 71
    payload["strategyId"] = "V35_CORE_PLUS_PENGU_V67_DYNAMIC_CAP_EXTENSION"
    payload["targetLevels"] = list(TARGET_LEVELS)
    payload["status"] = (
        "DYNAMIC_CAP_EXTENSION_PASS"
        if payload.get("selected") is not None
        else "NO_ROBUST_DYNAMIC_CAP_EXTENSION"
    )
    payload["extension"] = {
        "fromTargetGross": 0.80,
        "toTargetGross": 1.30,
        "step": 0.05,
        "portfolioGrossCapUnchanged": 2.0,
        "minimumClipRatioGateUnchanged": 0.50,
        "standaloneSevereDdGateUnchangedPct": -16.0,
        "mtmAuditGuardPct": 75.0,
    }
    target_json = state_dir / "v35-core-pengu-v67-v71-cap-extension.json"
    target_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    selected = payload.get("selected")
    core_full = payload["core"]["full"]
    if selected:
        report = [
            "# V35 Core + PENGU V67 V71 Dynamic Cap Extension",
            "",
            f"- Status: **{payload['status']}**",
            f"- Selected target V67 max Gross: **{selected['targetV67MaxGross']}**",
            f"- Observed max concurrent Gross: {selected['full']['observedMaxConcurrentGross']}",
            f"- Clipped buckets: {selected['capDiagnostics']['normal']['clippedBuckets']} / {selected['capDiagnostics']['normal']['activeBuckets']}",
            f"- Minimum clip ratio: {selected['capDiagnostics']['normal']['minimumClipRatio']}",
            f"- Average clip ratio: {selected['capDiagnostics']['normal']['averageClipRatio']}",
            f"- Full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Severe: {selected['severeFull']['compoundedReturnPct']}% / DD {selected['severeFull']['maxDrawdownPct']}%",
            f"- Large-wave profits excluded: {selected['largeWaveExcludedFull']['compoundedReturnPct']}%",
            f"- Excluded Severe: {selected['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Remove best trade Severe: {selected['removeBestTradeSevere']['compoundedReturnPct']}%",
            f"- Remove best month Severe: {selected['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- V67 standalone Severe DD: {selected['v67StandaloneSevere']['maxDrawdownPct']}%",
            f"- Increment vs Core: {selected['full']['compoundedReturnPct'] - core_full['compoundedReturnPct']} percentage points",
            "",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    else:
        report = [
            "# V35 Core + PENGU V67 V71 Dynamic Cap Extension",
            "",
            f"- Status: **{payload['status']}**",
            "- No target level passed every risk gate.",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    target_md = state_dir / "v35-core-pengu-v67-v71-cap-extension.md"
    target_md.write_text("\n".join(report), encoding="utf-8")
    source_md.unlink(missing_ok=True)
    source_json.unlink(missing_ok=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
