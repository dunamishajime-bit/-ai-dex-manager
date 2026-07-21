from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v96_core_profit_capture_screen as r1
import research_lab_v96_symbol_missed_profit_attribution as audit

core = v95.core
BAR = r1.BAR
SYMBOLS = r1.SYMBOLS
DEV_END = r1.DEV_END
VALIDATION_END = r1.VALIDATION_END
GROSS_CAP = 2.0
SLEEVE_GROSS = 0.10


@dataclass(frozen=True)
class RoleEngineConfig:
    name: str
    family: str
    symbol: str
    role: str
    sma_length: int
    momentum_length: int
    entry_confirm: int
    exit_confirm: int
    relative_to_btc: bool = False
    gross: float = SLEEVE_GROSS


CANDIDATES = (
    RoleEngineConfig("BTC_SLOW_C2", "BTC_SLOW", "BTC", "SLOW_TREND_HEDGE", 60, 20, 2, 2),
    RoleEngineConfig("BTC_SLOW_C3", "BTC_SLOW", "BTC", "SLOW_TREND_HEDGE", 60, 20, 3, 3),
    RoleEngineConfig("ETH_REL_L20", "ETH_RELATIVE", "ETH", "RELATIVE_STRENGTH_TREND", 40, 20, 2, 2, True),
    RoleEngineConfig("ETH_REL_L40", "ETH_RELATIVE", "ETH", "RELATIVE_STRENGTH_TREND", 60, 40, 2, 2, True),
    RoleEngineConfig("BNB_STABLE_C2", "BNB_STABLE", "BNB", "STABLE_TREND", 40, 20, 2, 2),
    RoleEngineConfig("BNB_STABLE_C3", "BNB_STABLE", "BNB", "STABLE_TREND", 40, 20, 3, 3),
    RoleEngineConfig("SOL_FAST_EXIT2", "SOL_FAST_SLOW_EXIT", "SOL", "FAST_ENTRY_SLOW_EXIT", 40, 10, 1, 2),
    RoleEngineConfig("SOL_FAST_EXIT3", "SOL_FAST_SLOW_EXIT", "SOL", "FAST_ENTRY_SLOW_EXIT", 40, 10, 1, 3),
)

PRIMARY_NAMES = ("BTC_SLOW_C2", "ETH_REL_L20", "BNB_STABLE_C2", "SOL_FAST_EXIT2")
NEIGHBOR_NAMES = ("BTC_SLOW_C3", "ETH_REL_L40", "BNB_STABLE_C3", "SOL_FAST_EXIT3")


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and abs(number) != float("inf") else fallback


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    if end - length + 1 < 0:
        return None
    values = [finite(row["close"]) for row in rows[end - length + 1:end + 1]]
    return statistics.fmean(values) if values else None


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    prior = end - length
    if prior < 0:
        return None
    previous = finite(rows[prior]["close"])
    current = finite(rows[end]["close"])
    return current / previous - 1.0 if previous > 0 else None


def raw_signal(config: RoleEngineConfig, raw: dict, ts: int) -> int:
    index = raw["indexes"][config.symbol].get(ts)
    btc_index = raw["indexes"]["BTC"].get(ts)
    if index is None or btc_index is None:
        return 0
    rows = raw["bars"][config.symbol]
    average = sma(rows, index, config.sma_length)
    mom = momentum(rows, index, config.momentum_length)
    if average is None or mom is None:
        return 0
    close = finite(rows[index]["close"])
    score = mom
    if config.relative_to_btc:
        btc_mom = momentum(raw["bars"]["BTC"], btc_index, config.momentum_length)
        if btc_mom is None:
            return 0
        score = mom - btc_mom
    if close > average and mom > 0 and score > 0:
        return 1
    if close < average and mom < 0 and score < 0:
        return -1
    return 0


