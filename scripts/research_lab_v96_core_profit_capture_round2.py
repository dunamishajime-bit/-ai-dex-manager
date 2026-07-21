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


@dataclass(frozen=True)
class Round2Config:
    name: str
    family: str
    weak_probe: str = "NONE"  # NONE, ONE_BAR, FIRST_BAR_CONFIRM
    lock_trigger_pct: Optional[float] = None
    lock_negative_bars: int = 2
    lock_reduction: float = 0.25
    pyramid_trigger_pct: Optional[float] = None
    pyramid_add: float = 0.0


CANDIDATES = (
    Round2Config("BASELINE", "BASELINE"),
    Round2Config("WEAK_PROBE50_1BAR", "WEAK_ENTRY", weak_probe="ONE_BAR"),
    Round2Config("WEAK_PROBE50_FIRSTBAR_CONFIRM", "WEAK_ENTRY", weak_probe="FIRST_BAR_CONFIRM"),
    Round2Config("LOCK25_T8_2NEG", "CONFIRMED_LOCK", lock_trigger_pct=8.0),
    Round2Config("LOCK25_T12_2NEG", "CONFIRMED_LOCK", lock_trigger_pct=12.0),
    Round2Config("LOCK25_T16_2NEG", "CONFIRMED_LOCK", lock_trigger_pct=16.0),
    Round2Config("PYRAMID5_T4", "PYRAMID5", pyramid_trigger_pct=4.0, pyramid_add=0.05),
    Round2Config("PYRAMID5_T6", "PYRAMID5", pyramid_trigger_pct=6.0, pyramid_add=0.05),
    Round2Config("PYRAMID5_T8", "PYRAMID5", pyramid_trigger_pct=8.0, pyramid_add=0.05),
    Round2Config("PYRAMID10_T4", "PYRAMID10", pyramid_trigger_pct=4.0, pyramid_add=0.10),
    Round2Config("PYRAMID10_T6", "PYRAMID10", pyramid_trigger_pct=6.0, pyramid_add=0.10),
    Round2Config("PYRAMID10_T8", "PYRAMID10", pyramid_trigger_pct=8.0, pyramid_add=0.10),
)


def state_template() -> dict:
    return {
        "side": 0,
        "age": 0,
        "firstSignedReturn": None,
        "lastSignedReturn": 0.0,
        "cumulative": 0.0,
        "peak": 0.0,
        "negativeStreak": 0,
        "weakEntry": False,
        "locked": False,
        "pyramided": False,
    }


def strong_entry(frame: dict, side: int) -> bool:
    if bool(frame.get("whipsaw")) or int(frame.get("ddStage", 0)) > 0:
        return False
    regime = int(frame.get("regime", 0))
    if side < 0:
        return regime < 0
    feature = frame.get("feature", {})
    return bool(
        regime > 0
        and bool(feature.get("closeAboveSma20", False))
        and r1.finite(feature.get("mom20")) >= 15.0
        and r1.finite(feature.get("mom3")) >= 0.0
        and r1.finite(feature.get("shock")) >= -4.0
        and r1.finite(feature.get("skew"), 1.0) <= 1.35
        and int(frame.get("breadth", 0)) >= 2
    )


def frame_at(
    ts: int,
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    context: Dict[int, dict],
    controlled_map: Dict[int, dict],
) -> dict:
    controller = controlled_map.get(ts, {})
    item = base_core.get(ts, {})
    ctx = context.get(ts, {})
    return {
        "regime": int(item.get("regime", 0)),
        "feature": features.get(ts, {}),
        "breadth": int(ctx.get("breadth", 0)),
        "whipsaw": bool(controller.get("whipsawActive", False)),
        "ddStage": int(controller.get("ddStage", 0)),
        "boost": r1.finite(controller.get("boost")) > 0,
    }


def candidate_weights(
    config: Round2Config,
    baseline: Dict[str, float],
    states: Dict[str, dict],
    frame: dict,
) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for symbol in SYMBOLS:
        state = states[symbol]
        base_weight = r1.finite(baseline.get(symbol))
        side = 1 if base_weight > 1e-12 else -1 if base_weight < -1e-12 else 0
        if side != int(state["side"]):
            state.clear()
            state.update(state_template())
            state["side"] = side
            state["weakEntry"] = bool(side and not strong_entry(frame, side))

        if side == 0:
            continue

        multiplier = 1.0
        if bool(state["weakEntry"]):
            if config.weak_probe == "ONE_BAR" and int(state["age"]) == 0:
                multiplier *= 0.50
            elif config.weak_probe == "FIRST_BAR_CONFIRM":
                if int(state["age"]) == 0 or r1.finite(state["firstSignedReturn"], -1.0) <= 0:
                    multiplier *= 0.50

        if config.lock_trigger_pct is not None:
            if (
                r1.finite(state["peak"]) * 100.0 >= config.lock_trigger_pct
                and int(state["negativeStreak"]) >= config.lock_negative_bars
            ):
                state["locked"] = True
        if bool(state["locked"]):
            multiplier *= 1.0 - config.lock_reduction

        if config.pyramid_trigger_pct is not None and not bool(state["pyramided"]):
            calm = not bool(frame.get("whipsaw")) and int(frame.get("ddStage", 0)) == 0
            if (
                calm
                and r1.finite(state["cumulative"]) * 100.0 >= config.pyramid_trigger_pct
                and r1.finite(state["lastSignedReturn"]) > 0
            ):
                state["pyramided"] = True
        if bool(state["pyramided"]):
            multiplier *= 1.0 + config.pyramid_add

        result[symbol] = base_weight * multiplier
    return r1.cap_weights(result)


