from __future__ import annotations

from typing import Any

from .models import Bar, coerce_bar


def generate_q102_candidates(raw_bundle: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    if raw_bundle.get("fixedCsvPlayback"):
        raise ValueError("FIXED_REPLAY_FORBIDDEN")
    contract = raw_bundle.get("contracts", {}).get("Q102", {})
    selector = contract.get("selector", "CAUSAL_V4")
    maximum_positions = int(contract.get("maximumPositions", 1))
    maximum_gross = float(contract.get("maximumGross", 3.0))
    bars = raw_bundle.get("bars", {})
    symbols = sorted(bars)
    if not symbols:
        return []
    max_index = min(len(bars[symbol]) for symbol in symbols) - 1
    candidates: list[dict[str, Any]] = []
    for index in range(1, max_index):
        scored: list[tuple[float, str, Bar]] = []
        for symbol in symbols:
            previous = coerce_bar(bars[symbol][index - 1])
            signal = coerce_bar(bars[symbol][index])
            score = (signal.close / previous.close - 1.0) * 100.0
            if score > 0:
                scored.append((score, symbol, signal))
        if not scored:
            continue
        score, symbol, signal = sorted(scored, key=lambda item: (-item[0], item[1]))[0]
        candidates.append({
            "positionId": f"q102:{symbol}:{signal.ts_ms}",
            "strategyId": "QUALITY102_CAUSAL_V1",
            "mode": mode,
            "selector": selector,
            "symbol": symbol,
            "side": "LONG",
            "signalTs": signal.ts_ms,
            "entryTs": coerce_bar(bars[symbol][index + 1]).ts_ms,
            "featureSourceTs": signal.ts_ms,
            "score": score,
            "maximumPositions": maximum_positions,
            "requestedGross": maximum_gross,
            "acceptedGross": maximum_gross,
            "source": "raw-bars",
        })
    return candidates

