from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v96_independent_alpha_screen as a12

core = v95.core
SYMBOLS = ("ETH", "BNB", "SOL")
BAR = 12 * core.HOUR
START_2025 = core.v4.START_2025
START_2026 = core.v4.START_2026


@dataclass(frozen=True)
class BearAlphaConfig:
    name: str
    family: str
    lookback: int
    hold_bars: int
    gross: float = 0.10
    persistence: int = 0


CANDIDATES = (
    BearAlphaConfig("BEAR_BREAK_L20_H4", "BREAKDOWN", 20, 4),
    BearAlphaConfig("BEAR_BREAK_L20_H8", "BREAKDOWN", 20, 8),
    BearAlphaConfig("BEAR_BREAK_L40_H4", "BREAKDOWN", 40, 4),
    BearAlphaConfig("BEAR_BREAK_L40_H8", "BREAKDOWN", 40, 8),
    BearAlphaConfig("BEAR_WEAK_M10_P2_H4", "WEAKNESS", 10, 4, persistence=2),
    BearAlphaConfig("BEAR_WEAK_M10_P2_H8", "WEAKNESS", 10, 8, persistence=2),
    BearAlphaConfig("BEAR_WEAK_M20_P2_H4", "WEAKNESS", 20, 4, persistence=2),
    BearAlphaConfig("BEAR_WEAK_M20_P2_H8", "WEAKNESS", 20, 8, persistence=2),
    BearAlphaConfig("BEAR_WEAK_M20_P3_H4", "WEAKNESS", 20, 4, persistence=3),
    BearAlphaConfig("BEAR_WEAK_M20_P3_H8", "WEAKNESS", 20, 8, persistence=3),
)


def finite(value, fallback: float = 0.0) -> float:
    return a12.finite(value, fallback)


def rounded(value):
    return a12.rounded(value)


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    return a12.sma(rows, end, length)


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    return a12.momentum(rows, end, length)


def btc_bear_gate(raw: dict, ts: int) -> bool:
    index = raw["indexes"]["BTC"].get(ts)
    if index is None:
        return False
    rows = raw["bars"]["BTC"]
    average = sma(rows, index, 120)
    mom = momentum(rows, index, 20)
    if average is None or mom is None:
        return False
    return finite(rows[index]["close"]) < average and mom < -0.02


def mode_allows(baseline: dict, ts: int) -> bool:
    target = baseline["targets"].get(ts, {})
    has_alt_long = any(finite(target.get(symbol)) > 1e-12 for symbol in SYMBOLS)
    btc_short = finite(target.get("BTC")) < -1e-12
    return not has_alt_long and (btc_short or not target)


def breakdown_signal(
    config: BearAlphaConfig,
    raw: dict,
    ts: int,
    excluded: Set[str],
) -> Optional[str]:
    if not btc_bear_gate(raw, ts):
        return None
    candidates: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        if symbol in excluded:
            continue
        index = raw["indexes"][symbol].get(ts)
        if index is None or index < config.lookback + 1:
            continue
        rows = raw["bars"][symbol]
        prior = rows[index - config.lookback:index]
        level = min((finite(row["low"]) for row in prior), default=0.0)
        current = rows[index]
        base_volume = statistics.fmean(
            finite(row.get("volume")) for row in rows[index - min(40, config.lookback):index]
        )
        if (
            level > 0
            and finite(current["close"]) < level * 0.998
            and finite(current["close"]) < finite(current["open"])
            and finite(current.get("volume")) >= base_volume * 0.70
        ):
            candidates.append((symbol, finite(current["close"]) / level - 1.0))
    return min(candidates, key=lambda item: item[1])[0] if candidates else None


def weakest_at(
    config: BearAlphaConfig,
    raw: dict,
    ts: int,
    excluded: Set[str],
) -> Optional[str]:
    candidates: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        if symbol in excluded:
            continue
        index = raw["indexes"][symbol].get(ts)
        if index is None or index < max(config.lookback, 44):
            continue
        rows = raw["bars"][symbol]
        mom = momentum(rows, index, config.lookback)
        average = sma(rows, index, 44)
        if mom is not None and average is not None and mom < 0 and finite(rows[index]["close"]) < average:
            candidates.append((symbol, mom))
    return min(candidates, key=lambda item: item[1])[0] if candidates else None


