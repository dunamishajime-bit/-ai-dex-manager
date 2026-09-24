from __future__ import annotations

from copy import deepcopy
from typing import Any

from .models import Bar, Funding, coerce_bar


HOUR_MS = 3_600_000


def _return_pct(previous: Bar, current: Bar) -> float:
    return (current.close / previous.close - 1.0) * 100.0


def generate_pengu_candidates(bars: dict[str, list[Bar]], funding: list[Funding], mode: str) -> list[dict[str, Any]]:
    """Create COMBINED_FILTERED candidates from PENGU raw bars.

    Funding is accepted as an explicit input for provenance and is joined by
    the integrated engine before settlement; it is never used from a future
    timestamp by this signal adapter.
    """
    rows = bars.get("PENGUUSDT", [])
    if len(rows) < 3:
        return []
    candidates: list[dict[str, Any]] = []
    for index in range(1, len(rows) - 1):
        previous = coerce_bar(rows[index - 1])
        signal = coerce_bar(rows[index])
        momentum = _return_pct(previous, signal)
        if momentum == 0:
            continue
        route = "SHORT_V20" if momentum < 0 else "BASE_V64_LONG"
        if momentum > 0 and index >= 2:
            prior_return = _return_pct(coerce_bar(rows[index - 2]), previous)
            if prior_return < 0:
                route = "RECOVERY_V8"
        candidates.append({
            "positionId": f"pengu:{route}:{signal.ts_ms}",
            "strategyId": "PENGU_DUAL_LS_V2_FINAL",
            "logic": "COMBINED_FILTERED",
            "mode": mode,
            "symbol": signal.symbol,
            "side": "SHORT" if route == "SHORT_V20" else "LONG",
            "route": route,
            "signalTs": signal.ts_ms,
            "entryTs": coerce_bar(rows[index + 1]).ts_ms,
            "featureSourceTs": signal.ts_ms,
            "signalBasis": momentum,
            "requestedGross": 1.0,
            "acceptedGross": 1.0,
            "fundingInputCount": len(funding),
            "source": "raw-bars",
        })
    return candidates


def apply_pengu_q60_dd17_h72(state: dict[str, Any], closed_trade: dict[str, Any]) -> dict[str, Any]:
    """Advance Q60/DD17 state only for an accepted, filled, closed trade."""
    if not all(bool(closed_trade.get(key)) for key in ("accepted", "filled", "closed")):
        return state
    result = deepcopy(state)
    result.setdefault("routeQuarantineUntil", {})
    current_equity = float(result.get("realizedEquity", result.get("startingEquity", 0.0)))
    peak_equity = float(result.get("peakRealizedEquity", current_equity))
    new_equity = current_equity + float(closed_trade.get("pnl", 0.0))
    peak_equity = max(peak_equity, new_equity)
    result["realizedEquity"] = new_equity
    result["peakRealizedEquity"] = peak_equity
    result["lastClosedTradeTs"] = int(closed_trade.get("exitTs", 0))
    if closed_trade.get("exitReason") == "HARD_STOP":
        route = str(closed_trade["route"])
        result["routeQuarantineUntil"][route] = int(closed_trade["exitTs"]) + 60 * HOUR_MS
    drawdown = (new_equity - peak_equity) / peak_equity if peak_equity else 0.0
    result["realizedDrawdown"] = drawdown
    if drawdown <= -0.17:
        hold_until = int(closed_trade["exitTs"]) + 72 * HOUR_MS
        result["governorHoldUntil"] = max(int(result.get("governorHoldUntil", 0)), hold_until)
    result["newEntriesPaused"] = int(result.get("governorHoldUntil", 0)) > int(closed_trade.get("exitTs", 0))
    return result


def normalize_pengu_trade(candidate: dict[str, Any], fill: dict[str, Any]) -> dict[str, Any]:
    if int(fill["entryTs"]) <= int(candidate["signalTs"]):
        raise ValueError("PENGU fill must occur strictly after the signal bar")
    if float(candidate.get("acceptedGross", 0.0)) <= 0:
        raise ValueError("cannot normalize a rejected PENGU candidate")
    result = dict(candidate)
    result.update({"entryTs": int(fill["entryTs"]), "entryPrice": float(fill["entryPrice"]), "fillSource": "next-bar"})
    return result

