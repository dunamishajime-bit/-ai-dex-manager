from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v96_core_profit_capture_screen as r1

core = v95.core
SYMBOLS = r1.SYMBOLS
BAR = r1.BAR
DEV_END = r1.DEV_END
VALIDATION_END = r1.VALIDATION_END
DD = v95.v86.BALANCED_DD
GUARD = v95.v86.BALANCED_GUARD


@dataclass(frozen=True)
class ExactPyramidConfig:
    name: str
    family: str
    trigger_pct: Optional[float] = None
    add: float = 0.0


CANDIDATES = (
    ExactPyramidConfig("BASELINE", "BASELINE"),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID2P5_T4", "PYRAMID2P5", 4.0, 0.025),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID2P5_T6", "PYRAMID2P5", 6.0, 0.025),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID2P5_T8", "PYRAMID2P5", 8.0, 0.025),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID5_T4", "PYRAMID5", 4.0, 0.05),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID5_T6", "PYRAMID5", 6.0, 0.05),
    ExactPyramidConfig("EXACT_BOOST_PYRAMID5_T8", "PYRAMID5", 8.0, 0.05),
)


def state_template() -> dict:
    return {
        "side": 0,
        "cumulative": 0.0,
        "lastSignedReturn": 0.0,
        "pyramided": False,
        "eventId": None,
    }


def per_symbol_reconstructed(
    weights: Dict[str, float],
    previous: Dict[str, float],
    raw: dict,
    ts: int,
    cost_bps: float,
    adverse_bps: float,
) -> Dict[str, float]:
    result = {}
    for symbol in set(weights) | set(previous):
        weight = r1.finite(weights.get(symbol))
        old = r1.finite(previous.get(symbol))
        result[symbol] = (
            weight * r1.price_return(raw, symbol, ts)
            - weight * r1.funding_rate(raw, symbol, ts)
            - abs(weight - old) * cost_bps / 10_000.0
            - abs(weight) * adverse_bps / 10_000.0
        )
    return result


def controller_step(
    row: dict,
    item: dict,
    equity: float,
    peak: float,
    reference_returns: List[float],
    turnover_history: List[float],
    regime_history: List[int],
    signal_count: int,
    calm_count: int,
    whipsaw_active: bool,
) -> dict:
    portfolio_dd = equity / peak - 1.0
    recent_core = (
        v95.v86.v83.compounded(reference_returns[-DD.core_window_buckets:])
        if reference_returns else 0.0
    )
    if (
        portfolio_dd <= -(DD.core_start_dd + v95.v86.v83.SECOND_GAP)
        and recent_core <= DD.core_trigger_return
    ):
        dd_stage = 2
        dd_scale = DD.core_scale_2
    elif portfolio_dd <= -DD.core_start_dd and recent_core <= DD.core_trigger_return:
        dd_stage = 1
        dd_scale = DD.core_scale_1
    else:
        dd_stage = 0
        dd_scale = 1.0

    recent_turnover = sum(turnover_history[-GUARD.window_buckets:])
    recent_flips = v95.v86.count_flips(regime_history[-GUARD.window_buckets:])
    whipsaw_signal = (
        recent_turnover >= GUARD.turnover_threshold
        or recent_flips >= GUARD.flip_threshold
    )
    if whipsaw_signal:
        signal_count += 1
        calm_count = 0
    else:
        calm_count += 1
        signal_count = 0
    if not whipsaw_active and signal_count >= GUARD.confirmation_buckets:
        whipsaw_active = True
    elif whipsaw_active and calm_count >= GUARD.recovery_buckets:
        whipsaw_active = False

    boost = 0.0
    if (
        dd_stage == 0
        and not whipsaw_active
        and portfolio_dd > -0.05
        and v95.v86.strong_signal(v95.STRONG_CONFIG, item)
    ):
        boost = v95.STRONG_CONFIG.boost
    scale = dd_scale * (GUARD.core_scale if whipsaw_active else 1.0) * (1.0 + boost)
    raw_gross = r1.finite(row.get("gross")) * scale
    cap_ratio = min(1.0, 2.0 / raw_gross) if raw_gross > 0 else 1.0
    scale *= cap_ratio
    return {
        "scale": scale,
        "boost": boost,
        "ddStage": dd_stage,
        "whipsaw": whipsaw_active,
        "signalCount": signal_count,
        "calmCount": calm_count,
        "portfolioDrawdown": portfolio_dd,
    }


