from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v71_whipsaw_guard_v84 as v84

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_GROSS = 1.15

PROFILES = {
    "BALANCED": v84.WhipsawConfig(10, 1.5, 3, 0.60, 1, 2),
    "DEFENSIVE": v84.WhipsawConfig(10, 1.0, 3, 0.60, 1, 2),
}


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    built = v84.build_core_context()
    base_core_rows = built["baseRows"]
    severe_core_rows = built["severeRows"]
    context = built["context"]
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)
    trades = v69.scale_trades(TARGET_GROSS)
    series = {
        "main": v68.v67_series(pengu_rows, trades),
        "noBest": v68.v67_series(pengu_rows, v69.remove_best_trade(trades)),
        "noMonth": v68.v67_series(pengu_rows, v69.remove_best_month(trades)),
    }
    baseline = v70.evaluate(
        TARGET_GROSS,
        pengu_rows,
        base_core_rows,
        severe_core_rows,
        overlap_start,
        overlap_end,
    )
    results = {
        name: v84.evaluate(
            config,
            series,
            base_core_rows,
            severe_core_rows,
            context,
            overlap_start,
            overlap_end,
            baseline,
            {
                "full": baseline["full"],
                "severeFull": baseline["severeFull"],
            },
        )
        for name, config in PROFILES.items()
    }
    result = rounded({
        "version": 85,
        "strategyId": "V71_FIXED_DRAWDOWN_PROFILES_V85",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "V71_FIXED_PROFILES_COMPLETE",
        "targetV67MaxGross": TARGET_GROSS,
        "baselineV71": baseline,
        "selectedDefault": "BALANCED",
        "profiles": results,
        "selectionRationale": {
            "BALANCED": "Preserve at least about 85% of V71 full and large-wave-excluded return while improving both normal and Severe DD.",
            "DEFENSIVE": "Accept a larger return reduction to target approximately 26% normal DD and 42% Severe DD.",
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "Profiles are selected from the already observed V84 Pareto frontier and require frozen forward evidence.",
            "The fixed profile controls use prior completed 12h turnover/regime data and prior portfolio equity only.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-fixed-profiles-v85.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 Fixed Drawdown Profiles V85",
        "",
        f"- Baseline V71: {baseline['full']['compoundedReturnPct']}% / DD {baseline['full']['maxDrawdownPct']}% / Severe DD {baseline['severeFull']['maxDrawdownPct']}%",
        "- Default profile: **BALANCED**",
        "",
    ]
    for name, item in results.items():
        report.extend([
            f"## {name}",
            f"- Config: `{item['configId']}`",
            f"- Full: {item['full']['compoundedReturnPct']}% / DD {item['full']['maxDrawdownPct']}%",
            f"- Severe: {item['severeFull']['compoundedReturnPct']}% / DD {item['severeFull']['maxDrawdownPct']}%",
            f"- Waves excluded: {item['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {item['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Whipsaw active: {item['diagnostics']['normal']['whipsawRatePct']}%",
            "",
        ])
    report.append("- Production / LIVE / VPS changed: **NO**")
    (state_dir / "v71-fixed-profiles-v85.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
