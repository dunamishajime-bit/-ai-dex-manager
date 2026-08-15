"""Residual Market Ownership V15.

Clean-sheet structural response to V13/V14 and raw opportunity-map diagnosis.

Causal evidence frozen before first V15 result:
- V13 proved persistent fixed-slot ownership can generate very large annual returns,
  but year2 was dominated by market/BTC-context contamination and wrong-side episodes.
- V14 phase-to-CASH routing reduced loss but concentrated turnover and erased edge.
- raw leader/laggard continuation/reversal motifs had no phase/horizon combination
  with positive Normal mean+PF across all three years after costs.

V15 therefore does NOT add another phase filter. It changes the signal domain:
1. Build one common rolling market factor from the median hourly return of the same
   six frozen symbols (BTC, ETH, BNB, SOL, LINK, AVAX).
2. For each tradable alt, estimate its rolling beta to that common factor and work
   only with the residual return stream. This is common logic; no pair parameters.
3. Entry requires residual 12h and 48h ownership to agree in sign AND the pair's
   absolute 24h/72h direction to agree with that residual sign for two observations.
4. Two fixed slots, 0.625 gross each (max total gross 1.25), no periodic resizing,
   no phase-to-CASH churn, no gross increase from V13/V14.
5. Rank only fills a vacant slot by residual strength. Rank can never replace an
   active owner. Exit requires two observations of medium residual/absolute trend
   structural loss.

Both LONG and SHORT are allowed only when residual and absolute direction agree.
BTC is market-factor reference only and is never traded. No threshold grid,
pair-specific params, Fresh OOS, VPS, LIVE, orders, deployment, or production change.
Normal=10bps/delay0; Stress=30bps/delay1. Historical boundary=2026-07-01.
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
FACTOR = ("BTC",) + TRADE
OBS_HOURS = 6
LOOKBACK = 168
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


def mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def sd(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def factor_and_series(candles, idx, ts):
    series = {}
    for s in FACTOR:
        i = idx[s].get(ts)
        if i is None or i < LOOKBACK:
            return None, None
        xs = v109.b.rseries(candles[s], i, LOOKBACK)
        if len(xs) != LOOKBACK:
            return None, None
        series[s] = [float(x) for x in xs]
    market = [statistics.median(series[s][k] for s in FACTOR) for k in range(LOOKBACK)]
    return market, series


def ownership_states(candles, idx, ts):
    market, series = factor_and_series(candles, idx, ts)
    if market is None:
        return {}
    mm = mean(market)
    mdev = [x - mm for x in market]
    mvar = sum(x * x for x in mdev)
    if mvar <= 1e-12:
        return {}
    out = {}
    for s in TRADE:
        xs = series[s]
        xm = mean(xs)
        xdev = [x - xm for x in xs]
        beta = sum(a * b for a, b in zip(xdev, mdev)) / mvar
        residual = [x - beta * m for x, m in zip(xs, market)]
        rsd = sd(residual)
        if rsd <= 1e-12:
            continue
        rr12 = sum(residual[-12:]) / (rsd * math.sqrt(12) + 1e-12)
        rr48 = sum(residual[-48:]) / (rsd * math.sqrt(48) + 1e-12)
        rr168 = sum(residual) / (rsd * math.sqrt(168) + 1e-12)
        i = idx[s].get(ts)
        r24 = ret(candles[s], i, 24)
        r72 = ret(candles[s], i, 72)
        if r24 is None or r72 is None:
            continue
        side = 1 if rr12 > 0 and rr48 > 0 and r24 > 0 and r72 > 0 else -1 if rr12 < 0 and rr48 < 0 and r24 < 0 and r72 < 0 else 0
        hold_long = rr48 > 0 and r72 > 0
        hold_short = rr48 < 0 and r72 < 0
        strength = statistics.median((abs(rr12), abs(rr48), abs(rr168)))
        out[s] = {
            "side": int(side),
            "eligible": bool(side),
            "holdLong": bool(hold_long),
            "holdShort": bool(hold_short),
            "strength": float(strength),
            "beta": float(beta),
            "residual12": float(rr12),
            "residual48": float(rr48),
            "residual168": float(rr168),
        }
    return out


def metric(rs, start, end):
    if not rs:
        return {"intervals": 0, "returnPct": 0.0, "cagrPct": 0.0, "pf": None, "pfWithoutBest": None, "maxDDPct": 0.0, "winRatePct": 0.0}
    equity = peak = 1.0
    dd = 0.0
    gains = losses = 0.0
    for r in rs:
        equity *= max(0.001, 1 + r / 100.0)
        peak = max(peak, equity)
        dd = min(dd, (equity / peak - 1) * 100.0)
        gains += max(0.0, r)
        losses += max(0.0, -r)
    years = max((end - start) / (365.25 * DAY), 1e-9)
    total = (equity - 1) * 100.0
    cagr = (equity ** (1 / years) - 1) * 100.0 if equity > 0 else -100.0
    pf = gains / losses if losses > 1e-12 else (999.0 if gains > 0 else None)
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
    prev = {}
    active = {}  # symbol -> side
    loss_count = {}
    returns = []
    turnover = 0.0
    contrib = {s: 0.0 for s in TRADE}
    entries = exits = 0
    active_intervals = 0
    side_intervals = {"LONG": 0, "SHORT": 0, "MIXED": 0}

    for ts in times:
        cur = ownership_states(candles, idx, ts)
        target = dict(active)

        for s, side in list(active.items()):
            st = cur.get(s)
            alive = bool(st and (st["holdLong"] if side > 0 else st["holdShort"]))
            loss_count[s] = 0 if alive else loss_count.get(s, 0) + 1
            if loss_count[s] >= LOSS_CONFIRMATIONS:
                target.pop(s, None)
                loss_count.pop(s, None)
                exits += 1

        vacancies = MAX_POSITIONS - len(target)
        if vacancies > 0:
            candidates = []
            for s, st in cur.items():
                if s in target or not st["eligible"] or st["side"] == 0:
                    continue
                pr = prev.get(s)
                if not pr or not pr.get("eligible") or pr.get("side") != st["side"]:
                    continue
                candidates.append((st["strength"], s, int(st["side"])))
            candidates.sort(reverse=True)
            for _, s, side in candidates[:vacancies]:
                target[s] = side
                loss_count[s] = 0
                entries += 1

        tw = {s: side * SLOT_GROSS for s, side in target.items()}
        aw = {s: side * SLOT_GROSS for s, side in active.items()}
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
            prev = cur
            continue

        universe = set(tw) | set(aw)
        tu = sum(abs(tw.get(s, 0.0) - aw.get(s, 0.0)) for s in universe)
        interval -= tu * costbps / 100.0
        turnover += tu
        if tw:
            active_intervals += 1
            signs = {1 if w > 0 else -1 for w in tw.values()}
            side_intervals["MIXED" if len(signs) > 1 else "LONG" if 1 in signs else "SHORT"] += 1
        returns.append(interval)
        active = target
        prev = cur

    m = metric(returns, start, end)
    m.update({
        "activeIntervals": active_intervals,
        "cashIntervalPct": 100.0 * (len(returns) - active_intervals) / len(returns) if returns else 100.0,
        "turnoverGrossUnits": turnover,
        "contributionPctPoints": contrib,
        "entries": entries,
        "exits": exits,
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
    for label, (a, b) in PERIODS.items():
        normal[label] = simulate(candles, idx, a, b, NORMAL_BPS, 0)
        stress[label] = simulate(candles, idx, a, b, STRESS_BPS, STRESS_DELAY)
    cl = classify(normal, stress)
    out = {
        "researchLine": "RESIDUAL_MARKET_OWNERSHIP_V15",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "architecture": {
            "commonMedianMarketFactor": True,
            "rollingBetaLookbackHours": LOOKBACK,
            "btcReferenceOnly": True,
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
            "phaseToCashRouter": False,
            "leverageRaisedFromV13V14": False,
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
    path = root / "residual-market-ownership-v15.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
