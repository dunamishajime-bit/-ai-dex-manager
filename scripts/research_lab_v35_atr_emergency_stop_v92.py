from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
core = v69.core
DEV_END = core.v4.START_2026
FIXED_TARGET_CONFIG = v90.Config(0.05, 0.20, 12)


@dataclass(frozen=True)
class StopConfig:
    atr_length: int
    stop_atr: float
    cooldown_bars: int

    @property
    def config_id(self) -> str:
        return f"A{self.atr_length}_S{str(self.stop_atr).replace('.', 'p')}_C{self.cooldown_bars}"


def configs() -> List[StopConfig]:
    return [
        StopConfig(*values)
        for values in itertools.product(
            (10, 20, 40),
            (1.5, 2.0, 2.5, 3.0),
            (0, 1, 2),
        )
    ]


def rolling_mean(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= length:
            total -= values[index - length]
        if index >= length - 1:
            result[index] = total / length
    return result


def true_range(rows: List[dict]) -> List[float]:
    if not rows:
        return []
    result = [float(rows[0]["high"]) - float(rows[0]["low"])]
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        result.append(max(high - low, abs(high - previous), abs(low - previous)))
    return result


def atr_maps(bars: Dict[str, List[dict]], config: StopConfig) -> Dict[str, List[Optional[float]]]:
    return {
        symbol: rolling_mean(true_range(rows), config.atr_length)
        for symbol, rows in bars.items()
    }


def core_series_stop(
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
    cost_bps: float,
    delay_bars: int,
    adverse_bps: float,
    config: StopConfig,
    stop_slippage_bps: float,
) -> tuple[Dict[int, dict], dict]:
    atrs = atr_maps(bars, config)
    result: Dict[int, dict] = {}
    portfolio: Dict[str, float] = {}
    cooldown_until: Dict[str, int] = {}
    stop_counts: Dict[str, int] = {symbol: 0 for symbol in bars}
    stopped_loss_sum = 0.0
    for position, ts in enumerate(times):
        source = position - 1 - delay_bars
        raw_desired = dict(targets.get(times[source], {})) if source >= 0 else {}
        desired = {
            symbol: float(weight)
            for symbol, weight in raw_desired.items()
            if position >= cooldown_until.get(symbol, 0)
        }
        entry_turnover = core.v4.turnover(portfolio, desired) if desired != portfolio else 0.0
        gross_return = actual_funding = stop_exit_turnover = 0.0
        stopped_symbols: List[str] = []
        for symbol, weight in desired.items():
            idx = indexes[symbol].get(ts)
            if idx is None:
                continue
            bar = bars[symbol][idx]
            open_price = float(bar["open"])
            close_price = float(bar["close"])
            high = float(bar["high"])
            low = float(bar["low"])
            atr_index = max(0, idx - 1)
            atr = atrs[symbol][atr_index]
            if atr is None or atr <= 0 or open_price <= 0:
                price_return = close_price / open_price - 1.0 if open_price > 0 else 0.0
                stopped = False
            else:
                distance = config.stop_atr * float(atr)
                if weight > 0:
                    stop_price = max(0.0, open_price - distance)
                    stopped = low <= stop_price
                    exit_price = stop_price * (1.0 - stop_slippage_bps / 10_000.0)
                else:
                    stop_price = open_price + distance
                    stopped = high >= stop_price
                    exit_price = stop_price * (1.0 + stop_slippage_bps / 10_000.0)
                price_return = exit_price / open_price - 1.0 if stopped else close_price / open_price - 1.0
            contribution = float(weight) * price_return
            gross_return += contribution
            actual_funding += float(weight) * funding.get(symbol, {}).get(ts, 0.0) / 100.0
            if stopped:
                stopped_symbols.append(symbol)
                stop_counts[symbol] += 1
                stopped_loss_sum += contribution
                stop_exit_turnover += abs(float(weight))
                cooldown_until[symbol] = position + 1 + config.cooldown_bars
        exposure = core.v4.gross_exposure(desired)
        total_turnover = entry_turnover + stop_exit_turnover
        regime = (
            1 if any(weight > 0 for symbol, weight in desired.items() if symbol != "BTC")
            else -1 if any(weight < 0 for weight in desired.values())
            else 0
        )
        result[ts] = {
            "return": (
                gross_return
                - actual_funding
                - total_turnover * cost_bps / 10_000.0
                - exposure * adverse_bps / 10_000.0
            ),
            "exposure": exposure,
            "regime": regime,
        }
        portfolio = {
            symbol: weight for symbol, weight in desired.items()
            if symbol not in stopped_symbols
        }
    return result, {
        "stopsBySymbol": stop_counts,
        "totalStops": sum(stop_counts.values()),
        "stoppedGrossContributionPctSum": stopped_loss_sum * 100.0,
    }


def simulate(config: StopConfig, raw: dict) -> dict:
    targets, target_diag = v90.stabilize(raw["targets"], raw["times"], FIXED_TARGET_CONFIG)
    normal_core, normal_stop = core_series_stop(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"],
        10.0, 0, 0.0, config, 5.0,
    )
    severe_core, severe_stop = core_series_stop(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"],
        50.0, 1, 3.0, config, 20.0,
    )
    features = core.v34.features_with_vol(
        raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    v35_config = core.CoreConfig()
    normal_rows = core.core_rows(v35_config, raw["times"], normal_core, features)
    severe_rows = core.core_rows(v35_config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, normal_core, features)
    controlled_normal, normal_control = v86.controlled_core(normal_rows, context, None)
    controlled_severe, severe_control = v86.controlled_core(severe_rows, context, None)
    return {
        "normalRows": controlled_normal,
        "severeRows": controlled_severe,
        "targetDiagnostics": target_diag,
        "stopDiagnostics": {"normal": normal_stop, "severe": severe_stop},
        "controlDiagnostics": {"normal": normal_control, "severe": severe_control},
    }


def neighbor(left: StopConfig, right: StopConfig) -> bool:
    differences = sum([
        left.atr_length != right.atr_length,
        left.stop_atr != right.stop_atr,
        left.cooldown_bars != right.cooldown_bars,
    ])
    return differences <= 1


def evaluate(config: StopConfig, raw: dict, baseline: dict) -> dict:
    simulation = simulate(config, raw)
    normal = simulation["normalRows"]
    severe = simulation["severeRows"]
    dev = v69.metrics(normal, core.CORE_START, DEV_END)
    dev_severe = v69.metrics(severe, core.CORE_START, DEV_END)
    hold = v69.metrics(normal, DEV_END, core.CORE_END)
    hold_severe = v69.metrics(severe, DEV_END, core.CORE_END)
    full = v69.metrics(normal, core.CORE_START, core.CORE_END)
    full_severe = v69.metrics(severe, core.CORE_START, core.CORE_END)
    development_pass = bool(
        dev["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"] * 0.90
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"]
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"]
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"]
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and simulation["stopDiagnostics"]["normal"]["totalStops"] >= 5
    )
    holdout_pass = bool(
        hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
        and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.70
        and hold["maxDrawdownPct"] >= baseline["reused2026H1"]["maxDrawdownPct"]
        and hold_severe["maxDrawdownPct"] >= -15.0
        and full_severe["compoundedReturnPct"] >= baseline["fullSevere"]["compoundedReturnPct"]
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "developmentPass": development_pass,
        "holdoutPass": holdout_pass,
        "development": dev,
        "developmentSevere": dev_severe,
        "reused2026H1": hold,
        "reused2026H1Severe": hold_severe,
        "full": full,
        "fullSevere": full_severe,
        "targetDiagnostics": simulation["targetDiagnostics"],
        "stopDiagnostics": simulation["stopDiagnostics"],
    }


def rank_key(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["developmentSevere"]["maxDrawdownPct"],
        item["development"]["maxDrawdownPct"],
        -item["config"]["stop_atr"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    baseline_sim = v90.simulate(FIXED_TARGET_CONFIG, raw)
    baseline = {
        "targetConfig": asdict(FIXED_TARGET_CONFIG),
        "development": v69.metrics(baseline_sim["normalRows"], core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(baseline_sim["normalRows"], DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(baseline_sim["severeRows"], DEV_END, core.CORE_END),
        "full": v69.metrics(baseline_sim["normalRows"], core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(baseline_sim["severeRows"], core.CORE_START, core.CORE_END),
    }
    candidates = [evaluate(config, raw, baseline) for config in configs()]
    development_passed = [item for item in candidates if item["developmentPass"]]
    lookup = {config.config_id: config for config in configs()}
    stable = [
        item for item in development_passed
        if sum(
            neighbor(lookup[item["configId"]], lookup[other["configId"]])
            for other in development_passed if other["configId"] != item["configId"]
        ) >= 2
    ]
    accepted = [item for item in stable if item["holdoutPass"]]
    accepted.sort(key=rank_key, reverse=True)
    selected = accepted[0] if accepted else None
    best_2026 = max(
        stable,
        key=lambda item: (
            item["reused2026H1Severe"]["compoundedReturnPct"],
            item["reused2026H1"]["compoundedReturnPct"],
            item["developmentSevere"]["compoundedReturnPct"],
        ),
        default=None,
    )
    status = "V35_ATR_EMERGENCY_STOP_PASS" if selected else "NO_V35_ATR_EMERGENCY_STOP_PASS"
    result = rounded({
        "version": 92,
        "strategyId": "V35_ATR_EMERGENCY_STOP_V92",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(candidates),
        "developmentPassedCount": len(development_passed),
        "stableDevelopmentCount": len(stable),
        "acceptedCount": len(accepted),
        "baseline": baseline,
        "selected": selected,
        "best2026Diagnostic": best_2026,
        "topAccepted": accepted[:30],
        "topDevelopment": sorted(stable, key=rank_key, reverse=True)[:40],
        "allCandidates": sorted(candidates, key=rank_key, reverse=True),
        "rule": {
            "target": "Fixed V90 no-trade-band target allocator T50_P20_S12.",
            "stop": "For every active symbol, cap the current completed 12h bar at 1.5-3.0 prior ATR from its Open.",
            "cost": "Stopped legs pay an additional closing turnover cost and 5/20 bps stop slippage in normal/Severe modes.",
            "cooldown": "A stopped symbol is blocked for 0-2 subsequent completed 12h bars.",
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "The stop is modeled from 12h OHLC and cannot establish the intrabar ordering of stop and other price extremes.",
            "Production promotion requires lower-timeframe execution replay and exchange stop-order behavior review.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-atr-emergency-stop-v92.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 ATR Emergency Stop V92",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / development {len(development_passed)} / stable {len(stable)} / accepted {len(accepted)}",
        f"- Baseline Full: {baseline['full']['compoundedReturnPct']}% / Severe {baseline['fullSevere']['compoundedReturnPct']}%",
        f"- Baseline 2026H1: {baseline['reused2026H1']['compoundedReturnPct']}% / Severe {baseline['reused2026H1Severe']['compoundedReturnPct']}%",
    ]
    if selected:
        report.extend([
            "",
            f"- Selected: **{selected['configId']}**",
            f"- Stops normal / Severe: {selected['stopDiagnostics']['normal']['totalStops']} / {selected['stopDiagnostics']['severe']['totalStops']}",
            f"- Development: {selected['development']['compoundedReturnPct']}% / Severe {selected['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected['reused2026H1']['compoundedReturnPct']}% / Severe {selected['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Full: {selected['full']['compoundedReturnPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Full Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
        ])
    if not selected and best_2026:
        report.extend([
            "",
            f"- Best 2026 diagnostic: `{best_2026['configId']}`",
            f"- Stops normal / Severe: {best_2026['stopDiagnostics']['normal']['totalStops']} / {best_2026['stopDiagnostics']['severe']['totalStops']}",
            f"- 2026H1: {best_2026['reused2026H1']['compoundedReturnPct']}% / Severe {best_2026['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Development: {best_2026['development']['compoundedReturnPct']}% / Severe {best_2026['developmentSevere']['compoundedReturnPct']}%",
            f"- Full: {best_2026['full']['compoundedReturnPct']}% / Severe {best_2026['fullSevere']['compoundedReturnPct']}%",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-atr-emergency-stop-v92.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
