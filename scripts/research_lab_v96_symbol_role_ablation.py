from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_strong_reserved_pengu_v96 as v96
import research_lab_v96_core_exact_boost_pyramid as exact
import research_lab_v96_crowding_guarded_boost_replay as crowd

v95 = exact.v95
r1 = exact.r1
core = exact.core
SYMBOLS = exact.SYMBOLS
BAR = r1.BAR
DAY = v96.DAY
HOUR = v96.HOUR
DEV_END = r1.DEV_END
VALIDATION_END = r1.VALIDATION_END


@dataclass(frozen=True)
class RoleConfig:
    name: str
    family: str
    sol_probe50: bool = False
    eth_funding_boost: bool = False
    btc_reversal_confirm: bool = False


CANDIDATES = (
    RoleConfig("V96_BASE", "BASELINE"),
    RoleConfig("V96_SOL_SCALE", "SOL_ROLE", sol_probe50=True),
    RoleConfig("V96_ETH_FUNDING_BOOST", "ETH_ROLE", eth_funding_boost=True),
    RoleConfig("V96_BTC_CONFIRM", "BTC_ROLE", btc_reversal_confirm=True),
)

ETH_TRIGGER_PCT = 6.0
ETH_ADD = 0.025
ETH_MAX_FUNDING_BPS = 1.0


def symbol_side(weight: float) -> int:
    return 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0


def sol_state_template() -> dict:
    return {
        "side": 0,
        "confirmed": False,
        "lastSignedReturn": 0.0,
        "eventId": None,
    }


def btc_state_template() -> dict:
    return {
        "acceptedSide": 0,
        "pendingSide": 0,
        "pendingBars": 0,
        "eventId": None,
    }


def new_event(events: Dict[str, dict], symbol: str, ts: int, sequence: int, reason: str) -> str:
    event_id = f"{symbol}-{sequence}"
    events[event_id] = {
        "id": event_id,
        "symbol": symbol,
        "reason": reason,
        "startTs": ts,
        "year": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year,
        "directDelta": 0.0,
        "bars": 0,
        "deltaByTs": {},
    }
    return event_id


def add_event_delta(event: dict, ts: int, delta: float) -> None:
    event["directDelta"] = r1.finite(event.get("directDelta")) + delta
    event["bars"] = int(event.get("bars", 0)) + 1
    key = str(ts)
    event["deltaByTs"][key] = r1.finite(event["deltaByTs"].get(key)) + delta


def event_summary(events: List[dict]) -> dict:
    positive_events = [event for event in events if r1.finite(event.get("directDelta")) > 0]
    positive_total = sum(r1.finite(event.get("directDelta")) for event in positive_events)
    top_positive = max((r1.finite(event.get("directDelta")) for event in positive_events), default=0.0)
    return {
        "count": len(events),
        "years": sorted(set(int(event["year"]) for event in events)),
        "symbols": sorted(set(str(event["symbol"]) for event in events)),
        "positiveRatePct": (
            sum(r1.finite(event.get("directDelta")) > 0 for event in events) / len(events) * 100.0
            if events else None
        ),
        "totalDirectDeltaPct": sum(r1.finite(event.get("directDelta")) for event in events) * 100.0,
        "positiveDirectDeltaPct": positive_total * 100.0,
        "topPositiveEventShare": top_positive / positive_total if positive_total > 0 else 0.0,
        "bestEventDeltaPct": top_positive * 100.0,
        "worstEventDeltaPct": min(
            (r1.finite(event.get("directDelta")) for event in events), default=0.0
        ) * 100.0,
    }


def remove_best_positive_event(rows: List[dict], events: List[dict]) -> tuple[List[dict], Optional[dict]]:
    best = max(events, key=lambda event: r1.finite(event.get("directDelta")), default=None)
    if best is None or r1.finite(best.get("directDelta")) <= 0:
        return [dict(row) for row in rows], None
    delta_by_ts = {int(ts): r1.finite(value) for ts, value in best.get("deltaByTs", {}).items()}
    stressed = []
    for row in rows:
        item = dict(row)
        item["return"] = r1.finite(row.get("return")) - delta_by_ts.get(int(row["ts"]), 0.0)
        stressed.append(item)
    return stressed, best


def sanitize_events(events: List[dict]) -> List[dict]:
    result = []
    for event in events:
        item = dict(event)
        item.pop("deltaByTs", None)
        result.append(item)
    return result


