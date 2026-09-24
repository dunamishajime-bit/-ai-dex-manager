from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .models import Bar, coerce_bar


def _score(previous: Bar, current: Bar) -> float:
    return (current.close / previous.close - 1.0) * 100.0


def generate_v12_candidates(bars: dict[str, list[Bar]], contract: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    """Generate V12 candidates from signal-bar momentum only.

    This adapter deliberately emits a candidate without a fill price.  The
    caller must provide the next-bar fill to normalize a trade, preventing a
    signal close from being reused as an execution price.
    """
    if not bars:
        return []
    top_n = int(contract.get("top_n", 3))
    rank3_gross = float(contract.get("rank3_gross", 0.10))
    rank3_minimum_score = float(contract.get("rank3_minimum_score", 0.70))
    per_position_cap = float(contract.get("per_position_gross_cap", 1.0))
    aggregate_cap = float(contract.get("aggregate_gross_cap", 2.0))
    declared_universe = contract.get("symbols")
    symbols = sorted(declared_universe if declared_universe is not None else bars.keys())
    if any(symbol not in bars for symbol in symbols):
        raise ValueError("V12_DECLARED_UNIVERSE_MISSING_RAW_SYMBOL")
    # Different market inception dates and missing candles must NEVER be
    # compared by list index. Rank only symbols with both aligned signal
    # and prior bars; fill strictly on that symbol's next aligned bar.
    lookup = {
        symbol: {bar.ts_ms: bar for raw in bars[symbol] if (bar := coerce_bar(raw))}
        for symbol in symbols
    }
    candidates: list[dict[str, Any]] = []
    signal_times = sorted(set().union(*(set(rows) for rows in lookup.values())))
    hour_ms = 3_600_000
    for signal_ts in signal_times:
        scored: list[tuple[float, str, Bar]] = []
        for symbol in symbols:
            timeline = lookup[symbol]
            previous = timeline.get(signal_ts - hour_ms)
            current = timeline.get(signal_ts)
            next_bar = timeline.get(signal_ts + hour_ms)
            if previous is None or current is None or next_bar is None:
                continue
            score = _score(previous, current)
            if score > 0:
                scored.append((score, symbol, current))
        scored.sort(key=lambda item: (-item[0], item[1]))
        gross_used = 0.0
        for rank, (score, symbol, signal_bar) in enumerate(scored[:top_n], start=1):
            requested = rank3_gross if rank == 3 else min(1.0, per_position_cap)
            if rank == 3 and score + 1e-9 < rank3_minimum_score:
                continue
            rejected = requested > per_position_cap or gross_used + requested > aggregate_cap
            accepted = 0.0 if rejected else requested
            rejection_reason = (
                "PER_POSITION_GROSS_CAP" if requested > per_position_cap
                else "AGGREGATE_GROSS_CAP" if rejected else None
            )
            gross_used += accepted
            candidates.append({
                "positionId": f"v12:{symbol}:{signal_bar.ts_ms}",
                "strategyId": "V12_X1.00_ALL",
                "mode": mode,
                "symbol": symbol,
                "side": "LONG",
                "signalTs": signal_bar.ts_ms,
                "entryTs": signal_bar.ts_ms + hour_ms,
                "featureSourceTs": signal_bar.ts_ms,
                "rank": rank,
                "score": score,
                "requestedGross": requested,
                "acceptedGross": accepted,
                "rejectionReason": rejection_reason,
                "signalClose": signal_bar.close,
                "source": "raw-bars-time-aligned-independent-adapter",
            })
    return candidates


def normalize_v12_trade(candidate: dict[str, Any], fill: dict[str, Any]) -> dict[str, Any]:
    signal_ts = int(candidate["signalTs"])
    entry_ts = int(fill["entryTs"])
    if entry_ts <= signal_ts:
        raise ValueError("V12 fill must occur strictly after the signal bar")
    if float(candidate.get("acceptedGross", 0.0)) <= 0:
        raise ValueError("cannot normalize a rejected V12 candidate")
    trade = dict(candidate)
    trade.update({"entryTs": entry_ts, "entryPrice": float(fill["entryPrice"]), "fillSource": "next-bar"})
    return trade


def run_v12_raw_rebuild(bundle_path: Path, output_path: Path) -> dict[str, Any]:
    payload = json.loads(bundle_path.read_text(encoding="utf-8"))
    bars = {symbol: [coerce_bar(row) for row in rows] for symbol, rows in payload.get("bars", {}).items()}
    contract = payload.get("contracts", {}).get("V12", {})
    candidates = generate_v12_candidates(bars, contract, payload.get("mode", "NORMAL"))
    result = {
        "source": "raw-bars",
        "sourceBundleSha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
        "candidateCount": len(candidates),
        "acceptedCandidateCount": sum(1 for candidate in candidates if candidate["acceptedGross"] > 0),
        "candidates": candidates,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    return result
