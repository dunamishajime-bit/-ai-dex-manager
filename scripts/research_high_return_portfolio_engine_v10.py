"""High Return Portfolio Engine V10 — annual-return standard correction.

V9 was never backtested. This V10 freezes the intended interpretation before any
result is observed: PENGU-class comparison means >100% in ONE YEAR, not 100%
over three years.

Return standard:
- each non-overlapping historical year must return >= 80% in Normal to survive;
- median of the three annual returns must be >= 100%;
- combined 3Y CAGR must be >= 100%;
- primary candidate additionally passes PF/DD/best-trade/Stress robustness;
- strong candidate requires every annual return >= 100% and 3Y CAGR >= 120%.

80% is a rejection floor, never the objective. No performance is guaranteed.
Historical data is already-inspected design evidence only. Fresh OOS remains
sealed. Research only; no VPS/LIVE/order/deployment path exists here.
"""
from __future__ import annotations

import json
import os
import statistics
from pathlib import Path
from typing import Any

import research_high_return_portfolio_engine_v9 as v9

ANNUAL_HARD_FLOOR_PCT = 80.0
ANNUAL_PRIMARY_MEDIAN_PCT = 100.0
THREE_YEAR_PRIMARY_CAGR_PCT = 100.0
ANNUAL_STRONG_FLOOR_PCT = 100.0
THREE_YEAR_STRONG_CAGR_PCT = 120.0


def _classification(normal: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    labels = ("year1_2023_24", "year2_2024_25", "year3_2025_26")
    annual = [float(normal[x].get("returnPct", -999.0)) for x in labels]
    annual_stress = [float(stress[x].get("returnPct", -999.0)) for x in labels]
    c = normal["combined3Y"]
    cs = stress["combined3Y"]
    cagr = float(c.get("cagrPct", -999.0))
    median_annual = statistics.median(annual)
    min_annual = min(annual)

    # High-return status must not be manufactured by one lucky interval or only by
    # gross exposure. Robustness remains mandatory alongside the return hurdle.
    robust = bool(
        float(c.get("pf") or 0.0) >= 1.40
        and float(c.get("pfWithoutBest") or 0.0) >= 1.25
        and float(c.get("maxDDPct", -999.0)) >= -40.0
        and int(c.get("activeIntervals", 0)) >= 120
        and float(cs.get("cagrPct", -999.0)) >= 45.0
        and float(cs.get("pf") or 0.0) >= 1.08
        and float(cs.get("pfWithoutBest") or 0.0) >= 1.00
        and float(cs.get("maxDDPct", -999.0)) >= -50.0
        and sum(x > 0.0 for x in annual_stress) >= 2
        and min(annual_stress) > -25.0
    )

    annual_floor_pass = min_annual >= ANNUAL_HARD_FLOOR_PCT
    primary_return_pass = bool(
        annual_floor_pass
        and median_annual >= ANNUAL_PRIMARY_MEDIAN_PCT
        and cagr >= THREE_YEAR_PRIMARY_CAGR_PCT
    )
    strong_return_pass = bool(
        min_annual >= ANNUAL_STRONG_FLOOR_PCT
        and cagr >= THREE_YEAR_STRONG_CAGR_PCT
    )
    primary_pass = primary_return_pass and robust
    strong_pass = strong_return_pass and robust

    if not annual_floor_pass:
        status = "ANNUAL_80_FLOOR_FAIL"
    elif not primary_return_pass:
        status = "BELOW_PENGU_CLASS_RETURN_STANDARD"
    elif not robust:
        status = "RETURN_PASS_ROBUSTNESS_FAIL"
    elif strong_pass:
        status = "STRONG_100PCT_PLUS_ANNUAL_CANDIDATE"
    else:
        status = "100PCT_CLASS_CANDIDATE"

    return {
        "annualReturnPct": dict(zip(labels, annual)),
        "annualStressReturnPct": dict(zip(labels, annual_stress)),
        "minimumAnnualReturnPct": min_annual,
        "medianAnnualReturnPct": median_annual,
        "combined3YCagrPct": cagr,
        "annual80FloorPass": annual_floor_pass,
        "primaryReturnPass": primary_return_pass,
        "strongReturnPass": strong_return_pass,
        "robustnessPass": robust,
        "primaryCandidatePass": primary_pass,
        "strongCandidatePass": strong_pass,
        "status": status,
    }


def main() -> None:
    candles, idx, _ = v9.v109.b.base.load()
    for s in v9.ALL:
        if s not in candles:
            raise RuntimeError(f"MISSING_SYMBOL:{s}")
    if v9.END_2026 > v9.hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")

    normal: dict[str, Any] = {}
    stress: dict[str, Any] = {}
    for label, (start, end) in v9.PERIODS.items():
        normal[label] = v9.simulate(candles, idx, start, end, v9.NORMAL_BPS, 0)["metrics"]
        stress[label] = v9.simulate(candles, idx, start, end, v9.STRESS_BPS, v9.STRESS_DELAY)["metrics"]

    classification = _classification(normal, stress)
    candidate = bool(classification["primaryCandidatePass"])
    out = {
        "researchLine": "HIGH_RETURN_PORTFOLIO_ENGINE_V10",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "v9BacktestedBeforeThisCorrection": False,
        "historicalEvidenceStatus": "DESIGN_SANITY_ONLY_ALREADY_INSPECTED",
        "returnStandard": {
            "annual80PctIsMinimumFloorNotTarget": True,
            "minimumEveryYearPct": ANNUAL_HARD_FLOOR_PCT,
            "primaryMedianAnnualPct": ANNUAL_PRIMARY_MEDIAN_PCT,
            "primary3YCagrPct": THREE_YEAR_PRIMARY_CAGR_PCT,
            "strongMinimumEveryYearPct": ANNUAL_STRONG_FLOOR_PCT,
            "strong3YCagrPct": THREE_YEAR_STRONG_CAGR_PCT,
            "guaranteed": False,
        },
        "architecture": {
            "source": "V9 frozen before first result",
            "btcRole": "REFERENCE_ONLY",
            "tradeUniverse": list(v9.TRADE),
            "profitModes": ["OWNERSHIP", "SHOCK_REVERSAL", "DISPERSION_LS"],
            "rebalanceHours": v9.REBALANCE_HOURS,
            "maxGrossResearchOnly": v9.MAX_GROSS_RESEARCH,
            "pairSpecificParameters": False,
            "parameterGrid": False,
            "warning": "gross exposure cannot substitute for PF/DD/Stress robustness",
        },
        "periods": v9.PERIODS,
        "normal": normal,
        "stress": stress,
        "classification": classification,
        "status": classification["status"],
        "nextAction": "FREEZE_AND_ONE_FRESH_OOS_TEST" if candidate else "STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "high-return-portfolio-engine-v10.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    (root / "high-return-portfolio-engine-v10.md").write_text(
        "# High Return Portfolio Engine V10\n\n```json\n" + json.dumps(out, indent=2, sort_keys=True) + "\n```\n",
        encoding="utf-8",
    )
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
