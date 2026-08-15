"""Priority Router V7: frozen V6 plus direction-aware regime scaling.

Research-only. Frozen V6 candidate generation, champions, entry/exit, preemption,
and lifecycle guards are unchanged. This wrapper only scales exposure at the
candidate entry timestamp using causal features from the existing V6 regime
attribution engine. No production/LIVE/VPS/order path is imported or mutated.
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
import research_priority_router_v6 as v6
import research_priority_router_v6_historical_robustness as hist
import research_priority_router_v6_regime_attribution as attr

BASELINE = "V6_FROZEN_BASELINE"
SHORT_ONLY = "V7_SHORT_SCALING_ONLY"
DIRECTION = "V7_DIRECTION_AWARE"
NO_ZERO = "V7_DIRECTION_AWARE_NO_ZERO"
VARIANTS = (BASELINE, SHORT_ONLY, DIRECTION, NO_ZERO)
V6_FLAGS = {v6.GUARD_SAME_DAY, v6.GUARD_CHURN}
V6_FREEZE_COMMIT = "9a795bb478e4a2d21ab21552a650a3c8e2b693c7"
V6_SOURCE_SHA256 = "ade97549be141371a73c72d781915d1c5cc32eb00310552aaf48c419d36968c9"

PERIODS = (
    ("2023-24", hist.jst08(2023, 7, 1), hist.jst08(2024, 7, 1)),
    ("2024-25", hist.jst08(2024, 7, 1), hist.jst08(2025, 7, 1)),
    ("2025-26", hist.jst08(2025, 7, 1), hist.jst08(2026, 7, 1)),
    ("3Y_COMBINED", hist.jst08(2023, 7, 1), hist.jst08(2026, 7, 1)),
)


def _source_hash() -> str:
    return hashlib.sha256(Path(v6.__file__).read_bytes()).hexdigest()


def _hostility(f: dict[str, float], t: dict[str, Any], side: str) -> int:
    score = 0
    for key in ("breadth_72", "alt_rel_72", "dispersion_72", "btc_vol_percentile"):
        if float(f[key]) >= float(t["q67"][key]):
            score += 1
    if side == "SHORT" and float(f["btc_trend_168"]) >= float(t["q67"]["btc_trend_168"]):
        score += 1
    if side == "LONG" and float(f["btc_trend_168"]) <= float(t["q33"]["btc_trend_168"]):
        score += 1
    return score


def _scale(variant: str, side: str, hostility: int) -> float:
    if variant == BASELINE:
        return 1.0
    if variant == SHORT_ONLY:
        if side == "LONG":
            return 1.0
        return 1.0 if hostility == 0 else 0.50 if hostility == 1 else 0.25 if hostility == 2 else 0.0
    if variant == DIRECTION:
        if side == "LONG":
            return 1.0 if hostility <= 1 else 0.75 if hostility == 2 else 0.50
        return 1.0 if hostility == 0 else 0.50 if hostility == 1 else 0.25 if hostility == 2 else 0.0
    if variant == NO_ZERO:
        if side == "LONG":
            return 1.0 if hostility <= 1 else 0.75 if hostility == 2 else 0.50
        return 1.0 if hostility == 0 else 0.50 if hostility == 1 else 0.25
    raise ValueError(variant)


def _scale_candidates(candidates: dict[str, list[dict[str, Any]]], engine: attr.FeatureEngine,
                      thresholds: dict[str, Any], variant: str) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    out: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in candidates}
    audit: dict[str, Any] = {
        "LONG": {"candidateCount": 0, "keptCount": 0, "zeroedCount": 0, "scaleSum": 0.0},
        "SHORT": {"candidateCount": 0, "keptCount": 0, "zeroedCount": 0, "scaleSum": 0.0},
    }
    for symbol, rows in candidates.items():
        for original in rows:
            row = copy.deepcopy(original)
            side = str(row.get("side", "LONG")).upper()
            f = engine.snapshot(int(row["entryTs"]))
            hostile = _hostility(f, thresholds, side)
            scale = _scale(variant, side, hostile)
            a = audit[side]
            a["candidateCount"] += 1
            a["scaleSum"] += scale
            if scale <= 0.0:
                a["zeroedCount"] += 1
                continue
            a["keptCount"] += 1
            row["v7BaseRiskMultiplier"] = float(row["riskMultiplier"])
            row["v7ExposureScale"] = scale
            row["v7Hostility"] = hostile
            row["riskMultiplier"] = float(row["riskMultiplier"]) * scale
            out[symbol].append(row)
    for side in ("LONG", "SHORT"):
        count = audit[side]["candidateCount"]
        audit[side]["averageCandidateScale"] = audit[side]["scaleSum"] / count if count else 0.0
    return out, audit


def _summary(normal: dict[str, Any], stress: dict[str, Any], exposure_audit: dict[str, Any]) -> dict[str, Any]:
    m, sm = normal["metrics"], stress["metrics"]
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
        "cashPct": float(normal["allocationTimePct"]["averageCashPct"]),
        "long": hist.directional_breakdown(normal["realTrades"]).get("LONG", {}),
        "short": hist.directional_breakdown(normal["realTrades"]).get("SHORT", {}),
        "stressLong": hist.directional_breakdown(stress["realTrades"]).get("LONG", {}),
        "stressShort": hist.directional_breakdown(stress["realTrades"]).get("SHORT", {}),
        "exposureAudit": exposure_audit,
    }


def _run_variant(candles, index, start: int, end: int, normal_candidates, stress_candidates,
                 frozen_dv, thresholds, variant: str) -> dict[str, Any]:
    period = {"fixedWindowStart": start, "fixedWindowEndExclusive": end}
    engine = attr.FeatureEngine(candles, index)
    scaled, exposure_audit = _scale_candidates(normal_candidates, engine, thresholds, variant)
    shadow = {s: list(scaled[s]) for s in base.COMPLEMENTS}
    normal = v6.run_router(candles, index, period, scaled, v6.V6_FULL, frozen_dv, shadow,
                           guard_flags=V6_FLAGS, audit=False)
    stress_scaled, _ = _scale_candidates(stress_candidates, engine, thresholds, variant)
    stress_shadow = {s: list(stress_scaled[s]) for s in base.COMPLEMENTS}
    old_bps, old_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = v6.STRESS_BPS, v6.STRESS_DELAY_BARS
    try:
        stress = v6.run_router(candles, index, period, stress_scaled, v6.V6_FULL, frozen_dv, stress_shadow,
                               guard_flags=V6_FLAGS, audit=False)
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = old_bps, old_delay
    return _summary(normal, stress, exposure_audit)


def main() -> None:
    if _source_hash() != V6_SOURCE_SHA256:
        raise RuntimeError("FROZEN_V6_SOURCE_DRIFT")
    candles, index, _ = v109.b.base.load()
    frozen_periods = base._periods(candles)
    _, models = base.load_candidates(candles, index, frozen_periods)
    frozen_dv_candidates = v6._dv_candidates(candles, index, frozen_periods, models)
    frozen_dv = v6._dv_expectancy(frozen_dv_candidates, frozen_periods)

    feature_engine = attr.FeatureEngine(candles, index)
    thresholds = attr._feature_thresholds(feature_engine)

    results: dict[str, Any] = {}
    for label, start, end in PERIODS:
        normal_candidates = hist._records_for_window(candles, index, models, start, end, base.NORMAL_BPS, base.EXECUTION_DELAY_BARS)
        stress_candidates = hist._records_for_window(candles, index, models, start, end, v6.STRESS_BPS, v6.STRESS_DELAY_BARS)
        results[label] = {
            variant: _run_variant(candles, index, start, end, normal_candidates, stress_candidates, frozen_dv, thresholds, variant)
            for variant in VARIANTS
        }

    baseline_2025 = float(results["2025-26"][BASELINE]["returnPct"])
    for variant in VARIANTS:
        value = float(results["2025-26"][variant]["returnPct"])
        results["2025-26"][variant]["profitRetentionPct"] = value / baseline_2025 * 100.0 if baseline_2025 else None

    out = {
        "researchLine": "PRIORITY_ROUTER_V7_DIRECTION_AWARE_REGIME_SCALING",
        "researchOnly": True,
        "productionChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY_NO_POSITION",
        "oosIsNewEvidence": False,
        "historicalTestIsUntouched": False,
        "v6Frozen": True,
        "v6FreezeCommit": V6_FREEZE_COMMIT,
        "v6SourceSha256": _source_hash(),
        "policy": {
            "features": list(attr.FEATURES),
            "thresholdSource": thresholds.get("selectionSource"),
            "thresholdDevelopment": thresholds.get("development"),
            "thresholdValidation": thresholds.get("validation"),
            "portfolioWideCashController": False,
            "longShortIndependent": True,
            "note": "V6 lifecycle is unchanged; only candidate riskMultiplier is scaled causally at entry. Zero-scale candidates are skipped.",
        },
        "thresholds": thresholds,
        "results": results,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v7-direction-aware-3y.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