def simulate(
    config: RoleConfig,
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
    sol_state = sol_state_template()
    eth_state = exact.state_template()
    btc_state = btc_state_template()
    previous_standard: Dict[str, float] = {}
    previous_candidate: Dict[str, float] = {}
    equity = peak = 1.0
    reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False
    rows: List[dict] = []
    events: Dict[str, dict] = {}
    next_event = 0
    symbol_delta_rows: List[dict] = []
    guard_rejections = 0

    for position, ts in enumerate(times):
        row = rows_by_ts.get(ts, {"return": 0.0, "gross": 0.0})
        item = context.get(ts, {"turnover": 0.0, "regime": 0, "breadth": 0, "feature": {}})
        controller = exact.controller_step(
            row,
            item,
            equity,
            peak,
            reference_returns,
            turnover_history,
            regime_history,
            signal_count,
            calm_count,
            whipsaw_active,
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
        active_events: Dict[str, Optional[str]] = {symbol: None for symbol in SYMBOLS}

        if config.sol_probe50:
            sol_weight = r1.finite(standard.get("SOL"))
            sol_side = symbol_side(sol_weight)
            if sol_side != int(sol_state["side"]):
                sol_state.clear()
                sol_state.update(sol_state_template())
                sol_state["side"] = sol_side
            if sol_side != 0 and not bool(sol_state["confirmed"]):
                candidate["SOL"] = sol_weight * 0.50
                if sol_state.get("eventId") is None:
                    next_event += 1
                    sol_state["eventId"] = new_event(
                        events, "SOL", ts, next_event, "INITIAL_50_UNTIL_POSITIVE_CONTINUATION"
                    )
                active_events["SOL"] = str(sol_state["eventId"])

        if config.eth_funding_boost:
            eth_weight = r1.finite(standard.get("ETH"))
            eth_side = symbol_side(eth_weight)
            if eth_side != int(eth_state["side"]):
                eth_state.clear()
                eth_state.update(exact.state_template())
                eth_state["side"] = eth_side
            if eth_side != 0:
                trigger = bool(
                    not bool(eth_state["pyramided"])
                    and r1.finite(controller["boost"]) > 0
                    and not bool(controller["whipsaw"])
                    and int(controller["ddStage"]) == 0
                    and r1.finite(eth_state["cumulative"]) * 100.0 >= ETH_TRIGGER_PCT
                    and r1.finite(eth_state["lastSignedReturn"]) > 0
                )
                if trigger:
                    funding_bps = crowd.rolling_funding_bps(raw, "ETH", times, position, 1)
                    if funding_bps is not None and funding_bps <= ETH_MAX_FUNDING_BPS:
                        eth_state["pyramided"] = True
                        next_event += 1
                        event_id = new_event(
                            events, "ETH", ts, next_event, "STRONG_BOOST_T6_FUNDING_LE_1BPS_ADD_2P5"
                        )
                        events[event_id]["fundingBps"] = funding_bps
                        eth_state["eventId"] = event_id
                    else:
                        guard_rejections += 1
                if bool(eth_state["pyramided"]):
                    candidate["ETH"] = eth_weight * (1.0 + ETH_ADD)
                    active_events["ETH"] = str(eth_state["eventId"])

        if config.btc_reversal_confirm:
            btc_weight = r1.finite(standard.get("BTC"))
            btc_side = symbol_side(btc_weight)
            accepted_side = int(btc_state["acceptedSide"])
            if btc_side == 0:
                candidate.pop("BTC", None)
                btc_state.clear()
                btc_state.update(btc_state_template())
            elif accepted_side == 0:
                btc_state["acceptedSide"] = btc_side
                btc_state["pendingSide"] = 0
                btc_state["pendingBars"] = 0
            elif btc_side == accepted_side:
                btc_state["pendingSide"] = 0
                btc_state["pendingBars"] = 0
            elif int(btc_state["pendingSide"]) == btc_side and int(btc_state["pendingBars"]) >= 1:
                btc_state["acceptedSide"] = btc_side
                btc_state["pendingSide"] = 0
                btc_state["pendingBars"] = 0
                btc_state["eventId"] = None
            else:
                candidate.pop("BTC", None)
                btc_state["pendingSide"] = btc_side
                btc_state["pendingBars"] = 1
                next_event += 1
                event_id = new_event(
                    events, "BTC", ts, next_event, "ONE_BAR_FLAT_CONFIRM_ON_DIRECT_REVERSAL"
                )
                btc_state["eventId"] = event_id
                active_events["BTC"] = event_id

        candidate = r1.cap_weights(candidate)
        standard_symbol = exact.per_symbol_reconstructed(
            standard, previous_standard, raw, ts, cost_bps, adverse_bps
        )
        candidate_symbol = exact.per_symbol_reconstructed(
            candidate, previous_candidate, raw, ts, cost_bps, adverse_bps
        )
        exact_standard = r1.finite(row.get("return")) * r1.finite(controller["scale"])
        value = exact_standard + sum(candidate_symbol.values()) - sum(standard_symbol.values())

        deltas = {
            symbol: r1.finite(candidate_symbol.get(symbol)) - r1.finite(standard_symbol.get(symbol))
            for symbol in SYMBOLS
        }
        symbol_delta_rows.append({"ts": ts, **deltas})
        for symbol, event_id in active_events.items():
            if event_id and event_id in events:
                add_event_delta(events[event_id], ts, deltas[symbol])

        rows.append({
            "ts": ts,
            "return": value,
            "gross": sum(abs(weight) for weight in candidate.values()),
            "maxGross": sum(abs(weight) for weight in candidate.values()),
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

        if config.sol_probe50:
            sol_weight = r1.finite(standard.get("SOL"))
            sol_side = symbol_side(sol_weight)
            if sol_side != 0 and not bool(sol_state["confirmed"]):
                signed = sol_side * r1.price_return(raw, "SOL", ts)
                sol_state["lastSignedReturn"] = signed
                if signed > 0:
                    sol_state["confirmed"] = True
                    sol_state["eventId"] = None

        if config.eth_funding_boost:
            eth_weight = r1.finite(standard.get("ETH"))
            eth_side = symbol_side(eth_weight)
            if eth_side != 0:
                signed = eth_side * r1.price_return(raw, "ETH", ts)
                eth_state["lastSignedReturn"] = signed
                eth_state["cumulative"] = (
                    (1.0 + r1.finite(eth_state["cumulative"])) * (1.0 + signed) - 1.0
                )

        if config.btc_reversal_confirm and active_events["BTC"]:
            btc_state["eventId"] = None

    event_rows = list(events.values())
    stressed_rows, removed_event = remove_best_positive_event(rows, event_rows)
    return {
        "rows": rows,
        "events": sanitize_events(event_rows),
        "eventSummary": event_summary(event_rows),
        "bestEventRemovedRows": stressed_rows,
        "removedBestEvent": (
            {
                "id": removed_event["id"],
                "symbol": removed_event["symbol"],
                "year": removed_event["year"],
                "directDeltaPct": r1.finite(removed_event["directDelta"]) * 100.0,
            }
            if removed_event else None
        ),
        "symbolDeltaRows": symbol_delta_rows,
        "guardRejections": guard_rejections,
    }


def symbol_deltas(rows: List[dict], start: int, end: int) -> dict:
    return {
        symbol: sum(r1.finite(row.get(symbol)) for row in rows if start <= int(row["ts"]) < end) * 100.0
        for symbol in SYMBOLS
    }


def period_metrics(simulation: dict, periods: dict) -> dict:
    return {
        name: {
            "metrics": r1.metrics(simulation["rows"], start, end),
            "bestEventRemoved": r1.metrics(simulation["bestEventRemovedRows"], start, end),
            "symbolDirectDeltaPctPoints": symbol_deltas(simulation["symbolDeltaRows"], start, end),
        }
        for name, (start, end) in periods.items()
    }


def delta(value: float, baseline: float) -> float:
    return r1.finite(value) - r1.finite(baseline)


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

    trade_start = min(int(trade["entry_ts"]) for trade in v96.v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v96.v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)

    simulations = {}
    evaluations = {}
    for config in CANDIDATES:
        normal = simulate(
            config, raw, targets, times, base_core, features, base_rows, context, 10.0, 0.0, 0
        )
        severe = simulate(
            config, raw, targets, times, severe_core, features, severe_rows, context, 50.0, 3.0, 1
        )
        simulations[config.name] = {"normal": normal, "severe": severe}
        profile = {"normal": normal["rows"], "severe": severe["rows"]}
        integration = v96.integrate(profile, pengu_rows)
        evaluations[config.name] = {
            "config": asdict(config),
            "corePeriods": {
                "normal": period_metrics(normal, periods),
                "severe": period_metrics(severe, periods),
            },
            "normalEventSummary": normal["eventSummary"],
            "severeEventSummary": severe["eventSummary"],
            "normalRemovedBestEvent": normal["removedBestEvent"],
            "severeRemovedBestEvent": severe["removedBestEvent"],
            "guardRejections": {
                "normal": normal["guardRejections"],
                "severe": severe["guardRejections"],
            },
            "v96Portfolio": integration,
        }

    baseline_sim = simulations["V96_BASE"]
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

    baseline = evaluations["V96_BASE"]
    screen = []
    for config in CANDIDATES:
        if config.name == "V96_BASE":
            continue
        item = evaluations[config.name]
        base_core_periods = baseline["corePeriods"]
        core_periods = item["corePeriods"]
        portfolio = item["v96Portfolio"]
        base_portfolio = baseline["v96Portfolio"]
        event = item["normalEventSummary"]

        development_delta = delta(
            core_periods["normal"]["development2023_2024"]["metrics"]["compoundedReturnPct"],
            base_core_periods["normal"]["development2023_2024"]["metrics"]["compoundedReturnPct"],
        )
        validation_delta = delta(
            core_periods["normal"]["validation2025"]["metrics"]["compoundedReturnPct"],
            base_core_periods["normal"]["validation2025"]["metrics"]["compoundedReturnPct"],
        )
        diagnostic_delta = delta(
            core_periods["normal"]["diagnostic2026H1"]["metrics"]["compoundedReturnPct"],
            base_core_periods["normal"]["diagnostic2026H1"]["metrics"]["compoundedReturnPct"],
        )
        severe_validation_delta = delta(
            core_periods["severe"]["validation2025"]["metrics"]["compoundedReturnPct"],
            base_core_periods["severe"]["validation2025"]["metrics"]["compoundedReturnPct"],
        )
        severe_diagnostic_delta = delta(
            core_periods["severe"]["diagnostic2026H1"]["metrics"]["compoundedReturnPct"],
            base_core_periods["severe"]["diagnostic2026H1"]["metrics"]["compoundedReturnPct"],
        )
        full_delta = delta(
            portfolio["full"]["compoundedReturnPct"],
            base_portfolio["full"]["compoundedReturnPct"],
        )
        severe_full_delta = delta(
            portfolio["severeFull"]["compoundedReturnPct"],
            base_portfolio["severeFull"]["compoundedReturnPct"],
        )
        excluded_delta = delta(
            portfolio["largeWaveExcludedFull"]["compoundedReturnPct"],
            base_portfolio["largeWaveExcludedFull"]["compoundedReturnPct"],
        )
        excluded_severe_delta = delta(
            portfolio["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
            base_portfolio["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
        )
        h1_delta = delta(
            portfolio["reused2026H1"]["compoundedReturnPct"],
            base_portfolio["reused2026H1"]["compoundedReturnPct"],
        )
        h1_severe_delta = delta(
            portfolio["reused2026H1Severe"]["compoundedReturnPct"],
            base_portfolio["reused2026H1Severe"]["compoundedReturnPct"],
        )
        dd_delta = delta(
            portfolio["full"]["maxDrawdownPct"],
            base_portfolio["full"]["maxDrawdownPct"],
        )
        best_event_removed_full = core_periods["normal"]["full"]["bestEventRemoved"]["compoundedReturnPct"]
        baseline_core_full = base_core_periods["normal"]["full"]["metrics"]["compoundedReturnPct"]
        active_periods = sum(abs(value) > 1e-9 for value in (development_delta, validation_delta, diagnostic_delta))
        concentration_ok = bool(
            int(event["count"]) >= 5
            and len(event["years"]) >= 2
            and r1.finite(event["topPositiveEventShare"]) <= 0.50
            and best_event_removed_full >= baseline_core_full
        )
        time_robust = bool(
            validation_delta >= 0
            and severe_validation_delta >= 0
            and diagnostic_delta >= 0
            and severe_diagnostic_delta >= 0
            and active_periods >= 2
        )
        portfolio_robust = bool(
            full_delta > 0
            and severe_full_delta > 0
            and excluded_delta >= 0
            and excluded_severe_delta >= 0
            and h1_delta >= 0
            and h1_severe_delta >= 0
            and dd_delta >= -1.0
            and portfolio["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        )
        screen_pass = bool(portfolio_robust and time_robust and concentration_ok)
        screen.append({
            "candidate": config.name,
            "family": config.family,
            "screenPass": screen_pass,
            "portfolioRobust": portfolio_robust,
            "timeRobust": time_robust,
            "concentrationRobust": concentration_ok,
            "developmentNormalDeltaPctPoints": development_delta,
            "validationNormalDeltaPctPoints": validation_delta,
            "validationSevereDeltaPctPoints": severe_validation_delta,
            "diagnosticNormalDeltaPctPoints": diagnostic_delta,
            "diagnosticSevereDeltaPctPoints": severe_diagnostic_delta,
            "fullNormalDeltaPctPoints": full_delta,
            "fullSevereDeltaPctPoints": severe_full_delta,
            "largeWaveExcludedDeltaPctPoints": excluded_delta,
            "largeWaveExcludedSevereDeltaPctPoints": excluded_severe_delta,
            "reused2026H1DeltaPctPoints": h1_delta,
            "reused2026H1SevereDeltaPctPoints": h1_severe_delta,
            "drawdownDeltaPctPoints": dd_delta,
            "eventCount": event["count"],
            "eventYears": event["years"],
            "eventPositiveRatePct": event["positiveRatePct"],
            "topPositiveEventShare": event["topPositiveEventShare"],
            "bestEventRemovedCoreDeltaPctPoints": best_event_removed_full - baseline_core_full,
            "symbolDirectDeltaPctPoints": core_periods["normal"]["full"]["symbolDirectDeltaPctPoints"],
        })

    screen.sort(
        key=lambda row: (
            row["screenPass"],
            row["portfolioRobust"],
            row["timeRobust"],
            row["fullSevereDeltaPctPoints"],
            row["fullNormalDeltaPctPoints"],
        ),
        reverse=True,
    )
    passed = [row for row in screen if row["screenPass"]]
    status = "SYMBOL_ROLE_ROBUST_PASS" if passed else "NO_ROBUST_SYMBOL_ROLE_IMPROVEMENT"

    result = r1.rounded({
        "strategyId": "V96_SYMBOL_ROLE_ABLATION",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": passed[0]["candidate"] if passed else None,
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "promotionAllowed": False,
            "grossCap": 2.0,
            "dailyLossLimitChanged": False,
            "commonRegimeChanged": False,
            "bnbChanged": False,
        },
        "fixedRoleDefinitions": {
            "SOL": "Start each new SOL side episode at 50%; restore 100% only from the bar after a positive same-side completed 12h return.",
            "ETH": "Only ETH may add 2.5% once per episode when Strong Boost is active, DD stage is zero, Whipsaw is inactive, cumulative signed move is at least 6%, prior signed bar is positive and latest 12h Funding is <=1 bps.",
            "BTC": "Keep BTC regime unchanged. On direct BTC trade-side reversal only, stay flat for one completed decision bar and accept the new side if it persists.",
            "BNB": "Unchanged control symbol.",
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
            "All 2023-2026H1 observations are reused historical evidence, not pristine Forward evidence.",
            "The three role definitions were fixed before this run; no per-symbol threshold grid was searched.",
            "Best-event removal subtracts the direct event delta without rerunning controller feedback.",
            "A historical pass would remain Shadow-only and would not authorize Production or LIVE changes.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-symbol-role-ablation.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Symbol Role Ablation",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{result['selected'] or 'NONE'}**",
        f"- Baseline parity normal/severe: {result['baselineParity']['maximumNormalBarDifference']} / {result['baselineParity']['maximumSevereBarDifference']}",
        "- Production / LIVE / VPS changed: **NO**",
        "",
        "| Candidate | Pass | Portfolio | Time | Concentration | Full N | Full S | Excl N | Excl S | 2025 N | 2025 S | 2026 N | 2026 S | DD | Events | Top share | Best event removed |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["screen"]:
        report.append(
            f"| {item['candidate']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['portfolioRobust'] else 'NO'} | {'YES' if item['timeRobust'] else 'NO'} | "
            f"{'YES' if item['concentrationRobust'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['largeWaveExcludedDeltaPctPoints']} | {item['largeWaveExcludedSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['drawdownDeltaPctPoints']} | {item['eventCount']} | {item['topPositiveEventShare']} | "
            f"{item['bestEventRemovedCoreDeltaPctPoints']} |"
        )
    report.extend([
        "",
        "- BNB is unchanged and acts as the control symbol.",
        "- BTC market-regime state is unchanged; only BTC trade reversal execution is delayed.",
        "- No candidate is promoted by this workflow.",
    ])
    (state_dir / "v96-symbol-role-ablation.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
