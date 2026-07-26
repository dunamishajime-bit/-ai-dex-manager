from __future__ import annotations

import json
import os
from pathlib import Path


def close(left: float, right: float, tolerance: float = 0.02) -> bool:
    return abs(float(left) - float(right)) <= tolerance


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    path = state_dir / "v96-flat-fallback-entry-bt.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["strategyId"] == "DISDEX_V96_FLAT_ONLY_FALLBACK_ENTRY_BT"
    assert payload["method"]["fallbackScope"].startswith("Fallback can hold exposure only")
    assert payload["method"]["causality"].startswith("Signal uses one completed 12h bar")
    assert set(payload["families"]) == {"pullbackLong", "breakoutLong", "bearAltShort"}
    assert payload["resultGate"]["productionAuthorization"] is False
    assert payload["safety"] == {
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "ordersSent": False,
        "merged": False,
    }
    assert payload["status"] in {
        "NO_FALLBACK_FAMILY_VALIDATION_PASS",
        "V96_FALLBACK_HISTORICAL_LEAD_FORWARD_REQUIRED",
        "V96_FALLBACK_VALIDATION_LEAD_REUSED_2026_NOT_CONFIRMED",
    }

    baseline = payload["baseline"]
    full = baseline["windows"]["full"]
    assert close(full["normal"]["compoundedReturnPct"], 1353.6042)
    assert close(full["normal"]["maxDrawdownPct"], -30.2022)
    assert close(full["severe"]["compoundedReturnPct"], 435.2929)
    assert close(full["severe"]["maxDrawdownPct"], -46.7186)
    assert baseline["orders"]["officialOrderEvents"] == 351
    assert full["normal"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
    assert full["severe"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9

    leader = payload.get("observedLeader")
    if leader is not None:
        assert leader["discoveryPass"] is True
        assert leader["validationPass"] is True
        assert leader["windows"]["full"]["normal"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        assert leader["windows"]["full"]["severe"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        assert payload["stress"] is not None

    print(json.dumps({
        "status": payload["status"],
        "leader": leader["config"]["config_id"] if leader else None,
        "baselineFullReturnPct": full["normal"]["compoundedReturnPct"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
