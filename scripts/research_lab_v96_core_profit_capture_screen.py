from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_v35_weight_band_strong_v95 as v95

core = v95.core
SYMBOLS = ("BTC", "ETH", "BNB", "SOL")
HOUR = 3_600_000
BAR = 12 * HOUR
GROSS_CAP = 2.0
DEV_END = 1_735_689_600_000  # 2025-01-01 UTC
VALIDATION_END = 1_767_225_600_000  # 2026-01-01 UTC


@dataclass(frozen=True)
class ModuleConfig:
    name: str
    family: str
    probe_bars: int = 0
    require_first_positive: bool = False
    hard_take_trigger_pct: Optional[float] = None
    trailing_trigger_pct: Optional[float] = None
    trailing_giveback_ratio: float = 0.40
    trailing_reduction: float = 0.25
    runner_bars: int = 0
    runner_fraction: float = 0.25
    winner_add: float = 0.0


CANDIDATES = (
    ModuleConfig("BASELINE", "BASELINE"),
    ModuleConfig("ENTRY_PROBE50_1BAR", "ENTRY", probe_bars=1),
    ModuleConfig("ENTRY_PROBE50_FIRSTBAR_CONFIRM", "ENTRY", probe_bars=1, require_first_positive=True),
    ModuleConfig("HARD_TAKE25_T8", "HARD_TAKE", hard_take_trigger_pct=8.0),
    ModuleConfig("HARD_TAKE25_T12", "HARD_TAKE", hard_take_trigger_pct=12.0),
    ModuleConfig("TRAIL25_T8_G40", "TRAIL", trailing_trigger_pct=8.0),
    ModuleConfig("TRAIL25_T12_G40", "TRAIL", trailing_trigger_pct=12.0),
    ModuleConfig("TRAIL25_T16_G40", "TRAIL", trailing_trigger_pct=16.0),
    ModuleConfig("EXIT_RUNNER25_1BAR", "RUNNER", runner_bars=1),
    ModuleConfig("EXIT_RUNNER25_2BAR", "RUNNER", runner_bars=2),
    ModuleConfig("WINNER_ADD10", "ADD", winner_add=0.10),
    ModuleConfig("WINNER_ADD20", "ADD", winner_add=0.20),
)


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and abs(number) != float("inf") else fallback


