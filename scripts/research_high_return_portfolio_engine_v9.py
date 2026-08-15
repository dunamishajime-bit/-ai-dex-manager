"""High Return Portfolio Engine V9.

Research-only clean-sheet portfolio architecture.

Return standard is intentionally high:
- 80% 3Y CAGR is NOT the target; it is the hard rejection floor.
- <80% CAGR: automatic fail.
- 80-100% CAGR: below primary standard, not a candidate.
- >=100% CAGR with robustness gates: candidate.
- >=120% CAGR with robustness gates: strong candidate.

Architecture is frozen before the first V9 result is observed:
1) directional market-ownership continuation,
2) shock-reversal capture,
3) neutral-market cross-sectional long/short dispersion.

BTC is reference-only. Trade universe is ETH/BNB/SOL/LINK/AVAX. One common
architecture is used for all pairs: no pair-specific thresholds, no parameter
grid and no V2-V8 entry/exit inheritance.

Historical 2023-07-01 -> 2026-07-01 is already-inspected DESIGN evidence only.
No post-2026-07-01 Fresh OOS data is read. This script cannot touch VPS, LIVE,
orders, deployment, production config, or real trading.
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
MAX_GROSS_RESEARCH = 2.00

HARD_CAGR_FLOOR = 80.0
PRIMARY_CAGR_STANDARD = 100.0
STRONG_CAGR_STANDARD = 120.0

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


def mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def sd(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def ret(c, i: int, n: int):
    return v109.b.ret(c, i, n)


def vol(c, i: int, n: int):
    return v109.b.vol(c, i, n)


def efficiency(c, i: int, n: int):
    return v109.b.efficiency(c, i, n)


def range_pos(c, i: int, n: int):
    return v109.b.range_position(c, i, n)


def scaled_move(r: float | None, hourly_vol_pct: float, bars: int) -> float:
    if r is None or hourly_vol_pct <= 1e-12:
        return 0.0
    return float(r) / (hourly_vol_pct * math.sqrt(float(bars)) + 1e-12)


def breadth(candles, idx, ts: int, n: int) -> float:
    vals = []
    for s in ALL:
        i = idx[s].get(ts)
        if i is None:
            continue
        x = ret(candles[s], i, n)
        if x is not None:
            vals.append(float(x))
    return sum(x > 0 for x in vals) / len(vals) if vals else 0.5


def median_move(candles, idx, ts: int, n: int) -> float:
    vals = []
    for s in ALL:
        i = idx[s].get(ts)
        if i is None:
            continue
        x = ret(candles[s], i, n)
        if x is not None:
            vals.append(float(x))
    return statistics.median(vals) if vals else 0.0


def residual_z(symbol: str, candles, idx, ts: int, n: int = 168) -> float:
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
    s = sd(base)
    return sum(rr[-12:]) / (s * math.sqrt(12) + 1e-12) if s > 1e-12 else 0.0


def market_context(candles, idx, ts: int) -> dict[str, float] | None:
    bi = idx["BTC"].get(ts)
    if bi is None or bi < 900:
        return None
    btc = candles["BTC"]
    vh = vol(btc, bi, 168)
    if vh <= 1e-12:
        return None
    z6 = scaled_move(ret(btc, bi, 6), vh, 6)
    z24 = scaled_move(ret(btc, bi, 24), vh, 24)
    z72 = scaled_move(ret(btc, bi, 72), vh, 72)
    z336 = scaled_move(ret(btc, bi, 336), vh, 336)
    br24 = breadth(candles, idx, ts, 24)
    br72 = breadth(candles, idx, ts, 72)
    eff72 = efficiency(btc, bi, 72)
    ownership = 0.42 * z72 + 0.25 * z336 + 0.18 * ((br72 - 0.5) * 4.0) + 0.15 * z24
    return {
        "z6": z6,
        "z24": z24,
        "z72": z72,
        "z336": z336,
        "breadth24": br24,
        "breadth72": br72,
        "eff72": eff72,
        "ownership": ownership,
    }


def pair_features(symbol: str, candles, idx, ts: int) -> dict[str, float] | None:
    i = idx[symbol].get(ts)
    if i is None or i < 900:
        return None
    c = candles[symbol]
    vh = vol(c, i, 168)
    v24 = vol(c, i, 24)
    if vh <= 1e-12 or v24 <= 1e-12:
        return None
    z6 = scaled_move(ret(c, i, 6), vh, 6)
    z12 = scaled_move(ret(c, i, 12), vh, 12)
    z24 = scaled_move(ret(c, i, 24), vh, 24)
    z72 = scaled_move(ret(c, i, 72), vh, 72)
    z168 = scaled_move(ret(c, i, 168), vh, 168)
    m24 = median_move(candles, idx, ts, 24)
    m72 = median_move(candles, idx, ts, 72)
    rel24 = scaled_move((ret(c, i, 24) or 0.0) - m24, vh, 24)
    rel72 = scaled_move((ret(c, i, 72) or 0.0) - m72, vh, 72)
    eff72 = efficiency(c, i, 72)
    rp168 = range_pos(c, i, 168)
    rz = residual_z(symbol, candles, idx, ts)
    return {
        "z6": z6,
        "z12": z12,
        "z24": z24,
        "z72": z72,
        "z168": z168,
        "rel24": rel24,
        "rel72": rel72,
        "eff72": eff72,
        "rangePos": rp168,
        "residualZ": rz,
        "volRatio": v24 / vh,
    }


def directional_score(f: dict[str, float], side: int) -> float:
    boundary = f["rangePos"] if side > 0 else 1.0 - f["rangePos"]
    persistence = side * (
        0.14 * f["z6"] + 0.18 * f["z12"] + 0.22 * f["z24"]
        + 0.22 * f["z72"] + 0.08 * f["z168"]
        + 0.08 * f["rel24"] + 0.06 * f["rel72"] + 0.02 * f["residualZ"]
    )
    quality = persistence + 0.40 * max(0.0, f["eff72"] - 0.20) + 0.22 * max(0.0, boundary - 0.58)
    if f["volRatio"] > 2.75 and f["eff72"] < 0.18:
        quality -= 0.85
    return quality


def dispersion_score(f: dict[str, float]) -> float:
    return 0.38 * f["rel24"] + 0.32 * f["rel72"] + 0.16 * f["residualZ"] + 0.14 * f["z24"]


def build_weights(candles, idx, ts: int) -> tuple[dict[str, float], dict[str, Any]]:
    mc = market_context(candles, idx, ts)
    if mc is None:
        return {}, {"mode": "CASH", "market": None}
    feats = {s: pair_features(s, candles, idx, ts) for s in TRADE}
    feats = {s: f for s, f in feats.items() if f is not None}
    if len(feats) < 4:
        return {}, {"mode": "CASH", "market": mc}

    own = float(mc["ownership"])
    # Mode 1: persistent directional ownership.
    if abs(own) >= 0.52 and (mc["eff72"] >= 0.16 or abs(mc["z24"]) >= 0.85):
        side = 1 if own > 0 else -1
        ranked = sorted(((directional_score(f, side), s) for s, f in feats.items()), reverse=True)
        eligible = [x for x in ranked if x[0] >= 0.72]
        if eligible:
            strength = abs(own)
            gross = 2.00 if strength >= 1.45 else 1.65 if strength >= 1.00 else 1.20
            gross = min(MAX_GROSS_RESEARCH, gross)
            weights: dict[str, float] = {}
            if len(eligible) >= 2 and eligible[1][0] >= max(0.72, eligible[0][0] - 0.28):
                weights[eligible[0][1]] = side * gross * 0.68
                weights[eligible[1][1]] = side * gross * 0.32
            else:
                weights[eligible[0][1]] = side * gross
            return weights, {"mode": "OWNERSHIP", "market": mc, "ranked": ranked, "gross": gross}

    # Mode 2: market shock exhausted and reverses on the short horizon.
    # Uses portfolio-level BTC/breadth state only, not pair-specific tuning.
    shock_side = 0
    if mc["z24"] <= -1.55 and mc["z6"] >= 0.25 and mc["breadth24"] <= 0.34:
        shock_side = 1
    elif mc["z24"] >= 1.55 and mc["z6"] <= -0.25 and mc["breadth24"] >= 0.66:
        shock_side = -1
    if shock_side:
        ranked = sorted(((directional_score(f, shock_side), s) for s, f in feats.items()), reverse=True)
        eligible = [x for x in ranked if x[0] >= 0.45]
        if eligible:
            gross = 1.35
            weights = {eligible[0][1]: shock_side * gross}
            if len(eligible) >= 2 and eligible[1][0] >= eligible[0][0] - 0.20:
                weights = {eligible[0][1]: shock_side * gross * 0.65, eligible[1][1]: shock_side * gross * 0.35}
            return weights, {"mode": "SHOCK_REVERSAL", "market": mc, "ranked": ranked, "gross": gross}

    # Mode 3: neutral market but strong cross-sectional dispersion.
    ds = sorted(((dispersion_score(f), s) for s, f in feats.items()), reverse=True)
    if len(ds) >= 2:
        spread = ds[0][0] - ds[-1][0]
        neutral = abs(own) < 0.62 and 0.25 <= mc["breadth24"] <= 0.75
        if neutral and spread >= 1.05:
            gross = 1.60
            return {
                ds[0][1]: gross * 0.50,
                ds[-1][1]: -gross * 0.50,
            }, {"mode": "DISPERSION_LS", "market": mc, "ranked": ds, "gross": gross, "spread": spread}

    return {}, {"mode": "CASH", "market": mc}


def portfolio_metric(returns: list[float], start: int, end: int) -> dict[str, Any]:
    if not returns:
        return {"intervals": 0, "returnPct": 0.0, "cagrPct": 0.0, "pf": None,
                "pfWithoutBest": None, "maxDDPct": 0.0, "winRatePct": 0.0}
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
    years = max((end - start) / (365.25 * DAY), 1e-9)
    total = (equity - 1.0) * 100.0
    cagr = (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else -100.0
    pf = gains / losses if losses > 1e-12 else (999.0 if gains > 0 else None)
    bi = max(range(len(returns)), key=returns.__getitem__)
    wo = returns[:bi] + returns[bi + 1:]
    wg = sum(x for x in wo if x > 0); wl = abs(sum(x for x in wo if x < 0))
    pfwo = wg / wl if wl > 1e-12 else (999.0 if wg > 0 else None)
    return {
        "intervals": len(returns), "returnPct": total, "cagrPct": cagr,
        "pf": pf, "pfWithoutBest": pfwo, "maxDDPct": maxdd,
        "winRatePct": 100.0 * sum(x > 0 for x in returns) / len(returns),
        "bestIntervalPct": max(returns),
    }


def simulate(candles, idx, start: int, end: int, cost_bps: float, delay_bars: int) -> dict[str, Any]:
    times = [int(r["ts"]) for r in candles["BTC"] if start <= int(r["ts"]) < end]
    signal_times = times[::REBALANCE_HOURS]
    prev_weights: dict[str, float] = {}
    returns: list[float] = []
    records: list[dict[str, Any]] = []
    contribution = {s: 0.0 for s in TRADE}
    mode_counts = {"OWNERSHIP": 0, "SHOCK_REVERSAL": 0, "DISPERSION_LS": 0, "CASH": 0}
    active = cash = 0
    gross_sum = turnover_sum = 0.0

    for ts in signal_times:
        weights, diag = build_weights(candles, idx, ts)
        mode = str(diag.get("mode", "CASH"))
        mode_counts[mode] = mode_counts.get(mode, 0) + 1
        interval = 0.0
        legs = []
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
            ar = (xp / ep - 1.0) * 100.0
            pnl = w * ar
            interval += pnl
            contribution[s] += pnl
            legs.append({"symbol": s, "weight": w, "assetReturnPct": ar, "pnlPct": pnl})
        if not valid:
            continue
        universe = set(prev_weights) | set(weights)
        turnover = sum(abs(weights.get(s, 0.0) - prev_weights.get(s, 0.0)) for s in universe)
        cost = turnover * cost_bps / 100.0
        interval -= cost
        gross = sum(abs(w) for w in weights.values())
        turnover_sum += turnover
        gross_sum += gross
        if gross > 1e-12:
            active += 1
        else:
            cash += 1
        returns.append(interval)
        records.append({"signalTs": ts, "mode": mode, "weights": weights, "gross": gross,
                        "turnover": turnover, "costPct": cost, "portfolioReturnPct": interval,
                        "legs": legs, "market": diag.get("market")})
        prev_weights = dict(weights)

    m = portfolio_metric(returns, start, end)
    m.update({
        "activeIntervals": active,
        "cashIntervalPct": 100.0 * cash / len(returns) if returns else 100.0,
        "averageGross": gross_sum / len(returns) if returns else 0.0,
        "turnoverGrossUnits": turnover_sum,
        "contributionPctPoints": contribution,
        "modeCounts": mode_counts,
    })
    return {"metrics": m, "returns": returns, "records": records}


def main() -> None:
    candles, idx, _ = v109.b.base.load()
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
    annual = [normal[x] for x in ("year1_2023_24", "year2_2024_25", "year3_2025_26")]
    annual_returns = [float(x.get("returnPct", 0.0)) for x in annual]
    positive_years = sum(x > 0 for x in annual_returns)
    median_year = statistics.median(annual_returns)
    worst_year = min(annual_returns)
    cagr = float(c.get("cagrPct", -999.0))

    robustness = bool(
        float(c.get("pf") or 0.0) >= 1.35
        and float(c.get("pfWithoutBest") or 0.0) >= 1.20
        and float(c.get("maxDDPct", -999.0)) >= -40.0
        and int(c.get("activeIntervals", 0)) >= 100
        and positive_years >= 2
        and median_year >= 50.0
        and worst_year > -25.0
        and float(cs.get("cagrPct", -999.0)) >= 45.0
        and float(cs.get("pf") or 0.0) >= 1.05
        and float(cs.get("maxDDPct", -999.0)) >= -50.0
    )
    hard_floor_pass = cagr >= HARD_CAGR_FLOOR
    primary_pass = cagr >= PRIMARY_CAGR_STANDARD and robustness
    strong_pass = cagr >= STRONG_CAGR_STANDARD and robustness

    if not hard_floor_pass:
        status = "RETURN_FLOOR_FAIL"
    elif not primary_pass:
        status = "BELOW_PRIMARY_STANDARD"
    elif strong_pass:
        status = "STRONG_CANDIDATE_PASS"
    else:
        status = "CANDIDATE_PASS"

    out = {
        "researchLine": "HIGH_RETURN_PORTFOLIO_ENGINE_V9",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "returnStandard": {
            "hardRejectionFloor3YCagrPct": HARD_CAGR_FLOOR,
            "primaryCandidate3YCagrPct": PRIMARY_CAGR_STANDARD,
            "strongCandidate3YCagrPct": STRONG_CAGR_STANDARD,
            "eightyPctIsTarget": False,
            "guaranteed": False,
        },
        "architecture": {
            "btcRole": "REFERENCE_ONLY",
            "tradeUniverse": list(TRADE),
            "rebalanceHours": REBALANCE_HOURS,
            "maxGrossResearchOnly": MAX_GROSS_RESEARCH,
            "maxPositions": 2,
            "pairSpecificParameters": False,
            "parameterGrid": False,
            "profitModes": ["OWNERSHIP", "SHOCK_REVERSAL", "DISPERSION_LS"],
        },
        "periods": PERIODS,
        "normal": normal,
        "stress": stress,
        "diagnostic": {
            "positiveYears": positive_years,
            "medianAnnualReturnPct": median_year,
            "worstAnnualReturnPct": worst_year,
            "robustnessPass": robustness,
            "hardFloorPass": hard_floor_pass,
            "primary100Pass": primary_pass,
            "strong120Pass": strong_pass,
        },
        "status": status,
        "nextAction": "FREEZE_AND_ONE_FRESH_OOS_TEST" if primary_pass else "STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "high-return-portfolio-engine-v9.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    (root / "high-return-portfolio-engine-v9.md").write_text(
        "# High Return Portfolio Engine V9\n\n```json\n" + json.dumps(out, indent=2, sort_keys=True) + "\n```\n",
        encoding="utf-8",
    )
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
