from __future__ import annotations

import argparse
import json
import math
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import research_current_top2_pengu_v52_dca as sim

TARGET_MONTHS = ["2026-02", "2026-04", "2026-05", "2026-07"]


def f(v: Any, default: float = 0.0) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return x if math.isfinite(x) else default


def pengu_selector(diag: dict) -> tuple[str | None, dict | None]:
    baseline = diag["pengu"]["baseline"]
    qualified = []
    for name, row in diag["pengu"]["candidates"].items():
        deltas = [f(x["returnDeltaPct"]) for x in row["buckets"].values()]
        improves = sum(x > 0 for x in deltas)
        qualifies = (
            row["droppedHard"] >= 1
            and row["droppedTrail"] <= 1
            and f(row["normal"]["returnPct"]) > f(baseline["returnPct"])
            and f(row["stress"]["returnPct"]) > 0
            and min(deltas or [0]) >= -2.0
            and improves >= 2
        )
        if qualifies:
            score = min(deltas) + 0.25 * sum(deltas) + 2.0 * row["droppedHard"] - 3.0 * row["droppedTrail"]
            qualified.append((score, name, row))
    if not qualified:
        return None, None
    _score, name, row = max(qualified, key=lambda x: (x[0], x[1]))
    return name, row


def v50_selector(diag: dict) -> tuple[str | None, dict | None]:
    base_n = diag["v50Meta"]["baselineNormal"]
    base_s = diag["v50Meta"]["baselineSevere"]
    qualified = []
    for name, row in diag["v50Meta"]["candidates"].items():
        early_delta = f(row["early"]["filtered"]["returnPct"]) - f(row["early"]["baseline"]["returnPct"])
        late_delta = f(row["late"]["filtered"]["returnPct"]) - f(row["late"]["baseline"]["returnPct"])
        qualifies = (
            row["dropped"] >= 1
            and f(row["normal"]["returnPct"]) > f(base_n["returnPct"])
            and f(row["severe"]["returnPct"]) >= f(base_s["returnPct"]) - 1.0
            and early_delta >= -0.5
            and late_delta > 0
        )
        if qualifies:
            score = min(early_delta, late_delta) + 0.2 * (early_delta + late_delta)
            qualified.append((score, name, row))
    if not qualified:
        return None, None
    _score, name, row = max(qualified, key=lambda x: (x[0], x[1]))
    return name, row


def pkey(t: dict) -> tuple[str, int, int]:
    return (str(t.get("side")), int(t.get("signalTs", -1)), int(t.get("entryTs", -1)))


def skey(t: dict) -> tuple[str, int, int]:
    return (str(t.get("symbol")), int(t.get("entryTs", -1)), int(t.get("exitTs", -1)))


def filtered_pengu(rows: Sequence[dict], selected: dict | None) -> list[dict]:
    if not selected:
        return list(rows)
    drops = {(str(x[0]), int(x[1]), int(x[2])) for x in selected.get("droppedKeys", [])}
    return [t for t in rows if pkey(t) not in drops]


def filtered_v50(rows: Sequence[dict], selected: dict | None) -> list[dict]:
    if not selected:
        return list(rows)
    drops = {(str(x[0]), int(x[1]), int(x[2])) for x in selected.get("droppedKeys", [])}
    return [t for t in rows if skey(t) not in drops]


def merge_overlay(v12_rows: Sequence[dict], overlay_rows: Sequence[dict]) -> list[dict]:
    out = [dict(x) for x in v12_rows]
    for x in overlay_rows:
        row = dict(x)
        row["rank"] = 3
        row["requestedGross"] = min(0.50, max(0.0, f(row.get("requestedGross"), 0.50)))
        row["sourceSubstrategy"] = str(row.get("family") or "IDLE_OVERLAY")
        out.append(row)
    return sorted(out, key=lambda x: (int(x["entryTs"]), int(x.get("rank", 1)), str(x.get("symbol", ""))))


