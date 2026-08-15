"""Phase-Routed Long Ownership V14.

Clean-sheet response to V13 breadth-phase diagnosis; not V13 plus a threshold patch.

Frozen causal findings before this first V14 backtest:
- the V13 fixed-slot lifecycle solved most turnover/cost fragility;
- 3Y stable edge concentrated in DISPERSED x LONG and UP_PERSIST x LONG;
- trend-following SHORT in broad-down and SHORT in reversal phases was structurally
  negative, while a generic reversal-short hypothesis was rejected;
- the same phase categories were defined before V14 implementation from 24h/72h
  breadth and are applied uniformly across all pairs.

Architecture:
1. A market phase router has only two active engines:
   - UP_PERSIST: 72h breadth >=4/5 up and 24h breadth >=4/5 up.
   - DISPERSED: 72h breadth has neither >=4/5 up nor >=4/5 down.
   Other phases are explicit CASH/risk-off states.
2. Both active engines own LONG positions only, but pair ownership is independent:
   medium/long positive direction + positive cross-sectional relative persistence +
   above-median path efficiency. No pair-specific thresholds.
3. Entry requires the same engine+pair ownership to persist for two 6h observations.
4. Two fixed slots, 0.625 gross each (1.25 total maximum). No periodic resize,
   no strong-gross tier, no leverage increase to manufacture the return target.
5. Active slots are not replaced by rank. Exit requires two observations of either
   unsupported market phase or lost pair ownership; then the slot may refill.

No continuous parameter grid, no pair-specific params. BTC is reference-only and is
not used to force sign. Normal=10bps/delay0, Stress=30bps/delay1. Historical through
2026-07-01 is already-inspected DESIGN evidence only; no Fresh OOS, VPS, LIVE,
orders, deployment, or production mutation.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
DAY = 24 * HOUR
TRADE = ("ETH", "BNB", "SOL", "LINK", "AVAX")
ALL = ("BTC",) + TRADE
OBS_HOURS = 6
MAX_POSITIONS = 2
TOTAL_GROSS = 1.25
SLOT_GROSS = TOTAL_GROSS / MAX_POSITIONS
ENTRY_CONFIRMATIONS = 2
LOSS_CONFIRMATIONS = 2
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1

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


def vol(c, i, n):
    return v109.b.vol(c, i, n)


def eff(c, i, n):
    return v109.b.efficiency(c, i, n)


def scaled(r, vh, n):
    return 0.0 if r is None or vh <= 1e-12 else float(r) / (vh * math.sqrt(n) + 1e-12)


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


def market_phase(candles, idx, ts):
    up24, down24 = breadth_counts(candles, idx, ts, 24)
    up72, down72 = breadth_counts(candles, idx, ts, 72)
    if up72 >= 4 and up24 >= 4:
        return "UP_PERSIST"
    if up72 < 4 and down72 < 4:
        return "DISPERSED"
    return "RISK_OFF"


def cross_median(candles, idx, ts, n):
    xs = []
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = ret(candles[s], i, n)
        if r is not None:
            xs.append(float(r))
    return statistics.median(xs) if xs else 0.0


def ownership(candles, idx, ts, phase):
    if phase not in ("UP_PERSIST", "DISPERSED"):
        return {}
    med72 = cross_median(candles, idx, ts, 72)
    med168 = cross_median(candles, idx, ts, 168)
    raw = []
    efficiencies = []
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None or i < 900:
            continue
        c = candles[s]
        vh = vol(c, i, 168)
        if vh <= 1e-12:
            continue
        r72 = ret(c, i, 72)
        r168 = ret(c, i, 168)
        r336 = ret(c, i, 336)
        if r72 is None or r168 is None or r336 is None:
            continue
        z72 = scaled(r72, vh, 72)
        z168 = scaled(r168, vh, 168)
        z336 = scaled(r336, vh, 336)
        rel72 = scaled(float(r72) - med72, vh, 72)
        rel168 = scaled(float(r168) - med168, vh, 168)
        path = float(eff(c, i, 72))
        efficiencies.append(path)
        raw.append((s, z72, z168, z336, rel72, rel168, path))

    eff_med = statistics.median(efficiencies) if efficiencies else 0.0
    out = {}
    for s, z72, z168, z336, rel72, rel168, path in raw:
        # Common pair ownership: medium+long direction positive and relative edge positive.
        direction_alive = z72 > 0 and z168 > 0 and (z336 > 0 or z168 >= z72 * 0.5)
        relative_alive = rel72 > 0 and rel168 > 0
        own = direction_alive and relative_alive and path >= eff_med
        # Ranking only fills vacant slots; it never replaces an owner.
        strength = statistics.median((max(z72, 0.0), max(z168, 0.0), max(rel72, 0.0), max(rel168, 0.0)))
        out[s] = {"owned": bool(own), "strength": float(strength)}
    return out


def metric(rs, start, end):
    if not rs:
        return {"intervals": 0, "returnPct": 0.0, "cagrPct": 0.0, "pf": None, "pfWithoutBest": None, "maxDDPct": 0.0, "winRatePct": 0.0}
    equity = peak = 1.0
    dd = 0.0
    gain = loss = 0.0
    for r in rs:
        equity *= max(0.001, 1 + r / 100.0)
        peak = max(peak, equity)
        dd = min(dd, (equity / peak - 1) * 100.0)
        gain += max(0.0, r)
        loss += max(0.0, -r)
    years = max((end - start) / (365.25 * DAY), 1e-9)
    total = (equity - 1) * 100.0
    cagr = (equity ** (1 / years) - 1) * 100.0 if equity > 0 else -100.0
    pf = gain / loss if loss > 1e-12 else (999.0 if gain > 0 else None)
    best = max(range(len(rs)), key=rs.__getitem__)
    wo = rs[:best] + rs[best + 1 :]
    wg = sum(x for x in wo if x > 0)
    wl = abs(sum(x for x in wo if x < 0))
    pfwo = wg / wl if wl > 1e-12 else (999.0 if wg > 0 else None)
    return {
        "intervals": len(rs),
        "returnPct": total,
        "cagrPct": cagr,
        "pf": pf,
        "pfWithoutBest": pfwo,
        "maxDDPct": dd,
        "winRatePct": 100.0 * sum(x > 0 for x in rs) / len(rs),
        "bestIntervalPct": max(rs),
    }


def simulate(candles, idx, start, end, costbps, delay):
    times = [int(r["ts"]) for r in candles["BTC"] if start <= int(r["ts"]) < end][::OBS_HOURS]
    prev_phase = None
    prev_own = {}
    active = set()
    loss_count = {}
    returns = []
    turnover = 0.0
    contrib = {s: 0.0 for s in TRADE}
    entries = exits = 0
    active_intervals = 0
    phase_intervals = {"UP_PERSIST": 0, "DISPERSED": 0, "RISK_OFF": 0}

    for ts in times:
        phase = market_phase(candles, idx, ts)
        own = ownership(candles, idx, ts, phase)
        target = set(active)

        for s in list(active):
            alive = phase in ("UP_PERSIST", "DISPERSED") and bool(own.get(s, {}).get("owned"))
            loss_count[s] = 0 if alive else loss_count.get(s, 0) + 1
            if loss_count[s] >= LOSS_CONFIRMATIONS:
                target.discard(s)
                loss_count.pop(s, None)
                exits += 1

        vacancies = MAX_POSITIONS - len(target)
        if vacancies > 0 and phase in ("UP_PERSIST", "DISPERSED"):
            candidates = []
            for s, row in own.items():
                if s in target or not row["owned"]:
                    continue
                prev = prev_own.get(s)
                stable = prev_phase == phase and prev and prev.get("owned")
                if not stable:
                    continue
                candidates.append((row["strength"], s))
            candidates.sort(reverse=True)
            for _, s in candidates[:vacancies]:
                target.add(s)
                loss_count[s] = 0
                entries += 1

        tw = {s: SLOT_GROSS for s in target}
        aw = {s: SLOT_GROSS for s in active}
        interval = 0.0
        valid = True
        for s, w in tw.items():
            i = idx[s].get(ts)
            if i is None:
                valid = False
                break
            ei = i + 1 + delay
            xi = ei + OBS_HOURS
            if xi >= len(candles[s]) or int(candles[s][xi]["ts"]) >= end:
                valid = False
                break
            ep = float(candles[s][ei]["open"])
            xp = float(candles[s][xi]["open"])
            if ep <= 0:
                valid = False
                break
            pnl = w * (xp / ep - 1) * 100.0
            interval += pnl
            contrib[s] += pnl

        if not valid:
            prev_phase = phase
            prev_own = own
            continue

        universe = set(tw) | set(aw)
        tu = sum(abs(tw.get(s, 0.0) - aw.get(s, 0.0)) for s in universe)
        interval -= tu * costbps / 100.0
        turnover += tu
        phase_intervals[phase] += 1
        if tw:
            active_intervals += 1
        returns.append(interval)
        active = target
        prev_phase = phase
        prev_own = own

    m = metric(returns, start, end)
    m.update({
        "activeIntervals": active_intervals,
        "cashIntervalPct": 100.0 * (len(returns) - active_intervals) / len(returns) if returns else 100.0,
        "turnoverGrossUnits": turnover,
        "contributionPctPoints": contrib,
        "entries": entries,
        "exits": exits,
        "phaseIntervals": phase_intervals,
    })
    return m


def classify(normal, stress):
    labels = ("year1_2023_24", "year2_2024_25", "year3_2025_26")
    annual = [float(normal[x]["returnPct"]) for x in labels]
    stress_annual = [float(stress[x]["returnPct"]) for x in labels]
    c = normal["combined3Y"]
    cs = stress["combined3Y"]
    med = statistics.median(annual)
    mn = min(annual)
    cagr = float(c["cagrPct"])
    robust = (
        float(c.get("pf") or 0) >= 1.40
        and float(c.get("pfWithoutBest") or 0) >= 1.25
        and float(c["maxDDPct"]) >= -40
        and int(c["activeIntervals"]) >= 100
        and float(cs["cagrPct"]) >= 45
        and float(cs.get("pf") or 0) >= 1.08
        and float(cs.get("pfWithoutBest") or 0) >= 1.0
        and float(cs["maxDDPct"]) >= -50
        and sum(x > 0 for x in stress_annual) >= 2
        and min(stress_annual) > -25
    )
    floor = mn >= 80
    primary = floor and med >= 100 and cagr >= 100 and robust
    strong = min(annual) >= 100 and cagr >= 120 and robust
    status = (
        "ANNUAL_80_FLOOR_FAIL" if not floor
        else "BELOW_PENGU_CLASS_RETURN_STANDARD" if not (med >= 100 and cagr >= 100)
        else "RETURN_PASS_ROBUSTNESS_FAIL" if not robust
        else "STRONG_100PCT_PLUS_ANNUAL_CANDIDATE" if strong
        else "100PCT_CLASS_CANDIDATE"
    )
    return {
        "annualReturnPct": dict(zip(labels, annual)),
        "annualStressReturnPct": dict(zip(labels, stress_annual)),
        "minimumAnnualReturnPct": mn,
        "medianAnnualReturnPct": med,
        "combined3YCagrPct": cagr,
        "robustnessPass": bool(robust),
        "primaryCandidatePass": bool(primary),
        "strongCandidatePass": bool(strong),
        "status": status,
    }


def main():
    candles, idx, _ = v109.b.base.load()
    if END_2026 > hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")
    normal = {}
    stress = {}
    for label, (start, end) in PERIODS.items():
        normal[label] = simulate(candles, idx, start, end, NORMAL_BPS, 0)
        stress[label] = simulate(candles, idx, start, end, STRESS_BPS, STRESS_DELAY)
    cl = classify(normal, stress)
    out = {
        "researchLine": "PHASE_ROUTED_LONG_OWNERSHIP_V14",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "architecture": {
            "activeMarketPhases": ["DISPERSED", "UP_PERSIST"],
            "riskOffOtherwise": True,
            "longOnly": True,
            "pairSpecificParameters": False,
            "parameterGrid": False,
            "maxPositions": MAX_POSITIONS,
            "totalGrossResearchOnly": TOTAL_GROSS,
            "slotGrossResearchOnly": SLOT_GROSS,
            "entryConfirmations": ENTRY_CONFIRMATIONS,
            "lossConfirmations": LOSS_CONFIRMATIONS,
            "fixedSlots": True,
            "rankCanReplaceActiveOwner": False,
            "periodicResize": False,
            "leverageRaisedFromV13": False,
        },
        "returnStandard": {
            "minimumEveryYearPct": 80.0,
            "primaryMedianAnnualPct": 100.0,
            "primary3YCagrPct": 100.0,
            "strongMinimumEveryYearPct": 100.0,
            "strong3YCagrPct": 120.0,
            "eightyPctIsTarget": False,
            "guaranteed": False,
        },
        "periods": PERIODS,
        "normal": normal,
        "stress": stress,
        "classification": cl,
        "status": cl["status"],
        "nextAction": "FREEZE_AND_ONE_FRESH_OOS_TEST" if cl["primaryCandidatePass"] else "STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "phase-routed-long-ownership-v14.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
