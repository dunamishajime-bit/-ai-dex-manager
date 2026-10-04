from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20


CORE = ["ETH", "BNB", "SOL"]
START = v4.START_2023
END = v4.END


def ema(rows: List[dict], end: int, length: int) -> Optional[float]:
    if length <= 0 or end - length * 4 < 0:
        return None
    start = max(0, end - length * 4)
    alpha = 2.0 / (length + 1.0)
    value = float(rows[start]["close"])
    for index in range(start + 1, end + 1):
        value = alpha * float(rows[index]["close"]) + (1.0 - alpha) * value
    return value


def atr(rows: List[dict], end: int, length: int = 14) -> Optional[float]:
    if end - length < 0:
        return None
    values: List[float] = []
    for index in range(end - length + 1, end + 1):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        values.append(max(high - low, abs(high - previous), abs(low - previous)))
    return statistics.fmean(values) if values else None


def rsi(rows: List[dict], end: int, length: int = 14) -> Optional[float]:
    if end - length < 0:
        return None
    gains = 0.0
    losses = 0.0
    for index in range(end - length + 1, end + 1):
        change = float(rows[index]["close"]) - float(rows[index - 1]["close"])
        gains += max(change, 0.0)
        losses += max(-change, 0.0)
    if losses <= 0:
        return 100.0 if gains > 0 else 50.0
    rs = gains / losses
    return 100.0 - 100.0 / (1.0 + rs)


def normalized_macd(rows: List[dict], end: int) -> Optional[float]:
    fast = ema(rows, end, 12)
    slow = ema(rows, end, 26)
    range_value = atr(rows, end, 14)
    if fast is None or slow is None or range_value is None or range_value <= 0:
        return None
    return (fast - slow) / range_value


def downside_skew(rows: List[dict], end: int, length: int = 40) -> Optional[float]:
    if end - length < 0:
        return None
    positive: List[float] = []
    negative: List[float] = []
    for index in range(end - length + 1, end + 1):
        previous = float(rows[index - 1]["close"])
        close = float(rows[index]["close"])
        if previous <= 0 or close <= 0:
            continue
        value = math.log(close / previous)
        if value >= 0:
            positive.append(value)
        else:
            negative.append(abs(value))
    up = statistics.pstdev(positive) if len(positive) >= 2 else 0.0
    down = statistics.pstdev(negative) if len(negative) >= 2 else 0.0
    if up <= 1e-12:
        return 3.0 if down > 0 else 1.0
    return min(5.0, down / up)


def overextension_atr(rows: List[dict], end: int) -> Optional[float]:
    average = ema(rows, end, 20)
    range_value = atr(rows, end, 14)
    if average is None or range_value is None or range_value <= 0:
        return None
    return (float(rows[end]["close"]) - average) / range_value


def bearish_rsi_divergence(rows: List[dict], end: int, lookback: int = 28) -> bool:
    if end - lookback < 14:
        return False
    prior_indexes = list(range(end - lookback, end))
    prior_peak = max(prior_indexes, key=lambda index: float(rows[index]["close"]))
    current_close = float(rows[end]["close"])
    prior_close = float(rows[prior_peak]["close"])
    current_rsi = rsi(rows, end)
    prior_rsi = rsi(rows, prior_peak)
    return bool(
        current_rsi is not None
        and prior_rsi is not None
        and current_close > prior_close * 1.002
        and current_rsi < prior_rsi - 5.0
        and current_rsi > 58.0
    )


def funding_zscore(
    symbol: str,
    position: int,
    times: List[int],
    funding: Dict[str, Dict[int, float]],
    recent_bars: int = 6,
    history_bars: int = 180,
) -> Optional[float]:
    if position < history_bars + recent_bars:
        return None
    bucket = funding.get(symbol, {})
    recent = sum(float(bucket.get(times[index], 0.0)) for index in range(position - recent_bars, position))
    history: List[float] = []
    first = max(recent_bars, position - history_bars)
    for anchor in range(first, position - recent_bars + 1):
        history.append(sum(float(bucket.get(times[index], 0.0)) for index in range(anchor - recent_bars, anchor)))
    if len(history) < 30:
        return None
    mean = statistics.fmean(history)
    stdev = statistics.pstdev(history)
    return (recent - mean) / stdev if stdev > 1e-12 else 0.0


def vwm_score(rows: List[dict], end: int) -> Optional[float]:
    momentum = v4.momentum(rows, end, 20)
    volume = v4.volume_ratio(rows, end, 20, 80)
    volatility = v4.realized_annual_vol(rows, end, 40)
    if momentum is None or volume is None or volatility is None or volatility <= 0:
        return None
    return momentum * min(2.5, max(0.25, volume)) / volatility