def compact(result: dict) -> dict:
    monthly = {x["month"]: x for x in result.get("monthly", [])}
    return {
        "endingAssetJpy": result.get("endingAssetJpy"),
        "netProfitJpy": result.get("netProfitJpy"),
        "returnOnContributedCapitalPct": result.get("returnOnContributedCapitalPct"),
        "timeWeightedReturnPct": result.get("timeWeightedReturnPct"),
        "xirrPct": result.get("xirrPct"),
        "maxDrawdownPct": result.get("maxDrawdownPct"),
        "trades": result.get("trades"),
        "winRatePct": result.get("winRatePct"),
        "profitFactor": result.get("profitFactor"),
        "monthlyTargets": {m: monthly.get(m) for m in TARGET_MONTHS},
        "sleeves": result.get("sleeves"),
        "routing": result.get("routing"),
        "grossVerification": result.get("grossVerification"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--v12", required=True)
    ap.add_argument("--pengu", required=True)
    ap.add_argument("--a-diagnostics", required=True)
    ap.add_argument("--b-result", required=True)
    ap.add_argument("--stock-cache", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    v12 = json.loads(Path(args.v12).read_text())
    pengu = json.loads(Path(args.pengu).read_text())
    adiag = json.loads(Path(args.a_diagnostics).read_text())
    bres = json.loads(Path(args.b_result).read_text())
    p_name, p_selected = pengu_selector(adiag)
    v50_name, v50_selected = v50_selector(adiag)
    bledger = (bres.get("currentIdleLedger") or {})
    b_promoted = bres.get("selection", {}).get("holdoutPromoted")

    v11, v50, _days, _diag = sim.build_stock(Path(args.stock_cache))
    scenarios = {}
    for scenario, cfg in sim.SCENARIOS.items():
        mode = str(cfg["ledgerMode"])
        base_v12 = list(v12["modes"][mode]["trades"])
        base_pengu = list(pengu["modes"][mode]["trades"])
        overlay = list(((bledger.get("modes") or {}).get(mode) or {}).get("trades") or []) if b_promoted else []
        p_filtered = filtered_pengu(base_pengu, p_selected)
        v50_filtered = filtered_v50(v50, v50_selected)
        cases = {
            "BASELINE": (base_v12, base_pengu, v50),
            "A_ONLY": (base_v12, p_filtered, v50_filtered),
            "B_ONLY": (merge_overlay(base_v12, overlay), base_pengu, v50),
            "A_PLUS_B": (merge_overlay(base_v12, overlay), p_filtered, v50_filtered),
        }
        scenarios[scenario] = {}
        for name, (vv, pp, ff) in cases.items():
            r = sim.simulate(vv, pp, v11, ff, float(cfg["stockCostBps"]))
            scenarios[scenario][name] = compact(r)

    payload = {
        "status": "PASS_RESEARCH_ONLY",
        "schema": "weak-month-ab-exact-dca-replay/v1",
        "period": {"startInclusive":"2025-08-01T00:00:00Z","endExclusive":"2026-08-01T00:00:00Z"},
        "capital": {"initialJpy":10000,"monthlyContributionJpy":10000,"totalContributedJpy":120000,"compounding":True},
        "trackA": {
            "penguSelected": p_name,
            "v50Selected": v50_name,
            "penguSelection": p_selected,
            "v50Selection": v50_selected,
            "rule": "entry-known candidates only; requires chronological bucket robustness; no exit reason can be a live predicate",
        },
        "trackB": {
            "preSelected": bres.get("selection", {}).get("preSelected"),
            "holdoutPromoted": b_promoted,
            "overlayNormalTrades": len(((bledger.get("modes") or {}).get("normal") or {}).get("trades") or []),
            "overlayStressTrades": len(((bledger.get("modes") or {}).get("stress") or {}).get("trades") or []),
        },
        "results": scenarios,
        "safety": {"mode":"RESEARCH_ONLY","ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
    }
    # Formal baseline parity guard: this prevents an A/B conclusion if the
    # replay silently diverges from the previously validated DCA run.
    baseline = payload["results"]["NORMAL"]["BASELINE"]
    if abs(f(baseline["endingAssetJpy"]) - 572544.35821388) > 2.0:
        raise RuntimeError(f"baseline parity failed: {baseline['endingAssetJpy']}")
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "status": payload["status"],
        "trackA": payload["trackA"],
        "trackB": payload["trackB"],
        "normal": payload["results"]["NORMAL"],
        "severe": payload["results"]["SEVERE"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
