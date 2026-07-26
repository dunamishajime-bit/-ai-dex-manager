from __future__ import annotations

import json
import os
from pathlib import Path


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    json_path = state_dir / "v96-profit-capture-bt.json"
    md_path = state_dir / "v96-profit-capture-bt.md"
    payload = json.loads(json_path.read_text(encoding="utf-8"))

    baseline = payload["baseline"]
    leader = payload["observedLeader"]
    normal_delta = (
        float(leader["combined"]["reused2026H1"]["compoundedReturnPct"])
        - float(baseline["combined"]["reused2026H1"]["compoundedReturnPct"])
    )
    severe_delta = (
        float(leader["combined"]["reused2026H1Severe"]["compoundedReturnPct"])
        - float(baseline["combined"]["reused2026H1Severe"]["compoundedReturnPct"])
    )
    baseline_selected = leader["config"] == baseline["config"]
    reused_uplift = normal_delta > 1e-9 and severe_delta >= -1e-9

    if baseline_selected:
        status = "NO_ROBUST_V96_PROFIT_EXTENSION"
    elif reused_uplift:
        status = "V96_PROFIT_EXTENSION_CANDIDATE_FOUND"
    else:
        status = "V96_PROFIT_EXTENSION_HISTORICAL_LEAD_FORWARD_REQUIRED"

    payload["status"] = status
    leader["reused2026H1NormalDeltaPctPoints"] = normal_delta
    leader["reused2026H1SevereDeltaPctPoints"] = severe_delta
    leader["reusedChronologicalUplift"] = reused_uplift
    payload["resultGate"] = {
        "rule": (
            "A Development-selected variant with no positive reused-2026H1 Normal uplift is classified "
            "as a historical lead requiring untouched Forward evidence, never as a Production candidate."
        ),
        "baselineSelected": baseline_selected,
        "reused2026H1NormalDeltaPctPoints": normal_delta,
        "reused2026H1SevereDeltaPctPoints": severe_delta,
        "reusedChronologicalUplift": reused_uplift,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = md_path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.startswith("- Status: **"):
            lines[index] = f"- Status: **{status}**"
            break
    lines.extend([
        "",
        "## Result gate",
        "",
        f"- Reused 2026H1 Normal delta: {normal_delta:.4f} percentage points",
        f"- Reused 2026H1 Severe delta: {severe_delta:.4f} percentage points",
        "- Zero reused-2026H1 uplift means this remains a historical lead requiring untouched Forward evidence.",
    ])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Result gate: {status}; reused 2026H1 delta {normal_delta:.4f} / {severe_delta:.4f}")


if __name__ == "__main__":
    main()
