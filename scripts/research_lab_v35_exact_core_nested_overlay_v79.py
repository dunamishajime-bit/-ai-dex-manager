from __future__ import annotations

import datetime as dt
import json
import math
import os
import random
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_major_core_nested_v73 as stats
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_asymmetric_return_stack_v32 as v32
import research_lab_resilient_profit_stack_v34 as v34

BAR = 12 * v4.HOUR
DAY = v4.DAY
START = v4.START_2023
END = v4.END
CASH_RESERVE = 0.02
GROSS_CAP = 1.60
RANDOM_SEED = 79079


@dataclass(frozen=True)
class OverlayConfig:
    strong_mult: float
    normal_mult: float
    brake_mult: float
    bear_mult: float
    dd_start: float

    @property
    def config_id(self) -> str:
        return (
            f"S{int(self.strong_mult*100)}_N{int(self.normal_mult*100)}"
            f"_B{int(self.brake_mult*100)}_H{int(self.bear_mult*100)}"
            f"_D{int(self.dd_start*100)}"
        )


def configs() -> List[OverlayConfig]:
    return [
        OverlayConfig(strong, normal, brake, bear, dd_start)
        for strong in (1.00, 1.20, 1.40)
        for normal in (0.80, 1.00, 1.20)
        for brake in (0.20, 0.35)
        for bear in (0.50, 0.75)
        for dd_start in (0.10, 0.15)
    ]


def load_exact_v35() -> tuple[List[int], Dict[int, dict], Dict[int, dict], Dict[int, dict], dict]:
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if START <= int(row["ts"]) < END]
    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    targets = v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
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


def core_multiplier(config: OverlayConfig, core: dict, feature: dict, drawdown: float) -> float:
    if int(core.get("regime", 0)) < 0:
        multiplier = config.bear_mult
    elif int(core.get("regime", 0)) > 0:
        strong = bool(
            feature.get("closeAboveSma20", False)
            and float(feature.get("mom20", 0.0)) >= 10.0
            and float(feature.get("mom3", 0.0)) > 0.0
        )
        brake = bool(
            float(feature.get("shock", 0.0)) <= -4.0
            or float(feature.get("skew", 1.0)) > 1.35
            or not feature.get("closeAboveSma20", False)
        )
        multiplier = config.brake_mult if brake else config.strong_mult if strong else config.normal_mult
    else:
        multiplier = 0.0
    if drawdown <= -config.dd_start - 0.08:
        multiplier *= 0.40
    elif drawdown <= -config.dd_start:
        multiplier *= 0.65
    return multiplier * (1.0 - CASH_RESERVE)


