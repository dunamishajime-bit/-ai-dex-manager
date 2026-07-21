from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import research_lab_v96_core_profit_capture_screen as r1
import research_lab_v96_symbol_role_engine_screen as roles


def max_return_difference(left: list[dict], right: list[dict]) -> float:
    if len(left) != len(right):
        raise RuntimeError(f"length mismatch: {len(left)} != {len(right)}")
    return max(
        (
            abs(r1.finite(a.get("return")) - r1.finite(b.get("return")))
            for a, b in zip(left, right)
        ),
        default=0.0,
    )


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = roles.v95.v89.build_raw()
    baseline = roles.audit.build_exact_baseline(raw)
    empty_normal = roles.simulate([], raw, baseline, "normal")
    empty_severe = roles.simulate([], raw, baseline, "severe")
    evaluation_normal = max_return_difference(
        empty_normal["rows"], baseline["normalControlled"]
    )
    evaluation_severe = max_return_difference(
        empty_severe["rows"], baseline["severeControlled"]
    )
    passed = bool(evaluation_normal <= 1e-15 and evaluation_severe <= 1e-15)
    result = roles.core.rounded({
        "strategyId": "V96_ROLE_EVALUATION_PARITY_CHECK",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "EXACT_EVALUATION_PARITY" if passed else "EVALUATION_PARITY_FAILURE",
        "passed": passed,
        "evaluationPathParity": {
            "maximumNormalBarDifference": evaluation_normal,
            "maximumSevereBarDifference": evaluation_severe,
        },
        "weightReconstructionDiagnostic": baseline["baselineParity"],
        "interpretation": (
            "Candidate deltas are added to the exact controlled V96 return path. "
            "The separate weight reconstruction diagnostic is used only for symbol attribution "
            "and is not the candidate evaluation baseline."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-role-evaluation-parity-check.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Role Evaluation Parity Check",
        "",
        f"- Status: **{result['status']}**",
        f"- Exact evaluation Normal max difference: {result['evaluationPathParity']['maximumNormalBarDifference']}",
        f"- Exact evaluation Severe max difference: {result['evaluationPathParity']['maximumSevereBarDifference']}",
        f"- Weight reconstruction diagnostic Normal / Severe: {result['weightReconstructionDiagnostic']['maximumNormalBarDifference']} / {result['weightReconstructionDiagnostic']['maximumSevereBarDifference']}",
        "- Candidate deltas use the exact controlled baseline; reconstruction differences do not enter candidate returns.",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    markdown = "\n".join(report) + "\n"
    (state_dir / "v96-role-evaluation-parity-check.md").write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)
    if not passed:
        raise RuntimeError("V96 role evaluation path does not reproduce the exact baseline")


if __name__ == "__main__":
    main()
