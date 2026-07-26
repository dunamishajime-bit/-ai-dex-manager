from __future__ import annotations

import json
import os
from pathlib import Path


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    path = state_dir / "v96-bear-confirm-then-8h-bt.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["strategyId"] == "DISDEX_V96_BEAR_CONFIRMATION_THEN_8H_FALLBACK_BT"
    assert payload["stage1BearConfirmation"]["fixedEntry"]["config_id"] == "BS25_H4_L20_M3_V090"
    assert len(payload["stage1BearConfirmation"]["candidates"]) == 10
    if not payload["stage1BearConfirmation"]["successAcross2025AndReused2026"]:
        assert payload["stage2EightHour"]["ran"] is True
        assert len(payload["stage2EightHour"]["candidates"]) == 12
    assert payload["resultGate"]["productionAuthorization"] is False
    assert payload["safety"] == {
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "ordersSent": False,
        "merged": False,
    }
    assert payload["baseline"]["combined"]["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
    for item in payload["stage1BearConfirmation"]["candidates"]:
        assert item["combined"]["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
    for item in payload["stage2EightHour"]["candidates"]:
        assert item["combined"]["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
    print(json.dumps({
        "status": payload["status"],
        "stage2Ran": payload["stage2EightHour"]["ran"],
        "productionAuthorization": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
