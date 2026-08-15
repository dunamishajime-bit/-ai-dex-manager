"""Three-year pairwise clean-sheet reconstruction for SOL/LINK/ETH/BNB/AVAX.

Research-only.  This intentionally does NOT inherit the V109/V145/V6 entry
signals.  Five low-complexity causal architecture families are declared up
front and evaluated per symbol.  Architecture selection requires agreement
between 2023-24 Development and 2024-25 Validation; 2025-26 is evaluation-only
inside this run.  No continuous threshold grid is searched.

The selected independent trade streams are additionally routed through the
already-proven V6 lifecycle engine (same-day roundtrip guard, preemption churn
guard, conditional SOL preemption) without changing that engine.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as router_base
import research_priority_router_v6 as v6
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
TRADE_SYMBOLS = ("SOL", "LINK", "ETH", "BNB", "AVAX")
FAMILIES = (
    "TREND_PERSISTENCE",
    "PULLBACK_REACCEL",
    "RELATIVE_HANDOFF",
    "COMPRESSION_EXPANSION",
    "EXHAUSTION_REVERSAL",
)
RISK = {s: float(v109.RISK[s]) for s in TRADE_SYMBOLS}
V6_FLAGS = {v6.GUARD_SAME_DAY, v6.GUARD_CHURN}

START_2023 = hist.jst08(2023, 7, 1)
START_2024 = hist.jst08(2024, 7, 1)
START_2025 = hist.jst08(2025, 7, 1)
END_2026 = hist.jst08(2026, 7, 1)
PERIODS = {
    "development": (START_2023, START_2024),
    "validation": (START_2024, START_2025),
    "evaluation": (START_2025, END_2026),
    "combined": (START_2023, END_2026),
}


def _pf(values: list[float]) -> float | None:
    gains = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def _compound(values: list[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def _metric(values: list[float]) -> dict[str, Any]:
    m = dict(v109.metric(values))
    if not values:
        m["pfWithoutBest"] = None
        return m
    best = max(range(len(values)), key=values.__getitem__)
    wo = values[:best] + values[best + 1 :]
    m["pfWithoutBest"] = _pf(wo)
    m["medianTradePct"] = statistics.median(values)
    m["top5ContributionPctPoints"] = sum(sorted(values, reverse=True)[:5])
    return m


def _expected_move(vol_annual_pct: float, bars: int) -> float:
    return max(1e-9, vol_annual_pct * math.sqrt(float(bars) / (24.0 * 365.0)))


def _ctx(symbol: str, candles, index, ts: int) -> dict[str, float] | None:
    i = index[symbol].get(int(ts))
    bi = index["BTC"].get(int(ts))
    if i is None or bi is None or i < 900 or bi < 900:
        return None
    c = candles[symbol]
    btc = candles["BTC"]
    vol168 = v109.b.vol(c, i, 168)
    vol24 = v109.b.vol(c, i, 24)
    vol96 = v109.b.vol(c, i, 96)
    if vol168 is None or vol24 is None or vol96 is None or min(vol168, vol96) <= 1e-9:
        return None

    def r(n: int) -> float:
        return float(v109.ret(c, i, n) or 0.0)

    def z(n: int) -> float:
        return r(n) / _expected_move(float(vol168), n)

    btc_vol = v109.b.vol(btc, bi, 168) or 1.0
    btc72 = float(v109.ret(btc, bi, 72) or 0.0)
    btc_z72 = btc72 / _expected_move(float(btc_vol), 72)
    median24 = float(v109.b.median_move(candles, index, ts, 24))
    median72 = float(v109.b.median_move(candles, index, ts, 72))
    rr12, rr48 = v109.residual_feature(symbol, candles, index, ts)
    rp = float(v109.b.range_position(c, i, 96))
    eff = float(v109.b.efficiency(c, i, 72) or 0.0)
    return {
        "i": float(i),
        "px": float(c[i]["close"]),
        "r3": r(3), "r6": r(6), "r12": r(12), "r24": r(24), "r72": r(72), "r168": r(168),
        "z3": z(3), "z6": z(6), "z12": z(12), "z24": z(24), "z72": z(72), "z168": z(168),
        "vol168": float(vol168), "vr": float(vol24) / float(vol96),
        "breadth": float(v109.b.breadth(candles, index, ts, 24)),
        "eff": eff, "rp": rp,
        "rel24": (r(24) - median24) / _expected_move(float(vol168), 24),
        "rel72": (r(72) - median72) / _expected_move(float(vol168), 72),
        "btcZ72": btc_z72, "rr12": float(rr12), "rr48": float(rr48),
    }


def _signal(family: str, symbol: str, x: dict[str, float], prev6: dict[str, float] | None,
            prev12: dict[str, float] | None) -> tuple[int, float] | None:
    # Thresholds are fixed by design and never searched per symbol/year.
    if family == "TREND_PERSISTENCE":
        if x["z72"] > 0.80 and x["z24"] > 0.35 and x["z6"] > 0 and x["eff"] > 0.28 and x["rp"] > 0.58 and x["breadth"] >= 0.50 and x["btcZ72"] > -0.50:
            return 1, min(3.0, 0.8 + abs(x["z72"]))
        if x["z72"] < -0.80 and x["z24"] < -0.35 and x["z6"] < 0 and x["eff"] > 0.28 and x["rp"] < 0.42 and x["breadth"] <= 0.50 and x["btcZ72"] < 0.50:
            return -1, min(3.0, 0.8 + abs(x["z72"]))

    elif family == "PULLBACK_REACCEL" and prev6 is not None:
        if x["z168"] > 0.70 and prev6["z6"] <= 0 < x["z6"] and x["z12"] > 0.15 and 0.35 < x["rp"] < 0.86 and x["eff"] > 0.18 and x["breadth"] >= 0.50:
            return 1, min(3.0, 1.0 + abs(x["z168"]))
        if x["z168"] < -0.70 and prev6["z6"] >= 0 > x["z6"] and x["z12"] < -0.15 and 0.14 < x["rp"] < 0.65 and x["eff"] > 0.18 and x["breadth"] <= 0.50:
            return -1, min(3.0, 1.0 + abs(x["z168"]))

    elif family == "RELATIVE_HANDOFF" and prev6 is not None:
        if x["rel72"] > 0.45 and x["rel24"] > 0.15 and prev6["rr12"] <= 0 < x["rr12"] and x["z6"] > 0 and x["breadth"] >= 0.40:
            return 1, min(3.0, 1.0 + abs(x["rel72"]))
        if x["rel72"] < -0.45 and x["rel24"] < -0.15 and prev6["rr12"] >= 0 > x["rr12"] and x["z6"] < 0 and x["breadth"] <= 0.60:
            return -1, min(3.0, 1.0 + abs(x["rel72"]))

    elif family == "COMPRESSION_EXPANSION" and prev12 is not None:
        if prev12["vr"] < 0.78 and x["vr"] >= 0.95 and x["z6"] > 0.45 and x["z12"] > 0.35 and x["rp"] > 0.76 and x["eff"] > 0.22 and x["breadth"] >= 0.50:
            return 1, min(3.0, 1.0 + x["z12"])
        if prev12["vr"] < 0.78 and x["vr"] >= 0.95 and x["z6"] < -0.45 and x["z12"] < -0.35 and x["rp"] < 0.24 and x["eff"] > 0.22 and x["breadth"] <= 0.50:
            return -1, min(3.0, 1.0 + abs(x["z12"]))

    elif family == "EXHAUSTION_REVERSAL":
        if x["vr"] > 1.25 and x["z24"] < -1.55 and x["z3"] > 0.25 and x["rp"] < 0.18 and x["eff"] < 0.30:
            return 1, min(3.0, 1.0 + abs(x["z24"]))
        if x["vr"] > 1.25 and x["z24"] > 1.55 and x["z3"] < -0.25 and x["rp"] > 0.82 and x["eff"] < 0.30:
            return -1, min(3.0, 1.0 + abs(x["z24"]))
    return None


def _exit_reason(family: str, side: int, x: dict[str, float], held: int, current_pct: float,
                 mfe_pct: float) -> str | None:
    capture = current_pct / mfe_pct if mfe_pct > 1e-9 else 1.0
    if family == "TREND_PERSISTENCE":
        if x["z6"] * side <= 0 and x["z12"] * side < 0:
            return "TREND_DIRECTION_LOSS"
        if mfe_pct > 1.0 and capture < 0.45:
            return "TREND_PROFIT_RELEASE"
        if held >= 120:
            return "TREND_MAXHOLD"
    elif family == "PULLBACK_REACCEL":
        if x["z6"] * side <= 0 and x["z12"] * side <= 0:
            return "PULLBACK_REACCEL_LOSS"
        if mfe_pct > 1.0 and capture < 0.40:
            return "PULLBACK_PROFIT_RELEASE"
        if held >= 96:
            return "PULLBACK_MAXHOLD"
    elif family == "RELATIVE_HANDOFF":
        if held >= 12 and (x["rr12"] * side <= 0 or x["z12"] * side < 0):
            return "RELATIVE_HANDOFF_END"
        if held >= 72:
            return "RELATIVE_MAXHOLD"
    elif family == "COMPRESSION_EXPANSION":
        if held >= 12 and (x["vr"] < 0.88 or x["z6"] * side <= 0):
            return "EXPANSION_END"
        if held >= 72:
            return "EXPANSION_MAXHOLD"
    elif family == "EXHAUSTION_REVERSAL":
        if held >= 12 and x["z6"] * side <= 0:
            return "REVERSAL_FAILED"
        if held >= 36:
            return "REVERSAL_MAXHOLD"
    return None


def simulate(symbol: str, family: str, candles, index, start: int, end: int,
             cost_bps: float, delay_bars: int) -> tuple[list[float], list[dict[str, Any]]]:
    c = candles[symbol]
    values: list[float] = []
    records: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    cooldown_until = -1

    def close_position(signal_ts: int, reason: str, period_end: bool = False) -> None:
        nonlocal position, cooldown_until
        assert position is not None
        i = index[symbol].get(int(signal_ts))
        if i is None:
            return
        xi = i if period_end else i + 1 + delay_bars
        if xi >= len(c) or int(c[xi]["ts"]) >= end:
            xi = i
            exit_price = float(c[i]["close"])
        else:
            exit_price = float(c[xi]["open"])
        side = int(position["sideSign"])
        gross = side * (exit_price / float(position["entryPrice"]) - 1.0) * 100.0
        net = (gross - cost_bps / 100.0) * RISK[symbol]
        lo, hi = int(position["entryIndex"]), xi
        rows = c[min(lo, hi):max(lo, hi) + 1]
        entry = float(position["entryPrice"])
        if side > 0:
            mfe = (max(float(r["high"]) for r in rows) / entry - 1.0) * 100.0
            mae = (min(float(r["low"]) for r in rows) / entry - 1.0) * 100.0
        else:
            mfe = (entry / min(float(r["low"]) for r in rows) - 1.0) * 100.0
            mae = (entry / max(float(r["high"]) for r in rows) - 1.0) * 100.0
        record = {
            "symbol": symbol,
            "family": family,
            "champion": f"CLEAN_SHEET_{family}",
            "side": "LONG" if side > 0 else "SHORT",
            "sideSign": side,
            "signalTs": int(position["signalTs"]),
            "entryTs": int(position["entryTs"]),
            "exitTs": int(c[xi]["ts"]),
            "entryPrice": entry,
            "exitPrice": exit_price,
            "grossReturnPct": gross,
            "netReturnPct": net,
            "championNetReturnPct": net,
            "riskMultiplier": RISK[symbol],
            "signalStrength": float(position["signalStrength"]),
            "mfePct": mfe,
            "maePct": mae,
            "exitReason": reason,
        }
        values.append(net)
        records.append(record)
        cooldown_until = int(c[xi]["ts"]) + 6 * HOUR
        position = None

    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        x = _ctx(symbol, candles, index, ts)
        if x is None:
            continue
        i = int(x["i"])
        if position is not None:
            held = int((ts - int(position["entryTs"])) // HOUR)
            side = int(position["sideSign"])
            px = float(row["close"])
            current = side * (px / float(position["entryPrice"]) - 1.0) * 100.0
            if side > 0:
                position["peak"] = max(float(position["peak"]), float(row["high"]))
                mfe = (float(position["peak"]) / float(position["entryPrice"]) - 1.0) * 100.0
            else:
                position["trough"] = min(float(position["trough"]), float(row["low"]))
                mfe = (float(position["entryPrice"]) / float(position["trough"]) - 1.0) * 100.0
            reason = _exit_reason(family, side, x, held, current, mfe)
            if reason is not None:
                close_position(ts, reason)
                continue
        if position is not None or ts < cooldown_until:
            continue
        prev6 = _ctx(symbol, candles, index, ts - 6 * HOUR)
        prev12 = _ctx(symbol, candles, index, ts - 12 * HOUR)
        sg = _signal(family, symbol, x, prev6, prev12)
        if sg is None:
            continue
        side, strength = sg
        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        entry_price = float(c[ei]["open"])
        position = {
            "sideSign": side,
            "signalTs": ts,
            "entryTs": int(c[ei]["ts"]),
            "entryPrice": entry_price,
            "entryIndex": ei,
            "peak": entry_price,
            "trough": entry_price,
            "signalStrength": strength,
        }
    if position is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close_position(final_ts, "PERIOD_END", period_end=True)
    return values, records


def _family_eval(symbol: str, family: str, candles, index) -> dict[str, Any]:
    out: dict[str, Any] = {"family": family}
    for label in ("development", "validation"):
        start, end = PERIODS[label]
        vals, recs = simulate(symbol, family, candles, index, start, end, NORMAL_BPS, 0)
        stress_vals, _ = simulate(symbol, family, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
        out[label] = _metric(vals)
        out[label + "Stress"] = _metric(stress_vals)
        out[label]["medianMfePct"] = statistics.median([r["mfePct"] for r in recs]) if recs else None
        out[label]["medianMaePct"] = statistics.median([r["maePct"] for r in recs]) if recs else None
        out[label]["longTrades"] = sum(r["side"] == "LONG" for r in recs)
        out[label]["shortTrades"] = sum(r["side"] == "SHORT" for r in recs)
    d, v, s = out["development"], out["validation"], out["validationStress"]
    out["viable"] = bool(
        d.get("trades", 0) >= 8 and v.get("trades", 0) >= 6
        and d.get("returnPct", 0) > 0 and v.get("returnPct", 0) > 0
        and (d.get("pf") or 0) >= 1.05 and (v.get("pf") or 0) >= 1.05
        and (d.get("pfWithoutBest") or 0) >= 0.95 and (v.get("pfWithoutBest") or 0) >= 0.95
        and (s.get("pf") or 0) >= 0.90
    )
    min_ret = min(float(d.get("returnPct", -999)), float(v.get("returnPct", -999)))
    min_pf = min(float(d.get("pf") or 0), float(v.get("pf") or 0))
    stress_pf = float(s.get("pf") or 0)
    dd_penalty = 0.15 * (abs(float(d.get("maxDDPct", 0))) + abs(float(v.get("maxDDPct", 0))))
    sample_bonus = 0.05 * min(60, int(d.get("trades", 0)) + int(v.get("trades", 0)))
    out["robustScore"] = min_ret + 8.0 * (min_pf - 1.0) + 2.0 * (stress_pf - 1.0) - dd_penalty + sample_bonus
    return out


def _select_symbol(symbol: str, candles, index) -> dict[str, Any]:
    families = [_family_eval(symbol, fam, candles, index) for fam in FAMILIES]
    viable = [row for row in families if row["viable"]]
    if viable:
        chosen = max(viable, key=lambda row: float(row["robustScore"]))
        selected = str(chosen["family"])
        status = "SELECTED"
    else:
        chosen = max(families, key=lambda row: float(row["robustScore"]))
        selected = "CASH"
        status = "NO_ROBUST_EDGE"
    return {"symbol": symbol, "status": status, "selectedFamily": selected, "bestDiagnosticFamily": chosen["family"], "families": families}


def _selected_records(symbol: str, family: str, candles, index, start: int, end: int,
                      cost: float, delay: int) -> tuple[list[float], list[dict[str, Any]]]:
    if family == "CASH":
        return [], []
    return simulate(symbol, family, candles, index, start, end, cost, delay)


def _symbol_report(symbol: str, selection: dict[str, Any], candles, index) -> dict[str, Any]:
    family = selection["selectedFamily"]
    report: dict[str, Any] = {
        "selectedFamily": family,
        "selectionStatus": selection["status"],
        "bestDiagnosticFamily": selection["bestDiagnosticFamily"],
        "selectionCandidates": selection["families"],
        "years": {},
    }
    for label in ("development", "validation", "evaluation"):
        start, end = PERIODS[label]
        vals, recs = _selected_records(symbol, family, candles, index, start, end, NORMAL_BPS, 0)
        stress, _ = _selected_records(symbol, family, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
        m = _metric(vals); sm = _metric(stress)
        m["stressPf"] = sm.get("pf"); m["stressReturnPct"] = sm.get("returnPct")
        m["longContributionPctPoints"] = sum(r["netReturnPct"] for r in recs if r["side"] == "LONG")
        m["shortContributionPctPoints"] = sum(r["netReturnPct"] for r in recs if r["side"] == "SHORT")
        report["years"][label] = m
    vals, recs = _selected_records(symbol, family, candles, index, *PERIODS["combined"], NORMAL_BPS, 0)
    stress, _ = _selected_records(symbol, family, candles, index, *PERIODS["combined"], STRESS_BPS, STRESS_DELAY)
    report["combined3Y"] = _metric(vals)
    report["combined3Y"]["stressPf"] = _metric(stress).get("pf")
    report["combined3Y"]["positiveYears"] = sum(report["years"][y].get("returnPct", 0) > 0 for y in ("development", "validation", "evaluation"))
    report["combined3Y"]["longContributionPctPoints"] = sum(r["netReturnPct"] for r in recs if r["side"] == "LONG")
    report["combined3Y"]["shortContributionPctPoints"] = sum(r["netReturnPct"] for r in recs if r["side"] == "SHORT")
    return report


def _dv_expectancy(selected: dict[str, str], candles, index) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for symbol, family in selected.items():
        vals, _ = _selected_records(symbol, family, candles, index, START_2023, START_2025, NORMAL_BPS, 0)
        out[symbol] = {
            "trades": len(vals),
            "expectancyPct": statistics.fmean(vals) if vals else 0.0,
            "pf": _pf(vals),
            "returnPct": _compound(vals),
        }
    return out


def _portfolio_period(selected: dict[str, str], candles, index, start: int, end: int,
                      cost: float, delay: int) -> dict[str, Any]:
    candidates: dict[str, list[dict[str, Any]]] = {}
    for symbol in TRADE_SYMBOLS:
        _, recs = _selected_records(symbol, selected[symbol], candles, index, start, end, cost, delay)
        candidates[symbol] = recs
    dv = _dv_expectancy(selected, candles, index)
    period = {"fixedWindowStart": start, "fixedWindowEndExclusive": end}
    shadow = {s: list(candidates[s]) for s in router_base.COMPLEMENTS}
    old_bps, old_delay = router_base.NORMAL_BPS, router_base.EXECUTION_DELAY_BARS
    router_base.NORMAL_BPS, router_base.EXECUTION_DELAY_BARS = cost, delay
    try:
        run = v6.run_router(candles, index, period, candidates, v6.V6_FULL, dv, shadow, guard_flags=V6_FLAGS, audit=True)
    finally:
        router_base.NORMAL_BPS, router_base.EXECUTION_DELAY_BARS = old_bps, old_delay
    return run


def _portfolio_summary(normal: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    n, s = normal["metrics"], stress["metrics"]
    real = normal["realTrades"]
    contrib = {sym: sum(float(r["portfolioPnlPctPoints"]) for r in real if r["symbol"] == sym) for sym in TRADE_SYMBOLS}
    values = [float(r["portfolioPnlPctPoints"]) for r in real]
    return {
        "returnPct": n["oneYearReturnPct"],
        "cagrPct": n["cagrPct"],
        "pf": n["pf"],
        "pfWithoutBest": n["pfWithoutBest"],
        "maxDDPct": n["maxDrawdownHourlyMtmPct"],
        "stressReturnPct": s["oneYearReturnPct"],
        "stressPf": s["pf"],
        "stressDDPct": s["maxDrawdownHourlyMtmPct"],
        "trades": n["realTradeCount"],
        "winRatePct": n["winRatePct"],
        "turnoverPct": n["portfolioTurnoverPctOfInitialEquity"],
        "cashPct": normal["allocationTimePct"]["averageCashPct"],
        "contributionPctPoints": contrib,
        "top5ContributionPctPoints": sum(sorted(values, reverse=True)[:5]) if values else 0.0,
    }


def main() -> None:
    candles, index, _ = v109.b.base.load()
    selections = {symbol: _select_symbol(symbol, candles, index) for symbol in TRADE_SYMBOLS}
    selected = {symbol: selections[symbol]["selectedFamily"] for symbol in TRADE_SYMBOLS}
    symbols = {symbol: _symbol_report(symbol, selections[symbol], candles, index) for symbol in TRADE_SYMBOLS}

    portfolio: dict[str, Any] = {}
    for label in ("development", "validation", "evaluation", "combined"):
        start, end = PERIODS[label]
        normal = _portfolio_period(selected, candles, index, start, end, NORMAL_BPS, 0)
        stress = _portfolio_period(selected, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
        portfolio[label] = _portfolio_summary(normal, stress)

    robust_symbols = [s for s in TRADE_SYMBOLS if selected[s] != "CASH"]
    out = {
        "researchLine": "PAIRWISE_CLEAN_SHEET_3Y_V1",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY_NO_POSITION",
        "oosIsNewEvidence": False,
        "historicalTestIsUntouched": False,
        "antiOverfit": {
            "architectureFamiliesPredeclared": list(FAMILIES),
            "continuousThresholdSearch": False,
            "perSymbolParameterGrid": False,
            "selectionUses": ["2023-24 development", "2024-25 validation"],
            "evaluation2025_26UsedForSelection": False,
            "minimumAgreement": "positive return + PF>=1.05 in both D/V, PF without best>=0.95, validation stress PF>=0.90",
            "cashAllowedWhenNoRobustEdge": True,
            "noSameRunRetuningAfterEvaluation": True,
        },
        "periods": PERIODS,
        "selectedFamilies": selected,
        "robustSymbols": robust_symbols,
        "symbols": symbols,
        "portfolioV6Lifecycle": portfolio,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    path = root / "pairwise-clean-sheet-3y.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
