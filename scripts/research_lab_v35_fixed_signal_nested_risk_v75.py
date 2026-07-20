from __future__ import annotations

import datetime as dt
import json
import math
import os
import random
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_major_core_nested_v73 as stats
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_asymmetric_return_stack_v32 as v32
import research_lab_resilient_profit_stack_v34 as v34

BAR = 12 * stats.HOUR
DAY = stats.DAY
RANDOM_SEED = 75075
CORE_GROSS_CAP = 1.55
CASH_RESERVE = 0.02


def risk_space() -> List[stats.RiskConfig]:
    result = []
    for bull in (0.75, 0.90, 1.05):
        for bear in (0.50, 0.75):
            for stop in (2.5, 3.5):
                for target_vol in (40.0, 55.0):
                    for max_symbol in (0.60, 0.75):
                        for dd_start in (0.12, 0.18):
                            result.append(stats.RiskConfig(bull, bear, stop, target_vol, max_symbol, dd_start))
    return result


def baseline_risk() -> stats.RiskConfig:
    return stats.RiskConfig(0.90, 0.75, 3.5, 55.0, 0.75, 0.18)


def build_v35_fixed_targets(bars: Dict[str, List[dict]], funding: Dict[str, Dict[int, float]], times: List[int]) -> tuple[Dict[int, Dict[str, float]], dict]:
    indexes = {symbol: {int(row["ts"]): index for index, row in enumerate(rows)} for symbol, rows in bars.items()}
    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    raw_targets = v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    feature_map = v34.features_with_vol(times, raw_targets, bars, indexes, funding)
    fixed: Dict[int, Dict[str, float]] = {}
    for ts in times:
        raw = dict(raw_targets.get(ts, {}))
        f = feature_map.get(ts, {})
        bull = any(weight > 0 for symbol, weight in raw.items() if symbol != "BTC")
        multiplier = 1.0
        if bull:
            strong = bool(
                f.get("closeAboveSma20", False)
                and float(f.get("mom20", 0.0)) >= 10.0
                and float(f.get("mom3", 0.0)) > 0.0
            )
            brake = bool(
                float(f.get("shock", 0.0)) <= -4.0
                or float(f.get("skew", 1.0)) > 1.35
                or not f.get("closeAboveSma20", False)
            )
            multiplier = 0.35 if brake else 1.40 if strong else 1.20
        scaled = {symbol: weight * multiplier for symbol, weight in raw.items()}
        gross = sum(abs(value) for value in scaled.values())
        if gross > 2.0:
            factor = 2.0 / gross
            scaled = {symbol: value * factor for symbol, value in scaled.items()}
        fixed[ts] = scaled
    return fixed, feature_map


def simulate(targets, risk, bars, features, funding, times, severe=False, bundle_shift=None):
    old_cap, old_reserve = stats.GROSS_CAP, stats.CASH_RESERVE
    stats.GROSS_CAP, stats.CASH_RESERVE = CORE_GROSS_CAP, CASH_RESERVE
    try:
        return stats.simulate(targets, risk, bars, features, funding, times, severe, bundle_shift)
    finally:
        stats.GROSS_CAP, stats.CASH_RESERVE = old_cap, old_reserve


def fold_boundaries(times: Sequence[int]) -> List[Tuple[int, int]]:
    return stats.outer_folds(times)


def conservative_select(risks, rows, severe_rows, train_start, validation_start, validation_end) -> tuple[stats.RiskConfig, dict]:
    strict = stats.select_risk(risks, rows, severe_rows, train_start, validation_start, validation_end)
    if strict is not None:
        return strict, {"fallback": False, "risk": strict.config_id}
    evaluated = []
    for risk in risks:
        dev = stats.metrics(rows[risk.config_id], train_start, validation_start)
        dev_s = stats.metrics(severe_rows[risk.config_id], train_start, validation_start)
        val = stats.metrics(rows[risk.config_id], validation_start, validation_end)
        val_s = stats.metrics(severe_rows[risk.config_id], validation_start, validation_end)
        if dev["compoundedReturnPct"] > 0 and val["compoundedReturnPct"] > 0 and dev["maxDrawdownPct"] >= -35 and val["maxDrawdownPct"] >= -22 and dev_s["compoundedReturnPct"] >= -20 and val_s["compoundedReturnPct"] >= -12:
            evaluated.append(((val_s["compoundedReturnPct"], val["compoundedReturnPct"], val["maxDrawdownPct"], dev_s["compoundedReturnPct"], -risk.bull_gross, -risk.bear_gross, risk.stop_atr), risk))
    evaluated.sort(key=lambda item: item[0], reverse=True)
    if not evaluated:
        selected = baseline_risk()
    else:
        top = [item[1] for item in evaluated[: min(12, len(evaluated))]]
        top.sort(key=lambda risk: (risk.bull_gross, risk.bear_gross, risk.max_symbol_gross, -risk.stop_atr, risk.target_vol_pct))
        selected = top[0]
    return selected, {"fallback": True, "eligible": len(evaluated), "risk": selected.config_id}


