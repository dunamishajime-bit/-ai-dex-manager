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
    symbols = sorted(bars)
    max_index = min(len(bars[symbol]) for symbol in symbols) - 1
    candidates: list[dict[str, Any]] = []
    for index in range(1, max_index):
        scored = []
        for symbol in symbols:
            previous = coerce_bar(bars[symbol][index - 1])
            current = coerce_bar(bars[symbol][index])
            score = _score(previous, current)
            if score > 0:
                scored.append((score, symbol, current))
        scored.sort(key=lambda item: (-item[0], item[1]))
        gross_used = 0.0
        for rank, (score, symbol, signal_bar) in enumerate(scored[:top_n], start=1):
            requested = rank3_gross if rank == 3 else min(1.0, per_position_cap)
            rejection_reason = None
            accepted = requested
            if rank == 3 and score + 1e-9 < rank3_minimum_score:
                continue
            elif requested > per_position_cap or gross_used + requested > aggregate_cap:
                accepted = 0.0
                rejection_reason = "AGGREGATE_GROSS_CAP" if gross_used + requested > aggregate_cap else "PER_POSITION_GROSS_CAP"
            if accepted:
                gross_used += accepted
            candidates.append({
                "positionId": f"v12:{symbol}:{signal_bar.ts_ms}",
                "strategyId": "V12_X1.00_ALL",
                "mode": mode,
                "symbol": symbol,
                "side": "LONG",
                "signalTs": signal_bar.ts_ms,
                "entryTs": coerce_bar(bars[symbol][index + 1]).ts_ms,
                "featureSourceTs": signal_bar.ts_ms,
                "rank": rank,
                "score": score,
                "requestedGross": requested,
                "acceptedGross": accepted,
                "rejectionReason": rejection_reason,
                "signalClose": signal_bar.close,
                "source": "raw-bars",
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
