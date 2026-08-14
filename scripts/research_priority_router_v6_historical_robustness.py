"""Frozen V6 historical robustness harness.

This module deliberately imports the V6 implementation without modifying it.
The V6 model/score inputs are regenerated from the frozen V6 development and
validation split, while only the evaluation window changes.  No historical
result is used to alter V6 or to select a new component.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as base
import research_priority_router_v3 as v3
import research_priority_router_v6 as v6
import research_priority_router_v5 as v5


HOUR = base.HOUR
DAY = base.DAY
JST = timezone(timedelta(hours=9))
DATA_START = 1661990400000
DATA_END = 1782864000000
KNOWN_OOS_START = 1751324400000
KNOWN_OOS_END = 1782860400000
V6_FREEZE_COMMIT = "9a795bb478e4a2d21ab21552a650a3c8e2b693c7"
V6_FULL_FLAGS = {v6.GUARD_SAME_DAY, v6.GUARD_CHURN}
V6_VARIANT = v6.V6_FULL
V1_VARIANT = v6.V1_BASELINE


def jst08(year: int, month: int, day: int) -> int:
    return int(datetime(year, month, day, 8, tzinfo=JST).timestamp() * 1000)


PRIOR_YEAR_2 = ("PRIOR_YEAR_2", jst08(2023, 7, 1), jst08(2024, 7, 1))
PRIOR_YEAR_1 = ("PRIOR_YEAR_1", jst08(2024, 7, 1), jst08(2025, 7, 1))
PRIOR_2Y = ("PRIOR_2Y_COMBINED", jst08(2023, 7, 1), jst08(2025, 7, 1))
FULL_3Y = ("FULL_3Y_DIAGNOSTIC", jst08(2023, 7, 1), jst08(2026, 7, 1))
ROLLING = [(f"ROLLING_{y:04d}-{m:02d}", jst08(y, m, 1), jst08(y + 1, m, 1)) for y, m in ((2023, 7), (2023, 10), (2024, 1), (2024, 4), (2024, 7), (2025, 7))]
EVALUATION_WINDOWS = (PRIOR_YEAR_1, PRIOR_YEAR_2, PRIOR_2Y, FULL_3Y)


def _cache_integrity(root: Path) -> dict[str, Any]:
    symbols = ("BTC", "SOL", "LINK", "ETH", "BNB", "AVAX")
    files: dict[str, str] = {}
    duplicate_counts: dict[str, int] = {}
    continuity_gaps: dict[str, int] = {}
    coverage: dict[str, Any] = {}
    missing: list[str] = []
    for symbol in symbols:
        target = root / "consolidated" / f"{symbol}USDT-{DATA_START}-{DATA_END}-v2.json"
        if not target.is_file():
            target = root / "consolidated" / f"{symbol}USDT-{DATA_START}-{DATA_END}-v3.json"
        if not target.is_file():
            missing.append(str(target))
            continue
        raw = target.read_bytes()
        files[symbol] = hashlib.sha256(raw).hexdigest()
        rows = json.loads(raw.decode("utf-8"))["candles"]
        timestamps = [int(row["ts"]) for row in rows]
        duplicate_counts[symbol] = len(timestamps) - len(set(timestamps))
        continuity_gaps[symbol] = sum(1 for a, b in zip(timestamps, timestamps[1:]) if b - a != HOUR)
        coverage[symbol] = {"firstTs": timestamps[0], "lastTs": timestamps[-1], "candleCount": len(timestamps)}
    combined = hashlib.sha256("".join(f"{s}:{files.get(s, '')}" for s in symbols).encode("utf-8")).hexdigest()
    return {"root": str(root), "symbols": list(symbols), "missingFiles": missing, "perSymbolSha256": files, "combinedSha256": combined, "duplicateCandles": duplicate_counts, "timestampContinuityGaps": continuity_gaps, "coverage": coverage, "integrityPass": not missing and all(value == 0 for value in duplicate_counts.values()) and all(value == 0 for value in continuity_gaps.values())}


def _historical_evidence_audit(repo_root: Path) -> dict[str, Any]:
    # Existing non-V6 historical reports contain the requested timestamps.
    # Therefore these periods cannot be called completely untouched evidence,
    # even though they were not V6 development/validation windows.
    matches = [
        "reports/bnb-rotation/a_attack-equity_curve.csv",
        "reports/addon-ideas/base/retq22-equity_curve.csv",
        "reports/idle-surge-addon/idle_surge_with_smooth_bonus/retq22-equity_curve.csv",
        "scripts/tmp-debug-regime.ts",
    ]
    existing = [path for path in matches if (repo_root / path).is_file()]
    period_flags = {}
    for name, start, end in EVALUATION_WINDOWS + tuple(ROLLING):
        overlaps_known = not (end <= KNOWN_OOS_START or start >= KNOWN_OOS_END)
        period_flags[name] = {"isUntouchedEvidence": False, "wasUsedInDevelopment": False, "wasUsedInValidation": False, "wasPreviouslyInspected": True, "overlapsKnownOos": overlaps_known}
    return {"historicalTestIsUntouched": False, "reason": "Repository contains pre-existing non-V6 research artifacts covering the requested historical timestamps; V6 development/validation itself did not use those periods.", "evidencePaths": existing, "periods": period_flags}


def _records_for_window(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], models: dict[str, dict[str, Any]], start: int, end: int, cost_bps: float, delay_bars: int) -> dict[str, list[dict[str, Any]]]:
    original_bps, original_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = cost_bps, delay_bars
    try:
        out: dict[str, list[dict[str, Any]]] = {}
        for symbol in base.TRADE_SYMBOLS:
            raw = base._champion_records(symbol, candles, index, start, end, models[symbol])
            out[symbol] = sorted([base.normalize_record(symbol, row, candles, index, models[symbol]) for row in raw], key=lambda row: (int(row["entryTs"]), int(row["exitTs"])))
        return out
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = original_bps, original_delay


def _summary_with_dependency(run: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    summary = v6._summary(run, stress)
    real = run["realTrades"]
    positive_trade_pnl = sum(float(row["portfolioPnlPctPoints"]) for row in real if float(row["portfolioPnlPctPoints"]) > 0)
    profitable_symbols = [symbol for symbol, value in summary["contributionPctPoints"].items() if value > 0]
    largest = max(summary["contributionPctPoints"].values()) if summary["contributionPctPoints"] else 0.0
    summary.update({"profitableSymbolsCount": len(profitable_symbols), "largestContributorSharePct": largest / positive_trade_pnl * 100.0 if positive_trade_pnl > 0 else 0.0, "top5TradeDependencyPct": summary["top5ContributionPctPoints"] / positive_trade_pnl * 100.0 if positive_trade_pnl > 0 else 0.0})
    return summary


def _trade_fingerprint(run: dict[str, Any]) -> dict[str, Any]:
    """Stable fingerprint of the realized PnL vector for parity checks.

    The fingerprint includes only realized trade identity and portfolio PnL,
    in the router's deterministic order.  It is diagnostic metadata and is not
    used by the router or any model-selection path.
    """
    vector = [
        {
            "entryTs": int(row.get("entryTs", 0)),
            "exitTs": int(row.get("exitTs", 0)),
            "symbol": str(row.get("symbol", "")),
            "side": str(row.get("side", "")),
            "portfolioPnlPctPoints": float(row.get("portfolioPnlPctPoints", 0.0)),
        }
        for row in run.get("realTrades", [])
    ]
    encoded = json.dumps(vector, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "count": len(vector),
        "pnlSumPctPoints": sum(float(row["portfolioPnlPctPoints"]) for row in vector),
    }


def _candidate_lookup(candidates: dict[str, list[dict[str, Any]]]) -> dict[tuple[str, int, str], dict[str, Any]]:
    return {(str(row["symbol"]), int(row["entryTs"]), str(row["side"])): row for rows in candidates.values() for row in rows}


def _sol_reject_attribution(run: dict[str, Any], candidates: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    lookup = _candidate_lookup(candidates)
    out = {"triggeredCount": 0, "preventedTrades": 0, "preventedWinners": 0, "preventedLosers": 0, "preventedWinnerPnlPctPoints": 0.0, "preventedLoserPnlPctPoints": 0.0}
    for decision in run["preemptionDecisions"]:
        if decision.get("reason") != "SOL_SCORE_REJECT":
            continue
        out["triggeredCount"] += 1
        row = next((candidate for candidate in candidates.get("SOL", []) if int(candidate["entryTs"]) == int(decision["timestamp"])), None)
        if row is None:
            continue
        value = float(row["netReturnPct"])
        out["preventedTrades"] += 1
        if value > 0:
            out["preventedWinners"] += 1
            out["preventedWinnerPnlPctPoints"] += value
        else:
            out["preventedLosers"] += 1
            out["preventedLoserPnlPctPoints"] += value
    out["netAvoidedPnlPctPoints"] = out["preventedWinnerPnlPctPoints"] + out["preventedLoserPnlPctPoints"]
    return out


def _lifecycle_diagnostics(base_run: dict[str, Any], base_stress: dict[str, Any], component_run: dict[str, Any], component_stress: dict[str, Any], candidates: dict[str, list[dict[str, Any]]], component: str) -> dict[str, Any]:
    if component == "SOL_CONDITIONAL":
        attribution = _sol_reject_attribution(component_run, candidates)
    else:
        attribution = {"triggeredCount": sum(int(values.get("preventedTrades", 0)) for values in component_run["guardAttribution"].get(component, {}).values())}
        attribution["preventedTrades"] = attribution["triggeredCount"]
        attribution["preventedWinners"] = sum(int(values.get("preventedWinners", 0)) for values in component_run["guardAttribution"].get(component, {}).values())
        attribution["preventedLosers"] = sum(int(values.get("preventedLosers", 0)) for values in component_run["guardAttribution"].get(component, {}).values())
        attribution["preventedWinnerPnlPctPoints"] = sum(float(values.get("preventedWinnerPnlPctPoints", 0.0)) for values in component_run["guardAttribution"].get(component, {}).values())
        attribution["preventedLoserPnlPctPoints"] = sum(float(values.get("preventedLoserPnlPctPoints", 0.0)) for values in component_run["guardAttribution"].get(component, {}).values())
        attribution["netAvoidedPnlPctPoints"] = attribution["preventedWinnerPnlPctPoints"] + attribution["preventedLoserPnlPctPoints"]
    return {**attribution, "normalPnlImpactPctPoints": component_run["metrics"]["oneYearReturnPct"] - base_run["metrics"]["oneYearReturnPct"], "stressPnlImpactPctPoints": component_stress["metrics"]["oneYearReturnPct"] - base_stress["metrics"]["oneYearReturnPct"], "turnoverRemovedPct": base_run["metrics"]["portfolioTurnoverPctOfInitialEquity"] - component_run["metrics"]["portfolioTurnoverPctOfInitialEquity"], "attributionBasis": "candidate netReturnPct for prevented trades; portfolio impact is separately reported"}


def _run_window(name: str, start: int, end: int, candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], models: dict[str, dict[str, Any]], frozen_dv: dict[str, dict[str, Any]], candidates: dict[str, list[dict[str, Any]]], stress_candidates: dict[str, list[dict[str, Any]]], evidence: dict[str, Any], include_lifecycle: bool = False) -> dict[str, Any]:
    period = {"fixedWindowStart": start, "fixedWindowEndExclusive": end}
    shadow = {symbol: list(candidates[symbol]) for symbol in base.COMPLEMENTS}
    stress_shadow = {symbol: list(stress_candidates[symbol]) for symbol in base.COMPLEMENTS}
    v1 = v6.run_router(candles, index, period, candidates, V1_VARIANT, frozen_dv, shadow, guard_flags=set(), audit=True)
    v6full = v6.run_router(candles, index, period, candidates, V6_VARIANT, frozen_dv, shadow, guard_flags=V6_FULL_FLAGS, audit=True)
    component_runs = {}
    if include_lifecycle:
        component_runs = {
            "SAME_DAY_ROUNDTRIP_GUARD": v6.run_router(candles, index, period, candidates, V1_VARIANT, frozen_dv, shadow, guard_flags={v6.GUARD_SAME_DAY}, audit=False),
            "PREEMPTION_CHURN_GUARD": v6.run_router(candles, index, period, candidates, V1_VARIANT, frozen_dv, shadow, guard_flags={v6.GUARD_CHURN}, audit=False),
            "SOL_CONDITIONAL": v6.run_router(candles, index, period, candidates, v6.V6_SOL, frozen_dv, shadow, guard_flags=set(), audit=False),
        }
    original_bps, original_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = v6.STRESS_BPS, v6.STRESS_DELAY_BARS
    try:
        v1_stress = v6.run_router(candles, index, period, stress_candidates, V1_VARIANT, frozen_dv, stress_shadow, guard_flags=set(), audit=False)
        v6full_stress = v6.run_router(candles, index, period, stress_candidates, V6_VARIANT, frozen_dv, stress_shadow, guard_flags=V6_FULL_FLAGS, audit=False)
        component_stress = {}
        if include_lifecycle:
            component_stress = {
                "SAME_DAY_ROUNDTRIP_GUARD": v6.run_router(candles, index, period, stress_candidates, V1_VARIANT, frozen_dv, stress_shadow, guard_flags={v6.GUARD_SAME_DAY}, audit=False),
                "PREEMPTION_CHURN_GUARD": v6.run_router(candles, index, period, stress_candidates, V1_VARIANT, frozen_dv, stress_shadow, guard_flags={v6.GUARD_CHURN}, audit=False),
                "SOL_CONDITIONAL": v6.run_router(candles, index, period, stress_candidates, v6.V6_SOL, frozen_dv, stress_shadow, guard_flags=set(), audit=False),
            }
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = original_bps, original_delay
    v1_summary = _summary_with_dependency(v1, v1_stress)
    full_summary = _summary_with_dependency(v6full, v6full_stress)
    lifecycle = {component: _lifecycle_diagnostics(v1, v1_stress, component_runs[component], component_stress[component], candidates, component if component != "SOL_CONDITIONAL" else "SOL_CONDITIONAL") for component in component_runs}
    return {"period": {"name": name, "start": start, "endExclusive": end, "hours": (end - start) // HOUR}, "evidence": evidence, "v1": v1_summary, "v6": full_summary, "improvement": {"returnDeltaPctPoints": full_summary["returnPct"] - v1_summary["returnPct"], "pfDelta": full_summary["pf"] - v1_summary["pf"], "ddImprovementPctPoints": full_summary["maxDDPct"] - v1_summary["maxDDPct"], "stressPfDelta": full_summary["stressPf"] - v1_summary["stressPf"], "turnoverDeltaPct": full_summary["turnoverPct"] - v1_summary["turnoverPct"], "stressReturnDeltaPctPoints": full_summary["stressReturnPct"] - v1_summary["stressReturnPct"]}, "lifecycle": lifecycle, "preemptionAudit": {"v1": v5._aggregate_audit(v1["preemptionEvents"]), "v6": v5._aggregate_audit(v6full["preemptionEvents"])}, "parityFingerprints": {"v1Normal": _trade_fingerprint(v1), "v6Normal": _trade_fingerprint(v6full), "v1Stress": _trade_fingerprint(v1_stress), "v6Stress": _trade_fingerprint(v6full_stress)} }


def _stable_counts(years: list[dict[str, Any]]) -> dict[str, int]:
    return {"v6PositiveReturnYears": sum(x["v6"]["returnPct"] > 0 for x in years), "v6PfAbove1Years": sum((x["v6"]["pf"] or 0) > 1 for x in years), "v6BeatV1ReturnYears": sum(x["improvement"]["returnDeltaPctPoints"] > 0 for x in years), "v6BeatV1PfYears": sum(x["improvement"]["pfDelta"] > 0 for x in years), "v6ImprovedV1DdYears": sum(x["improvement"]["ddImprovementPctPoints"] > 0 for x in years), "v6StressPositiveYears": sum(x["v6"]["stressReturnPct"] > 0 for x in years), "v6StressPfAbove1Years": sum((x["v6"]["stressPf"] or 0) > 1 for x in years), "v6BeatV1StressYears": sum(x["improvement"]["stressPfDelta"] > 0 for x in years)}


def _parity_audit(runs: dict[str, Any], rolling_results: list[dict[str, Any]]) -> dict[str, Any]:
    rolling_by_name = {row["period"]["name"]: row for row in rolling_results}
    pairs = (("PRIOR_YEAR_2", "ROLLING_2023-07"), ("PRIOR_YEAR_1", "ROLLING_2024-07"))
    checks = []
    for annual_name, rolling_name in pairs:
        annual = runs[annual_name]
        rolling = rolling_by_name[rolling_name]
        same_window = annual["period"]["start"] == rolling["period"]["start"] and annual["period"]["endExclusive"] == rolling["period"]["endExclusive"]
        metric_fields = ("returnPct", "cagrPct", "pf", "pfWithoutBest", "maxDDPct", "stressReturnPct", "stressPf", "stressDDPct", "trades", "turnoverPct")
        metric_diffs = {}
        for variant in ("v1", "v6"):
            for field in metric_fields:
                left = float(annual[variant][field])
                right = float(rolling[variant][field])
                metric_diffs[f"{variant}.{field}"] = left - right
        fp_match = all(annual["parityFingerprints"][key] == rolling["parityFingerprints"][key] for key in ("v1Normal", "v6Normal", "v1Stress", "v6Stress"))
        max_abs_metric_diff = max((abs(value) for value in metric_diffs.values()), default=0.0)
        checks.append({"annual": annual_name, "rolling": rolling_name, "sameWindow": same_window, "maxAbsMetricDiff": max_abs_metric_diff, "metricDiffs": metric_diffs, "tradePnlFingerprintsMatch": fp_match, "pass": same_window and max_abs_metric_diff == 0.0 and fp_match})
    return {"method": "same start/end timestamps, summary metrics, and realized normal/stress PnL-vector SHA256", "checks": checks, "pass": all(check["pass"] for check in checks)}


def main() -> None:
    repo_root = Path.cwd()
    cache_root = repo_root / ".cache" / "perp-research-usdm"
    integrity = _cache_integrity(cache_root)
    if not integrity["integrityPass"]:
        raise RuntimeError("CACHE_INTEGRITY_FAILED:" + json.dumps(integrity))
    evidence = _historical_evidence_audit(repo_root)
    candles, index, _ = v109.b.base.load()
    frozen_periods = base._periods(candles)
    _, models = base.load_candidates(candles, index, frozen_periods)
    frozen_dv_candidates = v6._dv_candidates(candles, index, frozen_periods, models)
    frozen_dv = v6._dv_expectancy(frozen_dv_candidates, frozen_periods)
    candidate_cache: dict[tuple[int, int], tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]] = {}

    def candidate_pair(start: int, end: int) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
        """Build each evaluation window's candidate stream with a fresh state.

        Models remain the frozen V6 models.  Only simulator lifecycle state is
        reset at the requested window boundary, matching the fixed-window V6
        runner and making equal windows comparable by construction.
        """
        key = (int(start), int(end))
        if key not in candidate_cache:
            candidate_cache[key] = (
                _records_for_window(candles, index, models, start, end, 10.0, 0),
                _records_for_window(candles, index, models, start, end, 30.0, 1),
            )
        return candidate_cache[key]

    runs: dict[str, Any] = {}
    for name, start, end in EVALUATION_WINDOWS:
        candidates, stress_candidates = candidate_pair(start, end)
        runs[name] = _run_window(name, start, end, candles, index, models, frozen_dv, candidates, stress_candidates, evidence["periods"][name], include_lifecycle=name in {"PRIOR_YEAR_1", "PRIOR_YEAR_2"})
    rolling_results = []
    for name, start, end in ROLLING:
        candidates, stress_candidates = candidate_pair(start, end)
        rolling_results.append(_run_window(name, start, end, candles, index, models, frozen_dv, candidates, stress_candidates, evidence["periods"][name], include_lifecycle=False))
    years = [runs["PRIOR_YEAR_1"], runs["PRIOR_YEAR_2"]]
    parity_audit = _parity_audit(runs, rolling_results)
    result = {
        "status": "RESEARCH_ONLY", "productionChanged": False, "vpsChanged": False, "realTradingEnabled": False, "btcRole": "REFERENCE_ONLY; position/order/PnL/allocation=0", "v6FreezeCommit": V6_FREEZE_COMMIT, "v6Variant": V6_VARIANT, "v6FrozenFlags": sorted(V6_FULL_FLAGS), "v6FrozenModelsSource": "V6 Run development/validation split regenerated from frozen sources; no historical result used", "candidateGenerationMode": "WINDOW_LOCAL_RESET_WITH_FROZEN_MODELS",
        "normalAssumptions": {"roundTripBps": 10.0, "executionDelayBars": 0}, "stressAssumptions": {"roundTripBps": 30.0, "executionDelayBars": 1}, "cacheIntegrity": integrity, "historicalEvidenceAudit": evidence, "historicalTestIsUntouched": evidence["historicalTestIsUntouched"], "frozenDvExpectancy": frozen_dv,
        "periods": {name: {"start": start, "endExclusive": end, "oosIsNewEvidence": False, "isUntouchedEvidence": evidence["periods"][name]["isUntouchedEvidence"]} for name, start, end in EVALUATION_WINDOWS},
        "runs": runs, "rollingWindows": rolling_results, "parityAudit": parity_audit, "annualStability": _stable_counts(years), "rollingStability": {"v6BeatV1ReturnRatio": sum(x["improvement"]["returnDeltaPctPoints"] > 0 for x in rolling_results) / len(rolling_results), "v6ImprovedV1DdRatio": sum(x["improvement"]["ddImprovementPctPoints"] > 0 for x in rolling_results) / len(rolling_results), "v6ImprovedV1StressPfRatio": sum(x["improvement"]["stressPfDelta"] > 0 for x in rolling_results) / len(rolling_results)},
        "diagnostics": {"v6Changed": False, "knownOosIncludedOnlyInFull3yDiagnostic": True, "futureInformationUsedForRouter": False, "resultBasedRerun": False, "historicalTestIsUntouched": evidence["historicalTestIsUntouched"]},
    }
    out_root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    out_root.mkdir(parents=True, exist_ok=True)
    path = out_root / "priority-router-v6-historical-robustness-2y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "historicalTestIsUntouched": result["historicalTestIsUntouched"], "annualStability": result["annualStability"], "rollingStability": result["rollingStability"], "runs": {name: {"v1": run["v1"], "v6": run["v6"], "improvement": run["improvement"]} for name, run in runs.items()}}, indent=2))


if __name__ == "__main__":
    main()