def splice(parts):
    result = []
    for start, end, rows in parts:
        result.extend(row for row in rows if start <= int(row["ts"]) < end)
    return sorted(result, key=lambda row: int(row["ts"]))


def final_risk(selections: Sequence[stats.RiskConfig]) -> stats.RiskConfig:
    counts: Dict[str, int] = {}
    for risk in selections:
        counts[risk.config_id] = counts.get(risk.config_id, 0) + 1
    ranked = sorted(selections, key=lambda risk: (counts[risk.config_id], -risk.bull_gross, -risk.bear_gross, risk.stop_atr, -risk.dd_brake_start), reverse=True)
    return ranked[0]


def effective_trials(months_by_risk: Dict[str, List[float]]) -> int:
    values = list(months_by_risk.values())
    if len(values) < 2:
        return 1
    length = min(len(item) for item in values)
    correlations = []
    for index in range(min(20, len(values))):
        left = values[index][:length]
        for right in values[index + 1:min(20, len(values))]:
            if statistics.pstdev(left) == 0 or statistics.pstdev(right[:length]) == 0:
                continue
            mean_l, mean_r = statistics.fmean(left), statistics.fmean(right[:length])
            cov = statistics.fmean((left[i] - mean_l) * (right[i] - mean_r) for i in range(length))
            correlations.append(cov / (statistics.pstdev(left) * statistics.pstdev(right[:length])))
    rho = max(0.0, min(0.99, statistics.fmean(correlations) if correlations else 0.0))
    return max(2, round(1 + (len(values) - 1) * (1 - rho)))


def reality_against_cash(months_by_risk: Dict[str, List[float]]) -> dict:
    common = min(len(values) for values in months_by_risk.values())
    return stats.reality_and_spa(months_by_risk, [0.0] * common, 1000)