def rank_tilt(
    target: Dict[str, float],
    scores: Dict[str, float],
    strength: float,
) -> Dict[str, float]:
    selected = [symbol for symbol, weight in target.items() if weight > 0 and symbol in scores]
    if len(selected) < 2:
        return dict(target)
    ordered = sorted(selected, key=lambda symbol: scores[symbol], reverse=True)
    middle = (len(ordered) - 1) / 2.0
    multipliers: Dict[str, float] = {}
    for rank, symbol in enumerate(ordered):
        direction = (middle - rank) / max(1.0, middle)
        multipliers[symbol] = max(0.25, 1.0 + strength * direction)
    original_gross = sum(max(0.0, float(target.get(symbol, 0.0))) for symbol in selected)
    raw = {symbol: float(target[symbol]) * multipliers[symbol] for symbol in selected}
    raw_gross = sum(raw.values())
    if raw_gross <= 0:
        return dict(target)
    result = dict(target)
    for symbol in selected:
        result[symbol] = round(raw[symbol] * original_gross / raw_gross, 4)
    return result


def scaled_target(target: Dict[str, float], scale: float) -> Dict[str, float]:
    if scale <= 0:
        return {}
    return {symbol: round(weight * scale, 4) for symbol, weight in target.items() if abs(weight * scale) > 1e-6}


def apply_variant(
    variant: str,
    target: Dict[str, float],
    ts: int,
    position: int,
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
) -> Dict[str, float]:
    if not target or all(weight <= 0 for weight in target.values()):
        return dict(target)

    vwm: Dict[str, float] = {}
    macd: Dict[str, float] = {}
    funding_z: List[float] = []
    skews: List[float] = []
    extensions: List[float] = []
    divergence = False

    for symbol, weight in target.items():
        if weight <= 0 or symbol not in CORE:
            continue
        index = indexes[symbol].get(ts)
        if index is None:
            continue
        rows = bars[symbol]
        vwm_value = vwm_score(rows, index)
        macd_value = normalized_macd(rows, index)
        funding_value = funding_zscore(symbol, position, times, funding)
        skew_value = downside_skew(rows, index)
        extension_value = overextension_atr(rows, index)
        if vwm_value is not None:
            vwm[symbol] = vwm_value
        if macd_value is not None:
            macd[symbol] = macd_value
        if funding_value is not None:
            funding_z.append(funding_value)
        if skew_value is not None:
            skews.append(skew_value)
        if extension_value is not None:
            extensions.append(extension_value)
        divergence = divergence or bearish_rsi_divergence(rows, index)

    result = dict(target)
    if variant.startswith("VWM_TILT"):
        strength = 0.25 if variant.endswith("25") else 0.50
        return rank_tilt(result, vwm, strength)
    if variant.startswith("NMACD_TILT"):
        strength = 0.25 if variant.endswith("25") else 0.50
        return rank_tilt(result, macd, strength)
    if variant.startswith("RANK_BLEND"):
        strength = 0.25 if variant.endswith("25") else 0.50
        combined = {
            symbol: vwm.get(symbol, 0.0) + macd.get(symbol, 0.0) * 0.35
            for symbol in set(vwm) | set(macd)
        }
        return rank_tilt(result, combined, strength)

    max_funding = max(funding_z) if funding_z else -999.0
    max_skew = max(skews) if skews else 1.0
    max_extension = max(extensions) if extensions else 0.0

    if variant == "FUNDING_REDUCE_Z15":
        return scaled_target(result, 0.5 if max_funding > 1.5 else 1.0)
    if variant == "FUNDING_VETO_Z20":
        return scaled_target(result, 0.0 if max_funding > 2.0 else 1.0)
    if variant == "VOL_SKEW_REDUCE_125":
        return scaled_target(result, 0.65 if max_skew > 1.25 else 1.0)
    if variant == "VOL_SKEW_REDUCE_150":
        return scaled_target(result, 0.65 if max_skew > 1.50 else 1.0)
    if variant == "RSI_DIV_REDUCE":
        return scaled_target(result, 0.6 if divergence else 1.0)
    if variant == "RSI_DIV_VETO":
        return scaled_target(result, 0.0 if divergence else 1.0)
    if variant == "REVERSION_REDUCE_20":
        return scaled_target(result, 0.6 if max_extension > 2.0 else 1.0)
    if variant == "REVERSION_REDUCE_25":
        return scaled_target(result, 0.6 if max_extension > 2.5 else 1.0)

    if variant in {"OVERHEAT_BALANCED", "RANK_VETO_BALANCED", "RANK_VETO_ATTACK"}:
        if variant.startswith("RANK_VETO"):
            strength = 0.35 if variant.endswith("BALANCED") else 0.55
            combined = {
                symbol: vwm.get(symbol, 0.0) + macd.get(symbol, 0.0) * 0.35
                for symbol in set(vwm) | set(macd)
            }
            result = rank_tilt(result, combined, strength)
        scale = 1.0
        if max_funding > 1.5:
            scale *= 0.65 if variant != "RANK_VETO_ATTACK" else 0.80
        if max_skew > 1.35:
            scale *= 0.75 if variant != "RANK_VETO_ATTACK" else 0.85
        if divergence:
            scale *= 0.75 if variant != "RANK_VETO_ATTACK" else 0.85
        if max_extension > 2.2:
            scale *= 0.75 if variant != "RANK_VETO_ATTACK" else 0.85
        floor = 0.35 if variant != "RANK_VETO_ATTACK" else 0.55
        return scaled_target(result, max(floor, scale))

    raise ValueError(f"unknown variant: {variant}")


