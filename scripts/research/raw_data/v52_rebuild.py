from __future__ import annotations

from typing import Any


THRESHOLDS = {
    "basisBps": 60,
    "convergenceBps": 20,
    "stopMultiple": 1.75,
    "netEdgeBps": 7.5,
    "maxCostBps": 60,
    "maxSpreadBps": 20,
}


def _reject(row: dict[str, Any]) -> str | None:
    if float(row.get("basis_bps", 0.0)) < 60:
        return "BASIS_BELOW_60BPS"
    if float(row.get("convergence_bps", 0.0)) < 20:
        return "CONVERGENCE_BELOW_20BPS"
    if float(row.get("net_edge_bps", 0.0)) < 7.5:
        return "NET_EDGE_BELOW_7_5BPS"
    if float(row.get("spread_bps", 0.0)) > 20:
        return "SPREAD_ABOVE_20BPS"
    if float(row.get("estimated_round_trip_cost_bps", 0.0)) > 60:
        return "ROUND_TRIP_COST_ABOVE_60BPS"
    return None


def generate_v52_candidates(stock_bars: dict[str, list[dict[str, Any]]], mode: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for symbol in sorted(stock_bars):
        for row in stock_bars[symbol]:
            strategy = str(row.get("strategy", "V50_POST_OPEN_BASIS"))
            rejection = _reject(row) if strategy != "V11_EQ" else None
            candidates.append({
                "positionId": f"v52:{strategy}:{symbol}:{int(row['ts_ms'])}",
                "strategy": strategy,
                "signalFamily": "V11" if strategy == "V11_EQ" else "V50",
                "mode": mode,
                "symbol": symbol,
                "signalTs": int(row["ts_ms"]),
                "window": "POST_EARLY3",
                "requestedGross": 2.0,
                "acceptedGross": 2.0 if rejection is None else 0.0,
                "accepted": rejection is None,
                "rejectionReason": rejection,
                "thresholds": dict(THRESHOLDS),
                "maxHoldHours": 3,
                "source": "raw-stock-bars",
                "telemetry": {
                    "basisBps": float(row.get("basis_bps", 0.0)),
                    "netEdgeBps": float(row.get("net_edge_bps", 0.0)),
                    "estimatedRoundTripCostBps": float(row.get("estimated_round_trip_cost_bps", 0.0)),
                    "spreadBps": float(row.get("spread_bps", 0.0)),
                },
            })
    return candidates

