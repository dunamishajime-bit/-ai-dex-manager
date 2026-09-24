from __future__ import annotations

from typing import Any

from .models import Bar, coerce_bar


def generate_fet_candidates(raw_bundle: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    rows = raw_bundle.get("bars", {}).get("FETUSDT", [])
    candidates: list[dict[str, Any]] = []
    for index in range(1, len(rows) - 1):
        previous = coerce_bar(rows[index - 1])
        signal = coerce_bar(rows[index])
        momentum = (signal.close / previous.close - 1.0) * 100.0
        if momentum <= 0:
            continue
        candidates.append({
            "positionId": f"fet:{signal.ts_ms}",
            "strategyId": "FET_BRK48_RESIDUAL",
            "mode": mode,
            "symbol": signal.symbol,
            "side": "LONG",
            "signalTs": signal.ts_ms,
            "entryTs": coerce_bar(rows[index + 1]).ts_ms,
            "featureSourceTs": signal.ts_ms,
            "requestedGross": 2.25,
            "acceptedGross": 2.25,
            "priority": 3,
            "preemptible": True,
            "source": "raw-bars",
        })
    return candidates

