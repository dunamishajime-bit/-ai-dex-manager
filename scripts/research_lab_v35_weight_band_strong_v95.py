from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_V67_GROSS = 1.15
TARGET_CONFIG = v90.Config(0.05, 0.20, 12)
STRONG_CONFIG = v86.GrowthConfig(15.0, 0.0, -4.0, 1.35, None, 2, 0.30)
OLD_V35_RETURN_PCT = 332.2003
OLD_V35_DD_PCT = -31.7730


def build_profile(raw: dict, strong) -> dict:
    targets, target_diag = v90.stabilize(raw["targets"], raw["times"], TARGET_CONFIG)
    base_core = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_core = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(
        raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    v35_config = core.CoreConfig()
    base_rows = core.core_rows(v35_config, raw["times"], base_core, features)
    severe_rows = core.core_rows(v35_config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, base_core, features)
    normal, normal_diag = v86.controlled_core(base_rows, context, strong)
    severe, severe_diag = v86.controlled_core(severe_rows, context, strong)
    return {
        "normal": normal,
        "severe": severe,
        "targetDiagnostics": target_diag,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def integrate(core_profile: dict, pengu_rows: List[dict]) -> dict:
    trades = v69.scale_trades(TARGET_V67_GROSS)
    main = v68.v67_series(pengu_rows, trades)
    no_best = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
    normal, cap = v70.capped_combine(core_profile["normal"], main, "base")
    severe, cap_severe = v70.capped_combine(core_profile["severe"], main, "severe")
    excluded, cap_excluded = v70.capped_combine(core_profile["normal"], main, "excludedBase")
    excluded_severe, cap_excluded_severe = v70.capped_combine(core_profile["severe"], main, "excludedSevere")
    remove_best, _ = v70.capped_combine(core_profile["normal"], no_best, "base")
    remove_best_severe, _ = v70.capped_combine(core_profile["severe"], no_best, "severe")
    remove_month, _ = v70.capped_combine(core_profile["normal"], no_month, "base")
    remove_month_severe, _ = v70.capped_combine(core_profile["severe"], no_month, "severe")
    return {
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "severeFull": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
        "reused2026H1": v69.metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, core.v4.START_2026, core.CORE_END),
        "reused2026H1Excluded": v69.metrics(excluded, core.v4.START_2026, core.CORE_END),
        "reused2026H1ExcludedSevere": v69.metrics(excluded_severe, core.v4.START_2026, core.CORE_END),
        "removeBestTrade": v69.metrics(remove_best, core.CORE_START, core.CORE_END),
        "removeBestTradeSevere": v69.metrics(remove_best_severe, core.CORE_START, core.CORE_END),
        "removeBestMonth": v69.metrics(remove_month, core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": v69.metrics(remove_month_severe, core.CORE_START, core.CORE_END),
        "capDiagnostics": {
            "normal": cap,
            "severe": cap_severe,
            "excluded": cap_excluded,
            "excludedSevere": cap_excluded_severe,
        },
    }


def metrics(rows: List[dict], start: int, end: int) -> dict:
    return v69.metrics(rows, start, end)


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    v90_profile = build_profile(raw, None)
    v95_profile = build_profile(raw, STRONG_CONFIG)

    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)

    v90_core = {
        "full": metrics(v90_profile["normal"], core.CORE_START, core.CORE_END),
        "severeFull": metrics(v90_profile["severe"], core.CORE_START, core.CORE_END),
        "reused2026H1": metrics(v90_profile["normal"], core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": metrics(v90_profile["severe"], core.v4.START_2026, core.CORE_END),
    }
    v95_core = {
        "full": metrics(v95_profile["normal"], core.CORE_START, core.CORE_END),
        "severeFull": metrics(v95_profile["severe"], core.CORE_START, core.CORE_END),
        "reused2026H1": metrics(v95_profile["normal"], core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": metrics(v95_profile["severe"], core.v4.START_2026, core.CORE_END),
    }
    integrated = integrate(v95_profile, pengu_rows)
    core_pass = bool(
        v95_core["full"]["compoundedReturnPct"] > OLD_V35_RETURN_PCT
        and v95_core["full"]["maxDrawdownPct"] >= OLD_V35_DD_PCT
        and v95_core["severeFull"]["compoundedReturnPct"] >= v90_core["severeFull"]["compoundedReturnPct"]
        and v95_core["severeFull"]["maxDrawdownPct"] >= v90_core["severeFull"]["maxDrawdownPct"] - 2.0
        and v95_core["reused2026H1"]["compoundedReturnPct"] > 0
    )
    integration_pass = bool(
        integrated["full"]["compoundedReturnPct"] > 0
        and integrated["severeFull"]["compoundedReturnPct"] > 0
        and integrated["largeWaveExcludedFull"]["compoundedReturnPct"] > 0
        and integrated["largeWaveExcludedSevereFull"]["compoundedReturnPct"] > 0
        and integrated["full"]["maxDrawdownPct"] >= -31.0
        and integrated["severeFull"]["maxDrawdownPct"] >= -47.0
        and integrated["reused2026H1"]["compoundedReturnPct"] > 0
        and integrated["reused2026H1Severe"]["compoundedReturnPct"] > 0
        and integrated["reused2026H1ExcludedSevere"]["compoundedReturnPct"] > 0
        and integrated["removeBestTradeSevere"]["compoundedReturnPct"] > 0
        and integrated["removeBestMonthSevere"]["compoundedReturnPct"] > 0
        and integrated["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        and integrated["capDiagnostics"]["normal"]["minimumClipRatio"] >= 0.50
    )
    status = (
        "V35_WEIGHT_BAND_STRONG_AND_V71_PASS"
        if core_pass and integration_pass
        else "V35_WEIGHT_BAND_STRONG_CORE_PASS"
        if core_pass
        else "V35_WEIGHT_BAND_STRONG_DIAGNOSTIC"
    )
    result = rounded({
        "version": 95,
        "strategyId": "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "corePass": core_pass,
        "integrationPass": integration_pass,
        "historicalOldV35Benchmark": {
            "compoundedReturnPct": OLD_V35_RETURN_PCT,
            "maxDrawdownPct": OLD_V35_DD_PCT,
        },
        "fixedTargetConfig": asdict(TARGET_CONFIG),
        "fixedStrongConfig": asdict(STRONG_CONFIG),
        "v90Core": v90_core,
        "v95Core": v95_core,
        "v71Integration": integrated,
        "diagnostics": {
            "v90": v90_profile["targetDiagnostics"],
            "v95": {
                "target": v95_profile["targetDiagnostics"],
                "control": v95_profile["controlDiagnostics"],
            },
        },
        "rule": (
            "Use the frozen V90 no-trade band. Add 30% Core Gross only when prior completed 12h V35 features "
            "show mom20>=15, mom3>0, shock>=-4, skew<=1.35, breadth>=2, no active DD brake, "
            "no active whipsaw guard, and controlled equity DD is better than -5%."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V90 and V86 components were historically observed before this fixed combination.",
            "2026H1 is reused evidence, not pristine holdout.",
            "Promotion requires frozen forward evidence and production allocator parity review.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-weight-band-strong-v95.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Weight Band + Fixed Strong Boost V95",
        "",
        f"- Status: **{status}**",
        f"- Old V35 benchmark: {OLD_V35_RETURN_PCT}% / DD {OLD_V35_DD_PCT}%",
        f"- V90 Core: {v90_core['full']['compoundedReturnPct']}% / Severe {v90_core['severeFull']['compoundedReturnPct']}% / DD {v90_core['full']['maxDrawdownPct']}%",
        f"- V95 Core: {v95_core['full']['compoundedReturnPct']}% / Severe {v95_core['severeFull']['compoundedReturnPct']}% / DD {v95_core['full']['maxDrawdownPct']}%",
        f"- V95 2026H1: {v95_core['reused2026H1']['compoundedReturnPct']}% / Severe {v95_core['reused2026H1Severe']['compoundedReturnPct']}%",
        f"- Core pass: **{'YES' if core_pass else 'NO'}**",
        "",
        "## V71 integration",
        f"- Pass: **{'YES' if integration_pass else 'NO'}**",
        f"- Full: {integrated['full']['compoundedReturnPct']}% / CAGR {integrated['full']['cagrPct']}% / DD {integrated['full']['maxDrawdownPct']}%",
        f"- Severe: {integrated['severeFull']['compoundedReturnPct']}% / DD {integrated['severeFull']['maxDrawdownPct']}%",
        f"- Waves excluded: {integrated['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {integrated['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- 2026H1: {integrated['reused2026H1']['compoundedReturnPct']}% / Severe {integrated['reused2026H1Severe']['compoundedReturnPct']}%",
        f"- Best trade/month removed Severe: {integrated['removeBestTradeSevere']['compoundedReturnPct']}% / {integrated['removeBestMonthSevere']['compoundedReturnPct']}%",
        f"- Max Gross / min clip: {integrated['full']['observedMaxConcurrentGross']} / {integrated['capDiagnostics']['normal']['minimumClipRatio']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-weight-band-strong-v95.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
