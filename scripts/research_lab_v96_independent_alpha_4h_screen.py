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
HOUR = core.HOUR
BAR4 = 4 * HOUR
BAR12 = 12 * HOUR
START_2025 = core.v4.START_2025
START_2026 = core.v4.START_2026


@dataclass(frozen=True)
class Alpha4hConfig:
    name: str
    family: str
    lookback: int
    hold_bars: int
    gross: float = 0.10
    persistence: int = 0
    mode: str = "FLAT"


CANDIDATES = (
    Alpha4hConfig("4H_BRK_RETEST_L30_H6_FLAT", "BREAKOUT_RETEST", 30, 6, mode="FLAT"),
    Alpha4hConfig("4H_BRK_RETEST_L30_H12_FLAT", "BREAKOUT_RETEST", 30, 12, mode="FLAT"),
    Alpha4hConfig("4H_BRK_RETEST_L60_H6_FLAT", "BREAKOUT_RETEST", 60, 6, mode="FLAT"),
    Alpha4hConfig("4H_BRK_RETEST_L60_H12_FLAT", "BREAKOUT_RETEST", 60, 12, mode="FLAT"),
    Alpha4hConfig("4H_RESUME_L30_H6_DIV", "TREND_RESUMPTION", 30, 6, mode="DIVERSIFY"),
    Alpha4hConfig("4H_RESUME_L30_H12_DIV", "TREND_RESUMPTION", 30, 12, mode="DIVERSIFY"),
    Alpha4hConfig("4H_RANK_M30_P3_H6_DIV", "RANK_PERSISTENCE", 30, 6, persistence=3, mode="DIVERSIFY"),
    Alpha4hConfig("4H_RANK_M30_P3_H12_DIV", "RANK_PERSISTENCE", 30, 12, persistence=3, mode="DIVERSIFY"),
    Alpha4hConfig("4H_RANK_M60_P3_H6_DIV", "RANK_PERSISTENCE", 60, 6, persistence=3, mode="DIVERSIFY"),
    Alpha4hConfig("4H_RANK_M60_P3_H12_DIV", "RANK_PERSISTENCE", 60, 12, persistence=3, mode="DIVERSIFY"),
)


def finite(value, fallback: float = 0.0) -> float:
    return a12.finite(value, fallback)


def rounded(value):
    return a12.rounded(value)


def bucket12(ts: int) -> int:
    return ts // BAR12 * BAR12


