"""Priority Router V7: frozen V6 plus direction-aware regime exposure scaling.

Research-only. V6 entries, exits, champions, preemption and lifecycle guards are
unchanged. This wrapper only scales candidate riskMultiplier causally at entry
using the existing V6 regime feature engine. No production/LIVE/VPS/order path.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as base
import research_priority_router_v3 as v3
import research_priority_router_v6 as v6
import research_priority_router_v6_historical_robustness as hist
import research_priority_router_v6_regime_attribution as attr

BASELINE = "V6_FROZEN_BASELINE"
SHORT_ONLY = "V7_SHORT_SCALING_ONLY"
DIRECTION = "V7_DIRECTION_AWARE"
NO_ZERO = "V7_DIRECTION_AWARE_NO_ZERO"
VARIANTS = (BASELINE, SHORT_ONLY, DIRECTION, NO_ZERO)

PERIODS = (
    ("2023-24", hist.START_2023, hist.START_2024),
    ("2024-25", hist.START_2024, hist.START_2025),
    ("2025-26", hist.START_2025, hist.END_2026),
    ("3Y_COMBINED", hist.START_2023, hist.END_2026),
)


def _hostility(features: dict[str, float], thresholds: dict[str, dict[str, float]], side: str) -> int:
    score = 0
    for key in ("breadth", "altRel", "dispersion", "volatility"):
        if float(features[key]) >= float(thresholds[key]["q67"]):
            score += 1
    if side == "SHORT" and float(features["btcTrend"]) >= float(thresholds["btcTrend"]["q67"]):
        score += 1
    if side == "LONG" and float(features["btcTrend"]) <= float(thresholds["btcTrend"]["q33"]):
        score += 1
    return score


def _scale(variant: str, side: str, hostility: int) -> float:
    if variant == BASELINE:
        return 1.0
    if variant == SHORT_ONLY:
        if side == "LONG":
            return 1.0
        return 1.0 if hostility == 0 else (0.50 if hostility == 1 else (0.25 if hostility == 2 else 0.0))
    if variant == DIRECTION:
        if side == "LONG":
            return 1.0 if hostility <= 1 else (0.75 if hostility == 2 else 0.50)
        return 1.0 if hostility == 0 else (0.50 if hostility == 1 else (0.25 if hostility == 2 else 0.0))
    if variant == NO_ZERO:
        if side == "LONG":
            return 1.0 if hostility <= 1 else (0.75 if hostility == 2 else 0.50)
        return 1.0 if hostility == 0 else (0.50 if hostility == 1 else 0.25)
    raise ValueError(variant)


def _scaled_candidates(candidates: dict[str, list[dict[str, Any]]], engine: attr.FeatureEngine,
                       thresholds: dict[str, dict[str, float]], variant: str) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    out = copy.deepcopy(candidates)
    audit = {"LONG": {"count": 0, "scaleSum": 0.0, "zero": 0}, "SHORT": {"count": 0, "scaleSum": 0.0, "zero": 0}}
    for rows in out.values():
        for row in rows:
            side = str(row.get("side", "LONG")).upper()
            ts = int(row["entryTs"])
            f = engine.at(ts)
            h = _hostility(f, thresholds, side)
            scale = _scale(variant, side, h)
            row["v7BaseRiskMultiplier"] = float(row["riskMultiplier"])
            row["v7ExposureScale"] = scale
            row["v7Hostility"] = h
            row["riskMultiplier"] = float(row["riskMultiplier"]) * scale
            audit[side]["count"] += 1
            audit[side]["scaleSum"] += scale
            if scale == 0.0:
                audit[side]["zero"] += 1
    for side in ("LONG", "SHORT"):
        c = audit[side]["count"]
        audit[side]["averageScale"] = audit[side]["scaleSum"] / c if c else 0.0
    return out, audit


def _metric(run: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    m = run["metrics"]
    sm = stress["metrics"]
    directional = hist.directional_breakdown(run["realTrades"])
    stress_directional = hist.directional_breakdown(stress["realTrades"])
    return {
        "returnPct": float(m["oneYearReturnPct"]),
        "cagrPct": float(m["cagrPct"]),
        "pf": m["pf"],
        "pfWithoutBest": m["pfWithoutBest"],
        "maxDDPct": float(m["maxDrawdownHourlyMtmPct"]),
        "stressReturnPct": float(sm["oneYearReturnPct"]),
        "stressPf": sm["pf"],
        "stressDDPct": float(sm["maxDrawdownHourlyMtmPct"]),
        "trades": int(m["realTradeCount"]),
        "winRatePct": float(m["winRatePct"]),
        "turnoverPct": float(m["portfolioTurnoverPctOfInitialEquity"]),
        "cashPct": float(run["allocationTimePct"]["averageCashPct"]),
        "long": directional.get("LONG", {}),
        "short": directional.get("SHORT", {}),
        "stressLong": stress_directional.get("LONG", {}),
        "stressShort": stress_directional.get("SHORT", {}),
    }


def _run_variant(candles, index, start: int, end: int, variant: str,
                 thresholds: dict[str, dict[str, float]]) -> dict[str, Any]:
    periods = hist._window_periods(start, end)
    models = v6.train_models(candles, index, periods)
    candidates = v6.build_candidates(candles, index, periods, models, allow_carry=False)
    dv = v6.dv_expectancy(candles, index, periods, models)
    shadow = {s: list(candidates[s]) for s in base.COMPLEMENTS}
    engine = attr.FeatureEngine(candles, index, start, end)
    scaled, exposure_audit = _scaled_candidates(candidates, engine, thresholds, variant)
    scaled_shadow = {s: list(scaled[s]) for s in base.COMPLEMENTS}
    normal = v6.run_router(candles, index, periods, scaled, v6.V6_FULL, dv, scaled_shadow,
                           guard_flags={v6.GUARD_SAME_DAY, v6.GUARD_CHURN}, audit=True)

    stress_candidates = v3._stress_candidates(candles, index, periods, models)
    stress_scaled, _ = _scaled_candidates(stress_candidates, engine, thresholds, variant)
    stress_shadow = {s: list(stress_scaled[s]) for s in base.COMPLEMENTS}
    old_bps, old_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = v6.STRESS_BPS, v6.STRESS_DELAY_BARS
    try:
        stress = v6.run_router(candles, index, periods, stress_scaled, v6.V6_FULL, dv, stress_shadow,
                               guard_flags={v6.GUARD_SAME_DAY, v6.GUARD_CHURN}, audit=False)
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = old_bps, old_delay
    return {"metrics": _metric(normal, stress), "exposureAudit": exposure_audit}


def _build_thresholds(candles, index) -> dict[str, dict[str, float]]:
    # Freeze thresholds before annual evaluation from the existing 2023-25 attribution span.
    engine = attr.FeatureEngine(candles, index, hist.START_2023, hist.START_2025)
    return attr._feature_thresholds(engine, hist.START_2023, hist.START_2025)


def main() -> None:
    candles, index, source = hist.load_extended_data()
    thresholds = _build_thresholds(candles, index)
    results: dict[str, Any] = {}
    for label, start, end in PERIODS:
        results[label] = {variant: _run_variant(candles, index, start, end, variant, thresholds) for variant in VARIANTS}

    known = results["2025-26"]
    baseline_ret = known[BASELINE]["metrics"]["returnPct"]
    for variant in VARIANTS:
        ret = known[variant]["metrics"]["returnPct"]
        known[variant]["metrics"]["profitRetentionPct"] = (ret / baseline_ret * 100.0) if baseline_ret else None

    out = {
        "researchLine": "PRIORITY_ROUTER_V7_DIRECTION_AWARE_REGIME_SCALING",
        "researchOnly": True,
        "productionChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY_NO_POSITION",
        "oosIsNewEvidence": False,
        "v6Frozen": True,
        "v6FreezeCommit": "9a795bb478e4a2d21ab21552a650a3c8e2b693c7",
        "policy": {
            "features": ["BTC_168H_TREND", "BREADTH_72H", "ALT_BTC_REL_72H", "BTC_VOL_PERCENTILE", "DISPERSION_72H"],
            "thresholdSource": "existing feature quantiles over 2023-07 to 2025-07; no 2025-26 tuning",
            "variants": list(VARIANTS),
            "portfolioWideCashController": False,
            "longShortIndependent": True,
        },
        "thresholds": thresholds,
        "source": source,
        "results": results,
    }
    payload = json.dumps(out, indent=2, sort_keys=True)
    out["artifactPayloadSha256BeforeSelfHash"] = hashlib.sha256(payload.encode()).hexdigest()
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v7-direction-aware-3y.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