def signal_series(config: RoleEngineConfig, raw: dict, times: List[int]) -> List[int]:
    current = 0
    pending_side = 0
    pending_count = 0
    result: List[int] = []
    for ts in times:
        desired = raw_signal(config, raw, ts)
        if current == 0:
            if desired == 0:
                pending_side = 0
                pending_count = 0
            else:
                if pending_side == desired:
                    pending_count += 1
                else:
                    pending_side = desired
                    pending_count = 1
                if pending_count >= config.entry_confirm:
                    current = desired
                    pending_side = 0
                    pending_count = 0
        elif desired == current:
            pending_side = 0
            pending_count = 0
        else:
            transition = desired
            if pending_side == transition:
                pending_count += 1
            else:
                pending_side = transition
                pending_count = 1
            if pending_count >= config.exit_confirm:
                current = transition
                pending_side = 0
                pending_count = 0
        result.append(current)
    return result


def period_ranges(times: List[int]) -> dict:
    return {
        "development2023_2024": (times[0], DEV_END),
        "validation2025": (DEV_END, VALIDATION_END),
        "diagnostic2026H1": (VALIDATION_END, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }


def simulate(
    configs: List[RoleEngineConfig],
    raw: dict,
    baseline: dict,
    scenario: str,
) -> dict:
    severe = scenario == "severe"
    baseline_rows = baseline["severeControlled" if severe else "normalControlled"]
    baseline_weights = baseline["severeWeights" if severe else "normalWeights"]
    delay = 1 if severe else 0
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0
    times = baseline["times"]
    series = {config.name: signal_series(config, raw, times) for config in configs}
    previous: Dict[str, float] = {config.symbol: 0.0 for config in configs}
    rows: List[dict] = []
    events: List[dict] = []
    active_event: Dict[str, Optional[dict]] = {config.symbol: None for config in configs}
    sequence = 0
    gross_clipped_bars = 0
    blocked_by_core = {config.symbol: 0 for config in configs}

    for position, base in enumerate(baseline_rows):
        ts = int(base["ts"])
        source = position - 1 - delay
        requested: Dict[str, float] = {}
        for config in configs:
            side = series[config.name][source] if source >= 0 else 0
            core_weight = finite(baseline_weights.get(ts, {}).get(config.symbol))
            if abs(core_weight) > 1e-12:
                blocked_by_core[config.symbol] += int(side != 0)
                side = 0
            requested[config.symbol] = side * config.gross

        requested_gross = sum(abs(weight) for weight in requested.values())
        available = max(0.0, GROSS_CAP - finite(base.get("gross")))
        scale = min(1.0, available / requested_gross) if requested_gross > 0 else 1.0
        gross_clipped_bars += int(scale < 1.0 - 1e-12)
        weights = {symbol: weight * scale for symbol, weight in requested.items()}

        alpha = 0.0
        alpha_by_symbol: Dict[str, float] = {}
        for config in configs:
            symbol = config.symbol
            weight = finite(weights.get(symbol))
            old = finite(previous.get(symbol))
            value = (
                weight * r1.price_return(raw, symbol, ts)
                - weight * r1.funding_rate(raw, symbol, ts)
                - abs(weight - old) * cost_bps / 10_000.0
                - abs(weight) * adverse_bps / 10_000.0
            )
            alpha += value
            alpha_by_symbol[symbol] = value
            old_side = 1 if old > 1e-12 else -1 if old < -1e-12 else 0
            new_side = 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0
            event = active_event.get(symbol)
            if event is not None and new_side != old_side:
                event["exitTs"] = ts
                event["exitIso"] = dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()
                active_event[symbol] = None
                event = None
            if new_side != 0 and event is None:
                sequence += 1
                event = {
                    "id": f"{symbol}-{sequence}",
                    "symbol": symbol,
                    "side": new_side,
                    "entryTs": ts,
                    "entryIso": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat(),
                    "entryYear": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year,
                    "exitTs": times[-1] + BAR,
                    "returnPct": 0.0,
                    "bars": 0,
                    "byBar": {},
                }
                events.append(event)
                active_event[symbol] = event
            if event is not None and new_side != 0:
                event["returnPct"] += value * 100.0
                event["bars"] += 1
                event["byBar"][str(position)] = value
            previous[symbol] = weight

        rows.append({
            "ts": ts,
            "return": finite(base.get("return")) + alpha,
            "baselineReturn": finite(base.get("return")),
            "alphaReturn": alpha,
            "gross": finite(base.get("gross")) + sum(abs(weight) for weight in weights.values()),
            "alphaBySymbol": alpha_by_symbol,
        })

    positives = [max(finite(event["returnPct"]), 0.0) for event in events]
    positive_total = sum(positives)
    return {
        "rows": rows,
        "events": events,
        "summary": {
            "count": len(events),
            "years": sorted(set(int(event["entryYear"]) for event in events)),
            "symbols": sorted(set(str(event["symbol"]) for event in events)),
            "winRatePct": sum(finite(event["returnPct"]) > 0 for event in events) / len(events) * 100.0 if events else 0.0,
            "topPositiveEventShare": max(positives, default=0.0) / positive_total if positive_total > 0 else 0.0,
            "grossClippedBars": gross_clipped_bars,
            "blockedByCoreBars": blocked_by_core,
            "maxObservedGross": max((finite(row["gross"]) for row in rows), default=0.0),
        },
    }


def remove_best_event(simulation: dict) -> List[dict]:
    best = max(simulation["events"], key=lambda event: finite(event["returnPct"]), default=None)
    if best is None or finite(best["returnPct"]) <= 0:
        return [dict(row) for row in simulation["rows"]]
    rows = []
    by_bar = {int(index): finite(value) for index, value in best["byBar"].items()}
    for index, row in enumerate(simulation["rows"]):
        item = dict(row)
        item["return"] = finite(row["return"]) - by_bar.get(index, 0.0)
        rows.append(item)
    return rows


def evaluate(name: str, configs: List[RoleEngineConfig], raw: dict, baseline: dict) -> dict:
    normal = simulate(configs, raw, baseline, "normal")
    severe = simulate(configs, raw, baseline, "severe")
    periods = period_ranges(baseline["times"])
    normal_base = baseline["normalControlled"]
    severe_base = baseline["severeControlled"]
    result_periods = {}
    for period, (start, end) in periods.items():
        candidate_n = r1.metrics(normal["rows"], start, end)
        candidate_s = r1.metrics(severe["rows"], start, end)
        base_n = r1.metrics(normal_base, start, end)
        base_s = r1.metrics(severe_base, start, end)
        result_periods[period] = {
            "normal": candidate_n,
            "severe": candidate_s,
            "normalDeltaPctPoints": candidate_n["compoundedReturnPct"] - base_n["compoundedReturnPct"],
            "severeDeltaPctPoints": candidate_s["compoundedReturnPct"] - base_s["compoundedReturnPct"],
            "drawdownDeltaPctPoints": candidate_n["maxDrawdownPct"] - base_n["maxDrawdownPct"],
        }
    full_start, full_end = periods["full"]
    removed_n = r1.metrics(remove_best_event(normal), full_start, full_end)
    removed_s = r1.metrics(remove_best_event(severe), full_start, full_end)
    base_full_n = r1.metrics(normal_base, full_start, full_end)
    base_full_s = r1.metrics(severe_base, full_start, full_end)
    summary = normal["summary"]
    period_deltas = [
        result_periods[period][field]
        for period in ("development2023_2024", "validation2025", "diagnostic2026H1")
        for field in ("normalDeltaPctPoints", "severeDeltaPctPoints")
    ]
    passed = bool(
        all(value >= 0.0 for value in period_deltas)
        and result_periods["full"]["normalDeltaPctPoints"] > 0.0
        and result_periods["full"]["severeDeltaPctPoints"] > 0.0
        and result_periods["full"]["drawdownDeltaPctPoints"] >= -1.5
        and int(summary["count"]) >= 10
        and len(summary["years"]) >= 3
        and finite(summary["topPositiveEventShare"]) <= 0.35
        and removed_n["compoundedReturnPct"] >= base_full_n["compoundedReturnPct"]
        and removed_s["compoundedReturnPct"] >= base_full_s["compoundedReturnPct"]
        and finite(summary["maxObservedGross"]) <= GROSS_CAP + 1e-9
    )
    return {
        "name": name,
        "configs": [asdict(config) for config in configs],
        "screenPass": passed,
        "periods": result_periods,
        "normalSummary": normal["summary"],
        "severeSummary": severe["summary"],
        "removeBestEvent": {
            "normal": removed_n,
            "severe": removed_s,
            "normalDeltaPctPoints": removed_n["compoundedReturnPct"] - base_full_n["compoundedReturnPct"],
            "severeDeltaPctPoints": removed_s["compoundedReturnPct"] - base_full_s["compoundedReturnPct"],
        },
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    baseline = audit.build_exact_baseline(raw)
    by_name = {config.name: config for config in CANDIDATES}

    evaluations: Dict[str, dict] = {}
    for config in CANDIDATES:
        evaluations[config.name] = evaluate(config.name, [config], raw, baseline)
    evaluations["ROLE_SET_PRIMARY"] = evaluate(
        "ROLE_SET_PRIMARY", [by_name[name] for name in PRIMARY_NAMES], raw, baseline
    )
    evaluations["ROLE_SET_NEIGHBOR"] = evaluate(
        "ROLE_SET_NEIGHBOR", [by_name[name] for name in NEIGHBOR_NAMES], raw, baseline
    )

    family_rows = []
    for family in sorted(set(config.family for config in CANDIDATES)):
        members = [evaluations[config.name] for config in CANDIDATES if config.family == family]
        family_rows.append({
            "family": family,
            "members": [member["name"] for member in members],
            "passes": sum(bool(member["screenPass"]) for member in members),
            "neighborStablePass": bool(all(member["screenPass"] for member in members)),
            "fullNormalDeltas": [member["periods"]["full"]["normalDeltaPctPoints"] for member in members],
            "fullSevereDeltas": [member["periods"]["full"]["severeDeltaPctPoints"] for member in members],
        })

    selected = [name for name, item in evaluations.items() if item["screenPass"]]
    status = "SYMBOL_ROLE_ENGINE_PASS" if selected else "NO_ROBUST_SYMBOL_ROLE_ENGINE"
    result = core.rounded({
        "strategyId": "V96_SYMBOL_ROLE_ENGINE_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected,
        "baselineParity": baseline["baselineParity"],
        "design": {
            "BTC": "Slow long/short trend and hedge confirmation.",
            "ETH": "Trend only when ETH momentum leads BTC in the same direction.",
            "BNB": "Stable two- or three-bar trend confirmation.",
            "SOL": "Fast trend entry with slower two- or three-bar exit confirmation.",
            "activation": "Independent sleeve only while V96 Core is flat on that same symbol.",
            "grossPerSleeve": SLEEVE_GROSS,
            "corePriority": True,
            "grossCap": GROSS_CAP,
        },
        "families": family_rows,
        "evaluations": evaluations,
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "promotionAllowed": False,
            "candidateCount": len(CANDIDATES) + 2,
        },
        "limitations": [
            "The role designs were chosen after observing the missed-profit attribution and are therefore historical research, not pristine holdout evidence.",
            "2025 and 2026H1 are reused time-separated evidence.",
            "A candidate must pass Normal and Severe in every period, best-event removal and neighbor stability before Forward Shadow consideration.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-symbol-role-engine-screen.json"
    md_path = state_dir / "v96-symbol-role-engine-screen.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 Symbol Role Engine Screen",
        "",
        f"- Status: **{status}**",
        f"- Selected: {', '.join(selected) if selected else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Candidate | Pass | Full N | Full S | 2025 N | 2025 S | 2026H1 N | 2026H1 S | DD | Events | Top share | Best removed N/S |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, item in result["evaluations"].items():
        full = item["periods"]["full"]
        val = item["periods"]["validation2025"]
        diag = item["periods"]["diagnostic2026H1"]
        removed = item["removeBestEvent"]
        lines.append(
            f"| {name} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{full['normalDeltaPctPoints']} | {full['severeDeltaPctPoints']} | "
            f"{val['normalDeltaPctPoints']} | {val['severeDeltaPctPoints']} | "
            f"{diag['normalDeltaPctPoints']} | {diag['severeDeltaPctPoints']} | "
            f"{full['drawdownDeltaPctPoints']} | {item['normalSummary']['count']} | "
            f"{item['normalSummary']['topPositiveEventShare']} | "
            f"{removed['normalDeltaPctPoints']} / {removed['severeDeltaPctPoints']} |"
        )
    lines.extend(["", "Historical research only. No candidate is connected to Production."])
    markdown = "\n".join(lines) + "\n"
    md_path.write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)


if __name__ == "__main__":
    main()