def combine(
    config: OverlayConfig,
    times: Sequence[int],
    core: Dict[int, dict],
    features: Dict[int, dict],
    permuted_core: Optional[List[dict]] = None,
) -> List[dict]:
    rows: List[dict] = []
    equity = peak = 1.0
    source_rows = permuted_core
    for index, ts in enumerate(times):
        c = source_rows[index] if source_rows is not None else core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        f = features.get(ts, {})
        drawdown = equity / peak - 1.0
        multiplier = core_multiplier(config, c, f, drawdown)
        raw_gross = float(c.get("exposure", 0.0)) * abs(multiplier)
        cap = min(1.0, GROSS_CAP / raw_gross) if raw_gross > 0 else 1.0
        value = float(c.get("return", 0.0)) * multiplier * cap
        rows.append({
            "ts": ts,
            "return": value,
            "gross": raw_gross * cap,
            "turnover": 0.0,
            "stops": 0,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    return rows


def outer_folds(times: Sequence[int]) -> List[Tuple[int, int]]:
    return stats.outer_folds(times)


def neighbor(left: OverlayConfig, right: OverlayConfig) -> bool:
    differences = sum([
        left.strong_mult != right.strong_mult,
        left.normal_mult != right.normal_mult,
        left.brake_mult != right.brake_mult,
        left.bear_mult != right.bear_mult,
        left.dd_start != right.dd_start,
    ])
    return differences <= 1


def selection_pass(dev: dict, dev_severe: dict, validation: dict, validation_severe: dict) -> bool:
    return bool(
        dev["compoundedReturnPct"] > 0
        and dev_severe["compoundedReturnPct"] > 0
        and dev["maxDrawdownPct"] >= -35
        and dev_severe["maxDrawdownPct"] >= -50
        and validation["compoundedReturnPct"] > 0
        and validation_severe["compoundedReturnPct"] >= -3
        and validation["maxDrawdownPct"] >= -20
        and validation_severe["maxDrawdownPct"] >= -28
        and (validation["monthlyProfitFactor"] or 0) >= 1.0
    )


def select_config(
    candidates: Sequence[OverlayConfig],
    normal_rows: Dict[str, List[dict]],
    severe_rows: Dict[str, List[dict]],
    train_start: int,
    validation_start: int,
    validation_end: int,
) -> tuple[OverlayConfig, dict]:
    passed: List[OverlayConfig] = []
    ranked: List[tuple] = []
    for config in candidates:
        dev = stats.metrics(normal_rows[config.config_id], train_start, validation_start)
        dev_severe = stats.metrics(severe_rows[config.config_id], train_start, validation_start)
        validation = stats.metrics(normal_rows[config.config_id], validation_start, validation_end)
        validation_severe = stats.metrics(severe_rows[config.config_id], validation_start, validation_end)
        if selection_pass(dev, dev_severe, validation, validation_severe):
            passed.append(config)
            ranked.append((
                (
                    validation_severe["compoundedReturnPct"],
                    validation["compoundedReturnPct"],
                    validation["maxDrawdownPct"],
                    dev_severe["compoundedReturnPct"],
                    -config.strong_mult,
                    -config.normal_mult,
                    -config.bear_mult,
                    config.brake_mult,
                ),
                config,
            ))
    stable = [
        config
        for config in passed
        if sum(neighbor(config, other) for other in passed if other != config) >= 2
    ]
    stable_ids = {config.config_id for config in stable}
    ranked = [item for item in ranked if item[1].config_id in stable_ids]
    ranked.sort(key=lambda item: item[0], reverse=True)
    if ranked:
        top = [item[1] for item in ranked[: min(10, len(ranked))]]
        top.sort(key=lambda config: (
            config.strong_mult,
            config.normal_mult,
            config.bear_mult,
            config.brake_mult,
            -config.dd_start,
        ))
        selected = top[0]
        return selected, {
            "fallback": False,
            "passed": len(passed),
            "stable": len(stable),
            "selected": selected.config_id,
        }

    relaxed = []
    for config in candidates:
        dev = stats.metrics(normal_rows[config.config_id], train_start, validation_start)
        dev_severe = stats.metrics(severe_rows[config.config_id], train_start, validation_start)
        validation = stats.metrics(normal_rows[config.config_id], validation_start, validation_end)
        validation_severe = stats.metrics(severe_rows[config.config_id], validation_start, validation_end)
        if (
            dev["compoundedReturnPct"] > 0
            and validation["compoundedReturnPct"] > 0
            and dev_severe["compoundedReturnPct"] >= -10
            and validation_severe["compoundedReturnPct"] >= -10
        ):
            relaxed.append((
                (
                    validation_severe["compoundedReturnPct"],
                    validation["compoundedReturnPct"],
                    validation["maxDrawdownPct"],
                    dev_severe["compoundedReturnPct"],
                    -config.strong_mult,
                    -config.normal_mult,
                    -config.bear_mult,
                ),
                config,
            ))
    relaxed.sort(key=lambda item: item[0], reverse=True)
    if relaxed:
        top = [item[1] for item in relaxed[: min(10, len(relaxed))]]
        top.sort(key=lambda config: (
            config.strong_mult,
            config.normal_mult,
            config.bear_mult,
            config.brake_mult,
            -config.dd_start,
        ))
        selected = top[0]
    else:
        selected = OverlayConfig(1.0, 0.8, 0.2, 0.5, 0.10)
    return selected, {
        "fallback": True,
        "passed": len(passed),
        "stable": len(stable),
        "relaxed": len(relaxed),
        "selected": selected.config_id,
        "note": "Fallback uses inner Development/Validation only; final OOS and statistical gates are unchanged.",
    }


def splice(parts: Sequence[Tuple[int, int, List[dict]]]) -> List[dict]:
    result = []
    for start, end, rows in parts:
        result.extend(row for row in rows if start <= int(row["ts"]) < end)
    return sorted(result, key=lambda row: int(row["ts"]))


def final_config(selections: Sequence[OverlayConfig]) -> OverlayConfig:
    counts: Dict[str, int] = {}
    for config in selections:
        counts[config.config_id] = counts.get(config.config_id, 0) + 1
    ranked = sorted(
        selections,
        key=lambda config: (
            counts[config.config_id],
            -config.strong_mult,
            -config.normal_mult,
            -config.bear_mult,
            config.brake_mult,
            config.dd_start,
        ),
        reverse=True,
    )
    return ranked[0]


def effective_trials(months_by_config: Dict[str, List[float]]) -> int:
    values = list(months_by_config.values())
    if len(values) < 2:
        return 1
    length = min(len(item) for item in values)
    correlations = []
    sample = values[: min(20, len(values))]
    for index, left in enumerate(sample):
        for right in sample[index + 1:]:
            left = left[:length]
            right = right[:length]
            sd_left = statistics.pstdev(left)
            sd_right = statistics.pstdev(right)
            if sd_left == 0 or sd_right == 0:
                continue
            mean_left = statistics.fmean(left)
            mean_right = statistics.fmean(right)
            covariance = statistics.fmean(
                (left[position] - mean_left) * (right[position] - mean_right)
                for position in range(length)
            )
            correlations.append(covariance / (sd_left * sd_right))
    rho = max(0.0, min(0.99, statistics.fmean(correlations) if correlations else 0.0))
    return max(2, round(1 + (len(values) - 1) * (1.0 - rho)))


def block_permutation(
    config: OverlayConfig,
    times: List[int],
    core: Dict[int, dict],
    features: Dict[int, dict],
    observed_return: float,
    iterations: int = 500,
) -> dict:
    original = [dict(core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})) for ts in times]
    block_size = 60
    blocks = [original[start:start + block_size] for start in range(0, len(original), block_size)]
    rng = random.Random(RANDOM_SEED)
    returns = []
    exceed = 0
    for _ in range(iterations):
        shuffled = list(blocks)
        rng.shuffle(shuffled)
        sequence = [row for block in shuffled for row in block][: len(times)]
        rows = combine(config, times, core, features, sequence)
        value = stats.metrics(rows, times[0], times[-1] + BAR)["compoundedReturnPct"]
        returns.append(value)
        if value >= observed_return:
            exceed += 1
    returns.sort()
    return {
        "pValue": (exceed + 1) / (iterations + 1),
        "iterations": iterations,
        "medianReturnPct": statistics.median(returns),
        "p95ReturnPct": returns[min(len(returns) - 1, int(0.95 * len(returns)))],
        "maxReturnPct": max(returns),
        "blockBars12h": block_size,
        "blockDays": block_size / 2.0,
    }