def update_states(states: Dict[str, dict], baseline: Dict[str, float], raw: dict, ts: int) -> None:
    for symbol in SYMBOLS:
        state = states[symbol]
        base_weight = r1.finite(baseline.get(symbol))
        side = 1 if base_weight > 1e-12 else -1 if base_weight < -1e-12 else 0
        if side == 0:
            continue
        signed = side * r1.price_return(raw, symbol, ts)
        if int(state["age"]) == 0:
            state["firstSignedReturn"] = signed
        state["lastSignedReturn"] = signed
        state["negativeStreak"] = int(state["negativeStreak"]) + 1 if signed < 0 else 0
        state["cumulative"] = (1.0 + r1.finite(state["cumulative"])) * (1.0 + signed) - 1.0
        state["peak"] = max(r1.finite(state["peak"]), r1.finite(state["cumulative"]))
        state["age"] = int(state["age"]) + 1


def simulate(
    config: Round2Config,
    raw: dict,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    base_core: Dict[int, dict],
    features: Dict[int, dict],
    context: Dict[int, dict],
    controlled_rows: List[dict],
    cost_bps: float,
    adverse_bps: float,
    delay_bars: int,
    excluded_symbol: Optional[str] = None,
) -> List[dict]:
    controlled_map = {int(row["ts"]): row for row in controlled_rows}
    states = {symbol: state_template() for symbol in SYMBOLS}
    previous_baseline: Dict[str, float] = {}
    previous_candidate: Dict[str, float] = {}
    rows: List[dict] = []

    for position, ts in enumerate(times):
        baseline = r1.baseline_weights(
            targets, times, position, base_core, features, controlled_map, delay_bars
        )
        frame = frame_at(ts, base_core, features, context, controlled_map)
        candidate = candidate_weights(config, baseline, states, frame)
        if excluded_symbol:
            baseline.pop(excluded_symbol, None)
            candidate.pop(excluded_symbol, None)

        baseline_recon = r1.reconstructed_return(
            baseline, previous_baseline, raw, ts, cost_bps, adverse_bps, excluded_symbol
        )
        candidate_recon = r1.reconstructed_return(
            candidate, previous_candidate, raw, ts, cost_bps, adverse_bps, excluded_symbol
        )
        exact = r1.finite(controlled_map.get(ts, {}).get("return"))
        value = candidate_recon if excluded_symbol else exact + candidate_recon - baseline_recon
        rows.append({
            "ts": ts,
            "return": value,
            "gross": sum(abs(weight) for weight in candidate.values()),
        })
        update_states(states, baseline, raw, ts)
        previous_baseline = dict(baseline)
        previous_candidate = dict(candidate)
    return rows


