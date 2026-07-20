from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_asymmetric_return_stack_v32 as v32
import research_lab_resilient_profit_stack_v34 as v34
import research_lab_v35_exact_core_nested_overlay_v79 as v79

TARGET_CONFIRMATION_BARS = 2
WEIGHT_TOLERANCE = 0.05
GROSS_CAP = 1.40


def configs():
    return [
        v79.OverlayConfig(strong, normal, brake, bear, dd_start)
        for strong in (0.80, 1.00, 1.20)
        for normal in (0.60, 0.80)
        for brake in (0.10, 0.20)
        for bear in (0.00, 0.25)
        for dd_start in (0.08, 0.12)
    ]


def signature(target: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted(
        (symbol, 1 if weight > 0 else -1)
        for symbol, weight in target.items()
        if abs(weight) > 1e-12
    ))


def confirm_targets(raw: Dict[int, Dict[str, float]], times):
    active: Dict[str, float] = {}
    pending_signature: Tuple[Tuple[str, int], ...] = ()
    pending_count = 0
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        desired = dict(raw.get(ts, {}))
        desired_signature = signature(desired)
        active_signature = signature(active)
        if desired_signature != active_signature:
            if desired_signature == pending_signature:
                pending_count += 1
            else:
                pending_signature = desired_signature
                pending_count = 1
            if pending_count >= TARGET_CONFIRMATION_BARS:
                active = desired
                pending_signature = ()
                pending_count = 0
        else:
            pending_signature = ()
            pending_count = 0
            updated = dict(active)
            for symbol in set(active) | set(desired):
                old = active.get(symbol, 0.0)
                new = desired.get(symbol, 0.0)
                if abs(new - old) >= WEIGHT_TOLERANCE:
                    if abs(new) <= 1e-12:
                        updated.pop(symbol, None)
                    else:
                        updated[symbol] = new
            active = updated
        result[ts] = dict(active)
    return result


def load_exact_confirmed():
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if v79.START <= int(row["ts"]) < v79.END]
    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    raw_targets = v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    targets = confirm_targets(raw_targets, times)
    normal = v32.core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe = v32.core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    features = v34.features_with_vol(times, targets, bars, indexes, funding)
    coverage = {
        symbol: {
            "candles": len(raw[symbol]["candles"]),
            "funding": len(raw[symbol]["funding"]),
            "bars12h": len(bars[symbol]),
        }
        for symbol in v4.SYMBOLS
    }
    return times, normal, severe, features, coverage


def rewrite_outputs():
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source = state_dir / "v35-exact-core-nested-overlay-v79.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["version"] = 80
    payload["strategyId"] = "V35_EXACT_CONFIRMED_NESTED_V80"
    payload["status"] = (
        "V35_EXACT_CONFIRMED_ROBUST_PASS"
        if payload.get("robustPass")
        else "V35_EXACT_CONFIRMED_RESEARCH_ONLY"
    )
    payload["targetConfirmation"] = {
        "bars12h": TARGET_CONFIRMATION_BARS,
        "weightTolerance": WEIGHT_TOLERANCE,
        "chosenBeforeThisRun": True,
        "purpose": "Reduce V35 target churn without changing the underlying V35 signal family.",
    }
    payload["riskSpecification"]["grossCap"] = GROSS_CAP
    payload["riskSpecification"]["targetConfirmationBars12h"] = TARGET_CONFIRMATION_BARS
    payload["riskSpecification"]["weightTolerance"] = WEIGHT_TOLERANCE
    payload["forwardFreeze"]["strategyId"] = "V35_EXACT_CONFIRMED_NESTED_V80"
    payload["forwardFreeze"]["targetConfirmationBars12h"] = TARGET_CONFIRMATION_BARS
    payload["forwardFreeze"]["weightTolerance"] = WEIGHT_TOLERANCE
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-exact-confirmed-nested-v80.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (state_dir / "v35-exact-confirmed-v80-forward-freeze.json").write_text(
        json.dumps(payload["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Exact Confirmed + Nested Overlay V80",
        "",
        f"- Status: **{payload['status']}**",
        "- Underlying V35 Signal family retuned: **NO**",
        f"- Target confirmation: {TARGET_CONFIRMATION_BARS} completed 12h bars",
        f"- Weight tolerance: {WEIGHT_TOLERANCE * 100.0}%",
        f"- Outer OOS: {payload['outerOos']['compoundedReturnPct']}% / DD {payload['outerOos']['maxDrawdownPct']}%",
        f"- Outer OOS Severe: {payload['outerOosSevere']['compoundedReturnPct']}% / DD {payload['outerOosSevere']['maxDrawdownPct']}%",
        f"- Positive folds: {payload['positiveOuterFolds']}/5; Severe {payload['positiveOuterSevereFolds']}/5",
        f"- Full: {payload['full']['compoundedReturnPct']}% / CAGR {payload['full']['cagrPct']}% / DD {payload['full']['maxDrawdownPct']}%",
        f"- Full Severe: {payload['fullSevere']['compoundedReturnPct']}% / DD {payload['fullSevere']['maxDrawdownPct']}%",
        f"- DSR probability: {payload['multipleTesting']['deflatedSharpe']['probability']}",
        f"- Reality Check p: {payload['multipleTesting']['whiteRealityCheckAndSpaAgainstCash']['realityCheckP']}",
        f"- SPA approximation p: {payload['multipleTesting']['whiteRealityCheckAndSpaAgainstCash']['spaApproxP']}",
        f"- 30-day permutation p: {payload['multipleTesting']['thirtyDayCoreBundlePermutation']['pValue']}",
        "",
        f"- Selected Overlay: `{v79.OverlayConfig(**payload['selectedOverlay']).config_id}`",
        f"- Gross cap: {GROSS_CAP}",
        "- Independent Core hard stop: NONE ADDED; exact V35 signal exit retained.",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-exact-confirmed-nested-v80.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    print("\n".join(report))


def main():
    v79.configs = configs
    v79.load_exact_v35 = load_exact_confirmed
    v79.GROSS_CAP = GROSS_CAP
    v79.main()
    rewrite_outputs()


if __name__ == "__main__":
    main()