def resample(candles: List[dict], hours: int) -> List[dict]:
    bucket_ms = hours * HOUR
    groups: Dict[int, List[dict]] = {}
    for candle in candles:
        ts = int(candle["ts"])
        groups.setdefault(ts // bucket_ms * bucket_ms, []).append(candle)
    rows = []
    for ts, items in sorted(groups.items()):
        items = sorted(items, key=lambda row: int(row["ts"]))
        if len(items) != hours:
            continue
        rows.append({
            "ts": ts,
            "open": finite(items[0]["open"]),
            "high": max(finite(row["high"]) for row in items),
            "low": min(finite(row["low"]) for row in items),
            "close": finite(items[-1]["close"]),
            "volume": sum(finite(row.get("volume")) for row in items),
        })
    return rows


def build_raw_extended() -> dict:
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    hourly = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars12 = {symbol: core.v4.resample_12h(hourly[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes12 = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars12.items()
    }
    funding12 = core.v6.funding_buckets({
        symbol: hourly[symbol]["funding"] for symbol in core.v4.SYMBOLS
    })
    times12 = [
        int(row["ts"]) for row in bars12["BTC"]
        if core.CORE_START <= int(row["ts"]) < core.CORE_END
    ]
    projected = core.v6.precompute_projected_members(
        core.v20.COMPONENTS, times12, bars12, indexes12
    )
    base_map = {
        ts: core.v4.overlay_target(core.v20.OVERLAY, ts, projected[ts], bars12, indexes12)
        for ts in times12
    }
    bear_map = core.v6.precompute_bear_targets(
        [core.v20.HEDGE], times12, bars12, indexes12
    )[core.v20.HEDGE.hedge_id]
    targets = core.v28.combo_targets(
        "VWM25_SKEW125", base_map, bear_map, times12, bars12, indexes12, funding12
    )
    bars4 = {symbol: resample(hourly[symbol]["candles"], 4) for symbol in ("BTC", *SYMBOLS)}
    indexes4 = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars4.items()
    }
    common4 = [
        int(row["ts"]) for row in bars4["BTC"]
        if core.CORE_START <= int(row["ts"]) < core.CORE_END
        and all(int(row["ts"]) in indexes4[symbol] for symbol in SYMBOLS)
    ]
    funding4: Dict[str, Dict[int, float]] = {}
    for symbol in SYMBOLS:
        grouped: Dict[int, float] = {}
        for point in hourly[symbol]["funding"]:
            ts = int(point.get("ts", point.get("fundingTime", 0)) or 0)
            rate = finite(point.get("rate", point.get("fundingRate", 0.0)))
            grouped[ts // BAR4 * BAR4] = grouped.get(ts // BAR4 * BAR4, 0.0) + rate
        funding4[symbol] = grouped
    return {
        "hourly": hourly,
        "bars": bars12,
        "indexes": indexes12,
        "funding": funding12,
        "times": times12,
        "targets": targets,
        "bars4": bars4,
        "indexes4": indexes4,
        "times4": common4,
        "funding4": funding4,
    }


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    return a12.sma(rows, end, length)


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    return a12.momentum(rows, end, length)


def btc_gate(raw: dict, ts: int) -> bool:
    index = raw["indexes4"]["BTC"].get(ts)
    if index is None:
        return False
    rows = raw["bars4"]["BTC"]
    average = sma(rows, index, 180)
    mom = momentum(rows, index, 30)
    if average is None or mom is None:
        return False
    return finite(rows[index]["close"]) >= average * 0.98 and mom > -0.04


def baseline_snapshot(baseline: dict, ts: int) -> Tuple[Dict[str, float], float]:
    key = bucket12(ts)
    target = dict(baseline["targets"].get(key, {}))
    return target, finite(baseline["normalGross"].get(key))


def mode_allows(config: Alpha4hConfig, baseline: dict, ts: int, symbol: str) -> bool:
    target, current_gross = baseline_snapshot(baseline, ts)
    if config.mode == "FLAT":
        return current_gross <= 0.05
    if config.mode == "DIVERSIFY":
        return abs(finite(target.get(symbol))) <= 1e-12 and current_gross <= 1.60
    return True


def breakout_retest_signal(config: Alpha4hConfig, raw: dict, ts: int) -> Optional[str]:
    if not btc_gate(raw, ts):
        return None
    for symbol in SYMBOLS:
        index = raw["indexes4"][symbol].get(ts)
        if index is None or index < config.lookback + 2:
            continue
        rows = raw["bars4"][symbol]
        breakout_index = index - 1
        prior = rows[breakout_index - config.lookback:breakout_index]
        level = max((finite(row["high"]) for row in prior), default=0.0)
        breakout = rows[breakout_index]
        retest = rows[index]
        if level <= 0:
            continue
        breakout_ok = finite(breakout["close"]) > level * 1.001
        retest_ok = (
            finite(retest["low"]) <= level * 1.008
            and finite(retest["close"]) >= level
            and finite(retest["close"]) > finite(retest["open"])
        )
        base_volume = statistics.fmean(
            finite(row.get("volume")) for row in rows[index - 30:index]
        )
        if breakout_ok and retest_ok and finite(retest.get("volume")) >= base_volume * 0.70:
            return symbol
    return None


def trend_resumption_signal(config: Alpha4hConfig, raw: dict, ts: int) -> Optional[str]:
    if not btc_gate(raw, ts):
        return None
    candidates: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        index = raw["indexes4"][symbol].get(ts)
        if index is None or index < max(config.lookback, 60) + 3:
            continue
        rows = raw["bars4"][symbol]
        mom = momentum(rows, index, config.lookback)
        average = sma(rows, index, 60)
        if mom is None or average is None:
            continue
        previous1 = rows[index - 1]
        previous2 = rows[index - 2]
        current = rows[index]
        pullback = (
            finite(previous1["close"]) < finite(previous1["open"])
            and finite(previous2["close"]) < finite(previous2["open"])
        )
        resume = (
            finite(current["close"]) > finite(current["open"])
            and finite(current["close"]) > finite(previous1["high"])
        )
        if mom > 0 and finite(current["close"]) > average and pullback and resume:
            candidates.append((symbol, mom))
    return max(candidates, key=lambda item: item[1])[0] if candidates else None


def rank_at(config: Alpha4hConfig, raw: dict, ts: int) -> Optional[str]:
    scores: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        index = raw["indexes4"][symbol].get(ts)
        if index is None or index < max(config.lookback, 60):
            return None
        rows = raw["bars4"][symbol]
        mom = momentum(rows, index, config.lookback)
        average = sma(rows, index, 60)
        if mom is None or average is None:
            return None
        if mom > 0 and finite(rows[index]["close"]) > average:
            scores.append((symbol, mom))
    return max(scores, key=lambda item: item[1])[0] if scores else None


def rank_signal(config: Alpha4hConfig, raw: dict, position: int) -> Optional[str]:
    times = raw["times4"]
    if not btc_gate(raw, times[position]) or position - config.persistence + 1 < 0:
        return None
    ranks = [
        rank_at(config, raw, times[index])
        for index in range(position - config.persistence + 1, position + 1)
    ]
    return ranks[-1] if ranks and all(rank is not None for rank in ranks) and len(set(ranks)) == 1 else None


def build_baseline(raw: dict) -> dict:
    baseline = a12.build_baseline(raw)
    baseline["normalGross"] = {int(row["ts"]): finite(row.get("gross")) for row in baseline["normal"]}
    baseline["severeGross"] = {int(row["ts"]): finite(row.get("gross")) for row in baseline["severe"]}
    baseline["normalReturn"] = {int(row["ts"]): finite(row.get("return")) for row in baseline["normal"]}
    baseline["severeReturn"] = {int(row["ts"]): finite(row.get("return")) for row in baseline["severe"]}
    return baseline


def generate_trades(
    config: Alpha4hConfig,
    raw: dict,
    baseline: dict,
    delay_bars: int,
    excluded: Set[str],
) -> List[dict]:
    times = raw["times4"]
    trades = []
    next_free = 0
    sequence = 0
    warmup = max(200, config.lookback + config.persistence + 3)
    for position in range(warmup, len(times) - config.hold_bars - delay_bars - 1):
        if position < next_free:
            continue
        ts = times[position]
        if config.family == "BREAKOUT_RETEST":
            symbol = breakout_retest_signal(config, raw, ts)
        elif config.family == "TREND_RESUMPTION":
            symbol = trend_resumption_signal(config, raw, ts)
        else:
            symbol = rank_signal(config, raw, position)
        if symbol is None or symbol in excluded or not mode_allows(config, baseline, ts, symbol):
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


def price_return4(raw: dict, symbol: str, ts: int) -> float:
    index = raw["indexes4"][symbol].get(ts)
    if index is None:
        return 0.0
    row = raw["bars4"][symbol][index]
    opening = finite(row["open"])
    return finite(row["close"]) / opening - 1.0 if opening > 0 else 0.0


def simulate(
    config: Alpha4hConfig,
    raw: dict,
    baseline: dict,
    scenario: str,
    excluded: Set[str] | None = None,
) -> dict:
    excluded = excluded or set()
    severe = scenario == "severe"
    delay = 1 if severe else 0
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 1.0 if severe else 0.0
    trades = generate_trades(config, raw, baseline, delay, excluded)
    active_by_ts: Dict[int, dict] = {}
    for trade in trades:
        for ts in raw["times4"]:
            if int(trade["entryTs"]) <= ts < int(trade["exitTs"]):
                active_by_ts[ts] = trade

    baseline_gross = baseline["severeGross" if severe else "normalGross"]
    baseline_return = baseline["severeReturn" if severe else "normalReturn"]
    previous_weight = 0.0
    alpha4: Dict[int, float] = {}
    events = {trade["id"]: {**trade, "returnPct": 0.0, "byBucket": {}} for trade in trades}
    overlap = flat = 0
    prior_event_id: Optional[str] = None
    for ts in raw["times4"]:
        bucket = bucket12(ts)
        trade = active_by_ts.get(ts)
        requested = config.gross if trade else 0.0
        available = max(0.0, 2.0 - finite(baseline_gross.get(bucket)))
        weight = min(requested, available)
        value = 0.0
        event_id = str(trade["id"]) if trade else None
        if trade and weight > 0:
            symbol = str(trade["symbol"])
            value = (
                weight * price_return4(raw, symbol, ts)
                - weight * finite(raw["funding4"].get(symbol, {}).get(ts))
                - abs(weight - previous_weight) * cost_bps / 10_000.0
                - abs(weight) * adverse_bps / 10_000.0
            )
            overlap += int(finite(baseline_gross.get(bucket)) > 0.05)
            flat += int(finite(baseline_gross.get(bucket)) <= 0.05)
        elif previous_weight > 0:
            value -= previous_weight * cost_bps / 10_000.0
            event_id = prior_event_id
        alpha4[ts] = value
        if event_id and event_id in events:
            events[event_id]["returnPct"] += value * 100.0
            events[event_id]["byBucket"][bucket] = finite(events[event_id]["byBucket"].get(bucket)) + value
        previous_weight = weight
        prior_event_id = str(trade["id"]) if trade else None

    alpha12: Dict[int, float] = {}
    for ts, value in alpha4.items():
        alpha12[bucket12(ts)] = alpha12.get(bucket12(ts), 0.0) + value
    rows = []
    for ts in baseline["times"]:
        alpha = finite(alpha12.get(ts))
        base = finite(baseline_return.get(ts))
        rows.append({
            "ts": ts,
            "return": base + alpha,
            "baselineReturn": base,
            "alphaReturn": alpha,
            "gross": finite(baseline_gross.get(ts)),
        })

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
            "activeOverlap4hBars": overlap,
            "activeFlat4hBars": flat,
        },
    }


def remove_top_events(simulation: dict, count: int) -> List[dict]:
    events = sorted(simulation["events"], key=lambda row: finite(row["returnPct"]), reverse=True)
    removed = {row["id"] for row in events[:count]}
    rows = []
    for row in simulation["rows"]:
        value = finite(row["return"])
        ts = int(row["ts"])
        for event in simulation["events"]:
            if event["id"] in removed:
                value -= finite(event["byBucket"].get(ts))
        rows.append({**row, "return": value})
    return rows


def evaluate(config: Alpha4hConfig, raw: dict, baseline: dict, periods: dict) -> dict:
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
        and int(summary["count"]) >= 15
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
    raw = build_raw_extended()
    baseline = build_baseline(raw)
    times = baseline["times"]
    periods = {
        "development2023_2024": (times[0], START_2025),
        "validation2025": (START_2025, START_2026),
        "diagnostic2026H1": (START_2026, times[-1] + BAR12),
        "full": (times[0], times[-1] + BAR12),
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
        "strategyId": "V96_INDEPENDENT_ALPHA_4H_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "completed4hChronology": True,
            "next4hEntry": True,
            "promotionAllowed": False,
        },
        "candidateCount": len(CANDIDATES),
        "screenPassedCount": sum(bool(item["screenPass"]) for item in evaluations),
        "neighborFamilyPassedCount": sum(bool(item["neighborFamilyPass"]) for item in evaluations),
        "evaluations": evaluations,
        "limitations": [
            "2025 and 2026H1 are reused historical evidence.",
            "The Severe scenario uses one completed 4-hour execution delay, 50 bps turnover cost and 1 bp adverse movement per active 4-hour bar.",
            "The frozen Core receives priority under the total Gross cap.",
            "No candidate changes Production in this PR.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-independent-alpha-4h-screen.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Independent Alpha 4h Screen",
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
    (state_dir / "v96-independent-alpha-4h-screen.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