def rounded(value):
    return r1.rounded(value)


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
    normal_context = v95.v89.context_for(targets, raw, base_core, features)
    normal_controlled, normal_diag = v95.v86.controlled_core(base_rows, normal_context, v95.STRONG_CONFIG)
    severe_controlled, severe_diag = v95.v86.controlled_core(severe_rows, normal_context, v95.STRONG_CONFIG)

    periods = {
        "development2023_2024": (times[0], DEV_END),
        "validation2025": (DEV_END, VALIDATION_END),
        "diagnostic2026H1": (VALIDATION_END, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }

    evaluations = {}
    leave_one_out = {}
    for candidate in CANDIDATES:
        normal = simulate(
            candidate, raw, targets, times, base_core, features, normal_context,
            normal_controlled, 10.0, 0.0, 0
        )
        severe = simulate(
            candidate, raw, targets, times, severe_core, features, normal_context,
            severe_controlled, 50.0, 3.0, 1
        )
        evaluations[candidate.name] = {
            "config": asdict(candidate),
            "periods": {
                period: {
                    "normal": r1.metrics(normal, start, end),
                    "severe": r1.metrics(severe, start, end),
                }
                for period, (start, end) in periods.items()
            },
        }
        leave_one_out[candidate.name] = {}
        for symbol in SYMBOLS:
            normal_ex = simulate(
                candidate, raw, targets, times, base_core, features, normal_context,
                normal_controlled, 10.0, 0.0, 0, symbol
            )
            severe_ex = simulate(
                candidate, raw, targets, times, severe_core, features, normal_context,
                severe_controlled, 50.0, 3.0, 1, symbol
            )
            leave_one_out[candidate.name][symbol] = {
                "normal": r1.metrics(normal_ex, periods["full"][0], periods["full"][1]),
                "severe": r1.metrics(severe_ex, periods["full"][0], periods["full"][1]),
            }

    baseline = evaluations["BASELINE"]["periods"]
    baseline_loo = leave_one_out["BASELINE"]
    screen = []
    for candidate in CANDIDATES:
        if candidate.name == "BASELINE":
            continue
        periods_result = evaluations[candidate.name]["periods"]
        full = periods_result["full"]
        validation = periods_result["validation2025"]
        diagnostic = periods_result["diagnostic2026H1"]
        loo_wins = 0
        for symbol in SYMBOLS:
            current = leave_one_out[candidate.name][symbol]
            reference = baseline_loo[symbol]
            if (
                current["normal"]["compoundedReturnPct"] >= reference["normal"]["compoundedReturnPct"]
                and current["severe"]["compoundedReturnPct"] >= reference["severe"]["compoundedReturnPct"]
            ):
                loo_wins += 1
        passed = bool(
            full["normal"]["compoundedReturnPct"] > baseline["full"]["normal"]["compoundedReturnPct"]
            and full["severe"]["compoundedReturnPct"] > baseline["full"]["severe"]["compoundedReturnPct"]
            and validation["normal"]["compoundedReturnPct"] >= baseline["validation2025"]["normal"]["compoundedReturnPct"]
            and validation["severe"]["compoundedReturnPct"] >= baseline["validation2025"]["severe"]["compoundedReturnPct"]
            and diagnostic["normal"]["compoundedReturnPct"] >= baseline["diagnostic2026H1"]["normal"]["compoundedReturnPct"]
            and full["normal"]["maxDrawdownPct"] >= baseline["full"]["normal"]["maxDrawdownPct"] - 2.0
            and loo_wins >= 3
        )
        screen.append({
            "candidate": candidate.name,
            "family": candidate.family,
            "screenPass": passed,
            "leaveOneOutImprovements": loo_wins,
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
            "diagnostic2026H1NormalDeltaPctPoints": (
                diagnostic["normal"]["compoundedReturnPct"] - baseline["diagnostic2026H1"]["normal"]["compoundedReturnPct"]
            ),
            "fullNormalDrawdownDeltaPctPoints": (
                full["normal"]["maxDrawdownPct"] - baseline["full"]["normal"]["maxDrawdownPct"]
            ),
        })
    screen.sort(key=lambda item: (
        item["screenPass"],
        item["fullSevereDeltaPctPoints"],
        item["fullNormalDeltaPctPoints"],
    ), reverse=True)

    family_summary: Dict[str, dict] = {}
    for candidate in CANDIDATES:
        if candidate.name == "BASELINE":
            continue
        row = next(item for item in screen if item["candidate"] == candidate.name)
        family = family_summary.setdefault(candidate.family, {"tested": 0, "passed": 0, "members": []})
        family["tested"] += 1
        family["passed"] += int(bool(row["screenPass"]))
        family["members"].append(candidate.name)

    result = rounded({
        "strategyId": "V96_CORE_PROFIT_CAPTURE_ROUND2",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "controllerFeedbackFrozen": True,
            "round1CandidatesCombined": False,
            "promotionAllowed": False,
        },
        "baseline": baseline,
        "screen": screen,
        "familySummary": family_summary,
        "evaluations": evaluations,
        "leaveOneSymbolOut": leave_one_out,
        "diagnostics": {
            "target": target_diag,
            "normalController": normal_diag,
            "severeController": severe_diag,
        },
        "limitations": [
            "Round 2 remains a frozen-controller screening overlay.",
            "2025 and 2026H1 are reused historical diagnostics.",
            "Any passing family requires exact controller feedback, neighboring thresholds and best-episode removal.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-core-profit-capture-round2.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Core Profit Capture Round 2",
        "",
        "- Production changed: **NO**",
        "- Round-1 modules combined: **NO**",
        "- Candidate types: weak-entry probe, confirmed profit lock, guarded pyramiding",
        "",
        "| Candidate | Family | Pass | Full normal delta | Full severe delta | 2025 normal | 2025 severe | 2026H1 | LOO |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["screen"]:
        report.append(
            f"| {item['candidate']} | {item['family']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnostic2026H1NormalDeltaPctPoints']} | {item['leaveOneOutImprovements']}/4 |"
        )
    report.extend([
        "",
        "A screen pass is not Production approval. Exact state feedback and forward shadow evidence remain mandatory.",
    ])
    (state_dir / "v96-core-profit-capture-round2.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
