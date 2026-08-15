"""Instrumentation-only diagnosis for frozen Independent Relative Ownership V12.

No V12 signal, threshold, sizing, holding, period, source boundary, or qualification
rule is changed. This isolates the two Stress deltas already defined by V12:
transaction cost (10bps -> 30bps) and one 1h execution-delay bar (0 -> 1), then
attributes the frozen target path to ENTRY/HOLD/HANDOFF/EXIT/CASH transitions.
No Fresh OOS, VPS, LIVE, order, deployment, or production mutation.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import research_independent_relative_ownership_v12 as v12
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist


def _bucket():
    return {
        "count": 0,
        "grossDelay0PctPoints": 0.0,
        "grossDelay1PctPoints": 0.0,
        "turnoverGrossUnits": 0.0,
        "normal10bpsDelay0PctPoints": 0.0,
        "costOnly30bpsDelay0PctPoints": 0.0,
        "delayOnly10bpsDelay1PctPoints": 0.0,
        "stress30bpsDelay1PctPoints": 0.0,
    }


def _trace(candles, idx, start, end):
    times = [int(r["ts"]) for r in candles["BTC"] if start <= int(r["ts"]) < end][::v12.OBS_HOURS]
    prev_rows = []
    active = {}
    loss = {}
    transitions = defaultdict(_bucket)
    pair_side = defaultdict(_bucket)

    for ts in times:
        rows = v12.ownership_scores(candles, idx, ts)
        cands = v12.stable_candidates(prev_rows, rows) if prev_rows else []
        desired = v12.target_from_candidates(cands, v12.btc_context(candles, idx, ts))
        target = dict(active)
        transition = "CASH"

        if not active:
            if desired:
                target = desired
                transition = "ENTRY"
        else:
            curmap = {s: 1 if w > 0 else -1 for s, w in active.items()}
            dmap = {s: 1 if w > 0 else -1 for s, w in desired.items()}
            for s, side in curmap.items():
                alive = s in dmap and dmap[s] == side
                loss[s] = 0 if alive else loss.get(s, 0) + 1
            must_change = any(loss.get(s, 0) >= 2 for s in curmap)
            if must_change:
                if desired:
                    target = desired
                    transition = "HANDOFF"
                else:
                    target = {}
                    transition = "EXIT"
                loss = {}
            else:
                target = dict(active)
                transition = "HOLD"

        gross = {0: 0.0, 1: 0.0}
        per_leg = {0: {}, 1: {}}
        valid = True
        for s, w in target.items():
            i = idx[s].get(ts)
            if i is None:
                valid = False
                break
            for delay in (0, 1):
                ei = i + 1 + delay
                xi = ei + v12.OBS_HOURS
                if xi >= len(candles[s]) or int(candles[s][xi]["ts"]) >= end:
                    valid = False
                    break
                ep = float(candles[s][ei]["open"])
                xp = float(candles[s][xi]["open"])
                if ep <= 0:
                    valid = False
                    break
                ar = (xp / ep - 1) * 100.0
                pnl = w * ar
                gross[delay] += pnl
                per_leg[delay][s] = pnl
            if not valid:
                break

        if not valid:
            prev_rows = rows
            continue

        universe = set(active) | set(target)
        turnover = sum(abs(target.get(s, 0.0) - active.get(s, 0.0)) for s in universe)
        vals = {
            "grossDelay0PctPoints": gross[0],
            "grossDelay1PctPoints": gross[1],
            "turnoverGrossUnits": turnover,
            "normal10bpsDelay0PctPoints": gross[0] - turnover * 10.0 / 100.0,
            "costOnly30bpsDelay0PctPoints": gross[0] - turnover * 30.0 / 100.0,
            "delayOnly10bpsDelay1PctPoints": gross[1] - turnover * 10.0 / 100.0,
            "stress30bpsDelay1PctPoints": gross[1] - turnover * 30.0 / 100.0,
        }
        b = transitions[transition]
        b["count"] += 1
        for k, v in vals.items():
            b[k] += v

        for s, w in target.items():
            key = f"{s}_{'LONG' if w > 0 else 'SHORT'}"
            pb = pair_side[key]
            pb["count"] += 1
            leg_turnover = abs(target.get(s, 0.0) - active.get(s, 0.0))
            g0 = per_leg[0].get(s, 0.0)
            g1 = per_leg[1].get(s, 0.0)
            pb["grossDelay0PctPoints"] += g0
            pb["grossDelay1PctPoints"] += g1
            pb["turnoverGrossUnits"] += leg_turnover
            pb["normal10bpsDelay0PctPoints"] += g0 - leg_turnover * 10.0 / 100.0
            pb["costOnly30bpsDelay0PctPoints"] += g0 - leg_turnover * 30.0 / 100.0
            pb["delayOnly10bpsDelay1PctPoints"] += g1 - leg_turnover * 10.0 / 100.0
            pb["stress30bpsDelay1PctPoints"] += g1 - leg_turnover * 30.0 / 100.0

        active = target
        prev_rows = rows

    return {
        "transitions": dict(sorted(transitions.items())),
        "pairSide": dict(sorted(pair_side.items())),
    }


def _variant_summary(candles, idx, start, end):
    variants = {
        "normal_10bps_delay0": v12.simulate(candles, idx, start, end, 10.0, 0),
        "cost_only_30bps_delay0": v12.simulate(candles, idx, start, end, 30.0, 0),
        "delay_only_10bps_delay1": v12.simulate(candles, idx, start, end, 10.0, 1),
        "stress_30bps_delay1": v12.simulate(candles, idx, start, end, 30.0, 1),
    }
    n = variants["normal_10bps_delay0"]
    return {
        "variants": variants,
        "returnDeltaVsNormalPct": {
            "costOnly": variants["cost_only_30bps_delay0"]["returnPct"] - n["returnPct"],
            "delayOnly": variants["delay_only_10bps_delay1"]["returnPct"] - n["returnPct"],
            "stress": variants["stress_30bps_delay1"]["returnPct"] - n["returnPct"],
        },
        "trace": _trace(candles, idx, start, end),
    }


def main():
    candles, idx, _ = v109.b.base.load()
    if v12.END_2026 > hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")
    periods = {}
    for label, (start, end) in v12.PERIODS.items():
        periods[label] = _variant_summary(candles, idx, start, end)
    out = {
        "researchLine": "V12_LATENCY_COST_TRANSITION_DIAGNOSIS",
        "researchOnly": True,
        "instrumentationOnly": True,
        "v12Changed": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "diagnosticComparisonsOnly": [
            "10bps_delay0",
            "30bps_delay0",
            "10bps_delay1",
            "30bps_delay1",
        ],
        "periods": periods,
        "nextAction": "STRUCTURAL_DIAGNOSIS_ONLY_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "v12-latency-cost-transition-diagnosis.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
