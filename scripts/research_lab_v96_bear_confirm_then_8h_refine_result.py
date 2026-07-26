from __future__ import annotations

import json
import os
from pathlib import Path


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    json_path = state_dir / "v96-bear-confirm-then-8h-bt.json"
    md_path = state_dir / "v96-bear-confirm-then-8h-bt.md"
    payload = json.loads(json_path.read_text(encoding="utf-8"))

    stage2 = payload["stage2EightHour"]
    selected = stage2.get("selectedOnDiscovery")
    alternates = [
        item for item in stage2.get("candidates", [])
        if item.get("discoveryPass") and item.get("validationPass")
    ]
    alternates.sort(key=lambda item: (
        item["uplift"]["validation2025"]["severe"]["returnPctPoints"],
        item["uplift"]["validation2025"]["normal"]["returnPctPoints"],
        item["uplift"]["discovery2023_2024"]["severe"]["returnPctPoints"],
    ), reverse=True)
    best = alternates[0] if alternates else None
    stage2["validationPassAlternates"] = alternates
    stage2["descriptiveBestValidationAlternate"] = best

    if (
        stage2.get("ran")
        and selected is not None
        and not selected.get("validationPass")
        and best is not None
    ):
        payload["status"] = (
            "EIGHT_HOUR_DISCOVERY_SELECTED_FAILED_VALIDATION_ALTERNATE_ALL_WINDOWS_PASS"
            if best.get("reused2026Pass")
            else "EIGHT_HOUR_DISCOVERY_SELECTED_FAILED_VALIDATION_ALTERNATE_2025_PASS_REUSED_2026_FAIL"
        )

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if best is not None:
        u = best["uplift"]
        extra = [
            "",
            "## Descriptive 2025-validation alternate",
            "",
            f"- Config: `{best['config']['config_id']}`",
            "- Not selection-clean because the Discovery-ranked candidate was different.",
            f"- 2025 Normal/Severe uplift: `{u['validation2025']['normal']['returnPctPoints']:.4f}` / `{u['validation2025']['severe']['returnPctPoints']:.4f}` points",
            f"- Reused 2026H1 Normal/Severe uplift: `{u['reused2026H1']['normal']['returnPctPoints']:.4f}` / `{u['reused2026H1']['severe']['returnPctPoints']:.4f}` points",
        ]
        md_path.write_text(md_path.read_text(encoding="utf-8").rstrip() + "\n" + "\n".join(extra) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": payload["status"],
        "bestValidationAlternate": best["config"]["config_id"] if best else None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
