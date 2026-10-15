#!/usr/bin/env python3
"""Read-only historical rejection audit. No orders, no production state changes.

Use: python3 scripts/research/v4-idle-rejection-decomposition-20261015.py
Outputs exact per-cost reject counts from source candidate decisions. This
does NOT treat rejected candidates as hypothetical profitable orders.
"""
from __future__ import annotations
import collections
import json
from pathlib import Path

ROOT = Path("docs/research/results/v4-production-cert-20261009/bt-baseline/"
            "cases/V2_M150_D05_CORE_NATIVE/runs")

def analyze(cost_bps: int) -> dict:
    path = ROOT / f"PRICE_MODEL_{cost_bps}BPS" / "candidate-decisions.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"Formal original candidate ledger missing: {path}")
    rows = (json.loads(line) for line in path.open(encoding="utf-8"))
    statuses: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    distinct: dict[str, set[str]] = collections.defaultdict(set)
    group_routes: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    samples: dict[str, list[dict]] = collections.defaultdict(list)
    for row in rows:
        strategy = str(row.get("strategy_id") or "UNKNOWN")
        decision = str(row.get("decision") or "")
        reason = str(row.get("reason") or "")
        status_key = "ACCEPTED" if decision == "ACCEPTED_MODELED_ENTRY" else f"{decision}:{reason}"
        statuses[strategy][status_key] += 1
        key = f"{strategy}:{reason}"
        if decision != "ACCEPTED_MODELED_ENTRY":
            distinct[key].add(str(row.get("candidate_id")))
            group_routes[key][str(row.get("route") or "NO_ROUTE")] += 1
            if len(samples[key]) < 3:
                samples[key].append({
                    "symbol": row.get("symbol"), "route": row.get("route"),
                    "decision_ts_ms": row.get("decision_ts_ms"),
                    "requested_gross": row.get("requested_gross"),
                })
    def detail(strategy: str, reason: str) -> dict:
        key = f"{strategy}:{reason}"
        return {"count": len(distinct[key]), "routeBreakdown": dict(group_routes[key].most_common()),
                "examples": samples[key]}
    return {"source": str(path), "costBps": cost_bps,
            "strategies": {k:dict(v) for k,v in statuses.items()},
            "v12": {
                "grossRoom": detail("V12","V12:NO_GROSS_ROOM"),
                "venueMinQuantity": detail("V12","V12:VENUE_MIN_QTY"),
                "venueMinNotional": detail("V12","V12:VENUE_MIN_NOTIONAL"),
                "oppositePosition": detail("V12","V12:OPPOSITE_SYMBOL_ACTIVE"),
            },
            "idle": {
                "quantityBlock": detail("IDLE","IDLE:FULL_1X_QUANTITY_BLOCK"),
                "capacityUnavailable": detail("IDLE","IDLE:FULL_1X_UNAVAILABLE"),
            },
            "tradingMutation":0, "ordersSent":0}
if __name__=="__main__":
    print(json.dumps([analyze(cost) for cost in (10,20,30)],ensure_ascii=False,indent=2))
