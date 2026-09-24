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
    declared_universe = contract.get("symbols")
    symbols = sorted(declared_universe if declared_universe is not None else bars.keys())
    if any(symbol not in bars for symbol in symbols):
        raise ValueError("Q102_DECLARED_UNIVERSE_MISSING_RAW_SYMBOL")
    if not symbols:
        return []
    # Independent approximation only; this is NOT the Production Causal V4
    # family/variant selector. Align unequal inception histories by exact UTC.
    lookup = {
        symbol: {bar.ts_ms: bar for raw in bars[symbol] if (bar := coerce_bar(raw))}
        for symbol in symbols
    }
    hour_ms = 3_600_000
    signal_times = sorted(set().union(*(set(rows) for rows in lookup.values())))
    candidates: list[dict[str, Any]] = []
    for signal_ts in signal_times:
        scored: list[tuple[float, str, Bar]] = []
        for symbol in symbols:
            timeline = lookup[symbol]
            previous = timeline.get(signal_ts - hour_ms)
            signal = timeline.get(signal_ts)
            next_bar = timeline.get(signal_ts + hour_ms)
            if previous is None or signal is None or next_bar is None:
                continue
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
            "adapterModel": "SIMPLE_MOMENTUM_PROXY_NOT_CAUSAL_V4",
            "productionParity": False,
            "symbol": symbol,
            "side": "LONG",
            "signalTs": signal.ts_ms,
            "entryTs": signal.ts_ms + hour_ms,
            "featureSourceTs": signal.ts_ms,
            "score": score,
            "maximumPositions": maximum_positions,
            "requestedGross": maximum_gross,
            "acceptedGross": maximum_gross,
            "source": "raw-bars-time-aligned-independent-adapter",
        })
    return candidates