def rounded(value):
    return stats.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    times, normal_core, severe_core, features, coverage = load_exact_v35()
    candidates = configs()
    normal_rows = {
        config.config_id: combine(config, times, normal_core, features)
        for config in candidates
    }
    severe_rows = {
        config.config_id: combine(config, times, severe_core, features)
        for config in candidates
    }
    folds = outer_folds(times)
    selections: List[OverlayConfig] = []
    parts = []
    severe_parts = []
    fold_results = []
    for fold_index, (test_start, test_end) in enumerate(folds):
        train_start, validation_start, validation_end = stats.inner_bounds(times[0], test_start)
        selected, audit = select_config(
            candidates,
            normal_rows,
            severe_rows,
            train_start,
            validation_start,
            validation_end,
        )
        selections.append(selected)
        parts.append((test_start, test_end, normal_rows[selected.config_id]))
        severe_parts.append((test_start, test_end, severe_rows[selected.config_id]))
        fold_results.append({
            "fold": fold_index + 1,
            "testStart": dt.datetime.fromtimestamp(test_start / 1000, tz=dt.timezone.utc).isoformat(),
            "testEnd": dt.datetime.fromtimestamp(test_end / 1000, tz=dt.timezone.utc).isoformat(),
            "config": asdict(selected),
            "selectionAudit": audit,
            "test": stats.metrics(normal_rows[selected.config_id], test_start, test_end),
            "testSevere": stats.metrics(severe_rows[selected.config_id], test_start, test_end),
        })
    oos = splice(parts)
    oos_severe = splice(severe_parts)
    oos_start, oos_end = folds[0][0], folds[-1][1]
    selected = final_config(selections)
    full_start, full_end = times[0], times[-1] + BAR
    full = stats.metrics(normal_rows[selected.config_id], full_start, full_end)
    full_severe = stats.metrics(severe_rows[selected.config_id], full_start, full_end)
    months_by_config = {
        config.config_id: stats.monthly_returns(normal_rows[config.config_id], full_start, full_end)
        for config in candidates
    }
    trial_count = effective_trials(months_by_config)
    oos_months = stats.monthly_returns(oos, oos_start, oos_end)
    dsr = stats.deflated_sharpe(oos_months, trial_count)
    common_months = min(len(values) for values in months_by_config.values())
    reality = stats.reality_and_spa(
        months_by_config,
        [0.0] * common_months,
        1000,
    )
    permutation = block_permutation(
        selected,
        times,
        normal_core,
        features,
        full["compoundedReturnPct"],
        500,
    )
    positive = sum(item["test"]["compoundedReturnPct"] > 0 for item in fold_results)
    positive_severe = sum(item["testSevere"]["compoundedReturnPct"] > 0 for item in fold_results)
    oos_metric = stats.metrics(oos, oos_start, oos_end)
    oos_severe_metric = stats.metrics(oos_severe, oos_start, oos_end)
    robust = bool(
        positive >= 4
        and positive_severe >= 3
        and oos_metric["compoundedReturnPct"] > 0
        and oos_severe_metric["compoundedReturnPct"] > 0
        and oos_metric["maxDrawdownPct"] >= -30
        and oos_severe_metric["maxDrawdownPct"] >= -40
        and (dsr["probability"] or 0) >= 0.90
        and reality["realityCheckP"] is not None
        and reality["realityCheckP"] <= 0.10
        and permutation["pValue"] is not None
        and permutation["pValue"] <= 0.10
    )
    status = "V35_EXACT_CORE_OVERLAY_ROBUST_PASS" if robust else "V35_EXACT_CORE_OVERLAY_RESEARCH_ONLY"
    freeze = {
        "strategyId": "V35_EXACT_CORE_NESTED_OVERLAY_V79",
        "effectiveAfter": "2026-07-20T00:00:00+00:00",
        "coreSignalAndExecution": "Exact V35 core_series fixed; no Entry/Exit retuning.",
        "overlay": asdict(selected),
        "grossCap": GROSS_CAP,
        "cashReservePct": CASH_RESERVE * 100.0,
        "minimumForwardTradesBeforeRetune": 30,
        "minimumForwardMonthsBeforeRetune": 6,
    }
    result = rounded({
        "version": 79,
        "strategyId": "V35_EXACT_CORE_NESTED_OVERLAY_V79",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "robustPass": robust,
        "candidateCount": len(candidates),
        "effectiveMultipleTestingTrials": trial_count,
        "outerFolds": fold_results,
        "positiveOuterFolds": positive,
        "positiveOuterSevereFolds": positive_severe,
        "outerOos": oos_metric,
        "outerOosSevere": oos_severe_metric,
        "selectedOverlay": asdict(selected),
        "full": full,
        "fullSevere": full_severe,
        "multipleTesting": {
            "deflatedSharpe": dsr,
            "whiteRealityCheckAndSpaAgainstCash": reality,
            "thirtyDayCoreBundlePermutation": permutation,
        },
        "riskSpecification": {
            "coreSignal": "Exact DISDEX_RESILIENT_PROFIT_MAIN_V35 Bagged Core; completed 12h decision and next-bar execution are inherited.",
            "strongGrossMultiplier": selected.strong_mult,
            "normalGrossMultiplier": selected.normal_mult,
            "brakeGrossMultiplier": selected.brake_mult,
            "btcBearGrossMultiplier": selected.bear_mult,
            "portfolioDrawdownBrakeStartPct": selected.dd_start * 100.0,
            "drawdownScaleAtStart": 0.65,
            "drawdownScaleAtAdditional8Pct": 0.40,
            "grossCap": GROSS_CAP,
            "cashReservePct": CASH_RESERVE * 100.0,
            "majorCoreHardStop": "NONE_ADDED: V35 exits and rotates on its completed 12h signal logic. Loss control is via Brake multiplier, Gross cap and portfolio DD brake.",
            "normalExecution": "10 bps turnover cost, no delay, no additional adverse bps.",
            "severeExecution": "50 bps turnover cost, one completed 12h-bar delay, 3 bps adverse cost per Gross per bar.",
        },
        "forwardFreeze": freeze,
        "coverage": coverage,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V35 was developed before this validation; the core Signal and execution are frozen, while only 72 overlay-risk candidates are tested.",
            "No independent per-symbol hard stop is added because doing so changes the validated V35 execution semantics.",
            "Forward evidence remains required before Production promotion.",
        ],
    })
    (state_dir / "v35-exact-core-nested-overlay-v79.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (state_dir / "v35-exact-core-v79-forward-freeze.json").write_text(
        json.dumps(result["forwardFreeze"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Exact Core + Nested Overlay V79",
        "",
        f"- Status: **{status}**",
        "- Core Entry/Exit retuned: **NO**",
        f"- Outer OOS: {oos_metric['compoundedReturnPct']}% / DD {oos_metric['maxDrawdownPct']}%",
        f"- Outer OOS Severe: {oos_severe_metric['compoundedReturnPct']}% / DD {oos_severe_metric['maxDrawdownPct']}%",
        f"- Positive folds: {positive}/{len(folds)}; Severe {positive_severe}/{len(folds)}",
        f"- Full: {full['compoundedReturnPct']}% / CAGR {full['cagrPct']}% / DD {full['maxDrawdownPct']}%",
        f"- Full Severe: {full_severe['compoundedReturnPct']}% / DD {full_severe['maxDrawdownPct']}%",
        f"- DSR probability: {dsr['probability']}",
        f"- Reality Check p: {reality['realityCheckP']}",
        f"- SPA approximation p: {reality['spaApproxP']}",
        f"- 30-day Core-bundle permutation p: {permutation['pValue']}",
        "",
        f"- Selected Overlay: `{selected.config_id}`",
        f"- Gross cap: {GROSS_CAP}",
        "- Independent Major-Core hard stop: NONE ADDED; exact V35 signal exit is retained.",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-exact-core-nested-overlay-v79.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
