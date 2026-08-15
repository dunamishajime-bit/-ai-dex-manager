"""Raw regime opportunity map after V14 failure.

Instrumentation/research diagnosis only. No strategy candidate is modified or traded.
Four structural motifs are frozen before reading this diagnosis:
1) LEADER_CONTINUATION_LONG  - strongest 72h alt, follow long.
2) LAGGARD_REVERSAL_LONG     - weakest 72h alt, fade the decline long.
3) LAGGARD_CONTINUATION_SHORT- weakest 72h alt, follow short.
4) LEADER_REVERSAL_SHORT     - strongest 72h alt, fade the rise short.

For each fixed 24h/72h breadth phase, evaluate two structurally distinct horizons only:
6h immediate ownership and 24h episode ownership. This is not a parameter grid.
Normal diagnostic cost is a full 10bps/side round trip (20bps total); Stress is
30bps/side plus one-hour entry delay (60bps total). Results are descriptive
mean/median/PF/win-rate by non-overlapping historical year and combined 3Y.
No Fresh OOS, pair-specific threshold, VPS, LIVE, orders, deployment, or production.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
TRADE = ("ETH", "BNB", "SOL", "LINK", "AVAX")
OBS_HOURS = 6
HORIZONS = (6, 24)
MOTIFS = (
    "LEADER_CONTINUATION_LONG",
    "LAGGARD_REVERSAL_LONG",
    "LAGGARD_CONTINUATION_SHORT",
    "LEADER_REVERSAL_SHORT",
)
START_2023 = hist.jst08(2023, 7, 1)
START_2024 = hist.jst08(2024, 7, 1)
START_2025 = hist.jst08(2025, 7, 1)
END_2026 = hist.jst08(2026, 7, 1)
PERIODS = {
    "year1_2023_24": (START_2023, START_2024),
    "year2_2024_25": (START_2024, START_2025),
    "year3_2025_26": (START_2025, END_2026),
    "combined3Y": (START_2023, END_2026),
}


def ret(c, i, n):
    return v109.b.ret(c, i, n)


def breadth_counts(candles, idx, ts, n):
    up = down = 0
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = ret(candles[s], i, n)
        if r is None:
            continue
        up += r > 0
        down += r < 0
    return int(up), int(down)


def phase(candles, idx, ts):
    p24, n24 = breadth_counts(candles, idx, ts, 24)
    p72, n72 = breadth_counts(candles, idx, ts, 72)
    if p72 >= 4:
        if p24 >= 4:
            return "UP_PERSIST"
        if n24 >= 3:
            return "UP_REVERSING"
        return "UP_WEAKENING"
    if n72 >= 4:
        if n24 >= 4:
            return "DOWN_PERSIST"
        if p24 >= 3:
            return "DOWN_REVERSING"
        return "DOWN_WEAKENING"
    return "DISPERSED"


def ranked_72h(candles, idx, ts):
    rows = []
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = ret(candles[s], i, 72)
        if r is None:
            continue
        rows.append((float(r), s))
    rows.sort(reverse=True)
    return rows


def forward_return(candles, idx, symbol, ts, horizon, delay):
    i = idx[symbol].get(ts)
    if i is None:
        return None
    ei = i + 1 + delay
    xi = ei + horizon
    if xi >= len(candles[symbol]):
        return None
    ep = float(candles[symbol][ei]["open"])
    xp = float(candles[symbol][xi]["open"])
    if ep <= 0:
        return None
    return (xp / ep - 1.0) * 100.0


def summarize(xs):
    if not xs:
        return {"count": 0, "meanPct": None, "medianPct": None, "pf": None, "winRatePct": None, "sumPctPoints": 0.0}
    gains = sum(max(0.0, x) for x in xs)
    losses = sum(max(0.0, -x) for x in xs)
    pf = gains / losses if losses > 1e-12 else (999.0 if gains > 0 else None)
    return {
        "count": len(xs),
        "meanPct": statistics.mean(xs),
        "medianPct": statistics.median(xs),
        "pf": pf,
        "winRatePct": 100.0 * sum(x > 0 for x in xs) / len(xs),
        "sumPctPoints": sum(xs),
    }


def diagnose_period(candles, idx, start, end):
    samples = defaultdict(lambda: {"gross": [], "normal": [], "stress": []})
    times = [int(r["ts"]) for r in candles["BTC"] if start <= int(r["ts"]) < end][::OBS_HOURS]
    for ts in times:
        ph = phase(candles, idx, ts)
        ranked = ranked_72h(candles, idx, ts)
        if len(ranked) < len(TRADE):
            continue
        leader = ranked[0][1]
        laggard = ranked[-1][1]
        motif_leg = {
            "LEADER_CONTINUATION_LONG": (leader, 1.0),
            "LAGGARD_REVERSAL_LONG": (laggard, 1.0),
            "LAGGARD_CONTINUATION_SHORT": (laggard, -1.0),
            "LEADER_REVERSAL_SHORT": (leader, -1.0),
        }
        for horizon in HORIZONS:
            for motif, (symbol, side) in motif_leg.items():
                g0 = forward_return(candles, idx, symbol, ts, horizon, 0)
                g1 = forward_return(candles, idx, symbol, ts, horizon, 1)
                if g0 is None or g1 is None:
                    continue
                gross = side * g0
                # full round-trip cost: 10bps/side Normal, 30bps/side Stress.
                normal = gross - 0.20
                stress = side * g1 - 0.60
                key = (ph, motif, horizon)
                samples[key]["gross"].append(gross)
                samples[key]["normal"].append(normal)
                samples[key]["stress"].append(stress)

    out = {}
    for (ph, motif, horizon), vals in sorted(samples.items()):
        out.setdefault(ph, {}).setdefault(motif, {})[f"{horizon}h"] = {
            "gross": summarize(vals["gross"]),
            "normalRoundTrip": summarize(vals["normal"]),
            "stressDelay1RoundTrip": summarize(vals["stress"]),
        }
    return out


def main():
    candles, idx, _ = v109.b.base.load()
    if END_2026 > hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")
    periods = {label: diagnose_period(candles, idx, a, b) for label, (a, b) in PERIODS.items()}
    out = {
        "researchLine": "REGIME_OPPORTUNITY_MAP_V15_DIAGNOSIS",
        "researchOnly": True,
        "instrumentationOnly": True,
        "strategyChanged": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "motifsFrozenBeforeResults": list(MOTIFS),
        "horizonsFrozenBeforeResultsHours": list(HORIZONS),
        "normalRoundTripCostPct": 0.20,
        "stressRoundTripCostPct": 0.60,
        "periods": periods,
        "nextAction": "SELECT_ONLY_MULTIYEAR_REPRODUCIBLE_CAUSAL_MOTIF_FOR_CLEAN_SHEET_V15",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "regime-opportunity-map-v15-diagnosis.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
