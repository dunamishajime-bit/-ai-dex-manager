from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
core = v69.core
START_2026 = core.v4.START_2026


def build_raw_context() -> dict:
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
    normal_raw = core.v32.core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe_raw = core.v32.core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, bars, indexes, funding)
    config = core.CoreConfig()
    normal_rows = core.core_rows(config, times, normal_raw, features)
    severe_rows = core.core_rows(config, times, severe_raw, features)
    built = v86.build_context()
    controlled_normal, _ = v86.controlled_core(normal_rows, built["context"], None)
    controlled_severe, _ = v86.controlled_core(severe_rows, built["context"], None)
    return {
        "raw": raw,
        "bars": bars,
        "indexes": indexes,
        "funding": funding,
        "times": times,
        "targets": targets,
        "normalRaw": normal_raw,
        "severeRaw": severe_raw,
        "features": features,
        "normalRows": normal_rows,
        "severeRows": severe_rows,
        "controlledNormal": controlled_normal,
        "controlledSevere": controlled_severe,
        "context": built["context"],
    }


def v35_multiplier(raw_row: dict, v35_row: dict) -> float:
    exposure = float(raw_row.get("exposure", 0.0))
    return float(v35_row.get("gross", 0.0)) / exposure if exposure > 0 else 0.0


def controlled_multiplier(v35_row: dict, controlled_row: dict) -> float:
    gross = float(v35_row.get("gross", 0.0))
    return float(controlled_row.get("gross", 0.0)) / gross if gross > 0 else 0.0


def bucket_details(data: dict) -> List[dict]:
    times = data["times"]
    bars = data["bars"]
    indexes = data["indexes"]
    funding = data["funding"]
    targets = data["targets"]
    severe_raw = data["severeRaw"]
    normal_raw = data["normalRaw"]
    severe_rows = {int(row["ts"]): row for row in data["severeRows"]}
    normal_rows = {int(row["ts"]): row for row in data["normalRows"]}
    controlled_severe = {int(row["ts"]): row for row in data["controlledSevere"]}
    controlled_normal = {int(row["ts"]): row for row in data["controlledNormal"]}
    context = data["context"]
    result: List[dict] = []
    previous_severe_target: Dict[str, float] = {}
    previous_normal_target: Dict[str, float] = {}
    for position, ts in enumerate(times):
        severe_source = position - 2
        normal_source = position - 1
        severe_target = dict(targets.get(times[severe_source], {})) if severe_source >= 0 else {}
        normal_target = dict(targets.get(times[normal_source], {})) if normal_source >= 0 else {}
        severe_turnover = core.v4.turnover(previous_severe_target, severe_target) if severe_target != previous_severe_target else 0.0
        normal_turnover = core.v4.turnover(previous_normal_target, normal_target) if normal_target != previous_normal_target else 0.0
        previous_severe_target = severe_target
        previous_normal_target = normal_target
        if ts < START_2026:
            continue
        severe_item = severe_raw.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        normal_item = normal_raw.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        severe_v35 = severe_rows[ts]
        normal_v35 = normal_rows[ts]
        severe_control = controlled_severe[ts]
        normal_control = controlled_normal[ts]
        severe_v35_mult = v35_multiplier(severe_item, severe_v35)
        normal_v35_mult = v35_multiplier(normal_item, normal_v35)
        severe_control_mult = controlled_multiplier(severe_v35, severe_control)
        normal_control_mult = controlled_multiplier(normal_v35, normal_control)
        symbol_rows = []
        for symbol, weight in severe_target.items():
            index = indexes[symbol].get(ts)
            if index is None:
                continue
            bar = bars[symbol][index]
            price_return = float(bar["close"]) / float(bar["open"]) - 1.0
            funding_cost = float(weight) * funding.get(symbol, {}).get(ts, 0.0) / 100.0
            raw_contribution = float(weight) * price_return - funding_cost
            controlled_contribution = raw_contribution * severe_v35_mult * severe_control_mult
            symbol_rows.append({
                "symbol": symbol,
                "weight": float(weight),
                "priceReturnPct": price_return * 100.0,
                "rawContributionPct": raw_contribution * 100.0,
                "controlledContributionPct": controlled_contribution * 100.0,
            })
        severe_cost = (
            severe_turnover * 50.0 / 10_000.0
            + float(severe_item.get("exposure", 0.0)) * 3.0 / 10_000.0
        ) * severe_v35_mult * severe_control_mult
        normal_cost = normal_turnover * 10.0 / 10_000.0 * normal_v35_mult * normal_control_mult
        feature = context.get(ts, {}).get("feature", {})
        result.append({
            "ts": ts,
            "iso": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat(),
            "controlledSeverePct": float(severe_control["return"]) * 100.0,
            "controlledNormalPct": float(normal_control["return"]) * 100.0,
            "differencePct": (float(severe_control["return"]) - float(normal_control["return"])) * 100.0,
            "severeRegime": int(severe_item.get("regime", 0)),
            "normalRegime": int(normal_item.get("regime", 0)),
            "severeTurnover": severe_turnover,
            "normalTurnover": normal_turnover,
            "severeEstimatedCostPct": severe_cost * 100.0,
            "normalEstimatedCostPct": normal_cost * 100.0,
            "v35Multiplier": severe_v35_mult,
            "controlMultiplier": severe_control_mult,
            "symbols": sorted(symbol_rows, key=lambda item: item["controlledContributionPct"]),
            "feature": {
                "mom3": float(feature.get("mom3", 0.0)),
                "mom20": float(feature.get("mom20", 0.0)),
                "shock": float(feature.get("shock", 0.0)),
                "skew": float(feature.get("skew", 1.0)),
                "btcVol": float(feature.get("btcVol", 0.0)),
                "closeAboveSma20": bool(feature.get("closeAboveSma20", False)),
            },
        })
    return result


