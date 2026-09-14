from __future__ import annotations

import datetime as dt
import json
import os
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b

v68 = v68b.v68
core = v68.core
HOUR = v68.HOUR
DAY = v68.DAY
PORTFOLIO_GROSS_CAP = 2.0
V67_BASE_MAX_GROSS = 0.30
SIZING_LEVELS = (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70)


def scale_trades(max_gross: float) -> List[dict]:
    factor = max_gross / V67_BASE_MAX_GROSS
    result = []
    for trade in v68.V67_ASTER_TRADES:
        item = deepcopy(trade)
        for field in ("probe_gross", "add_gross", "total_gross"):
            item[field] = float(item[field]) * factor
        for field in ("base_pct", "severe_pct", "excluded_base_pct", "excluded_severe_pct"):
            item[field] = float(item[field]) * factor
        result.append(item)
    return result


def build_core():
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars = {symbol: core.v4.resample_12h(raw[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = core.v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in core.v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
    projected = core.v6.precompute_projected_members(core.v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: core.v4.overlay_target(core.v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = core.v6.precompute_bear_targets([core.v20.HEDGE], times, bars, indexes)[core.v20.HEDGE.hedge_id]
    targets = core.v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    base_core = core.v32.core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, bars, indexes, funding)
    config = core.CoreConfig()
    return {
        "config": config,
        "baseRows": core.core_rows(config, times, base_core, features),
        "severeRows": core.core_rows(config, times, severe_core, features),
    }


def metrics(rows: List[dict], start: int, end: int) -> dict:
    return core.metrics_with_observed_gross(rows, start, end)


def remove_best_trade(trades: List[dict]) -> List[dict]:
    result, _best = v68.remove_best_trade(trades)
    return result


def remove_best_month(trades: List[dict]) -> List[dict]:
    result, _month = v68.remove_best_month(trades)
    return result


def evaluate_level(
    level: float,
    pengu_rows: List[dict],
    base_core_rows: List[dict],
    severe_core_rows: List[dict],
    overlap_start: int,
    overlap_end: int,
) -> dict:
    trades = scale_trades(level)
    series = v68.v67_series(pengu_rows, trades)
    combined = v68.combine(base_core_rows, series, "base")
    combined_severe = v68.combine(severe_core_rows, series, "severe")
    excluded = v68.combine(base_core_rows, series, "excludedBase")
    excluded_severe = v68.combine(severe_core_rows, series, "excludedSevere")

    no_best_series = v68.v67_series(pengu_rows, remove_best_trade(trades))
    no_month_series = v68.v67_series(pengu_rows, remove_best_month(trades))
    no_best = v68.combine(base_core_rows, no_best_series, "base")
    no_best_severe = v68.combine(severe_core_rows, no_best_series, "severe")
    no_month = v68.combine(base_core_rows, no_month_series, "base")
    no_month_severe = v68.combine(severe_core_rows, no_month_series, "severe")

    full = metrics(combined, core.CORE_START, core.CORE_END)
    severe_full = metrics(combined_severe, core.CORE_START, core.CORE_END)
    excluded_full = metrics(excluded, core.CORE_START, core.CORE_END)
    excluded_severe_full = metrics(excluded_severe, core.CORE_START, core.CORE_END)
    overlap = metrics(combined, overlap_start, overlap_end)
    overlap_severe = metrics(combined_severe, overlap_start, overlap_end)
    excluded_overlap = metrics(excluded, overlap_start, overlap_end)
    excluded_overlap_severe = metrics(excluded_severe, overlap_start, overlap_end)
    removed_best = metrics(no_best, core.CORE_START, core.CORE_END)
    removed_best_severe = metrics(no_best_severe, core.CORE_START, core.CORE_END)
    removed_month = metrics(no_month, core.CORE_START, core.CORE_END)
    removed_month_severe = metrics(no_month_severe, core.CORE_START, core.CORE_END)

    passed = bool(
        full["observedMaxConcurrentGross"] <= PORTFOLIO_GROSS_CAP + 1e-9
        and full["compoundedReturnPct"] > 0
        and full["maxDrawdownPct"] >= -35.0
        and severe_full["compoundedReturnPct"] > 0
        and severe_full["maxDrawdownPct"] >= -55.0
        and excluded_full["compoundedReturnPct"] > 0
        and excluded_severe_full["compoundedReturnPct"] > 0
        and overlap["compoundedReturnPct"] > 0
        and overlap_severe["compoundedReturnPct"] > 0
        and excluded_overlap["compoundedReturnPct"] > 0
        and excluded_overlap_severe["compoundedReturnPct"] > 0
        and removed_best["compoundedReturnPct"] > 0
        and removed_best_severe["compoundedReturnPct"] > 0
        and removed_month["compoundedReturnPct"] > 0
        and removed_month_severe["compoundedReturnPct"] > 0
    )
    return {
        "v67MaxGross": level,
        "scaleFactor": level / V67_BASE_MAX_GROSS,
        "passed": passed,
        "full": full,
        "severeFull": severe_full,
        "largeWaveExcludedFull": excluded_full,
        "largeWaveExcludedSevereFull": excluded_severe_full,
        "overlap": overlap,
        "overlapSevere": overlap_severe,
        "largeWaveExcludedOverlap": excluded_overlap,
        "largeWaveExcludedOverlapSevere": excluded_overlap_severe,
        "removeBestTrade": removed_best,
        "removeBestTradeSevere": removed_best_severe,
        "removeBestMonth": removed_month,
        "removeBestMonthSevere": removed_month_severe,
    }


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    core_data = build_core()
    base_core_rows = core_data["baseRows"]
    severe_core_rows = core_data["severeRows"]
    core_full = metrics(base_core_rows, core.CORE_START, core.CORE_END)
    core_severe = metrics(severe_core_rows, core.CORE_START, core.CORE_END)

    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)

    candidates = [
        evaluate_level(
            level,
            pengu_rows,
            base_core_rows,
            severe_core_rows,
            overlap_start,
            overlap_end,
        )
        for level in SIZING_LEVELS
    ]
    passed = [candidate for candidate in candidates if candidate["passed"]]
    passed.sort(
        key=lambda candidate: (
            candidate["full"]["compoundedReturnPct"],
            candidate["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
            candidate["severeFull"]["compoundedReturnPct"],
        ),
        reverse=True,
    )
    selected = passed[0] if passed else None
    status = "PORTFOLIO_SIZING_PASS" if selected else "NO_ROBUST_PORTFOLIO_SIZING"

    result = rounded({
        "version": 69,
        "strategyId": "V35_CORE_PLUS_PENGU_V67_PORTFOLIO_SIZING",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
        "sizingLevels": SIZING_LEVELS,
        "core": {
            "full": core_full,
            "severeFull": core_severe,
            "config": asdict(core_data["config"]),
        },
        "selected": selected,
        "passedCount": len(passed),
        "candidates": candidates,
        "selectionRule": (
            "Highest full-period compounded return among levels satisfying observed Gross <=2.0, "
            "normal/severe/excluded positivity, overlap positivity, DD limits, and best-trade/month removal positivity."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "This is portfolio sizing on an already observed V67 trade sequence, not pristine new out-of-sample evidence.",
            "The V67 relative Distribution floor/high sizing pattern is scaled proportionally.",
            "Observed concurrent Gross is enforced; theoretical simultaneous maxima that never occurred are not used.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-core-pengu-v67-v69-sizing.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if selected:
        report = [
            "# V35 Core + PENGU V67 V69 Portfolio Sizing",
            "",
            f"- Status: **{status}**",
            f"- Selected V67 max Gross: **{selected['v67MaxGross']}**",
            f"- Observed max concurrent Gross: {selected['full']['observedMaxConcurrentGross']}",
            f"- Full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Severe: {selected['severeFull']['compoundedReturnPct']}% / DD {selected['severeFull']['maxDrawdownPct']}%",
            f"- Large-wave profits excluded: {selected['largeWaveExcludedFull']['compoundedReturnPct']}%",
            f"- Excluded Severe: {selected['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Overlap: {selected['overlap']['compoundedReturnPct']}% / Severe {selected['overlapSevere']['compoundedReturnPct']}%",
            f"- Remove best trade Severe: {selected['removeBestTradeSevere']['compoundedReturnPct']}%",
            f"- Remove best month Severe: {selected['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- Increment vs V35 Core: {selected['full']['compoundedReturnPct'] - core_full['compoundedReturnPct']} percentage points",
            "",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    else:
        report = [
            "# V35 Core + PENGU V67 V69 Portfolio Sizing",
            "",
            f"- Status: **{status}**",
            "- No sizing level passed every risk and concentration gate.",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    (state_dir / "v35-core-pengu-v67-v69-sizing.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