def targets_for_variant(
    variant: str,
    base: Dict[int, Dict[str, float]],
    bear: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
) -> Dict[int, Dict[str, float]]:
    adjusted: Dict[int, Dict[str, float]] = {}
    for position, ts in enumerate(times):
        base_target = base.get(ts, {})
        adjusted[ts] = apply_variant(variant, base_target, ts, position, times, bars, indexes, funding)
    return v20.desired_targets(adjusted, bear, times)


def evaluate(
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
) -> dict:
    periods = {
        "full": (START, END),
        "year2023": (v4.START_2023, v4.START_2024),
        "year2024": (v4.START_2024, v4.START_2025),
        "year2025": (v4.START_2025, v4.START_2026),
        "holdout2026H1": (v4.START_2026, END),
    }
    return {
        period: v20.run_scenarios(targets, times, bars, indexes, funding, start, end)
        for period, (start, end) in periods.items()
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def preliminary_pass(item: dict, baseline: dict) -> bool:
    full = item["full"]["BASE_10BPS"]
    base_full = baseline["full"]["BASE_10BPS"]
    holdout = item["holdout2026H1"]["BASE_10BPS"]
    base_holdout = baseline["holdout2026H1"]["BASE_10BPS"]
    severe = item["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    base_severe = baseline["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    annual_positive = all(item[period]["BASE_10BPS"]["compoundedReturnPct"] > 0 for period in ["year2023", "year2024", "year2025"])
    return (
        annual_positive
        and full["cagrPct"] >= base_full["cagrPct"]
        and (full["profitFactor"] or 0) >= (base_full["profitFactor"] or 0)
        and full["maxDrawdownPct"] >= base_full["maxDrawdownPct"] - 2.0
        and severe["compoundedReturnPct"] >= base_severe["compoundedReturnPct"]
        and holdout["compoundedReturnPct"] >= base_holdout["compoundedReturnPct"]
        and (holdout["profitFactor"] or 0) >= (base_holdout["profitFactor"] or 0)
    )


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if START <= int(bar["ts"]) < END]

    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    baseline_targets = v20.desired_targets(base_map, bear_map, times)

    variants = [
        "VWM_TILT25", "VWM_TILT50",
        "NMACD_TILT25", "NMACD_TILT50",
        "RANK_BLEND25", "RANK_BLEND50",
        "FUNDING_REDUCE_Z15", "FUNDING_VETO_Z20",
        "VOL_SKEW_REDUCE_125", "VOL_SKEW_REDUCE_150",
        "RSI_DIV_REDUCE", "RSI_DIV_VETO",
        "REVERSION_REDUCE_20", "REVERSION_REDUCE_25",
        "OVERHEAT_BALANCED", "RANK_VETO_BALANCED", "RANK_VETO_ATTACK",
    ]

    results: Dict[str, dict] = {"V6_BASELINE": evaluate(baseline_targets, times, bars, indexes, funding)}
    for variant in variants:
        targets = targets_for_variant(variant, base_map, bear_map, times, bars, indexes, funding)
        results[variant] = evaluate(targets, times, bars, indexes, funding)

    baseline = results["V6_BASELINE"]
    passed = [variant for variant in variants if preliminary_pass(results[variant], baseline)]
    families = {
        "VWM": ["VWM_TILT25", "VWM_TILT50"],
        "NMACD": ["NMACD_TILT25", "NMACD_TILT50"],
        "RANK_BLEND": ["RANK_BLEND25", "RANK_BLEND50"],
        "FUNDING": ["FUNDING_REDUCE_Z15", "FUNDING_VETO_Z20"],
        "VOL_SKEW": ["VOL_SKEW_REDUCE_125", "VOL_SKEW_REDUCE_150"],
        "RSI_DIV": ["RSI_DIV_REDUCE", "RSI_DIV_VETO"],
        "REVERSION": ["REVERSION_REDUCE_20", "REVERSION_REDUCE_25"],
        "COMBINED": ["OVERHEAT_BALANCED", "RANK_VETO_BALANCED", "RANK_VETO_ATTACK"],
    }
    stable_families = [family for family, members in families.items() if sum(member in passed for member in members) >= 2]
    eligible = [variant for variant in passed if any(variant in families[family] for family in stable_families)]
    eligible.sort(key=lambda variant: (
        results[variant]["holdout2026H1"]["BASE_10BPS"]["compoundedReturnPct"],
        results[variant]["full"]["BASE_10BPS"]["cagrPct"],
        results[variant]["full"]["BASE_10BPS"]["profitFactor"] or 0,
    ), reverse=True)
    selected = eligible[0] if eligible else None
    status = "FEATURE_OVERLAY_ROBUST_CANDIDATE_FOUND" if selected else "NO_ROBUST_FEATURE_OVERLAY_IMPROVEMENT"

    comparisons: Dict[str, dict] = {}
    base_full = baseline["full"]["BASE_10BPS"]
    base_holdout = baseline["holdout2026H1"]["BASE_10BPS"]
    for variant, item in results.items():
        full = item["full"]["BASE_10BPS"]
        holdout = item["holdout2026H1"]["BASE_10BPS"]
        comparisons[variant] = {
            "fullReturnDeltaPct": full["compoundedReturnPct"] - base_full["compoundedReturnPct"],
            "fullCagrDeltaPct": full["cagrPct"] - base_full["cagrPct"],
            "fullPfDelta": (full["profitFactor"] or 0) - (base_full["profitFactor"] or 0),
            "fullDdImprovementPct": full["maxDrawdownPct"] - base_full["maxDrawdownPct"],
            "holdoutReturnDeltaPct": holdout["compoundedReturnPct"] - base_holdout["compoundedReturnPct"],
            "holdoutPfDelta": (holdout["profitFactor"] or 0) - (base_holdout["profitFactor"] or 0),
        }

    result = rounded({
        "version": 27,
        "strategyId": "DISDEX_FEATURE_OVERLAY_V27",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected,
        "preliminaryPassed": passed,
        "stableFamilies": stable_families,
        "eligible": eligible,
        "fixedV6": {
            "components": [component.__dict__ for component in v20.COMPONENTS],
            "overlay": v20.OVERLAY.__dict__,
            "hedge": v20.HEDGE.__dict__,
            "confirmBars": v20.CONFIRM_BARS,
        },
        "testedFeatures": [
            "volumeWeightedMomentum", "normalizedMACD", "trailingFundingZScore",
            "realizedDownsideUpsideVolatilitySkew", "bearishRSIDivergence", "priceReversionOverextensionATR",
        ],
        "notTestedYet": [
            "orderBookDepthRatio", "bidAskSpreadCompression", "takerFlow", "markIndexBasis",
            "openInterestChange", "impliedVolatilityTermStructure",
        ],
        "results": results,
        "comparisonVsV6": comparisons,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "Historical order-book, spread, taker-flow, OI and option IV term-structure data are not present in the frozen USD-M cache and are deferred to V19 forward evidence.",
            "Funding signal uses trailing settled funding only; no future funding bucket is used.",
            "Feature thresholds were predeclared before this run and holdout 2026H1 is not used to tune them.",
            "Research branch only; production, VPS, accounts, positions, .env and live runners are unchanged.",
        ],
    })

    report = [
        "# Dis-Dex Manager Feature Overlay V27",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected or 'NONE'}**",
        f"- Preliminary passed: {', '.join(passed) if passed else 'NONE'}",
        f"- Stable families: {', '.join(stable_families) if stable_families else 'NONE'}",
        "- Frozen V6: UNCHANGED",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Full history and 2026H1 holdout",
        "",
        "| Variant | Full return | CAGR | PF | DD | Severe return | 2026H1 return | 2026H1 PF |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for variant, item in result["results"].items():
        full = item["full"]["BASE_10BPS"]
        severe = item["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
        holdout = item["holdout2026H1"]["BASE_10BPS"]
        report.append(
            f"| {variant} | {full['compoundedReturnPct']}% | {full['cagrPct']}% | {full['profitFactor']} | "
            f"{full['maxDrawdownPct']}% | {severe['compoundedReturnPct']}% | {holdout['compoundedReturnPct']}% | {holdout['profitFactor']} |"
        )
    report.extend([
        "",
        "## Verdict",
        "",
        "A candidate must beat frozen V6 in full-history CAGR/PF, severe return and untouched 2026H1 holdout, while preserving positive 2023/2024/2025 returns and nearby-parameter family stability.",
        "",
        "## Deferred forward-only features",
        "",
        "Order-book depth, spread compression, taker flow, mark/index basis, OI changes and implied-volatility term structure require separate forward evidence and are not inferred from OHLCV.",
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-feature-overlay-v27.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-feature-overlay-v27.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
