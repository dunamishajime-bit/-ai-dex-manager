"""Independent Ownership Episodes V13.

Clean-sheet structural response to the frozen V12 diagnosis, not a threshold retune.

Observed causal failure in V12:
- HOLD was the dominant positive transition class;
- ENTRY/EXIT and especially repeated HANDOFF turnover consumed the edge;
- the official one-hour Stress delay was not the dominant failure; 30bps cost was.

V13 therefore changes the ownership lifecycle itself:
- each pair independently forms a multi-horizon directional ownership state;
- entry needs common multi-horizon sign agreement, cross-sectional relative
  agreement, above-median path efficiency, and persistence across two observations;
- active positions are NEVER replaced merely because another pair ranks higher;
- each active pair owns a fixed slot and remains unchanged while its medium/long
  directional structure survives; rank/relative drift alone cannot force exit;
- exit requires structural ownership loss for two observations;
- vacant slots may be filled by newly persistent candidates; opposite directions
  may coexist; no portfolio-wide BTC direction forcing;
- fixed slot size; no periodic resizing and no strong-gross tier.

All rules are common across ETH/BNB/SOL/LINK/AVAX; no pair-specific parameters or
continuous parameter grid. BTC is reference context only and does not force sign.
Normal=10bps/delay0; Stress=30bps/delay1. Historical through 2026-07-01 is already
inspected DESIGN evidence only: no Fresh OOS, VPS, LIVE, orders, deployment, or
production mutation.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

import research_independent_relative_ownership_v12 as v12
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
DAY = 24 * HOUR
TRADE = ("ETH", "BNB", "SOL", "LINK", "AVAX")
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
OBS_HOURS = 6
MAX_POSITIONS = 2
TOTAL_GROSS = 1.25
SLOT_GROSS = TOTAL_GROSS / MAX_POSITIONS
LOSS_CONFIRMATIONS = 2
ENTRY_CONFIRMATIONS = 2

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


def _sign(x):
    return 1 if x > 0 else -1 if x < 0 else 0


def _scaled(c, i, n, vh):
    r = v12.ret(c, i, n)
    if r is None or vh <= 1e-12:
        return 0.0
    return float(r) / (vh * math.sqrt(n) + 1e-12)


def _cross_median(candles, idx, ts, n):
    xs = []
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = v12.ret(candles[s], i, n)
        if r is not None:
            xs.append(float(r))
    return statistics.median(xs) if xs else 0.0


def states(candles, idx, ts):
    med72 = _cross_median(candles, idx, ts, 72)
    med168 = _cross_median(candles, idx, ts, 168)
    raw = []
    efficiencies = []
    for s in TRADE:
        i = idx[s].get(ts)
        if i is None or i < 900:
            continue
        c = candles[s]
        vh = v12.vol(c, i, 168)
        if vh <= 1e-12:
            continue
        z24 = _scaled(c, i, 24, vh)
        z72 = _scaled(c, i, 72, vh)
        z168 = _scaled(c, i, 168, vh)
        z336 = _scaled(c, i, 336, vh)
        r72 = v12.ret(c, i, 72) or 0.0
        r168 = v12.ret(c, i, 168) or 0.0
        rel72 = (float(r72) - med72) / (vh * math.sqrt(72) + 1e-12)
        rel168 = (float(r168) - med168) / (vh * math.sqrt(168) + 1e-12)
        efficiency = float(v12.eff(c, i, 72))
        efficiencies.append(efficiency)
        raw.append((s, z24, z72, z168, z336, rel72, rel168, efficiency))

    eff_median = statistics.median(efficiencies) if efficiencies else 0.0
    out = {}
    for s, z24, z72, z168, z336, rel72, rel168, efficiency in raw:
        votes = [_sign(z24), _sign(z72), _sign(z168), _sign(z336)]
        pos = sum(v == 1 for v in votes)
        neg = sum(v == -1 for v in votes)
        side = 1 if pos >= 3 and z72 > 0 and z168 > 0 else -1 if neg >= 3 and z72 < 0 and z168 < 0 else 0
        relative_side = _sign(rel72 + rel168)
        entry_eligible = side != 0 and relative_side == side and efficiency >= eff_median
        strength = statistics.median([abs(z72), abs(z168), abs(rel72), abs(rel168)])
        hold_votes = [_sign(z72), _sign(z168), _sign(z336)]
        hold_alive_long = sum(v == 1 for v in hold_votes) >= 2
        hold_alive_short = sum(v == -1 for v in hold_votes) >= 2
        out[s] = {
            "side": side,
            "entryEligible": bool(entry_eligible),
            "strength": float(strength),
            "holdAliveLong": bool(hold_alive_long),
            "holdAliveShort": bool(hold_alive_short),
        }
    return out


def metric(rs, start, end):
    if not rs:
        return {"intervals": 0, "returnPct": 0.0, "cagrPct": 0.0, "pf": None, "pfWithoutBest": None, "maxDDPct": 0.0, "winRatePct": 0.0}
    e = p = 1.0
    dd = 0.0
    g = l = 0.0
    for r in rs:
        e *= max(0.001, 1 + r / 100.0)
        p = max(p, e)
        dd = min(dd, (e / p - 1) * 100.0)
        g += max(0.0, r)
        l += max(0.0, -r)
    years = max((end - start) / (365.25 * DAY), 1e-9)
    total = (e - 1) * 100.0
    cagr = (e ** (1 / years) - 1) * 100.0 if e > 0 else -100.0
    pf = g / l if l > 1e-12 else (999.0 if g > 0 else None)
    bi = max(range(len(rs)), key=rs.__getitem__)
    wo = rs[:bi] + rs[bi + 1 :]
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
    prev_state = {}
    active = {}  # symbol -> side, fixed slot size while owned
    loss = {}
    returns = []
    turn = 0.0
    contrib = {s: 0.0 for s in TRADE}
    leg_entries = leg_exits = 0
    active_intervals = 0
    side_intervals = {"LONG": 0, "SHORT": 0, "MIXED": 0}

    for ts in times:
        cur = states(candles, idx, ts)
        target = dict(active)

        # Structural invalidation only. Rank loss and relative drift do not exit.
        for s, side in list(active.items()):
            st = cur.get(s)
            alive = bool(st and (st["holdAliveLong"] if side > 0 else st["holdAliveShort"]))
            loss[s] = 0 if alive else loss.get(s, 0) + 1
            if loss[s] >= LOSS_CONFIRMATIONS:
                target.pop(s, None)
                loss.pop(s, None)
                leg_exits += 1

        # Fill vacancies only; never replace an existing owner because of rank.
        vacancies = MAX_POSITIONS - len(target)
        if vacancies > 0:
            candidates = []
            for s, st in cur.items():
                if s in target or not st["entryEligible"] or st["side"] == 0:
                    continue
                prev = prev_state.get(s)
                if not prev or not prev.get("entryEligible") or prev.get("side") != st["side"]:
                    continue
                candidates.append((st["strength"], s, int(st["side"])))
            candidates.sort(reverse=True)
            for _, s, side in candidates[:vacancies]:
                target[s] = side
                loss[s] = 0
                leg_entries += 1

        target_weights = {s: side * SLOT_GROSS for s, side in target.items()}
        active_weights = {s: side * SLOT_GROSS for s, side in active.items()}
        interval = 0.0
        valid = True
        for s, w in target_weights.items():
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
            ar = (xp / ep - 1) * 100.0
            pnl = w * ar
            interval += pnl
            contrib[s] += pnl

        if not valid:
            prev_state = cur
            continue

        universe = set(active_weights) | set(target_weights)
        tu = sum(abs(target_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in universe)
        interval -= tu * costbps / 100.0
        turn += tu
        if target_weights:
            active_intervals += 1
            signs = {1 if w > 0 else -1 for w in target_weights.values()}
            side_intervals["MIXED" if len(signs) > 1 else "LONG" if 1 in signs else "SHORT"] += 1
        returns.append(interval)
        active = target
        prev_state = cur

    m = metric(returns, start, end)
    m.update({
        "activeIntervals": active_intervals,
        "cashIntervalPct": 100.0 * (len(returns) - active_intervals) / len(returns) if returns else 100.0,
        "turnoverGrossUnits": turn,
        "contributionPctPoints": contrib,
        "legEntries": leg_entries,
        "legExits": leg_exits,
        "sideIntervals": side_intervals,
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
        "researchLine": "INDEPENDENT_OWNERSHIP_EPISODES_V13",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "architecture": {
            "portfolioWideDirectionForced": False,
            "pairSpecificParameters": False,
            "parameterGrid": False,
            "fixedSlotLifecycle": True,
            "rankLossCanForceExit": False,
            "rankCanReplaceActiveOwner": False,
            "entryConfirmations": ENTRY_CONFIRMATIONS,
            "lossConfirmations": LOSS_CONFIRMATIONS,
            "maxPositions": MAX_POSITIONS,
            "totalGrossResearchOnly": TOTAL_GROSS,
            "slotGrossResearchOnly": SLOT_GROSS,
            "periodicResize": False,
            "oppositeDirectionsCanCoexist": True,
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
    path = root / "independent-ownership-episodes-v13.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