def rounded(value):
    return stats.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    bars, funding, times, coverage = stats.fetch_data()
    features = stats.build_features(bars)
    targets, v35_features = build_v35_fixed_targets(bars, funding, times)
    risks = risk_space()
    rows = {risk.config_id: simulate(targets, risk, bars, features, funding, times, False) for risk in risks}
    severe_rows = {risk.config_id: simulate(targets, risk, bars, features, funding, times, True) for risk in risks}
    folds = fold_boundaries(times)
    parts, severe_parts, fold_results, selections = [], [], [], []
    for fold_index, (test_start, test_end) in enumerate(folds):
        train_start, validation_start, validation_end = stats.inner_bounds(times[0], test_start)
        selected, audit = conservative_select(risks, rows, severe_rows, train_start, validation_start, validation_end)
        selections.append(selected)
        parts.append((test_start, test_end, rows[selected.config_id]))
        severe_parts.append((test_start, test_end, severe_rows[selected.config_id]))
        fold_results.append({
            "fold": fold_index + 1,
            "testStart": dt.datetime.fromtimestamp(test_start / 1000, tz=dt.timezone.utc).isoformat(),
            "testEnd": dt.datetime.fromtimestamp(test_end / 1000, tz=dt.timezone.utc).isoformat(),
            "risk": asdict(selected),
            "selectionAudit": audit,
            "test": stats.metrics(rows[selected.config_id], test_start, test_end),
            "testSevere": stats.metrics(severe_rows[selected.config_id], test_start, test_end),
        })
    oos, oos_severe = splice(parts), splice(severe_parts)
    oos_start, oos_end = folds[0][0], folds[-1][1]
    selected = final_risk(selections)
    full_start, full_end = times[0], times[-1] + BAR
    final_rows = rows[selected.config_id]
    final_severe = severe_rows[selected.config_id]
    months_by_risk = {risk.config_id: stats.monthly_returns(rows[risk.config_id], full_start, full_end) for risk in risks}
    trial_count = effective_trials(months_by_risk)
    dsr = stats.deflated_sharpe(stats.monthly_returns(oos, oos_start, oos_end), trial_count)
    reality = reality_against_cash(months_by_risk)
    full = stats.metrics(final_rows, full_start, full_end)
    permutation = stats.permutation_test(targets, selected, bars, features, funding, times, full["compoundedReturnPct"], 500)
    positive = sum(item["test"]["compoundedReturnPct"] > 0 for item in fold_results)
    positive_severe = sum(item["testSevere"]["compoundedReturnPct"] > 0 for item in fold_results)
    oos_metric = stats.metrics(oos, oos_start, oos_end)
    oos_severe_metric = stats.metrics(oos_severe, oos_start, oos_end)
    robust = bool(
        positive >= 4
        and positive_severe >= 3
        and oos_metric["compoundedReturnPct"] > 0
        and oos_severe_metric["compoundedReturnPct"] > 0
        and oos_metric["maxDrawdownPct"] >= -25
        and oos_severe_metric["maxDrawdownPct"] >= -35
        and (dsr["probability"] or 0) >= 0.90
        and (reality["realityCheckP"] is not None and reality["realityCheckP"] <= 0.10)
        and (permutation["pValue"] is not None and permutation["pValue"] <= 0.10)
    )
    status = "V35_FIXED_SIGNAL_RISK_ROBUST_PASS" if robust else "V35_FIXED_SIGNAL_RESEARCH_ONLY"
    freeze = {
        "strategyId": "V35_FIXED_SIGNAL_NESTED_RISK_V75",
        "effectiveAfter": "2026-07-20T00:00:00+00:00",
        "v35Signal": {
            "strongMultiplier": 1.40,
            "normalMultiplier": 1.20,
            "brakeMultiplier": 0.35,
            "signalRetuned": False,
        },
        "risk": asdict(selected),
        "coreGrossCap": CORE_GROSS_CAP,
        "cashReservePct": CASH_RESERVE * 100.0,
        "minimumForwardTradesBeforeRetune": 30,
        "minimumForwardMonthsBeforeRetune": 6,
    }
    result = rounded({
        "version": 75,
        "strategyId": "V35_FIXED_SIGNAL_NESTED_RISK_V75",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "robustPass": robust,
        "signal": {
            "source": "DISDEX_RESILIENT_PROFIT_MAIN_V35 fixed Bagged Core",
            "retuned": False,
            "strongMultiplier": 1.40,
            "normalMultiplier": 1.20,
            "brakeMultiplier": 0.35,
            "universe": ["BTC", "ETH", "BNB", "SOL"],
        },
        "riskCandidateCount": len(risks),
        "effectiveMultipleTestingTrials": trial_count,
        "outerFolds": fold_results,
        "positiveOuterFolds": positive,
        "positiveOuterSevereFolds": positive_severe,
        "outerOos": oos_metric,
        "outerOosSevere": oos_severe_metric,
        "selectedRisk": asdict(selected),
        "full": full,
        "fullSevere": stats.metrics(final_severe, full_start, full_end),
        "multipleTesting": {
            "deflatedSharpe": dsr,
            "whiteRealityCheckAndSpaAgainstCash": reality,
            "monthlyDecisionBlockPermutation": permutation,
        },
        "riskSpecification": {
            "bullGrossMultiplierOnFixedV35": selected.bull_gross,
            "btcBearGrossMultiplierOnFixedV35": selected.bear_gross,
            "perSymbolHardStopAtr": selected.stop_atr,
            "targetVolatilityPct": selected.target_vol_pct,
            "perSymbolGrossCap": selected.max_symbol_gross,
            "drawdownBrakeStartPct": selected.dd_brake_start * 100.0,
            "drawdownScaleAtStart": 0.65,
            "drawdownScaleAtAdditional8Pct": 0.40,
            "coreGrossCap": CORE_GROSS_CAP,
            "cashReservePct": CASH_RESERVE * 100.0,
            "normalCostBpsPerTurnover": stats.NORMAL_COST_BPS,
            "severeCostBpsPerTurnover": stats.SEVERE_COST_BPS,
            "severeAdditionalDelayBars": 1,
            "stopCooldownBars12h": 1,
        },
        "forwardFreeze": freeze,
        "coverage": coverage,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "V35 Signal was developed before this test and is frozen rather than reselected.",
            "Nested selection applies only to the small Risk grid.",
            "Forward evidence remains required before Production sizing changes.",
        ],
    })
    (state_dir / "v35-fixed-signal-nested-risk-v75.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-fixed-signal-v75-forward-freeze.json").write_text(json.dumps(result["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V35 Fixed Signal + Nested Risk V75",
        "",
        f"- Status: **{status}**",
        "- V35 Entry/Signal retuned: **NO**",
        f"- Outer OOS: {oos_metric['compoundedReturnPct']}% / DD {oos_metric['maxDrawdownPct']}%",
        f"- Outer OOS Severe: {oos_severe_metric['compoundedReturnPct']}% / DD {oos_severe_metric['maxDrawdownPct']}%",
        f"- Positive folds: {positive}/{len(folds)}; Severe {positive_severe}/{len(folds)}",
        f"- Full: {full['compoundedReturnPct']}% / CAGR {full['cagrPct']}% / DD {full['maxDrawdownPct']}%",
        f"- Full Severe: {result['fullSevere']['compoundedReturnPct']}% / DD {result['fullSevere']['maxDrawdownPct']}%",
        f"- DSR probability: {dsr['probability']}",
        f"- Reality Check p: {reality['realityCheckP']}",
        f"- SPA approximation p: {reality['spaApproxP']}",
        f"- 30-day permutation p: {permutation['pValue']}",
        "",
        f"- Selected risk: `{selected.config_id}`",
        f"- Hard stop: {selected.stop_atr} ATR",
        f"- Core Gross cap: {CORE_GROSS_CAP}",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-fixed-signal-nested-risk-v75.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