def simulate_exact(
    config: ExactPyramidConfig,
    raw: dict,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    base_rows: List[dict],
    context: Dict[int, dict],
    cost_bps: float,
    adverse_bps: float,
    delay_bars: int,
) -> dict:
    rows_by_ts = {int(row["ts"]): row for row in base_rows}
    states = {symbol: state_template() for symbol in SYMBOLS}
    previous_standard: Dict[str, float] = {}
    previous_candidate: Dict[str, float] = {}
    equity = peak = 1.0
    reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False
    rows = []
    events: Dict[str, dict] = {}
    next_event = 0
    controller_counts = {"boost": 0, "dd1": 0, "dd2": 0, "whipsaw": 0}

    for position, ts in enumerate(times):
        row = rows_by_ts.get(ts, {"return": 0.0, "gross": 0.0})
        item = context.get(ts, {"turnover": 0.0, "regime": 0, "breadth": 0, "feature": {}})
        controller = controller_step(
            row, item, equity, peak, reference_returns, turnover_history, regime_history,
            signal_count, calm_count, whipsaw_active,
        )
        signal_count = int(controller["signalCount"])
        calm_count = int(controller["calmCount"])
        whipsaw_active = bool(controller["whipsaw"])
        controller_counts["boost"] += int(r1.finite(controller["boost"]) > 0)
        controller_counts["dd1"] += int(int(controller["ddStage"]) == 1)
        controller_counts["dd2"] += int(int(controller["ddStage"]) == 2)
        controller_counts["whipsaw"] += int(whipsaw_active)

        target = r1.source_target(targets, times, position, delay_bars)
        item_core = base_core.get(ts, {"exposure": 0.0, "regime": 0})
        base_scale = r1.v35_scale(item_core, features.get(ts, {}))
        standard = r1.cap_weights({
            symbol: r1.finite(weight) * base_scale * r1.finite(controller["scale"])
            for symbol, weight in target.items()
        })
        candidate = dict(standard)

        for symbol in SYMBOLS:
            state = states[symbol]
            weight = r1.finite(standard.get(symbol))
            side = 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0
            if side != int(state["side"]):
                state.clear()
                state.update(state_template())
                state["side"] = side
            if side == 0:
                continue
            if (
                config.trigger_pct is not None
                and not bool(state["pyramided"])
                and r1.finite(controller["boost"]) > 0
                and not bool(controller["whipsaw"])
                and int(controller["ddStage"]) == 0
                and r1.finite(state["cumulative"]) * 100.0 >= config.trigger_pct
                and r1.finite(state["lastSignedReturn"]) > 0
            ):
                state["pyramided"] = True
                next_event += 1
                event_id = f"{symbol}-{next_event}"
                state["eventId"] = event_id
                events[event_id] = {
                    "id": event_id,
                    "symbol": symbol,
                    "startTs": ts,
                    "year": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year,
                    "directDelta": 0.0,
                    "bars": 0,
                }
            if bool(state["pyramided"]):
                candidate[symbol] = weight * (1.0 + config.add)
        candidate = r1.cap_weights(candidate)

        standard_symbol = per_symbol_reconstructed(
            standard, previous_standard, raw, ts, cost_bps, adverse_bps
        )
        candidate_symbol = per_symbol_reconstructed(
            candidate, previous_candidate, raw, ts, cost_bps, adverse_bps
        )
        standard_recon = sum(standard_symbol.values())
        candidate_recon = sum(candidate_symbol.values())
        exact_standard = r1.finite(row.get("return")) * r1.finite(controller["scale"])
        value = exact_standard + candidate_recon - standard_recon

        for symbol in SYMBOLS:
            event_id = states[symbol].get("eventId")
            if event_id and event_id in events:
                events[event_id]["directDelta"] += (
                    r1.finite(candidate_symbol.get(symbol)) - r1.finite(standard_symbol.get(symbol))
                )
                events[event_id]["bars"] += 1

        rows.append({
            "ts": ts,
            "return": value,
            "gross": sum(abs(weight) for weight in candidate.values()),
            "boost": r1.finite(controller["boost"]) > 0,
            "ddStage": int(controller["ddStage"]),
            "whipsaw": bool(controller["whipsaw"]),
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        reference_returns.append(r1.finite(row.get("return")))
        turnover_history.append(r1.finite(item.get("turnover")))
        regime_history.append(int(item.get("regime", 0)))
        previous_standard = dict(standard)
        previous_candidate = dict(candidate)

        for symbol in SYMBOLS:
            state = states[symbol]
            weight = r1.finite(standard.get(symbol))
            side = 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0
            if side == 0:
                continue
            signed = side * r1.price_return(raw, symbol, ts)
            state["lastSignedReturn"] = signed
            state["cumulative"] = (1.0 + r1.finite(state["cumulative"])) * (1.0 + signed) - 1.0

    event_rows = list(events.values())
    positive = sum(max(r1.finite(event["directDelta"]), 0.0) for event in event_rows)
    top_share = (
        max((max(r1.finite(event["directDelta"]), 0.0) for event in event_rows), default=0.0) / positive
        if positive > 0 else 0.0
    )
    return {
        "rows": rows,
        "events": event_rows,
        "eventSummary": {
            "count": len(event_rows),
            "years": sorted(set(int(event["year"]) for event in event_rows)),
            "symbols": sorted(set(str(event["symbol"]) for event in event_rows)),
            "positiveDirectDeltaPct": positive * 100.0,
            "topPositiveEventShare": top_share,
        },
        "controllerCounts": controller_counts,
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    times = list(raw["times"])
    targets, target_diag = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, raw["bars"], raw["indexes"], raw["funding"])
    base_rows = core.core_rows(core.CoreConfig(), times, base_core, features)
    severe_rows = core.core_rows(core.CoreConfig(), times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)
    periods = {
        "development2023_2024": (times[0], DEV_END),
        "validation2025": (DEV_END, VALIDATION_END),
        "diagnostic2026H1": (VALIDATION_END, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }

    simulations = {}
    evaluations = {}
    for candidate in CANDIDATES:
        normal = simulate_exact(
            candidate, raw, targets, times, base_core, features, base_rows, context, 10.0, 0.0, 0
        )
        severe = simulate_exact(
            candidate, raw, targets, times, severe_core, features, severe_rows, context, 50.0, 3.0, 1
        )
        simulations[candidate.name] = {"normal": normal, "severe": severe}
        evaluations[candidate.name] = {
            "config": asdict(candidate),
            "periods": {
                period: {
                    "normal": r1.metrics(normal["rows"], start, end),
                    "severe": r1.metrics(severe["rows"], start, end),
                }
                for period, (start, end) in periods.items()
            },
            "normalEventSummary": normal["eventSummary"],
            "severeEventSummary": severe["eventSummary"],
            "normalControllerCounts": normal["controllerCounts"],
            "severeControllerCounts": severe["controllerCounts"],
        }

    baseline = evaluations["BASELINE"]["periods"]
    baseline_sim = simulations["BASELINE"]
    original_normal, _ = v95.v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    original_severe, _ = v95.v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    max_normal_diff = max(
        abs(r1.finite(left["return"]) - r1.finite(right["return"]))
        for left, right in zip(baseline_sim["normal"]["rows"], original_normal)
    )
    max_severe_diff = max(
        abs(r1.finite(left["return"]) - r1.finite(right["return"]))
        for left, right in zip(baseline_sim["severe"]["rows"], original_severe)
    )

    screen = []
    for candidate in CANDIDATES:
        if candidate.name == "BASELINE":
            continue
        item = evaluations[candidate.name]
        result = item["periods"]
        full = result["full"]
        validation = result["validation2025"]
        diagnostic = result["diagnostic2026H1"]
        event = item["normalEventSummary"]
        passed = bool(
            full["normal"]["compoundedReturnPct"] > baseline["full"]["normal"]["compoundedReturnPct"]
            and full["severe"]["compoundedReturnPct"] > baseline["full"]["severe"]["compoundedReturnPct"]
            and validation["normal"]["compoundedReturnPct"] >= baseline["validation2025"]["normal"]["compoundedReturnPct"]
            and validation["severe"]["compoundedReturnPct"] >= baseline["validation2025"]["severe"]["compoundedReturnPct"]
            and diagnostic["normal"]["compoundedReturnPct"] >= baseline["diagnostic2026H1"]["normal"]["compoundedReturnPct"]
            and diagnostic["severe"]["compoundedReturnPct"] >= baseline["diagnostic2026H1"]["severe"]["compoundedReturnPct"]
            and full["normal"]["maxDrawdownPct"] >= baseline["full"]["normal"]["maxDrawdownPct"] - 2.0
            and int(event["count"]) >= 5
            and len(event["years"]) >= 2
            and r1.finite(event["topPositiveEventShare"]) <= 0.50
        )
        screen.append({
            "candidate": candidate.name,
            "family": candidate.family,
            "screenPass": passed,
            "fullNormalDeltaPctPoints": (
                full["normal"]["compoundedReturnPct"] - baseline["full"]["normal"]["compoundedReturnPct"]
            ),
            "fullSevereDeltaPctPoints": (
                full["severe"]["compoundedReturnPct"] - baseline["full"]["severe"]["compoundedReturnPct"]
            ),
            "validationNormalDeltaPctPoints": (
                validation["normal"]["compoundedReturnPct"] - baseline["validation2025"]["normal"]["compoundedReturnPct"]
            ),
            "validationSevereDeltaPctPoints": (
                validation["severe"]["compoundedReturnPct"] - baseline["validation2025"]["severe"]["compoundedReturnPct"]
            ),
            "diagnosticNormalDeltaPctPoints": (
                diagnostic["normal"]["compoundedReturnPct"] - baseline["diagnostic2026H1"]["normal"]["compoundedReturnPct"]
            ),
            "diagnosticSevereDeltaPctPoints": (
                diagnostic["severe"]["compoundedReturnPct"] - baseline["diagnostic2026H1"]["severe"]["compoundedReturnPct"]
            ),
            "drawdownDeltaPctPoints": (
                full["normal"]["maxDrawdownPct"] - baseline["full"]["normal"]["maxDrawdownPct"]
            ),
            "eventCount": event["count"],
            "eventYears": event["years"],
            "eventSymbols": event["symbols"],
            "topPositiveEventShare": event["topPositiveEventShare"],
        })
    family_passes: Dict[str, int] = {}
    for row in screen:
        family_passes[row["family"]] = family_passes.get(row["family"], 0) + int(bool(row["screenPass"]))
    for row in screen:
        row["neighborFamilyPass"] = bool(row["screenPass"] and family_passes.get(row["family"], 0) >= 2)
    screen.sort(key=lambda row: (
        row["neighborFamilyPass"],
        row["screenPass"],
        row["fullSevereDeltaPctPoints"],
        row["fullNormalDeltaPctPoints"],
    ), reverse=True)

    result = r1.rounded({
        "strategyId": "V96_CORE_EXACT_BOOST_PYRAMID_REPLAY",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "controllerFeedbackExact": True,
            "promotionAllowed": False,
        },
        "baselineParity": {
            "maximumNormalBarDifference": max_normal_diff,
            "maximumSevereBarDifference": max_severe_diff,
        },
        "baseline": baseline,
        "screen": screen,
        "evaluations": evaluations,
        "diagnostics": {"target": target_diag},
        "limitations": [
            "2025 and 2026H1 remain reused historical evidence.",
            "A historical exact replay cannot replace forward shadow evidence.",
            "No candidate changes Production in this PR.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-core-exact-boost-pyramid.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Core Exact Boost-Pyramid Replay",
        "",
        f"- Baseline max normal bar difference: {result['baselineParity']['maximumNormalBarDifference']}",
        f"- Baseline max severe bar difference: {result['baselineParity']['maximumSevereBarDifference']}",
        "- Production changed: **NO**",
        "",
        "| Candidate | Screen | Neighbor | Full N | Full S | 2025 N | 2025 S | 2026 N | 2026 S | Events | Top share |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["screen"]:
        report.append(
            f"| {item['candidate']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['neighborFamilyPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['eventCount']} | {item['topPositiveEventShare']} |"
        )
    report.append("")
    report.append("Historical exact replay is research evidence only; Forward Shadow remains required.")
    (state_dir / "v96-core-exact-boost-pyramid.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
