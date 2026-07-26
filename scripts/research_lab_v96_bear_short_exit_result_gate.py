from __future__ import annotations

import json
import os
from pathlib import Path


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    path = state_dir / "v96-bear-short-exit-bt.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["strategyId"] == "DISDEX_V96_BEAR_SHORT_FIXED_ENTRY_EXIT_OPTIMIZATION_BT"
    assert payload["method"]["fixedEntry"]["config_id"] == "BS25_H4_L20_M3_V090"
    assert len(payload["candidates"]) == 11
    assert payload["safety"] == {
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "ordersSent": False,
        "merged": False,
    }
    assert payload["baseline"]["combined"]["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
    for item in payload["candidates"]:
        assert item["combined"]["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        assert item["config"]["entry"]["config_id"] == "BS25_H4_L20_M3_V090"
    assert payload["status"] in {
        "NO_BEAR_SHORT_EXIT_DISCOVERY_PASS",
        "NO_BEAR_SHORT_EXIT_VALIDATION_PASS",
        "BEAR_SHORT_EXIT_2025_PASS_REUSED_2026_FAIL",
        "BEAR_SHORT_EXIT_HISTORICAL_LEAD_FORWARD_REQUIRED",
    }
    print(json.dumps({
        "status": payload["status"],
        "selected": payload["selectedOnDiscovery"]["config"]["config_id"] if payload["selectedOnDiscovery"] else None,
        "productionAuthorization": payload["resultGate"]["productionAuthorization"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