def weakness_signal(
    config: BearAlphaConfig,
    raw: dict,
    times: List[int],
    position: int,
    excluded: Set[str],
) -> Optional[str]:
    if not btc_bear_gate(raw, times[position]) or position - config.persistence + 1 < 0:
        return None
    weakest = [
        weakest_at(config, raw, times[index], excluded)
        for index in range(position - config.persistence + 1, position + 1)
    ]
    return weakest[-1] if weakest and all(item is not None for item in weakest) and len(set(weakest)) == 1 else None


def build_baseline(raw: dict) -> dict:
    baseline = a12.build_baseline(raw)
    baseline["normalGross"] = {int(row["ts"]): finite(row.get("gross")) for row in baseline["normal"]}
    baseline["severeGross"] = {int(row["ts"]): finite(row.get("gross")) for row in baseline["severe"]}
    return baseline


def generate_trades(
    config: BearAlphaConfig,
    raw: dict,
    baseline: dict,
    delay_bars: int,
    excluded: Set[str],
) -> List[dict]:
    times = baseline["times"]
    trades = []
    next_free = 0
    sequence = 0
    warmup = max(140, config.lookback + config.persistence + 2)
    for position in range(warmup, len(times) - config.hold_bars - delay_bars - 1):
        if position < next_free:
            continue
        ts = times[position]
        if not mode_allows(baseline, ts):
            continue
        if config.family == "BREAKDOWN":
            symbol = breakdown_signal(config, raw, ts, excluded)
        else:
            symbol = weakness_signal(config, raw, times, position, excluded)
        if symbol is None:
            continue
        entry_index = position + 1 + delay_bars
        exit_index = entry_index + config.hold_bars
        if exit_index >= len(times):
            continue
        sequence += 1
        trades.append({
            "id": f"{config.name}-{sequence}",
            "symbol": symbol,
            "signalTs": ts,
            "entryTs": times[entry_index],
            "exitTs": times[exit_index],
            "entryYear": dt.datetime.fromtimestamp(times[entry_index] / 1000, tz=dt.timezone.utc).year,
        })
        next_free = exit_index
    return trades


def simulate(
    config: BearAlphaConfig,
    raw: dict,
    baseline: dict,
    scenario: str,
    excluded: Set[str] | None = None,
) -> dict:
    excluded = excluded or set()
    severe = scenario == "severe"
    delay = 1 if severe else 0
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0
    baseline_rows = baseline["severe" if severe else "normal"]
    baseline_gross = baseline["severeGross" if severe else "normalGross"]
    trades = generate_trades(config, raw, baseline, delay, excluded)
    active_by_ts: Dict[int, dict] = {}
    for trade in trades:
        for ts in baseline["times"]:
            if int(trade["entryTs"]) <= ts < int(trade["exitTs"]):
                active_by_ts[ts] = trade

    previous_weight = 0.0
    prior_event_id: Optional[str] = None
    events = {trade["id"]: {**trade, "returnPct": 0.0, "byBar": {}} for trade in trades}
    rows = []
    for index, base in enumerate(baseline_rows):
        ts = int(base["ts"])
        trade = active_by_ts.get(ts)
        available = max(0.0, 2.0 - finite(baseline_gross.get(ts)))
        weight = -min(config.gross, available) if trade else 0.0
        event_id = str(trade["id"]) if trade else None
        value = 0.0
        if trade and abs(weight) > 0:
            symbol = str(trade["symbol"])
            value = (
                weight * a12.price_return(raw, symbol, ts)
                - weight * a12.funding_rate(raw, symbol, ts)
                - abs(weight - previous_weight) * cost_bps / 10_000.0
                - abs(weight) * adverse_bps / 10_000.0
            )
        elif abs(previous_weight) > 0:
            value -= abs(previous_weight) * cost_bps / 10_000.0
            event_id = prior_event_id
        if event_id and event_id in events:
            events[event_id]["returnPct"] += value * 100.0
            events[event_id]["byBar"][index] = value
        rows.append({
            "ts": ts,
            "return": finite(base.get("return")) + value,
            "baselineReturn": finite(base.get("return")),
            "alphaReturn": value,
            "gross": finite(baseline_gross.get(ts)) + abs(weight),
        })
        previous_weight = weight
        prior_event_id = str(trade["id"]) if trade else None

    event_rows = list(events.values())
    positives = [max(finite(row["returnPct"]), 0.0) for row in event_rows]
    positive_total = sum(positives)
    alpha_values = [finite(row["alphaReturn"]) for row in rows]
    base_values = [finite(row["baselineReturn"]) for row in rows]
    return {
        "rows": rows,
        "events": event_rows,
        "summary": {
            "count": len(event_rows),
            "years": sorted(set(int(row["entryYear"]) for row in event_rows)),
            "symbols": sorted(set(str(row["symbol"]) for row in event_rows)),
            "winRatePct": sum(finite(row["returnPct"]) > 0 for row in event_rows) / len(event_rows) * 100.0 if event_rows else 0.0,
            "topPositiveEventShare": max(positives, default=0.0) / positive_total if positive_total > 0 else 0.0,
            "alphaBaselineCorrelation": a12.correlation(alpha_values, base_values),
        },
    }


