from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import research_lab_resilient_profit_stack_v34 as v34


def main() -> None:
    # Re-run the frozen V34 search, then select only from development-qualified
    # robust candidates. The selection rule deliberately minimizes required
    # gross exposure before considering return; 2026H1 is never used to rank.
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    v34.main()
    source = json.loads((state_dir / "disdex-resilient-profit-stack-v34.json").read_text(encoding="utf-8"))
    robust = list(source.get("robustDevelopment", []))
    if not robust:
        selected = None
    else:
        selected = min(
            robust,
            key=lambda name: (
                float(source["results"][name]["development"]["maxGross"]),
                float(source["results"][name]["config"]["strong_mult"]),
                float(source["results"][name]["config"]["normal_mult"]),
                float(source["results"][name]["config"]["brake_mult"]),
                -float(source["results"][name]["developmentSevere"]["compoundedReturnPct"]),
                -float(source["results"][name]["development"]["cagrPct"]),
                name,
            ),
        )
    final_pass = False
    selected_result = source["results"].get(selected) if selected else None
    if selected_result:
        hold = selected_result["reused2026H1"]
        severe = selected_result["reused2026H1Severe"]
        final_pass = bool(
            hold["compoundedReturnPct"] > 0
            and hold["maxDrawdownPct"] >= -20
            and severe["compoundedReturnPct"] > 0
            and severe["maxDrawdownPct"] >= -25
        )
    status = "FROZEN_MAIN_SHADOW_CANDIDATE" if selected and final_pass else "FROZEN_MAIN_CANDIDATE_REJECTED"
    result = {
        "version": 35,
        "strategyId": "DISDEX_RESILIENT_PROFIT_MAIN_V35",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selectionPolicy": "minimum development-qualified max gross, then minimum strong/normal/brake leverage; 2026H1 excluded from ranking",
        "selected": selected,
        "selectedResult": selected_result,
        "developmentCandidateCount": len(source.get("developmentPassed", [])),
        "robustCandidateCount": len(robust),
        "reused2026Passed": final_pass,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "2026H1 is reused confirmation and not a pristine holdout.",
            "PENGU evidence contains only the frozen 17-trade schedule.",
            "This gate freezes the configuration for implementation and forward shadow; it does not authorize real trading.",
        ],
    }
    report = [
        "# Dis-Dex Manager Frozen Main Candidate V35", "",
        f"- Status: **{status}**",
        f"- Selected: **{selected or 'NONE'}**",
        f"- Robust development candidates: {len(robust)}",
        f"- Reused 2026 H1 pass: **{'YES' if final_pass else 'NO'}**",
        "- Selection: minimum leverage that still clears CAGR 100% / DD 35% development gates",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    if selected_result:
        dev = selected_result["development"]
        dev_sev = selected_result["developmentSevere"]
        hold = selected_result["reused2026H1"]
        hold_sev = selected_result["reused2026H1Severe"]
        full = selected_result["full"]
        report.extend([
            "", "## Metrics", "",
            "| Period | Return | CAGR | DD | Monthly PF |",
            "| --- | ---: | ---: | ---: | ---: |",
            f"| 2023-2025 | {dev['compoundedReturnPct']}% | {dev['cagrPct']}% | {dev['maxDrawdownPct']}% | {dev['monthlyProfitFactor']} |",
            f"| 2023-2025 Severe | {dev_sev['compoundedReturnPct']}% | {dev_sev['cagrPct']}% | {dev_sev['maxDrawdownPct']}% | {dev_sev['monthlyProfitFactor']} |",
            f"| 2026 H1 reused | {hold['compoundedReturnPct']}% | {hold['cagrPct']}% | {hold['maxDrawdownPct']}% | {hold['monthlyProfitFactor']} |",
            f"| 2026 H1 Severe reused | {hold_sev['compoundedReturnPct']}% | {hold_sev['cagrPct']}% | {hold_sev['maxDrawdownPct']}% | {hold_sev['monthlyProfitFactor']} |",
            f"| Full | {full['compoundedReturnPct']}% | {full['cagrPct']}% | {full['maxDrawdownPct']}% | {full['monthlyProfitFactor']} |",
            "", "## Frozen configuration", "",
            "```json", json.dumps(selected_result["config"], ensure_ascii=False, indent=2), "```",
        ])
    report.extend(["", "## Limitations", "", *[f"- {item}" for item in result["limitations"]]])
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-frozen-main-candidate-v35.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-frozen-main-candidate-v35.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
