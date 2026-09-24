from __future__ import annotations

import hashlib
import json
from typing import Any


def result_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def drawdown_intervals(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    intervals: list[dict[str, Any]] = []
    peak_value: float | None = None
    peak_ts: Any = None
    active: dict[str, Any] | None = None
    for point in points:
        equity = float(point["equity"])
        ts = point["ts"]
        if peak_value is None or equity >= peak_value:
            if active is not None:
                active["recoveryTs"] = ts
                intervals.append(active)
                active = None
            peak_value = equity
            peak_ts = ts
            continue
        dd_pct = (equity / peak_value - 1.0) * 100.0
        if active is None:
            active = {"peakTs": peak_ts, "troughTs": ts, "troughEquity": equity, "peakEquity": peak_value, "drawdownPct": dd_pct, "recoveryTs": None}
        elif equity < float(active["troughEquity"]):
            active["troughTs"] = ts
            active["troughEquity"] = equity
            active["drawdownPct"] = dd_pct
    if active is not None:
        intervals.append(active)
    return intervals


def monthly_equity(points: list[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for point in points:
        month = str(point["ts"])[:7]
        result[month] = float(point["equity"])
    return result


def build_audit_report(result: dict[str, Any]) -> dict[str, Any]:
    trades = list(result.get("trades", []))
    extreme = [trade for trade in trades if abs(float(trade.get("accountReturn", 0.0))) >= 1.0]
    largest = max((float(trade.get("pnl", 0.0)) for trade in trades), default=0.0)
    points = list(result.get("equityTimeline", []))
    return {
        "extremeReturns": extreme,
        "largestTradeContribution": largest,
        "drawdownIntervals": drawdown_intervals(points),
        "monthlyEquity": monthly_equity(points),
        "resultHash": result_hash(result),
        "tradeCount": len(trades),
    }