def remove_top_events(simulation: dict, count: int) -> List[dict]:
    events = sorted(simulation["events"], key=lambda row: finite(row["returnPct"]), reverse=True)
    removed = {row["id"] for row in events[:count]}
    rows = []
    for index, row in enumerate(simulation["rows"]):
        value = finite(row["return"])
        for event in simulation["events"]:
            if event["id"] in removed:
                value -= finite(event["byBar"].get(index))
        rows.append({**row, "return": value})
    return rows


def evaluate(config: BearAlphaConfig, raw: dict, baseline: dict, periods: dict) -> dict:
    normal = simulate(config, raw, baseline, "normal")
    severe = simulate(config, raw, baseline, "severe")
    baseline_periods = {
        period: {
            "normal": a12.metrics(baseline["normal"], start, end),
            "severe": a12.metrics(baseline["severe"], start, end),
        }
        for period, (start, end) in periods.items()
    }
    period_rows = {
        period: {
            "normal": a12.metrics(normal["rows"], start, end),
            "severe": a12.metrics(severe["rows"], start, end),
            "alphaNormal": a12.metrics(normal["rows"], start, end, "alphaReturn"),
            "alphaSevere": a12.metrics(severe["rows"], start, end, "alphaReturn"),
        }
        for period, (start, end) in periods.items()
    }
    leave_one_out = {}
    for symbol in SYMBOLS:
        n = simulate(config, raw, baseline, "normal", {symbol})
        s = simulate(config, raw, baseline, "severe", {symbol})
        leave_one_out[symbol] = {
            "normalDelta": a12.metrics(n["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["normal"]["compoundedReturnPct"],
            "severeDelta": a12.metrics(s["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["severe"]["compoundedReturnPct"],
            "events": n["summary"]["count"],
        }
    full = period_rows["full"]
    development = period_rows["development2023_2024"]
    validation = period_rows["validation2025"]
    diagnostic = period_rows["diagnostic2026H1"]
    summary = normal["summary"]
    loo = [finite(item["severeDelta"]) for item in leave_one_out.values()]
    top1 = a12.metrics(remove_top_events(severe, 1), *periods["full"])
    top3 = a12.metrics(remove_top_events(severe, 3), *periods["full"])
    passed = bool(
        full["normal"]["compoundedReturnPct"] > baseline_periods["full"]["normal"]["compoundedReturnPct"]
        and full["severe"]["compoundedReturnPct"] > baseline_periods["full"]["severe"]["compoundedReturnPct"]
        and validation["normal"]["compoundedReturnPct"] >= baseline_periods["validation2025"]["normal"]["compoundedReturnPct"]
        and validation["severe"]["compoundedReturnPct"] >= baseline_periods["validation2025"]["severe"]["compoundedReturnPct"]
        and diagnostic["normal"]["compoundedReturnPct"] >= baseline_periods["diagnostic2026H1"]["normal"]["compoundedReturnPct"]
        and diagnostic["severe"]["compoundedReturnPct"] >= baseline_periods["diagnostic2026H1"]["severe"]["compoundedReturnPct"]
        and development["alphaSevere"]["compoundedReturnPct"] > 0
        and validation["alphaSevere"]["compoundedReturnPct"] >= 0
        and diagnostic["alphaSevere"]["compoundedReturnPct"] >= 0
        and full["normal"]["maxDrawdownPct"] >= baseline_periods["full"]["normal"]["maxDrawdownPct"] - 1.5
        and int(summary["count"]) >= 10
        and len(summary["years"]) >= 3
        and len(summary["symbols"]) >= 2
        and finite(summary["topPositiveEventShare"]) <= 0.40
        and abs(finite(summary["alphaBaselineCorrelation"])) <= 0.60
        and sum(value >= 0 for value in loo) >= 2
        and min(loo, default=0.0) >= -1.0
        and top1["compoundedReturnPct"] >= baseline_periods["full"]["severe"]["compoundedReturnPct"]
        and top3["compoundedReturnPct"] >= baseline_periods["full"]["severe"]["compoundedReturnPct"] - 1.0
    )
    return {
        "config": asdict(config),
        "screenPass": passed,
        "periods": period_rows,
        "baseline": baseline_periods,
        "summary": summary,
        "leaveOneSymbolOut": leave_one_out,
        "removeTop1Severe": top1,
        "removeTop3Severe": top3,
        "fullNormalDeltaPctPoints": full["normal"]["compoundedReturnPct"] - baseline_periods["full"]["normal"]["compoundedReturnPct"],
        "fullSevereDeltaPctPoints": full["severe"]["compoundedReturnPct"] - baseline_periods["full"]["severe"]["compoundedReturnPct"],
        "validationNormalDeltaPctPoints": validation["normal"]["compoundedReturnPct"] - baseline_periods["validation2025"]["normal"]["compoundedReturnPct"],
        "validationSevereDeltaPctPoints": validation["severe"]["compoundedReturnPct"] - baseline_periods["validation2025"]["severe"]["compoundedReturnPct"],
        "diagnosticNormalDeltaPctPoints": diagnostic["normal"]["compoundedReturnPct"] - baseline_periods["diagnostic2026H1"]["normal"]["compoundedReturnPct"],
        "diagnosticSevereDeltaPctPoints": diagnostic["severe"]["compoundedReturnPct"] - baseline_periods["diagnostic2026H1"]["severe"]["compoundedReturnPct"],
        "drawdownDeltaPctPoints": full["normal"]["maxDrawdownPct"] - baseline_periods["full"]["normal"]["maxDrawdownPct"],
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    baseline = build_baseline(raw)
    times = baseline["times"]
    periods = {
        "development2023_2024": (times[0], START_2025),
        "validation2025": (START_2025, START_2026),
        "diagnostic2026H1": (START_2026, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }
    evaluations = [evaluate(config, raw, baseline, periods) for config in CANDIDATES]
    family_passes: Dict[str, int] = {}
    for item in evaluations:
        family = str(item["config"]["family"])
        family_passes[family] = family_passes.get(family, 0) + int(bool(item["screenPass"]))
    for item in evaluations:
        family = str(item["config"]["family"])
        item["neighborFamilyPass"] = bool(item["screenPass"] and family_passes.get(family, 0) >= 2)
    evaluations.sort(key=lambda item: (
        item["neighborFamilyPass"],
        item["screenPass"],
        item["fullSevereDeltaPctPoints"],
        item["fullNormalDeltaPctPoints"],
    ), reverse=True)
    result = rounded({
        "strategyId": "V96_INDEPENDENT_BEAR_ALPHA_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "next12hEntry": True,
            "promotionAllowed": False,
        },
        "candidateCount": len(CANDIDATES),
        "screenPassedCount": sum(bool(item["screenPass"]) for item in evaluations),
        "neighborFamilyPassedCount": sum(bool(item["neighborFamilyPass"]) for item in evaluations),
        "evaluations": evaluations,
        "limitations": [
            "2025 and 2026H1 are reused historical evidence.",
            "The alpha shorts only when the frozen Core has no active alt long and is flat or BTC-short.",
            "The frozen Core receives priority under the total Gross cap.",
            "No candidate changes Production in this PR.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-independent-bear-alpha-screen.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Independent Bear Alpha Screen",
        "",
        f"- Candidates: {result['candidateCount']}",
        f"- Screen passed: {result['screenPassedCount']}",
        f"- Neighbor-family passed: {result['neighborFamilyPassedCount']}",
        "- Production changed: **NO**",
        "",
        "| Candidate | Pass | Neighbor | Full N | Full S | 2025 N | 2025 S | 2026 N | 2026 S | DD | Events | Corr |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["evaluations"]:
        summary = item["summary"]
        report.append(
            f"| {item['config']['name']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['neighborFamilyPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['drawdownDeltaPctPoints']} | {summary['count']} | {summary['alphaBaselineCorrelation']} |"
        )
    report.append("")
    report.append("Historical screen only. Forward Shadow remains required.")
    (state_dir / "v96-independent-bear-alpha-screen.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
