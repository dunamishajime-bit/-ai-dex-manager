from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v96_basis_alpha_screen as basis
import research_lab_v96_core_exact_boost_pyramid as exact

v95 = exact.v95
r1 = exact.r1
core = exact.core
BAR = r1.BAR
DEV_END = r1.DEV_END
VALIDATION_END = r1.VALIDATION_END
SYMBOLS = r1.SYMBOLS


@dataclass(frozen=True)
class GuardConfig:
    name: str
    family: str
    trigger_pct: float = 6.0
    add: float = 0.025
    max_funding_bps: Optional[float] = None
    funding_lookback: int = 1
    max_premium_z: Optional[float] = None
    premium_window: int = 60


CANDIDATES = (
    GuardConfig("BASELINE", "BASELINE", add=0.0),
    GuardConfig("BOOST2P5_T6_UNGUARDED", "UNGUARDED"),
    GuardConfig("BOOST2P5_T6_FUND1_L1", "FUND_GUARD", max_funding_bps=1.0, funding_lookback=1),
    GuardConfig("BOOST2P5_T6_FUND2_L1", "FUND_GUARD", max_funding_bps=2.0, funding_lookback=1),
    GuardConfig("BOOST2P5_T6_FUND4_L1", "FUND_GUARD", max_funding_bps=4.0, funding_lookback=1),
    GuardConfig("BOOST2P5_T6_FUND1_L2", "FUND_GUARD", max_funding_bps=1.0, funding_lookback=2),
    GuardConfig("BOOST2P5_T6_FUND2_L2", "FUND_GUARD", max_funding_bps=2.0, funding_lookback=2),
    GuardConfig("BOOST2P5_T6_FUND4_L2", "FUND_GUARD", max_funding_bps=4.0, funding_lookback=2),
    GuardConfig("BOOST2P5_T6_PREM_Z1", "PREMIUM_GUARD", max_premium_z=1.0),
    GuardConfig("BOOST2P5_T6_PREM_Z1P5", "PREMIUM_GUARD", max_premium_z=1.5),
    GuardConfig("BOOST2P5_T6_PREM_Z2", "PREMIUM_GUARD", max_premium_z=2.0),
    GuardConfig("BOOST2P5_T6_F2_PREM_Z1", "COMBINED_GUARD", max_funding_bps=2.0, max_premium_z=1.0),
    GuardConfig("BOOST2P5_T6_F2_PREM_Z1P5", "COMBINED_GUARD", max_funding_bps=2.0, max_premium_z=1.5),
    GuardConfig("BOOST2P5_T6_F2_PREM_Z2", "COMBINED_GUARD", max_funding_bps=2.0, max_premium_z=2.0),
)


def rolling_funding_bps(raw: dict, symbol: str, times: List[int], position: int, lookback: int) -> Optional[float]:
    if position - lookback + 1 < 0:
        return None
    return sum(
        r1.funding_rate(raw, symbol, times[index])
        for index in range(position - lookback + 1, position + 1)
    ) * 10_000.0


def guard_state(
    config: GuardConfig,
    raw: dict,
    premiums: Dict[str, Dict[int, float]],
    times: List[int],
    position: int,
    symbol: str,
) -> dict:
    funding_bps = rolling_funding_bps(raw, symbol, times, position, config.funding_lookback)
    premium_z = basis.premium_z(premiums, symbol, times, position, config.premium_window)
    funding_ok = config.max_funding_bps is None or (
        funding_bps is not None and funding_bps <= config.max_funding_bps
    )
    premium_ok = config.max_premium_z is None or (
        premium_z is not None and premium_z <= config.max_premium_z
    )
    return {
        "eligible": bool(funding_ok and premium_ok),
        "fundingBps": funding_bps,
        "premiumZ": premium_z,
        "fundingOk": funding_ok,
        "premiumOk": premium_ok,
    }


