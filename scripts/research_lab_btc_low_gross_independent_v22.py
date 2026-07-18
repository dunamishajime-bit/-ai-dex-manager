from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7
import research_lab_btc_variable_leverage_v21 as v21


@dataclass(frozen=True)
class BtcLogic:
    logic_id: str
    family: str
    fast_days: int = 0
    slow_days: int = 0
    momentum_days: int = 0
    breakout_days: int = 0
    exit_days: int = 0
    confirm_bars: int = 1
    long_gross: float = 0.75
    short_gross: float = 0.25


def scenario(scenario_id: str) -> v7.ExecutionScenario:
    return next(item for item in v21.scenarios() if item.scenario_id == scenario_id)


BASE_SCENARIO = scenario("BASE_10BPS")
SEVERE_SCENARIO = scenario("SEVERE_50BPS_DELAY12H_FUND3")


def prior_extreme(rows: List[dict], index: int, length: int, field: str) -> Optional[float]:
    start = index - length
    if start < 0:
        return None
    values = [float(row[field]) for row in rows[start:index]]
    if not values:
        return None
    return max(values) if field == "high" else min(values)


def btc_logic_targets(
    logic: BtcLogic,
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[int, Dict[str, float]]:
    rows = bars["BTC"]
    result: Dict[int, Dict[str, float]] = {}
    state = 0
    pending_sign = 0
    pending_count = 0

    for ts in times:
        index = indexes["BTC"].get(ts)
        if index is None:
            result[ts] = {}
            continue
        close = float(rows[index]["close"])
        raw = 0
        long_exit = False
        short_exit = False

        if logic.family == "FAST_SMA":
            fast = v4.sma(rows, index, logic.fast_days * 2)
            slow = v4.sma(rows, index, logic.slow_days * 2)
            momentum = v4.momentum(rows, index, logic.momentum_days * 2)
            if fast is None or slow is None or momentum is None:
                result[ts] = {"BTC": state * (logic.long_gross if state > 0 else logic.short_gross)} if state else {}
                continue
            raw = 1 if close > fast > slow and momentum > 0 else -1 if close < fast < slow and momentum < 0 else 0
            long_exit = close < fast and momentum < 0
            short_exit = close > fast and momentum > 0
        elif logic.family == "BREAKOUT":
            upper = prior_extreme(rows, index, logic.breakout_days * 2, "high")
            lower = prior_extreme(rows, index, logic.breakout_days * 2, "low")
            exit_low = prior_extreme(rows, index, logic.exit_days * 2, "low")
            exit_high = prior_extreme(rows, index, logic.exit_days * 2, "high")
            if upper is None or lower is None or exit_low is None or exit_high is None:
                result[ts] = {"BTC": state * (logic.long_gross if state > 0 else logic.short_gross)} if state else {}
                continue
            raw = 1 if close > upper else -1 if close < lower else 0
            long_exit = close < exit_low
            short_exit = close > exit_high
        else:
            raise ValueError(f"unknown BTC logic family: {logic.family}")

        if state > 0 and long_exit:
            state = 0
        elif state < 0 and short_exit:
            state = 0

        if raw != 0:
            if raw == pending_sign:
                pending_count += 1
            else:
                pending_sign = raw
                pending_count = 1
            if pending_count >= logic.confirm_bars and raw != state:
                state = raw
        else:
            pending_sign = 0
            pending_count = 0

        if state > 0:
            result[ts] = {"BTC": logic.long_gross}
        elif state < 0 and logic.short_gross > 0:
            result[ts] = {"BTC": -logic.short_gross}
        else:
            result[ts] = {}
    return result


def logic_grid() -> List[BtcLogic]:
    result: List[BtcLogic] = []
    for fast in [7, 14, 21]:
        for slow in [30, 60]:
            if fast >= slow:
                continue
            for momentum in [5, 10, 20]:
                for confirm in [1, 2]:
                    for long_gross in [0.5, 0.75, 1.0]:
                        for short_gross in [0.0, 0.25]:
                            logic_id = f"SMA_F{fast}_S{slow}_M{momentum}_Q{confirm}_L{long_gross}_H{short_gross}"
                            result.append(BtcLogic(logic_id, "FAST_SMA", fast, slow, momentum, 0, 0, confirm, long_gross, short_gross))
    for breakout in [10, 20, 30]:
        for exit_days in [5, 10]:
            if exit_days >= breakout:
                continue
            for confirm in [1, 2]:
                for long_gross in [0.5, 0.75, 1.0]:
                    for short_gross in [0.0, 0.25]:
                        logic_id = f"BRK_E{breakout}_X{exit_days}_Q{confirm}_L{long_gross}_H{short_gross}"
                        result.append(BtcLogic(logic_id, "BREAKOUT", 0, 0, 0, breakout, exit_days, confirm, long_gross, short_gross))
    return result


def signal_cluster_key(logic: BtcLogic) -> Tuple:
    if logic.family == "FAST_SMA":
        return (logic.family, logic.fast_days, logic.slow_days, logic.momentum_days, logic.confirm_bars)
    return (logic.family, logic.breakout_days, logic.exit_days, logic.confirm_bars)


def dev_pass(base: dict, severe: dict) -> bool:
    annual = base.get("annualReturnsPct", {})
    return (
        base["cycles"] >= 8
        and base["compoundedReturnPct"] > 0
        and (base["profitFactor"] or 0) >= 1.1
        and base["maxDrawdownPct"] >= -30
        and annual.get("2024", -100) > 0
        and annual.get("2025", -100) > 0
        and (severe["profitFactor"] or 0) >= 0.9
        and severe["maxDrawdownPct"] >= -40
    )


def evaluate_logic_grid(
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
    start: int,
    end: int,
) -> Tuple[List[dict], Optional[BtcLogic]]:
    evaluated: List[dict] = []
    for logic in logic_grid():
        targets = btc_logic_targets(logic, times, bars, indexes)
        base = v7.simulate_scenario(BASE_SCENARIO, targets, times, bars, indexes, funding, start, end)
        severe = v7.simulate_scenario(SEVERE_SCENARIO, targets, times, bars, indexes, funding, start, end)
        evaluated.append({"logic": asdict(logic), "developmentBase": base, "developmentSevere": severe, "passed": dev_pass(base, severe)})

    cluster_values: Dict[Tuple, List[dict]] = {}
    for item in evaluated:
        logic = BtcLogic(**item["logic"])
        cluster_values.setdefault(signal_cluster_key(logic), []).append(item)

    for item in evaluated:
        logic = BtcLogic(**item["logic"])
        passed_members = [other for other in cluster_values[signal_cluster_key(logic)] if other["passed"]]
        item["clusterPassCount"] = len(passed_members)
        item["clusterMedianCagrPct"] = statistics.median(
            other["developmentBase"]["cagrPct"] for other in passed_members
        ) if passed_members else -999.0
        item["robust"] = bool(item["passed"] and len(passed_members) >= 3)

    robust = [item for item in evaluated if item["robust"]]
    robust.sort(
        key=lambda item: (
            item["clusterMedianCagrPct"],
            item["developmentBase"]["cagrPct"],
            item["developmentBase"]["profitFactor"] or 0,
        ),
        reverse=True,
    )
    selected = BtcLogic(**robust[0]["logic"]) if robust else None
    evaluated.sort(key=lambda item: item["developmentBase"]["cagrPct"], reverse=True)
    return evaluated, selected


def positive_long(target: Dict[str, float]) -> bool:
    return bool(target and all(float(value) >= 0 for value in target.values()) and v4.gross_exposure(target) > 0)


def normalize_positive(target: Dict[str, float], gross: float) -> Dict[str, float]:
    current = sum(max(0.0, float(value)) for value in target.values())
    if current <= 0 or gross <= 0:
        return {}
    return {symbol: max(0.0, float(value)) * gross / current for symbol, value in target.items() if float(value) > 0}


def overlay_targets(
    mode: str,
    base_targets: Dict[int, Dict[str, float]],
    btc_targets: Dict[int, Dict[str, float]],
    times: List[int],
) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        base = dict(base_targets.get(ts, {}))
        btc = float(btc_targets.get(ts, {}).get("BTC", 0.0))
        if not positive_long(base) or btc <= 0:
            result[ts] = base
            continue
        gross = v4.gross_exposure(base)
        if mode == "REPLACE25_SAME_GROSS":
            result[ts] = normalize_positive(base, gross * 0.75)
            result[ts]["BTC"] = result[ts].get("BTC", 0.0) + gross * 0.25
        elif mode == "REPLACE40_SAME_GROSS":
            result[ts] = normalize_positive(base, gross * 0.60)
            result[ts]["BTC"] = result[ts].get("BTC", 0.0) + gross * 0.40
        elif mode == "SHIFT_CORE0P8_BTC0P2_CAP1P0":
            core_gross = min(0.8, gross)
            result[ts] = normalize_positive(base, core_gross)
            result[ts]["BTC"] = result[ts].get("BTC", 0.0) + min(0.2, max(0.0, 1.0 - core_gross))
        elif mode == "SHIFT_CORE0P75_BTC0P35_CAP1P1":
            core_gross = min(0.75, gross)
            result[ts] = normalize_positive(base, core_gross)
            result[ts]["BTC"] = result[ts].get("BTC", 0.0) + min(0.35, max(0.0, 1.1 - core_gross))
        elif mode == "ADD_BTC0P25_CAP1P35":
            combined = dict(base)
            combined["BTC"] = combined.get("BTC", 0.0) + 0.25
            combined_gross = v4.gross_exposure(combined)
            result[ts] = {symbol: value * min(1.0, 1.35 / combined_gross) for symbol, value in combined.items()}
        elif mode == "ADD_BTC0P50_CAP1P60":
            combined = dict(base)
            combined["BTC"] = combined.get("BTC", 0.0) + 0.50
            combined_gross = v4.gross_exposure(combined)
            result[ts] = {symbol: value * min(1.0, 1.60 / combined_gross) for symbol, value in combined.items()}
        else:
            raise ValueError(f"unknown overlay mode: {mode}")
    return result


def run_all_scenarios(targets, times, bars, indexes, funding, start, end) -> Dict[str, dict]:
    return {
        item.scenario_id: v7.simulate_scenario(item, targets, times, bars, indexes, funding, start, end)
        for item in v21.scenarios()
    }


def final_pass(base: dict, severe: dict) -> bool:
    return (
        base["compoundedReturnPct"] > 0
        and (base["profitFactor"] or 0) >= 1.0
        and base["maxDrawdownPct"] >= -20
        and severe["maxDrawdownPct"] >= -35
    )


def overlay_pass(item: dict, baseline: dict) -> bool:
    base = item["full"]["BASE_10BPS"]
    severe = item["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    final = item["final2026H1"]["BASE_10BPS"]
    baseline_base = baseline["full"]["BASE_10BPS"]
    baseline_severe = baseline["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    return (
        base["cagrPct"] >= baseline_base["cagrPct"]
        and base["maxDrawdownPct"] >= baseline_base["maxDrawdownPct"] - 3
        and severe["maxDrawdownPct"] >= baseline_severe["maxDrawdownPct"]
        and final["compoundedReturnPct"] > 0
        and (final["profitFactor"] or 0) >= 1.0
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def fmt_date(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {symbol: v21.fetch_aster_symbol(pair) for symbol, pair in v21.SYMBOL_PAIRS.items()}
    counts = {symbol: {"hourlyCandles": len(item["candles"]), "fundingRows": len(item["funding"])} for symbol, item in raw.items()}
    bars = {symbol: v4.resample_12h(item["candles"]) for symbol, item in raw.items()}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: item["funding"] for symbol, item in raw.items()})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v21.FETCH_START <= int(bar["ts"]) < v21.END]

    first_common = max(min(int(row["ts"]) for row in bars[symbol]) for symbol in v21.SYMBOL_PAIRS)
    test_start = next(ts for ts in times if ts >= first_common + 140 * 12 * v4.HOUR)
    development_end = v4.START_2026
    final_end = v21.END

    evaluated, selected_logic = evaluate_logic_grid(times, bars, indexes, funding, test_start, development_end)
    base_v6_targets = v21.v6_targets(times, bars, indexes)

    baseline = {
        "full": run_all_scenarios(base_v6_targets, times, bars, indexes, funding, test_start, final_end),
        "final2026H1": run_all_scenarios(base_v6_targets, times, bars, indexes, funding, development_end, final_end),
        "exposure": v21.exposure_stats(base_v6_targets, times, test_start, final_end),
    }

    independent: Optional[dict] = None
    overlays: Dict[str, dict] = {}
    if selected_logic is not None:
        selected_targets = btc_logic_targets(selected_logic, times, bars, indexes)
        independent = {
            "logic": asdict(selected_logic),
            "development": run_all_scenarios(selected_targets, times, bars, indexes, funding, test_start, development_end),
            "final2026H1": run_all_scenarios(selected_targets, times, bars, indexes, funding, development_end, final_end),
            "full": run_all_scenarios(selected_targets, times, bars, indexes, funding, test_start, final_end),
            "exposure": v21.exposure_stats(selected_targets, times, test_start, final_end),
            "liquidationProxy": v21.liquidation_proxy(selected_targets, times, bars, indexes, test_start, final_end),
        }
        independent["finalPassed"] = final_pass(
            independent["final2026H1"]["BASE_10BPS"],
            independent["final2026H1"]["SEVERE_50BPS_DELAY12H_FUND3"],
        )

        for mode in [
            "REPLACE25_SAME_GROSS",
            "REPLACE40_SAME_GROSS",
            "SHIFT_CORE0P8_BTC0P2_CAP1P0",
            "SHIFT_CORE0P75_BTC0P35_CAP1P1",
            "ADD_BTC0P25_CAP1P35",
            "ADD_BTC0P50_CAP1P60",
        ]:
            targets = overlay_targets(mode, base_v6_targets, selected_targets, times)
            overlays[mode] = {
                "full": run_all_scenarios(targets, times, bars, indexes, funding, test_start, final_end),
                "final2026H1": run_all_scenarios(targets, times, bars, indexes, funding, development_end, final_end),
                "exposure": v21.exposure_stats(targets, times, test_start, final_end),
                "liquidationProxy": v21.liquidation_proxy(targets, times, bars, indexes, test_start, final_end),
            }
            overlays[mode]["passed"] = overlay_pass(overlays[mode], baseline)

    passed_overlays = [mode for mode, item in overlays.items() if item["passed"]]
    passed_overlays.sort(key=lambda mode: overlays[mode]["full"]["BASE_10BPS"]["cagrPct"], reverse=True)
    selected_overlay = passed_overlays[0] if passed_overlays else None

    independent_passed = bool(independent and independent["finalPassed"])
    if selected_overlay:
        status = "LOW_GROSS_BTC_OVERLAY_CANDIDATE_FOUND"
    elif independent_passed:
        status = "BTC_INDEPENDENT_LOGIC_POSITIVE_HOLDOUT"
    elif selected_logic:
        status = "BTC_DEV_LOGIC_FOUND_BUT_HOLDOUT_REJECTED"
    else:
        status = "BTC_INDEPENDENT_LOGIC_NOT_FOUND"

    top_development = [
        {
            "logic": item["logic"],
            "developmentBase": item["developmentBase"],
            "developmentSevere": item["developmentSevere"],
            "passed": item["passed"],
            "clusterPassCount": item["clusterPassCount"],
            "clusterMedianCagrPct": item["clusterMedianCagrPct"],
            "robust": item["robust"],
        }
        for item in evaluated[:20]
    ]

    result = rounded({
        "version": 22,
        "strategyId": "BTC_LOW_GROSS_OVERLAY_AND_INDEPENDENT_LOGIC_V22",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "windows": {
            "full": {"start": test_start, "end": final_end, "startDate": fmt_date(test_start), "endDate": fmt_date(final_end)},
            "development": {"start": test_start, "end": development_end, "startDate": fmt_date(test_start), "endDate": fmt_date(development_end)},
            "final2026H1": {"start": development_end, "end": final_end, "startDate": fmt_date(development_end), "endDate": fmt_date(final_end)},
        },
        "source": {"venue": "ASTER_DEX_PUBLIC_FUTURES_API", "counts": counts, "authenticationUsed": False},
        "baseline": baseline,
        "logicSearch": {
            "candidateCount": len(evaluated),
            "selectionUsesDevelopmentOnly": True,
            "families": ["FAST_SMA", "BREAKOUT"],
            "selectedLogic": asdict(selected_logic) if selected_logic else None,
            "topDevelopment": top_development,
        },
        "independentBtc": independent,
        "lowGrossOverlays": overlays,
        "selectedOverlay": selected_overlay,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "The BTC logic was selected on the development window only and evaluated separately on 2026 H1.",
            "Aster public OHLCV and funding are modeled; V19 order-book calibration is not yet frozen.",
            "Liquidation checks are proxies and do not reproduce maintenance-margin tiers or cross-margin wallet equity.",
            "No production, VPS, account, order, position, .env, or live-runner setting was changed.",
        ],
    })

    report = [
        "# BTC Low-Gross Overlay and Independent Logic V22",
        "",
        f"- Status: **{status}**",
        f"- Full window: {result['windows']['full']['startDate']} to {result['windows']['full']['endDate']}",
        f"- Development: {result['windows']['development']['startDate']} to {result['windows']['development']['endDate']}",
        f"- Holdout: {result['windows']['final2026H1']['startDate']} to {result['windows']['final2026H1']['endDate']}",
        f"- Selected BTC logic: **{result['logicSearch']['selectedLogic']['logic_id'] if result['logicSearch']['selectedLogic'] else 'NONE'}**",
        f"- Selected overlay: **{selected_overlay or 'NONE'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Baseline and selected BTC-only logic",
        "",
        "| Strategy | Full return | Full CAGR | PF | Max DD | Holdout return | Holdout PF | Holdout DD | Severe full DD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]

    baseline_full = result["baseline"]["full"]["BASE_10BPS"]
    baseline_final = result["baseline"]["final2026H1"]["BASE_10BPS"]
    baseline_severe = result["baseline"]["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    report.append(
        f"| V6_BASELINE | {baseline_full['compoundedReturnPct']} | {baseline_full['cagrPct']} | {baseline_full['profitFactor']} | "
        f"{baseline_full['maxDrawdownPct']} | {baseline_final['compoundedReturnPct']} | {baseline_final['profitFactor']} | "
        f"{baseline_final['maxDrawdownPct']} | {baseline_severe['maxDrawdownPct']} |"
    )
    if result["independentBtc"]:
        full = result["independentBtc"]["full"]["BASE_10BPS"]
        final = result["independentBtc"]["final2026H1"]["BASE_10BPS"]
        severe = result["independentBtc"]["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| BTC_INDEPENDENT | {full['compoundedReturnPct']} | {full['cagrPct']} | {full['profitFactor']} | {full['maxDrawdownPct']} | "
            f"{final['compoundedReturnPct']} | {final['profitFactor']} | {final['maxDrawdownPct']} | {severe['maxDrawdownPct']} |"
        )

    report.extend([
        "",
        "## Low-gross overlays",
        "",
        "| Mode | Full return | CAGR | PF | Max DD | Holdout return | Holdout PF | Severe DD | Mean gross | Max gross | Passed |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ])
    for mode, item in result["lowGrossOverlays"].items():
        full = item["full"]["BASE_10BPS"]
        final = item["final2026H1"]["BASE_10BPS"]
        severe = item["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| {mode} | {full['compoundedReturnPct']} | {full['cagrPct']} | {full['profitFactor']} | {full['maxDrawdownPct']} | "
            f"{final['compoundedReturnPct']} | {final['profitFactor']} | {severe['maxDrawdownPct']} | "
            f"{item['exposure']['mean']} | {item['exposure']['max']} | {item['passed']} |"
        )

    report.extend([
        "",
        "## Interpretation",
        "",
        "The independent BTC logic is selected without using the 2026 H1 holdout. Low-gross overlays are evaluated only after the BTC signal is frozen.",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "btc-low-gross-independent-v22.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-low-gross-independent-v22.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
