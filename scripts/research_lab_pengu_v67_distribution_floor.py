from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List

import research_lab_pengu_v66_dual_gate as v66
import research_lab_pengu_v62_adaptive_sizing as v62
import research_lab_pengu_v60_delayed_exit as v60
import research_lab_pengu_wave_sleeve_v50 as v50

DISTRIBUTION_FLOOR_GROSS = 0.10
MAX_GROSS = 0.30


def build_candidate_with_floor(
    distribution: List[v50.Trade],
    flash: List[v50.Trade],
    rows: List[dict],
    features: dict,
    distribution_mom3_threshold: float,
    flash_volume_threshold: float,
) -> List[v50.Trade]:
    indices = v66.index_map(rows)
    distribution_scaled: List[v50.Trade] = []
    for trade in distribution:
        index = indices.get(int(trade.signal_ts))
        if index is None:
            continue
        momentum3 = features["mom3"][index]
        if momentum3 is None:
            continue
        target = (
            MAX_GROSS
            if float(momentum3) >= distribution_mom3_threshold
            else DISTRIBUTION_FLOOR_GROSS
        )
        distribution_scaled.append(v62.rescale_trade(trade, target))

    flash_scaled: List[v50.Trade] = []
    for trade in flash:
        index = indices.get(int(trade.signal_ts))
        if index is None:
            continue
        if trade.mode == "EXTREME_PROBE_ADD":
            flash_scaled.append(v62.rescale_trade(trade, MAX_GROSS))
            continue
        volume_acceleration = features["volumeAcceleration"][index]
        if volume_acceleration is not None and float(volume_acceleration) >= flash_volume_threshold:
            flash_scaled.append(v62.rescale_trade(trade, MAX_GROSS))

    return v60.combine_same_side(distribution_scaled, flash_scaled)


v66.build_candidate = build_candidate_with_floor


def main() -> None:
    v66.main()
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source = state_dir / "pengu-v66-dual-gate.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["version"] = 67
    payload["strategyId"] = "PENGU_V67_DISTRIBUTION_FLOOR"
    payload["distributionFloorGross"] = DISTRIBUTION_FLOOR_GROSS
    payload["designChange"] = (
        "Distribution signals below the selected three-hour momentum threshold retain 10% gross "
        "instead of being fully disabled; qualifying signals use 30% gross."
    )
    if payload["status"] == "DUAL_GATE_FULL_PASS":
        payload["status"] = "DISTRIBUTION_FLOOR_FULL_PASS"
    elif payload["status"] == "DUAL_GATE_ARCHIVE_PASS":
        payload["status"] = "DISTRIBUTION_FLOOR_ARCHIVE_PASS"
    else:
        payload["status"] = "NO_ROBUST_DISTRIBUTION_FLOOR"
    (state_dir / "pengu-v67-distribution-floor.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    selected = payload.get("selected")
    archive = payload.get("archive")
    aster = payload.get("aster")
    report = [
        "# PENGU V67 Distribution Floor",
        "",
        f"- Status: **{payload['status']}**",
        f"- Selected gate: **{selected['gateId'] if selected else 'NONE'}**",
        f"- Distribution floor / high gross: **{DISTRIBUTION_FLOOR_GROSS} / {MAX_GROSS}**",
        f"- Archive Holdout: **{'PASS' if payload.get('archiveHoldoutPassed') else 'FAIL'}**",
        f"- Archive robustness: **{'PASS' if payload.get('archiveRobustnessPassed') else 'FAIL'}**",
        f"- Aster robustness: **{'PASS' if payload.get('asterRobustnessPassed') else 'FAIL'}**",
        "",
        f"- Archive included: {archive['included']['compoundedReturnPct'] if archive else None}%",
        f"- Archive Severe: {archive['includedSevere']['compoundedReturnPct'] if archive else None}%",
        f"- Archive waves excluded: {archive['excluded']['compoundedReturnPct'] if archive else None}%",
        f"- Archive excluded Severe: {archive['excludedSevere']['compoundedReturnPct'] if archive else None}%",
        f"- Archive excluded cost 0.56%: {archive['excludedCost0p56']['compoundedReturnPct'] if archive else None}%",
        f"- Archive remove best trade: {archive['removeBestTrade']['compoundedReturnPct'] if archive else None}%",
        "",
        f"- Aster included: {aster['included']['compoundedReturnPct'] if aster else None}%",
        f"- Aster waves excluded: {aster['excluded']['compoundedReturnPct'] if aster else None}%",
        f"- Aster excluded cost 0.56%: {aster['excludedCost0p56']['compoundedReturnPct'] if aster else None}%",
        f"- Aster excluded bootstrap P05: {aster['excludedTradeBootstrap']['returnP05'] if aster else None}%",
        f"- Aster remove best trade: {aster['removeBestTrade']['compoundedReturnPct'] if aster else None}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v67-distribution-floor.md").write_text(
        "\n".join(report),
        encoding="utf-8",
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