def simulate(
    config: GuardConfig,
    raw: dict,
    premiums: Dict[str, Dict[int, float]],
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
    states = {symbol: exact.state_template() for symbol in SYMBOLS}
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
    guard_rejections = 0

    for position, ts in enumerate(times):
        row = rows_by_ts.get(ts, {"return": 0.0, "gross": 0.0})
        item = context.get(ts, {"turnover": 0.0, "regime": 0, "breadth": 0, "feature": {}})
        controller = exact.controller_step(
            row, item, equity, peak, reference_returns, turnover_history, regime_history,
            signal_count, calm_count, whipsaw_active,
        )
        signal_count = int(controller["signalCount"])
        calm_count = int(controller["calmCount"])
        whipsaw_active = bool(controller["whipsaw"])

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
                state.update(exact.state_template())
                state["side"] = side
            if side == 0:
                continue
            base_trigger = bool(
                config.add > 0
                and not bool(state["pyramided"])
                and r1.finite(controller["boost"]) > 0
                and not bool(controller["whipsaw"])
                and int(controller["ddStage"]) == 0
                and r1.finite(state["cumulative"]) * 100.0 >= config.trigger_pct
                and r1.finite(state["lastSignedReturn"]) > 0
            )
            if base_trigger:
                guard = guard_state(config, raw, premiums, times, position, symbol)
                if guard["eligible"]:
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
                        "fundingBps": guard["fundingBps"],
                        "premiumZ": guard["premiumZ"],
                    }
                else:
                    guard_rejections += 1
            if bool(state["pyramided"]):
                candidate[symbol] = weight * (1.0 + config.add)
        candidate = r1.cap_weights(candidate)

        standard_symbol = exact.per_symbol_reconstructed(
            standard, previous_standard, raw, ts, cost_bps, adverse_bps
        )
        candidate_symbol = exact.per_symbol_reconstructed(
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
            "guardRejections": guard_rejections,
        },
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    times = list(raw["times"])
    premiums, coverage = basis.build_premiums(times)
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

    evaluations = {}
    for config in CANDIDATES:
        normal = simulate(config, raw, premiums, targets, times, base_core, features, base_rows, context, 10.0, 0.0, 0)
        severe = simulate(config, raw, premiums, targets, times, severe_core, features, severe_rows, context, 50.0, 3.0, 1)
        evaluations[config.name] = {
            "config": asdict(config),
            "periods": {
                name: {
                    "normal": r1.metrics(normal["rows"], start, end),
                    "severe": r1.metrics(severe["rows"], start, end),
                }
                for name, (start, end) in periods.items()
            },
            "normalEventSummary": normal["eventSummary"],
            "severeEventSummary": severe["eventSummary"],
        }

    baseline = evaluations["BASELINE"]["periods"]
    screen = []
    for config in CANDIDATES:
        if config.name == "BASELINE":
            continue
        item = evaluations[config.name]
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
            and full["normal"]["maxDrawdownPct"] >= baseline["full"]["normal"]["maxDrawdownPct"] - 1.0
            and int(event["count"]) >= 5
            and len(event["years"]) >= 2
            and len(event["symbols"]) >= 2
            and r1.finite(event["topPositiveEventShare"]) <= 0.50
        )
        screen.append({
            "candidate": config.name,
            "family": config.family,
            "screenPass": passed,
            "fullNormalDeltaPctPoints": full["normal"]["compoundedReturnPct"] - baseline["full"]["normal"]["compoundedReturnPct"],
            "fullSevereDeltaPctPoints": full["severe"]["compoundedReturnPct"] - baseline["full"]["severe"]["compoundedReturnPct"],
            "validationNormalDeltaPctPoints": validation["normal"]["compoundedReturnPct"] - baseline["validation2025"]["normal"]["compoundedReturnPct"],
            "validationSevereDeltaPctPoints": validation["severe"]["compoundedReturnPct"] - baseline["validation2025"]["severe"]["compoundedReturnPct"],
            "diagnosticNormalDeltaPctPoints": diagnostic["normal"]["compoundedReturnPct"] - baseline["diagnostic2026H1"]["normal"]["compoundedReturnPct"],
            "diagnosticSevereDeltaPctPoints": diagnostic["severe"]["compoundedReturnPct"] - baseline["diagnostic2026H1"]["severe"]["compoundedReturnPct"],
            "drawdownDeltaPctPoints": full["normal"]["maxDrawdownPct"] - baseline["full"]["normal"]["maxDrawdownPct"],
            "eventCount": event["count"],
            "eventYears": event["years"],
            "eventSymbols": event["symbols"],
            "topPositiveEventShare": event["topPositiveEventShare"],
            "guardRejections": event["guardRejections"],
        })
    family_passes: Dict[str, int] = {}
    for row in screen:
        family_passes[row["family"]] = family_passes.get(row["family"], 0) + int(bool(row["screenPass"]))
    for row in screen:
        row["neighborFamilyPass"] = bool(row["screenPass"] and family_passes.get(row["family"], 0) >= 2)
    screen.sort(key=lambda row: (
        row["neighborFamilyPass"], row["screenPass"], row["fullSevereDeltaPctPoints"], row["fullNormalDeltaPctPoints"]
    ), reverse=True)

    result = r1.rounded({
        "strategyId": "V96_CROWDING_GUARDED_BOOST_PYRAMID_REPLAY",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "controllerFeedbackExact": True,
            "promotionAllowed": False,
        },
        "coverage": coverage,
        "baseline": baseline,
        "screen": screen,
        "evaluations": evaluations,
        "diagnostics": {"target": target_diag},
        "limitations": [
            "2025 and 2026H1 remain reused historical evidence.",
            "Crowding guards are exchange-specific and require Forward Shadow evidence.",
            "No candidate changes Production or submits orders.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-crowding-guarded-boost-replay.json"
    md_path = state_dir / "v96-crowding-guarded-boost-replay.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Crowding-Guarded Boost Pyramid Replay",
        "",
        f"- Screen passes: {sum(bool(row['screenPass']) for row in result['screen'])}",
        f"- Neighbor-family passes: {sum(bool(row['neighborFamilyPass']) for row in result['screen'])}",
        "- Production changed: **NO**",
        "",
        "| Candidate | Pass | Neighbor | Full N | Full S | 2025 N | 2025 S | 2026 N | 2026 S | DD | Events | Rejects |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["screen"]:
        report.append(
            f"| {item['candidate']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['neighborFamilyPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['drawdownDeltaPctPoints']} | {item['eventCount']} | {item['guardRejections']} |"
        )
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
