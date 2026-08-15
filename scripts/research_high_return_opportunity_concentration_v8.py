"""High Return Opportunity Concentration Portfolio Engine V8.

Research only. Clean-sheet portfolio architecture targeting a materially higher
return regime than the prior pair-by-pair survival gates.

Design principles (fixed before this V8 result is observed):
- BTC is reference-only; trade universe is ETH/BNB/SOL/LINK/AVAX.
- One common architecture for all pairs. No per-pair thresholds or parameter grid.
- Every 6h, classify market ownership, rank directional opportunity, and
  concentrate into the best one or two pairs.
- Maximum gross exposure is fixed at 1.50x for research. This is NOT a production
  leverage setting and cannot be promoted by this script.
- Normal cost = 10 bps, Stress = 30 bps + one-bar execution delay.
- The historical window is already-inspected design evidence. No post-2026-07-01
  Fresh OOS data is read.
- Final research gate is 3Y CAGR >= 80%, not merely positive return/PF > 1.

This module does not import or call V2-V7 entry/exit functions and does not touch
VPS, LIVE, order, deployment, or production paths.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
DAY = 24 * HOUR
TRADE = ("ETH", "BNB", "SOL", "LINK", "AVAX")
ALL = ("BTC",) + TRADE
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
REBALANCE_HOURS = 6
MAX_GROSS = 1.50

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


def _mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def _sd(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def _ret(c, i: int, n: int):
    return v109.b.ret(c, i, n)


def _vol(c, i: int, n: int):
    return v109.b.vol(c, i, n)


def _eff(c, i: int, n: int):
    return v109.b.efficiency(c, i, n)


def _range_pos(c, i: int, n: int):
    return v109.b.range_position(c, i, n)


def _scale_move(r: float | None, vol_hourly_pct: float, bars: int) -> float:
    if r is None or vol_hourly_pct <= 1e-12:
        return 0.0
    return float(r) / (vol_hourly_pct * math.sqrt(float(bars)) + 1e-12)


def _breadth(candles, idx, ts: int, n: int) -> float:
    vals = []
    for s in ALL:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = _ret(candles[s], i, n)
        if r is not None:
            vals.append(float(r))
    return sum(x > 0 for x in vals) / len(vals) if vals else 0.5


def _median_move(candles, idx, ts: int, n: int) -> float:
    vals = []
    for s in ALL:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = _ret(candles[s], i, n)
        if r is not None:
            vals.append(float(r))
    return statistics.median(vals) if vals else 0.0


def _residual_z(symbol: str, candles, idx, ts: int, n: int = 168) -> float:
    i = idx[symbol].get(ts)
    bi = idx["BTC"].get(ts)
    ei = idx["ETH"].get(ts)
    if i is None or bi is None or ei is None or min(i, bi, ei) < n:
        return 0.0
    sr = v109.b.rseries(candles[symbol], i, n)
    br = v109.b.rseries(candles["BTC"], bi, n)
    er = v109.b.rseries(candles["ETH"], ei, n)
    if symbol == "ETH":
        vb = sum(x * x for x in br)
        beta = sum(x * y for x, y in zip(br, sr)) / vb if vb > 1e-12 else 1.0
        rr = [y - beta * x for x, y in zip(br, sr)]
    else:
        rr = [a - 0.55 * b - 0.45 * e for a, b, e in zip(sr, br, er)]
    if len(rr) < 72:
        return 0.0
    base = rr[:-12]
    s = _sd(base)
    return sum(rr[-12:]) / (s * math.sqrt(12) + 1e-12) if s > 1e-12 else 0.0


def market_state(candles, idx, ts: int) -> dict[str, float] | None:
    bi = idx["BTC"].get(ts)
    if bi is None or bi < 900:
        return None
    btc = candles["BTC"]
    vh = _vol(btc, bi, 168)
    if vh <= 1e-12:
        return None
    z24 = _scale_move(_ret(btc, bi, 24), vh, 24)
    z72 = _scale_move(_ret(btc, bi, 72), vh, 72)
    z336 = _scale_move(_ret(btc, bi, 336), vh, 336)
    br24 = _breadth(candles, idx, ts, 24)
    br72 = _breadth(candles, idx, ts, 72)
    eff72 = _eff(btc, bi, 72)
    # Direction is portfolio-level ownership, not a pair threshold.
    raw = 0.45 * z72 + 0.25 * z336 + 0.20 * ((br72 - 0.5) * 4.0) + 0.10 * z24
    direction = 1.0 if raw >= 0.55 else -1.0 if raw <= -0.55 else 0.0
    strength = abs(raw)
    # Trend ownership requires some path efficiency; neutral market is allowed to be cash.
    if direction and eff72 < 0.16 and abs(z24) < 0.90:
        direction = 0.0
    return {
        "direction": direction,
        "strength": strength,
        "raw": raw,
        "btcZ24": z24,
        "btcZ72": z72,
        "btcZ336": z336,
        "breadth24": br24,
        "breadth72": br72,
        "eff72": eff72,
    }


def pair_score(symbol: str, side: int, candles, idx, ts: int) -> dict[str, float] | None:
    i = idx[symbol].get(ts)
    if i is None or i < 900:
        return None
    c = candles[symbol]
    vh = _vol(c, i, 168)
    v24 = _vol(c, i, 24)
    if vh <= 1e-12 or v24 <= 1e-12:
        return None
    z12 = _scale_move(_ret(c, i, 12), vh, 12)
    z24 = _scale_move(_ret(c, i, 24), vh, 24)
    z72 = _scale_move(_ret(c, i, 72), vh, 72)
    z168 = _scale_move(_ret(c, i, 168), vh, 168)
    med24 = _median_move(candles, idx, ts, 24)
    med72 = _median_move(candles, idx, ts, 72)
    rel24 = _scale_move((_ret(c, i, 24) or 0.0) - med24, vh, 24)
    rel72 = _scale_move((_ret(c, i, 72) or 0.0) - med72, vh, 72)
    resid = _residual_z(symbol, candles, idx, ts)
    eff72 = _eff(c, i, 72)
    rp168 = _range_pos(c, i, 168)
    vol_ratio = v24 / vh
    # Ownership score deliberately blends persistence + relative leadership + breakout quality.
    directional = side * (
        0.18 * z12 + 0.22 * z24 + 0.24 * z72 + 0.10 * z168
        + 0.12 * rel24 + 0.09 * rel72 + 0.05 * resid
    )
    boundary = rp168 if side > 0 else (1.0 - rp168)
    quality = directional + 0.35 * max(0.0, eff72 - 0.20) + 0.20 * max(0.0, boundary - 0.60)
    # Reject pathological volatility spikes; high-return engine should own trends, not random tails.
    if vol_ratio > 2.75 and eff72 < 0.18:
        quality -= 0.75
    return {
        "score": quality,
        "directional": directional,
        "eff72": eff72,
        "rangeBoundary": boundary,
        "volRatio": vol_ratio,
        "z24": z24,
        "z72": z72,
        "rel72": rel72,
        "residualZ": resid,
    }


def target_weights(candles, idx, ts: int) -> tuple[dict[str, float], dict[str, Any]]:
    ms = market_state(candles, idx, ts)
    if ms is None or ms["direction"] == 0.0:
        return {}, {"market": ms, "ranked": []}
    side = 1 if ms["direction"] > 0 else -1
    ranked = []
    for s in TRADE:
        row = pair_score(s, side, candles, idx, ts)
        if row is not None:
            ranked.append((float(row["score"]), s, row))
    ranked.sort(reverse=True, key=lambda x: x[0])
    # A true opportunity must be materially aligned. Otherwise stay cash.
    eligible = [x for x in ranked if x[0] >= 0.80]
    if not eligible:
        return {}, {"market": ms, "ranked": ranked}

    # Fixed gross tiers. No search over these values in this research line.
    strength = float(ms["strength"])
    gross = 1.50 if strength >= 1.35 else 1.25 if strength >= 0.90 else 0.85
    gross = min(MAX_GROSS, gross)
    top = eligible[0]
    weights: dict[str, float] = {}
    if len(eligible) >= 2 and eligible[1][0] >= max(0.80, top[0] - 0.30):
        weights[top[1]] = side * gross * 0.65
        weights[eligible[1][1]] = side * gross * 0.35
    else:
        weights[top[1]] = side * gross
    return weights, {"market": ms, "ranked": ranked, "gross": gross}


def _portfolio_metric(returns: list[float], start: int, end: int) -> dict[str, Any]:
    if not returns:
        return {"intervals": 0, "returnPct": 0.0, "cagrPct": 0.0, "pf": None, "pfWithoutBest": None,
                "maxDDPct": 0.0, "winRatePct": 0.0}
    equity = 1.0
    peak = 1.0
    maxdd = 0.0
    gains = losses = 0.0
    for r in returns:
        equity *= max(0.001, 1.0 + r / 100.0)
        peak = max(peak, equity)
        maxdd = min(maxdd, (equity / peak - 1.0) * 100.0)
        if r > 0:
            gains += r
        elif r < 0:
            losses += -r
    total = (equity - 1.0) * 100.0
    years = max((end - start) / (365.25 * DAY), 1e-9)
    cagr = (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else -100.0
    pf = gains / losses if losses > 1e-12 else (999.0 if gains > 0 else None)
    best_i = max(range(len(returns)), key=returns.__getitem__)
    wo = returns[:best_i] + returns[best_i + 1:]
    wg = sum(x for x in wo if x > 0); wl = abs(sum(x for x in wo if x < 0))
    pfwo = wg / wl if wl > 1e-12 else (999.0 if wg > 0 else None)
    return {
        "intervals": len(returns), "returnPct": total, "cagrPct": cagr, "pf": pf,
        "pfWithoutBest": pfwo, "maxDDPct": maxdd,
        "winRatePct": 100.0 * sum(x > 0 for x in returns) / len(returns),
        "bestIntervalPct": max(returns),
    }


def simulate(candles, idx, start: int, end: int, cost_bps: float, delay_bars: int) -> dict[str, Any]:
    btc = candles["BTC"]
    times = [int(r["ts"]) for r in btc if start <= int(r["ts"]) < end]
    if not times:
        return {"metrics": _portfolio_metric([], start, end), "returns": [], "records": []}
    # Align to the first 6h observation in the requested period; no outcome-dependent alignment.
    signal_times = times[::REBALANCE_HOURS]
    prev_weights: dict[str, float] = {}
    returns: list[float] = []
    records: list[dict[str, Any]] = []
    contribution = {s: 0.0 for s in TRADE}
    active_intervals = 0
    gross_sum = cash_intervals = turnover_sum = 0.0

    for ts in signal_times:
        weights, diag = target_weights(candles, idx, ts)
        # Execution on next open (+ optional stress delay), then hold exactly one rebalance interval.
        legs = []
        interval = 0.0
        valid = True
        for s, w in weights.items():
            i = idx[s].get(ts)
            if i is None:
                valid = False; break
            ei = i + 1 + delay_bars
            xi = ei + REBALANCE_HOURS
            if xi >= len(candles[s]) or int(candles[s][xi]["ts"]) >= end:
                valid = False; break
            ep = float(candles[s][ei]["open"]); xp = float(candles[s][xi]["open"])
            if ep <= 0:
                valid = False; break
            asset_ret = (xp / ep - 1.0) * 100.0
            pnl = w * asset_ret
            interval += pnl
            contribution[s] += pnl
            legs.append({"symbol": s, "weight": w, "assetReturnPct": asset_ret, "pnlPct": pnl})
        if not valid:
            continue
        universe = set(prev_weights) | set(weights)
        turnover = sum(abs(weights.get(s, 0.0) - prev_weights.get(s, 0.0)) for s in universe)
        cost = turnover * cost_bps / 100.0
        interval -= cost
        turnover_sum += turnover
        gross = sum(abs(w) for w in weights.values())
        gross_sum += gross
        if gross <= 1e-12:
            cash_intervals += 1
        else:
            active_intervals += 1
        returns.append(interval)
        records.append({"signalTs": ts, "weights": weights, "gross": gross, "turnover": turnover,
                        "costPct": cost, "portfolioReturnPct": interval, "legs": legs,
                        "market": diag.get("market")})
        prev_weights = dict(weights)

    metrics = _portfolio_metric(returns, start, end)
    metrics.update({
        "activeIntervals": active_intervals,
        "cashIntervalPct": 100.0 * cash_intervals / len(returns) if returns else 100.0,
        "averageGross": gross_sum / len(returns) if returns else 0.0,
        "turnoverGrossUnits": turnover_sum,
        "contributionPctPoints": contribution,
    })
    return {"metrics": metrics, "returns": returns, "records": records}


def main() -> None:
    candles, idx, _ = v109.b.base.load()
    # Hard boundary: this script may not evaluate post-2026-07-01 Fresh OOS.
    for s in ALL:
        if s not in candles:
            raise RuntimeError(f"MISSING_SYMBOL:{s}")
    if END_2026 > hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")

    normal: dict[str, Any] = {}
    stress: dict[str, Any] = {}
    for label, (start, end) in PERIODS.items():
        normal[label] = simulate(candles, idx, start, end, NORMAL_BPS, 0)["metrics"]
        stress[label] = simulate(candles, idx, start, end, STRESS_BPS, STRESS_DELAY)["metrics"]

    c = normal["combined3Y"]
    cs = stress["combined3Y"]
    years = [normal[x] for x in ("year1_2023_24", "year2_2024_25", "year3_2025_26")]
    positive_years = sum(float(x.get("returnPct", 0.0)) > 0 for x in years)
    worst_year = min(float(x.get("returnPct", 0.0)) for x in years)
    gate = bool(
        float(c.get("cagrPct", -999.0)) >= 80.0
        and float(c.get("pf") or 0.0) >= 1.30
        and float(c.get("pfWithoutBest") or 0.0) >= 1.15
        and float(c.get("maxDDPct", -999.0)) >= -35.0
        and int(c.get("activeIntervals", 0)) >= 80
        and positive_years >= 2
        and worst_year > -25.0
        and float(cs.get("cagrPct", -999.0)) >= 35.0
        and float(cs.get("pf") or 0.0) >= 1.05
        and float(cs.get("maxDDPct", -999.0)) >= -45.0
    )

    out = {
        "researchLine": "HIGH_RETURN_OPPORTUNITY_CONCENTRATION_V8",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "target": {"portfolio3YCagrPct": 80.0, "guaranteed": False},
        "architecture": {
            "btcRole": "REFERENCE_ONLY",
            "tradeUniverse": list(TRADE),
            "rebalanceHours": REBALANCE_HOURS,
            "maxGrossResearch": MAX_GROSS,
            "pairSpecificParameters": False,
            "parameterGrid": False,
            "components": ["market_ownership", "relative_leadership", "trend_persistence", "breakout_quality", "opportunity_concentration"],
            "maxPositions": 2,
        },
        "periods": PERIODS,
        "normal": normal,
        "stress": stress,
        "gate": {
            "threeYearCagrMinPct": 80.0,
            "pfMin": 1.30,
            "pfWithoutBestMin": 1.15,
            "maxDDLimitPct": -35.0,
            "positiveYearsMin": 2,
            "worstYearFloorPct": -25.0,
            "stressCagrMinPct": 35.0,
            "stressPfMin": 1.05,
            "stressMaxDDLimitPct": -45.0,
            "pass": gate,
        },
        "status": "HISTORICAL_HIGH_RETURN_GATE_PASS" if gate else "HISTORICAL_HIGH_RETURN_GATE_FAIL",
        "nextAction": "FREEZE_AND_ALLOW_ONE_FRESH_OOS_TEST" if gate else "DIAGNOSE_STRUCTURE_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "high-return-opportunity-concentration-v8.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    (root / "high-return-opportunity-concentration-v8.md").write_text(
        "# High Return Opportunity Concentration V8\n\n```json\n" + json.dumps(out, indent=2, sort_keys=True) + "\n```\n",
        encoding="utf-8",
    )
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
