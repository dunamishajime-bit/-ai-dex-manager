from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_overlay_v27 as v27


COMBOS = {
    "VWM25_SKEW125": ("VWM_TILT25", "VOL_SKEW_REDUCE_125"),
    "VWM50_SKEW125": ("VWM_TILT50", "VOL_SKEW_REDUCE_125"),
    "VWM25_SKEW150": ("VWM_TILT25", "VOL_SKEW_REDUCE_150"),
    "VWM50_SKEW150": ("VWM_TILT50", "VOL_SKEW_REDUCE_150"),
    "BLEND25_SKEW150": ("RANK_BLEND25", "VOL_SKEW_REDUCE_150"),
    "BLEND50_SKEW150": ("RANK_BLEND50", "VOL_SKEW_REDUCE_150"),
}


def combo_targets(name, base, bear, times, bars, indexes, funding):
    first, second = COMBOS[name]
    adjusted: Dict[int, Dict[str, float]] = {}
    for position, ts in enumerate(times):
        target = v27.apply_variant(first, base.get(ts, {}), ts, position, times, bars, indexes, funding)
        target = v27.apply_variant(second, target, ts, position, times, bars, indexes, funding)
        adjusted[ts] = target
    return v20.desired_targets(adjusted, bear, times)


def scenarios(targets, times, bars, indexes, funding, start, end):
    return v20.run_scenarios(targets, times, bars, indexes, funding, start, end)


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]

    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    baseline_targets = v20.desired_targets(base_map, bear_map, times)

    target_maps = {"V6_BASELINE": baseline_targets}
    for name in COMBOS:
        target_maps[name] = combo_targets(name, base_map, bear_map, times, bars, indexes, funding)

    results = {}
    for name, targets in target_maps.items():
        results[name] = {
            "development2023_2025": scenarios(targets, times, bars, indexes, funding, v4.START_2023, v4.START_2026),
            "year2023": scenarios(targets, times, bars, indexes, funding, v4.START_2023, v4.START_2024),
            "year2024": scenarios(targets, times, bars, indexes, funding, v4.START_2024, v4.START_2025),
            "year2025": scenarios(targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026),
            "reused2026H1": scenarios(targets, times, bars, indexes, funding, v4.START_2026, v4.END),
        }

    baseline = results["V6_BASELINE"]
    base_dev = baseline["development2023_2025"]["BASE_10BPS"]
    base_severe = baseline["development2023_2025"]["SEVERE_50BPS_DELAY12H_FUND3"]
    passed = []
    for name in COMBOS:
        item = results[name]
        dev = item["development2023_2025"]["BASE_10BPS"]
        severe = item["development2023_2025"]["SEVERE_50BPS_DELAY12H_FUND3"]
        annual_positive = all(item[period]["BASE_10BPS"]["compoundedReturnPct"] > 0 for period in ["year2023", "year2024", "year2025"])
        if (
            annual_positive
            and dev["cagrPct"] > base_dev["cagrPct"]
            and (dev["profitFactor"] or 0) >= (base_dev["profitFactor"] or 0)
            and dev["maxDrawdownPct"] >= base_dev["maxDrawdownPct"]
            and severe["compoundedReturnPct"] >= base_severe["compoundedReturnPct"]
            and (severe["profitFactor"] or 0) >= (base_severe["profitFactor"] or 0)
        ):
            passed.append(name)

    stable_groups = []
    for prefix in ["VWM25", "VWM50", "BLEND"]:
        members = [name for name in COMBOS if name.startswith(prefix)]
        if len([name for name in members if name in passed]) >= 2:
            stable_groups.append(prefix)
    eligible = [name for name in passed if any(name.startswith(prefix) for prefix in stable_groups)]
    eligible.sort(key=lambda name: (
        results[name]["development2023_2025"]["BASE_10BPS"]["cagrPct"],
        results[name]["development2023_2025"]["BASE_10BPS"]["profitFactor"] or 0,
    ), reverse=True)
    selected = eligible[0] if eligible else None
    status = "FORWARD_ONLY_FEATURE_COMBO_CANDIDATE" if selected else "NO_STABLE_COMPLEMENTARY_COMBO"

    result = rounded({
        "version": 28,
        "strategyId": "DISDEX_FEATURE_COMBO_V28",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected,
        "passedDevelopment": passed,
        "stableGroups": stable_groups,
        "eligible": eligible,
        "combos": COMBOS,
        "results": results,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "V28 was motivated by V27 single-feature results, so 2026H1 is displayed only as reused exploratory confirmation and is not a pristine holdout.",
            "Selection uses 2023-2025 only and requires annual positivity, CAGR/PF/DD/severe improvement and adjacent-combination stability.",
            "Any selected result requires new forward evidence before paper eligibility.",
        ],
    })

    report = [
        "# Dis-Dex Manager Feature Combo V28",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected or 'NONE'}**",
        f"- Development passed: {', '.join(passed) if passed else 'NONE'}",
        f"- Stable groups: {', '.join(stable_groups) if stable_groups else 'NONE'}",
        "- 2026H1: REUSED EXPLORATORY CONFIRMATION, NOT PRISTINE",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Variant | Dev return | Dev CAGR | Dev PF | Dev DD | Dev severe | 2026H1 return | 2026H1 PF |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, item in result["results"].items():
        dev = item["development2023_2025"]["BASE_10BPS"]
        severe = item["development2023_2025"]["SEVERE_50BPS_DELAY12H_FUND3"]
        holdout = item["reused2026H1"]["BASE_10BPS"]
        report.append(
            f"| {name} | {dev['compoundedReturnPct']}% | {dev['cagrPct']}% | {dev['profitFactor']} | {dev['maxDrawdownPct']}% | "
            f"{severe['compoundedReturnPct']}% | {holdout['compoundedReturnPct']}% | {holdout['profitFactor']} |"
        )

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-feature-combo-v28.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-feature-combo-v28.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