def aggregate(rows: List[dict]) -> dict:
    symbol_loss: Dict[str, float] = {}
    symbol_gain: Dict[str, float] = {}
    regime = {"bull": 0.0, "bear": 0.0, "flat": 0.0}
    negative_rows = [row for row in rows if row["controlledSeverePct"] < 0]
    for row in rows:
        key = "bull" if row["severeRegime"] > 0 else "bear" if row["severeRegime"] < 0 else "flat"
        regime[key] += row["controlledSeverePct"]
        for item in row["symbols"]:
            value = item["controlledContributionPct"]
            target = symbol_gain if value > 0 else symbol_loss
            target[item["symbol"]] = target.get(item["symbol"], 0.0) + value
    return {
        "buckets": len(rows),
        "negativeBuckets": len(negative_rows),
        "controlledSeverePctSum": sum(row["controlledSeverePct"] for row in rows),
        "controlledNormalPctSum": sum(row["controlledNormalPct"] for row in rows),
        "estimatedSevereCostPctSum": sum(row["severeEstimatedCostPct"] for row in rows),
        "estimatedNormalCostPctSum": sum(row["normalEstimatedCostPct"] for row in rows),
        "regimeReturnPctSum": regime,
        "symbolLossContributionPctSum": symbol_loss,
        "symbolGainContributionPctSum": symbol_gain,
        "highTurnoverNegativePctSum": sum(
            row["controlledSeverePct"] for row in negative_rows if row["severeTurnover"] >= 1.0
        ),
        "regimeMismatchNegativePctSum": sum(
            row["controlledSeverePct"] for row in negative_rows if row["severeRegime"] != row["normalRegime"]
        ),
    }


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    data = build_raw_context()
    rows = bucket_details(data)
    rows.sort(key=lambda item: item["controlledSeverePct"])
    result = rounded({
        "version": 88,
        "strategyId": "V35_2026_SEVERE_LOSS_AUDIT_V88",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "summary": aggregate(rows),
        "worstBuckets": rows[:60],
        "largestSevereVsNormalDeterioration": sorted(rows, key=lambda item: item["differencePct"])[:60],
        "method": {
            "severeTargetDelay": "Use the target from two 12h positions earlier, matching core_series delay_bars=1.",
            "severeCost": "50 bps per turnover plus 3 bps per Gross per 12h bar.",
            "scaling": "Apply the exact V35 multiplier and the fixed Balanced DD/Whipsaw multiplier.",
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-2026-severe-audit-v88.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = result["summary"]
    report = [
        "# V35 2026 Severe Loss Audit V88",
        "",
        f"- Buckets / negative: {summary['buckets']} / {summary['negativeBuckets']}",
        f"- Severe bucket return sum: {summary['controlledSeverePctSum']}%",
        f"- Normal bucket return sum: {summary['controlledNormalPctSum']}%",
        f"- Estimated Severe cost sum: {summary['estimatedSevereCostPctSum']}%",
        f"- Estimated Normal cost sum: {summary['estimatedNormalCostPctSum']}%",
        f"- Regime return sum: {summary['regimeReturnPctSum']}",
        f"- Symbol loss contribution: {summary['symbolLossContributionPctSum']}",
        f"- High-turnover negative sum: {summary['highTurnoverNegativePctSum']}%",
        f"- Severe/normal regime-mismatch negative sum: {summary['regimeMismatchNegativePctSum']}%",
        "",
        "## Worst 10 buckets",
    ]
    for row in result["worstBuckets"][:10]:
        report.append(
            f"- {row['iso']}: Severe {row['controlledSeverePct']}% / Normal {row['controlledNormalPct']}% / "
            f"regime {row['severeRegime']} / turnover {row['severeTurnover']} / symbols "
            f"{[(item['symbol'], item['controlledContributionPct']) for item in row['symbols']]}"
        )
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-2026-severe-audit-v88.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
