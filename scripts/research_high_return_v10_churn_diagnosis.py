"""Instrumentation-only diagnosis for frozen V10/V9 trade stream.

No strategy thresholds, signals, weights, periods, costs or delays are changed.
Aggregates the existing frozen V9 simulation records by mode and transition type
to explain why the first V10 run failed. No Fresh OOS, VPS, LIVE or orders.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_high_return_portfolio_engine_v9 as v9


def transition_type(prev: dict[str, float], cur: dict[str, float]) -> str:
    if not prev and not cur:
        return "CASH_STAY"
    if not prev and cur:
        return "CASH_TO_ACTIVE"
    if prev and not cur:
        return "ACTIVE_TO_CASH"
    pkeys, ckeys = set(prev), set(cur)
    if pkeys == ckeys:
        same_sign = all((prev[s] > 0) == (cur[s] > 0) for s in pkeys)
        if same_sign:
            return "SAME_BOOK_RESIZE"
        return "DIRECTION_FLIP"
    overlap = pkeys & ckeys
    if overlap:
        return "PARTIAL_ROTATION"
    return "FULL_ROTATION"


def agg_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    modes: dict[str, dict[str, float]] = {}
    transitions: dict[str, dict[str, float]] = {}
    prev: dict[str, float] = {}
    for r in records:
        mode = str(r.get("mode", "UNKNOWN"))
        gross = sum(float(x.get("pnlPct", 0.0)) for x in r.get("legs", []))
        cost = float(r.get("costPct", 0.0))
        net = float(r.get("portfolioReturnPct", 0.0))
        turn = float(r.get("turnover", 0.0))
        m = modes.setdefault(mode, {"intervals": 0, "grossPnlPctPoints": 0.0, "costPctPoints": 0.0,
                                    "netPnlPctPoints": 0.0, "turnoverGrossUnits": 0.0, "positiveNetIntervals": 0})
        m["intervals"] += 1; m["grossPnlPctPoints"] += gross; m["costPctPoints"] += cost
        m["netPnlPctPoints"] += net; m["turnoverGrossUnits"] += turn
        if net > 0: m["positiveNetIntervals"] += 1

        cur = {str(k): float(v) for k, v in r.get("weights", {}).items()}
        t = transition_type(prev, cur)
        z = transitions.setdefault(t, {"intervals": 0, "grossPnlPctPoints": 0.0, "costPctPoints": 0.0,
                                       "netPnlPctPoints": 0.0, "turnoverGrossUnits": 0.0})
        z["intervals"] += 1; z["grossPnlPctPoints"] += gross; z["costPctPoints"] += cost
        z["netPnlPctPoints"] += net; z["turnoverGrossUnits"] += turn
        prev = cur
    for m in modes.values():
        n = max(1.0, float(m["intervals"]))
        m["netWinRatePct"] = 100.0 * float(m["positiveNetIntervals"]) / n
        m["avgGrossPnlPerIntervalPct"] = float(m["grossPnlPctPoints"]) / n
        m["avgCostPerIntervalPct"] = float(m["costPctPoints"]) / n
    return {"modes": modes, "transitions": transitions}


def main() -> None:
    candles, idx, _ = v9.v109.b.base.load()
    out: dict[str, Any] = {
        "researchLine": "V10_CHURN_MODE_DIAGNOSIS",
        "instrumentationOnly": True,
        "strategyChanged": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "periods": {},
    }
    for label, (start, end) in v9.PERIODS.items():
        run = v9.simulate(candles, idx, start, end, v9.NORMAL_BPS, 0)
        diag = agg_records(run["records"])
        gross = sum(float(v) for v in run["metrics"]["contributionPctPoints"].values())
        cost = float(run["metrics"]["turnoverGrossUnits"]) * v9.NORMAL_BPS / 100.0
        out["periods"][label] = {
            "metrics": run["metrics"],
            "grossContributionPctPoints": gross,
            "impliedCostPctPoints": cost,
            "arithmeticNetPctPoints": gross - cost,
            **diag,
        }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    p = root / "high-return-v10-churn-diagnosis.json"
    p.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