def metrics(rows: List[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    equity = peak = 1.0
    max_dd = 0.0
    gains = losses = 0.0
    for row in active:
        value = finite(row["return"])
        gains += max(value, 0.0)
        losses += max(-value, 0.0)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "bars": len(active),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "averageGross": statistics.fmean(finite(row["gross"]) for row in active) if active else 0.0,
        "maxGross": max((finite(row["gross"]) for row in active), default=0.0),
    }


def v35_scale(item: dict, feature: dict) -> float:
    config = core.CoreConfig()
    multiplier = 1.0
    if int(item.get("regime", 0)) > 0:
        strong = (
            bool(feature.get("closeAboveSma20", False))
            and finite(feature.get("mom20")) >= 10.0
            and finite(feature.get("mom3")) > 0.0
        )
        brake = (
            finite(feature.get("shock")) <= -4.0
            or finite(feature.get("skew"), 1.0) > 1.35
            or not bool(feature.get("closeAboveSma20", False))
        )
        multiplier = config.brake_mult if brake else config.strong_mult if strong else config.normal_mult
    raw_gross = finite(item.get("exposure")) * multiplier
    cap = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
    return multiplier * cap


def price_return(raw: dict, symbol: str, ts: int) -> float:
    index = raw["indexes"][symbol].get(ts)
    if index is None:
        return 0.0
    candle = raw["bars"][symbol][index]
    opened = finite(candle["open"])
    closed = finite(candle["close"])
    return closed / opened - 1.0 if opened > 0 else 0.0


def funding_rate(raw: dict, symbol: str, ts: int) -> float:
    return finite(raw["funding"].get(symbol, {}).get(ts)) / 100.0


def cap_weights(weights: Dict[str, float]) -> Dict[str, float]:
    gross = sum(abs(value) for value in weights.values())
    scale = min(1.0, GROSS_CAP / gross) if gross > 0 else 1.0
    return {symbol: value * scale for symbol, value in weights.items() if abs(value * scale) > 1e-12}


def reconstructed_return(
    weights: Dict[str, float],
    previous: Dict[str, float],
    raw: dict,
    ts: int,
    cost_bps: float,
    adverse_bps: float,
    excluded_symbol: Optional[str] = None,
) -> float:
    total = 0.0
    symbols = set(weights) | set(previous)
    for symbol in symbols:
        if symbol == excluded_symbol:
            continue
        weight = finite(weights.get(symbol))
        old = finite(previous.get(symbol))
        total += weight * price_return(raw, symbol, ts)
        total -= weight * funding_rate(raw, symbol, ts)
        total -= abs(weight - old) * cost_bps / 10_000.0
        total -= abs(weight) * adverse_bps / 10_000.0
    return total


def source_target(targets: Dict[int, Dict[str, float]], times: List[int], position: int, delay_bars: int) -> Dict[str, float]:
    source = position - 1 - delay_bars
    return dict(targets.get(times[source], {})) if source >= 0 else {}


def baseline_weights(
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    position: int,
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    controlled_map: Dict[int, dict],
    delay_bars: int,
) -> Dict[str, float]:
    ts = times[position]
    target = source_target(targets, times, position, delay_bars)
    item = base_core.get(ts, {"exposure": 0.0, "regime": 0})
    scale = v35_scale(item, features.get(ts, {})) * finite(controlled_map.get(ts, {}).get("scale"))
    return cap_weights({symbol: finite(weight) * scale for symbol, weight in target.items()})


def new_state() -> dict:
    return {
        "side": 0,
        "age": 0,
        "firstSignedReturn": None,
        "cumulative": 0.0,
        "peak": 0.0,
        "reduced": False,
        "lastSignedReturn": 0.0,
        "lastBaselineWeight": 0.0,
        "runnerSide": 0,
        "runnerWeight": 0.0,
        "runnerRemaining": 0,
    }


def module_weights(
    config: ModuleConfig,
    baseline: Dict[str, float],
    state: Dict[str, dict],
) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for symbol in SYMBOLS:
        item = state[symbol]
        base_weight = finite(baseline.get(symbol))
        side = 1 if base_weight > 1e-12 else -1 if base_weight < -1e-12 else 0
        previous_side = int(item["side"])

        if side != previous_side:
            if side == 0 and previous_side != 0 and config.runner_bars > 0:
                if finite(item["cumulative"]) > 0 and finite(item["lastSignedReturn"]) > 0:
                    item["runnerSide"] = previous_side
                    item["runnerWeight"] = abs(finite(item["lastBaselineWeight"])) * config.runner_fraction
                    item["runnerRemaining"] = config.runner_bars
            else:
                item["runnerSide"] = 0
                item["runnerWeight"] = 0.0
                item["runnerRemaining"] = 0
            item["side"] = side
            item["age"] = 0
            item["firstSignedReturn"] = None
            item["cumulative"] = 0.0
            item["peak"] = 0.0
            item["reduced"] = False
            item["lastSignedReturn"] = 0.0

        if side != 0:
            multiplier = 1.0
            if int(item["age"]) < config.probe_bars:
                multiplier *= 0.50
            elif config.require_first_positive and finite(item["firstSignedReturn"], -1.0) <= 0:
                multiplier *= 0.50

            if config.hard_take_trigger_pct is not None:
                if finite(item["peak"]) * 100.0 >= config.hard_take_trigger_pct:
                    item["reduced"] = True

            if config.trailing_trigger_pct is not None:
                peak = finite(item["peak"])
                cumulative = finite(item["cumulative"])
                trigger = config.trailing_trigger_pct / 100.0
                giveback = peak - cumulative
                if peak >= trigger and giveback >= peak * config.trailing_giveback_ratio:
                    item["reduced"] = True

            if bool(item["reduced"]):
                multiplier *= 1.0 - config.trailing_reduction

            if config.winner_add > 0 and int(item["age"]) >= 1 and finite(item["firstSignedReturn"], -1.0) > 0:
                multiplier *= 1.0 + config.winner_add

            result[symbol] = base_weight * multiplier
            item["lastBaselineWeight"] = base_weight
        elif int(item["runnerRemaining"]) > 0 and int(item["runnerSide"]) != 0:
            result[symbol] = int(item["runnerSide"]) * finite(item["runnerWeight"])
    return cap_weights(result)


def update_module_state(state: Dict[str, dict], baseline: Dict[str, float], raw: dict, ts: int) -> None:
    for symbol in SYMBOLS:
        item = state[symbol]
        base_weight = finite(baseline.get(symbol))
        side = 1 if base_weight > 1e-12 else -1 if base_weight < -1e-12 else 0
        if side != 0:
            signed = side * price_return(raw, symbol, ts)
            if int(item["age"]) == 0:
                item["firstSignedReturn"] = signed
            cumulative = (1.0 + finite(item["cumulative"])) * (1.0 + signed) - 1.0
            item["cumulative"] = cumulative
            item["peak"] = max(finite(item["peak"]), cumulative)
            item["lastSignedReturn"] = signed
            item["age"] = int(item["age"]) + 1
        elif int(item["runnerRemaining"]) > 0:
            item["runnerRemaining"] = int(item["runnerRemaining"]) - 1
            if int(item["runnerRemaining"]) <= 0:
                item["runnerSide"] = 0
                item["runnerWeight"] = 0.0


def simulate(
    config: ModuleConfig,
    raw: dict,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    controlled_rows: List[dict],
    cost_bps: float,
    adverse_bps: float,
    delay_bars: int,
    excluded_symbol: Optional[str] = None,
) -> List[dict]:
    controlled_map = {int(row["ts"]): row for row in controlled_rows}
    state = {symbol: new_state() for symbol in SYMBOLS}
    previous_baseline: Dict[str, float] = {}
    previous_candidate: Dict[str, float] = {}
    result: List[dict] = []

    for position, ts in enumerate(times):
        baseline = baseline_weights(targets, times, position, base_core, features, controlled_map, delay_bars)
        candidate = module_weights(config, baseline, state)
        if excluded_symbol:
            baseline.pop(excluded_symbol, None)
            candidate.pop(excluded_symbol, None)

        baseline_recon = reconstructed_return(
            baseline, previous_baseline, raw, ts, cost_bps, adverse_bps, excluded_symbol
        )
        candidate_recon = reconstructed_return(
            candidate, previous_candidate, raw, ts, cost_bps, adverse_bps, excluded_symbol
        )
        exact = finite(controlled_map.get(ts, {}).get("return"))
        value = candidate_recon if excluded_symbol else exact + candidate_recon - baseline_recon
        result.append({
            "ts": ts,
            "return": value,
            "gross": sum(abs(weight) for weight in candidate.values()),
        })
        update_module_state(state, baseline, raw, ts)
        previous_baseline = dict(baseline)
        previous_candidate = dict(candidate)
    return result


def opportunity_audit(
    raw: dict,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    controlled_rows: List[dict],
) -> dict:
    controlled_map = {int(row["ts"]): row for row in controlled_rows}
    episodes: List[dict] = []
    active: Dict[str, dict] = {}

    for position, ts in enumerate(times):
        baseline = baseline_weights(targets, times, position, base_core, features, controlled_map, 0)
        for symbol in SYMBOLS:
            weight = finite(baseline.get(symbol))
            side = 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0
            current = active.get(symbol)
            if current and side != int(current["side"]):
                current["exitPosition"] = position
                active.pop(symbol, None)
                current = None
            if side != 0 and current is None:
                current = {
                    "symbol": symbol,
                    "side": side,
                    "entryPosition": position,
                    "exitPosition": position + 1,
                    "firstSignedReturn": None,
                    "cumulative": 0.0,
                    "peak": 0.0,
                }
                active[symbol] = current
                episodes.append(current)
            if current and side != 0:
                signed = side * price_return(raw, symbol, ts)
                if current["firstSignedReturn"] is None:
                    current["firstSignedReturn"] = signed
                current["cumulative"] = (1.0 + finite(current["cumulative"])) * (1.0 + signed) - 1.0
                current["peak"] = max(finite(current["peak"]), finite(current["cumulative"]))
                current["exitPosition"] = position + 1

    for item in episodes:
        exit_position = int(item["exitPosition"])
        symbol = str(item["symbol"])
        side = int(item["side"])
        for horizon in (1, 3, 6):
            cumulative = 0.0
            for position in range(exit_position, min(exit_position + horizon, len(times))):
                cumulative = (1.0 + cumulative) * (1.0 + side * price_return(raw, symbol, times[position])) - 1.0
            item[f"postExit{horizon}Bars"] = cumulative
        item["giveback"] = max(0.0, finite(item["peak"]) - finite(item["cumulative"]))

    def summarize(rows: List[dict]) -> dict:
        return {
            "episodes": len(rows),
            "firstBarPositivePct": (
                sum(finite(row["firstSignedReturn"]) > 0 for row in rows) / len(rows) * 100.0 if rows else 0.0
            ),
            "averageMfePct": statistics.fmean(finite(row["peak"]) for row in rows) * 100.0 if rows else 0.0,
            "averageExitReturnPct": statistics.fmean(finite(row["cumulative"]) for row in rows) * 100.0 if rows else 0.0,
            "averageGivebackPct": statistics.fmean(finite(row["giveback"]) for row in rows) * 100.0 if rows else 0.0,
            "givebackAtLeast4PctShare": (
                sum(finite(row["giveback"]) >= 0.04 for row in rows) / len(rows) * 100.0 if rows else 0.0
            ),
            "averagePostExit1BarPct": statistics.fmean(finite(row["postExit1Bars"]) for row in rows) * 100.0 if rows else 0.0,
            "averagePostExit3BarsPct": statistics.fmean(finite(row["postExit3Bars"]) for row in rows) * 100.0 if rows else 0.0,
            "averagePostExit6BarsPct": statistics.fmean(finite(row["postExit6Bars"]) for row in rows) * 100.0 if rows else 0.0,
        }

    return {
        "all": summarize(episodes),
        "bySymbol": {
            symbol: summarize([row for row in episodes if row["symbol"] == symbol])
            for symbol in SYMBOLS
        },
        "largestGivebacks": sorted(
            [{
                "symbol": row["symbol"],
                "entryTs": times[int(row["entryPosition"])],
                "exitTs": times[min(int(row["exitPosition"]), len(times) - 1)],
                "mfePct": finite(row["peak"]) * 100.0,
                "exitReturnPct": finite(row["cumulative"]) * 100.0,
                "givebackPct": finite(row["giveback"]) * 100.0,
            } for row in episodes],
            key=lambda row: row["givebackPct"],
            reverse=True,
        )[:20],
    }


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
    raw = v95.v89.build_raw()
    times = list(raw["times"])
    targets, target_diag = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    base_rows = core.core_rows(config, times, base_core, features)
    severe_rows = core.core_rows(config, times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)
    normal_controlled, normal_diag = v95.v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe_controlled, severe_diag = v95.v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)

    periods = {
        "development2023_2024": (times[0], DEV_END),
        "validation2025": (DEV_END, VALIDATION_END),
        "diagnostic2026H1": (VALIDATION_END, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }

    evaluations = {}
    leave_one_out = {}
    baseline_metrics = None
    for candidate in CANDIDATES:
        normal_rows = simulate(
            candidate, raw, targets, times, base_core, features, normal_controlled, 10.0, 0.0, 0
        )
        severe_rows_candidate = simulate(
            candidate, raw, targets, times, severe_core, features, severe_controlled, 50.0, 3.0, 1
        )
        period_result = {
            period: {
                "normal": metrics(normal_rows, start, end),
                "severe": metrics(severe_rows_candidate, start, end),
            }
            for period, (start, end) in periods.items()
        }
        evaluations[candidate.name] = {
            "config": asdict(candidate),
            "periods": period_result,
        }
        if candidate.name == "BASELINE":
            baseline_metrics = period_result

        leave_one_out[candidate.name] = {}
        for symbol in SYMBOLS:
            normal_ex = simulate(
                candidate, raw, targets, times, base_core, features, normal_controlled, 10.0, 0.0, 0, symbol
            )
            severe_ex = simulate(
                candidate, raw, targets, times, severe_core, features, severe_controlled, 50.0, 3.0, 1, symbol
            )
            leave_one_out[candidate.name][symbol] = {
                "normal": metrics(normal_ex, periods["full"][0], periods["full"][1]),
                "severe": metrics(severe_ex, periods["full"][0], periods["full"][1]),
            }

    assert baseline_metrics is not None
    baseline_leave = leave_one_out["BASELINE"]
    screen = []
    for candidate in CANDIDATES:
        if candidate.name == "BASELINE":
            continue
        item = evaluations[candidate.name]["periods"]
        full = item["full"]
        validation = item["validation2025"]
        diagnostic = item["diagnostic2026H1"]
        base_full = baseline_metrics["full"]
        base_validation = baseline_metrics["validation2025"]
        base_diagnostic = baseline_metrics["diagnostic2026H1"]
        loo_improvements = 0
        for symbol in SYMBOLS:
            current = leave_one_out[candidate.name][symbol]
            baseline = baseline_leave[symbol]
            if (
                current["normal"]["compoundedReturnPct"] >= baseline["normal"]["compoundedReturnPct"]
                and current["severe"]["compoundedReturnPct"] >= baseline["severe"]["compoundedReturnPct"]
            ):
                loo_improvements += 1
        passed = bool(
            full["normal"]["compoundedReturnPct"] > base_full["normal"]["compoundedReturnPct"]
            and full["severe"]["compoundedReturnPct"] > base_full["severe"]["compoundedReturnPct"]
            and validation["normal"]["compoundedReturnPct"] >= base_validation["normal"]["compoundedReturnPct"]
            and diagnostic["normal"]["compoundedReturnPct"] >= base_diagnostic["normal"]["compoundedReturnPct"]
            and full["normal"]["maxDrawdownPct"] >= base_full["normal"]["maxDrawdownPct"] - 2.0
            and loo_improvements >= 3
        )
        screen.append({
            "candidate": candidate.name,
            "family": candidate.family,
            "screenPass": passed,
            "leaveOneOutImprovements": loo_improvements,
            "fullNormalDeltaPctPoints": (
                full["normal"]["compoundedReturnPct"] - base_full["normal"]["compoundedReturnPct"]
            ),
            "fullSevereDeltaPctPoints": (
                full["severe"]["compoundedReturnPct"] - base_full["severe"]["compoundedReturnPct"]
            ),
            "validationNormalDeltaPctPoints": (
                validation["normal"]["compoundedReturnPct"] - base_validation["normal"]["compoundedReturnPct"]
            ),
            "diagnostic2026H1NormalDeltaPctPoints": (
                diagnostic["normal"]["compoundedReturnPct"] - base_diagnostic["normal"]["compoundedReturnPct"]
            ),
            "fullNormalDrawdownDeltaPctPoints": (
                full["normal"]["maxDrawdownPct"] - base_full["normal"]["maxDrawdownPct"]
            ),
        })
    screen.sort(key=lambda item: (
        item["screenPass"],
        item["fullSevereDeltaPctPoints"],
        item["fullNormalDeltaPctPoints"],
    ), reverse=True)

    family_counts: Dict[str, dict] = {}
    for candidate in CANDIDATES:
        if candidate.name == "BASELINE":
            continue
        family = candidate.family
        row = next(item for item in screen if item["candidate"] == candidate.name)
        item = family_counts.setdefault(family, {"tested": 0, "passed": 0, "candidates": []})
        item["tested"] += 1
        item["passed"] += int(bool(row["screenPass"]))
        item["candidates"].append(candidate.name)

    opportunity = opportunity_audit(raw, targets, times, base_core, features, normal_controlled)
    result = rounded({
        "strategyId": "V96_CORE_PROFIT_CAPTURE_MODULE_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "controllerStateFrozenToBaseline": True,
            "candidateFamiliesPredeclared": [candidate.name for candidate in CANDIDATES],
            "periods": periods,
            "promotionAllowed": False,
        },
        "baseline": baseline_metrics,
        "opportunityAudit": opportunity,
        "screen": screen,
        "familySummary": family_counts,
        "evaluations": evaluations,
        "leaveOneSymbolOut": leave_one_out,
        "diagnostics": {
            "target": target_diag,
            "normalController": normal_diag,
            "severeController": severe_diag,
        },
        "limitations": [
            "The module overlay does not feed modified returns back into the V95 drawdown controller.",
            "The 2025 and 2026H1 periods are reused historical evidence, not pristine forward evidence.",
            "Intrabar take-profit and trailing execution cannot be proven from 12-hour OHLC buckets.",
            "No candidate may be promoted without exact stateful replay, neighboring-rule stability and forward shadow evidence.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-core-profit-capture-screen.json"
    md_path = state_dir / "v96-core-profit-capture-screen.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    report = [
        "# V96 Core Profit Capture Module Screen",
        "",
        "- Production changed: **NO**",
        "- Parameter combination search: **NO**",
        "- Controller feedback: frozen to baseline for this first-stage screen",
        "",
        "## Opportunity audit",
        "",
        f"- Episodes: {result['opportunityAudit']['all']['episodes']}",
        f"- First bar positive: {result['opportunityAudit']['all']['firstBarPositivePct']}%",
        f"- Average MFE: {result['opportunityAudit']['all']['averageMfePct']}%",
        f"- Average exit return: {result['opportunityAudit']['all']['averageExitReturnPct']}%",
        f"- Average giveback: {result['opportunityAudit']['all']['averageGivebackPct']}%",
        f"- Giveback >= 4% share: {result['opportunityAudit']['all']['givebackAtLeast4PctShare']}%",
        f"- Average post-exit 1/3/6 bars: {result['opportunityAudit']['all']['averagePostExit1BarPct']}% / "
        f"{result['opportunityAudit']['all']['averagePostExit3BarsPct']}% / "
        f"{result['opportunityAudit']['all']['averagePostExit6BarsPct']}%",
        "",
        "## Candidate screen",
        "",
        "| Candidate | Family | Pass | Full normal delta | Full severe delta | 2025 delta | 2026H1 delta | LOO wins |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["screen"]:
        report.append(
            f"| {item['candidate']} | {item['family']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['diagnostic2026H1NormalDeltaPctPoints']} | "
            f"{item['leaveOneOutImprovements']}/4 |"
        )
    report.extend([
        "",
        "## Decision",
        "",
        "This is a screening result only. A passing isolated module must be rerun with controller-state feedback, "
        "neighboring rules, exact turnover accounting, best-episode removal and forward shadow evidence.",
    ])
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
