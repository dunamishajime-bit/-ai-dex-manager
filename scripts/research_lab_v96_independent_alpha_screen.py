from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import research_lab_v35_weight_band_strong_v95 as v95

core = v95.core
SYMBOLS = ("ETH", "BNB", "SOL")
BAR = 12 * core.HOUR
START_2025 = core.v4.START_2025
START_2026 = core.v4.START_2026


@dataclass(frozen=True)
class AlphaConfig:
    name: str
    family: str
    lookback: int
    hold_bars: int
    gross: float = 0.15
    persistence: int = 0
    mode: str = "FLAT"


CANDIDATES = (
    AlphaConfig("BRK_RETEST_L20_H4_FLAT", "BREAKOUT_RETEST", 20, 4, mode="FLAT"),
    AlphaConfig("BRK_RETEST_L20_H8_FLAT", "BREAKOUT_RETEST", 20, 8, mode="FLAT"),
    AlphaConfig("BRK_RETEST_L40_H4_FLAT", "BREAKOUT_RETEST", 40, 4, mode="FLAT"),
    AlphaConfig("BRK_RETEST_L40_H8_FLAT", "BREAKOUT_RETEST", 40, 8, mode="FLAT"),
    AlphaConfig("RANK_M10_P2_H4_DIV", "RANK_PERSISTENCE", 10, 4, persistence=2, mode="DIVERSIFY"),
    AlphaConfig("RANK_M10_P2_H8_DIV", "RANK_PERSISTENCE", 10, 8, persistence=2, mode="DIVERSIFY"),
    AlphaConfig("RANK_M20_P2_H4_DIV", "RANK_PERSISTENCE", 20, 4, persistence=2, mode="DIVERSIFY"),
    AlphaConfig("RANK_M20_P2_H8_DIV", "RANK_PERSISTENCE", 20, 8, persistence=2, mode="DIVERSIFY"),
    AlphaConfig("RANK_M20_P3_H4_DIV", "RANK_PERSISTENCE", 20, 4, persistence=3, mode="DIVERSIFY"),
    AlphaConfig("RANK_M20_P3_H8_DIV", "RANK_PERSISTENCE", 20, 8, persistence=3, mode="DIVERSIFY"),
)


def finite(value, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def metrics(rows: Sequence[dict], start: int, end: int, field: str = "return") -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    equity = peak = 1.0
    max_dd = 0.0
    wins = losses = 0.0
    positive = 0
    values = []
    for row in active:
        value = finite(row.get(field))
        values.append(value)
        positive += int(value > 0)
        wins += max(value, 0.0)
        losses += max(-value, 0.0)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": wins / losses if losses > 0 else 999.0 if wins > 0 else None,
        "positiveBarsPct": positive / len(values) * 100.0 if values else 0.0,
        "bars": len(values),
    }


def correlation(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or len(left) < 3:
        return 0.0
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_var = sum((a - left_mean) ** 2 for a in left)
    right_var = sum((b - right_mean) ** 2 for b in right)
    denominator = math.sqrt(left_var * right_var)
    return numerator / denominator if denominator > 1e-18 else 0.0


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    if length <= 0 or end - length + 1 < 0:
        return None
    return statistics.fmean(finite(row["close"]) for row in rows[end - length + 1:end + 1])


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    prior = end - length
    if prior < 0:
        return None
    previous = finite(rows[prior]["close"])
    current = finite(rows[end]["close"])
    return current / previous - 1.0 if previous > 0 else None


def price_return(raw: dict, symbol: str, ts: int) -> float:
    index = raw["indexes"][symbol].get(ts)
    if index is None:
        return 0.0
    row = raw["bars"][symbol][index]
    open_price = finite(row["open"])
    close_price = finite(row["close"])
    return close_price / open_price - 1.0 if open_price > 0 else 0.0


def funding_rate(raw: dict, symbol: str, ts: int) -> float:
    return finite(raw["funding"].get(symbol, {}).get(ts)) / 100.0


def btc_gate(raw: dict, ts: int) -> bool:
    index = raw["indexes"]["BTC"].get(ts)
    if index is None:
        return False
    rows = raw["bars"]["BTC"]
    average = sma(rows, index, 120)
    mom = momentum(rows, index, 20)
    if average is None or mom is None:
        return False
    close = finite(rows[index]["close"])
    return close >= average * 0.98 and mom > -0.04


def mode_allows(config: AlphaConfig, baseline_target: Dict[str, float], baseline_gross: float, symbol: str) -> bool:
    if config.mode == "FLAT":
        return baseline_gross <= 0.05
    if config.mode == "DIVERSIFY":
        return abs(finite(baseline_target.get(symbol))) <= 1e-12 and baseline_gross <= 1.60
    return True


def breakout_retest_signal(config: AlphaConfig, raw: dict, ts: int) -> Optional[str]:
    if not btc_gate(raw, ts):
        return None
    for symbol in SYMBOLS:
        index = raw["indexes"][symbol].get(ts)
        if index is None or index < config.lookback + 2:
            continue
        rows = raw["bars"][symbol]
        breakout_index = index - 1
        prior = rows[breakout_index - config.lookback:breakout_index]
        if len(prior) != config.lookback:
            continue
        level = max(finite(row["high"]) for row in prior)
        breakout = rows[breakout_index]
        retest = rows[index]
        if level <= 0:
            continue
        breakout_ok = finite(breakout["close"]) > level * 1.002
        retest_ok = (
            finite(retest["low"]) <= level * 1.012
            and finite(retest["close"]) >= level
            and finite(retest["close"]) > finite(retest["open"])
        )
        volume_ok = finite(retest.get("volume")) >= statistics.fmean(
            finite(row.get("volume")) for row in rows[index - 20:index]
        ) * 0.70
        if breakout_ok and retest_ok and volume_ok:
            return symbol
    return None


def rank_at(config: AlphaConfig, raw: dict, ts: int) -> Optional[str]:
    scores: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        index = raw["indexes"][symbol].get(ts)
        if index is None or index < max(config.lookback, 44):
            return None
        rows = raw["bars"][symbol]
        mom = momentum(rows, index, config.lookback)
        average = sma(rows, index, 44)
        if mom is None or average is None:
            return None
        close = finite(rows[index]["close"])
        if mom > 0 and close > average:
            scores.append((symbol, mom))
    return max(scores, key=lambda item: item[1])[0] if scores else None


def rank_persistence_signal(config: AlphaConfig, raw: dict, times: List[int], position: int) -> Optional[str]:
    if not btc_gate(raw, times[position]):
        return None
    if position - config.persistence + 1 < 0:
        return None
    ranks = [
        rank_at(config, raw, times[index])
        for index in range(position - config.persistence + 1, position + 1)
    ]
    if not ranks or any(rank is None for rank in ranks):
        return None
    return ranks[-1] if len(set(ranks)) == 1 else None


def build_baseline(raw: dict) -> dict:
    times = list(raw["times"])
    targets, target_diag = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(
        times, targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    config = core.CoreConfig()
    base_rows = core.core_rows(config, times, base_core, features)
    severe_rows = core.core_rows(config, times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)
    normal, normal_diag = v95.v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe, severe_diag = v95.v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    return {
        "times": times,
        "targets": targets,
        "normal": normal,
        "severe": severe,
        "targetDiagnostics": target_diag,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def generate_trades(
    config: AlphaConfig,
    raw: dict,
    baseline: dict,
    delay_bars: int,
    excluded: Set[str],
) -> List[dict]:
    times = baseline["times"]
    baseline_rows = {int(row["ts"]): row for row in baseline["normal"]}
    trades = []
    next_free = 0
    sequence = 0
    warmup = max(130, config.lookback + config.persistence + 2)
    for position in range(warmup, len(times) - config.hold_bars - delay_bars - 1):
        if position < next_free:
            continue
        ts = times[position]
        if config.family == "BREAKOUT_RETEST":
            symbol = breakout_retest_signal(config, raw, ts)
        else:
            symbol = rank_persistence_signal(config, raw, times, position)
        if symbol is None or symbol in excluded:
            continue
        baseline_target = baseline["targets"].get(ts, {})
        baseline_gross = finite(baseline_rows.get(ts, {}).get("gross"))
        if not mode_allows(config, baseline_target, baseline_gross, symbol):
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
    config: AlphaConfig,
    raw: dict,
    baseline: dict,
    scenario: str,
    excluded: Set[str] | None = None,
) -> dict:
    excluded = excluded or set()
    severe = scenario == "severe"
    baseline_rows = baseline["severe" if severe else "normal"]
    delay = 1 if severe else 0
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0
    trades = generate_trades(config, raw, baseline, delay, excluded)
    active_by_ts: Dict[int, dict] = {}
    for trade in trades:
        for ts in baseline["times"]:
            if int(trade["entryTs"]) <= ts < int(trade["exitTs"]):
                active_by_ts[ts] = trade
    previous_weight = 0.0
    rows = []
    event_values: Dict[str, float] = {trade["id"]: 0.0 for trade in trades}
    event_by_bar: Dict[str, Dict[int, float]] = {trade["id"]: {} for trade in trades}
    overlap_bars = flat_bars = 0
    for index, base in enumerate(baseline_rows):
        ts = int(base["ts"])
        trade = active_by_ts.get(ts)
        requested = config.gross if trade else 0.0
        available = max(0.0, 2.0 - finite(base.get("gross")))
        weight = min(requested, available)
        alpha = 0.0
        if trade and weight > 0:
            symbol = str(trade["symbol"])
            alpha = (
                weight * price_return(raw, symbol, ts)
                - weight * funding_rate(raw, symbol, ts)
                - abs(weight - previous_weight) * cost_bps / 10_000.0
                - abs(weight) * adverse_bps / 10_000.0
            )
            overlap_bars += int(finite(base.get("gross")) > 0.05)
            flat_bars += int(finite(base.get("gross")) <= 0.05)
            event_values[trade["id"]] += alpha
            event_by_bar[trade["id"]][index] = alpha
        elif previous_weight > 0:
            alpha -= previous_weight * cost_bps / 10_000.0
        rows.append({
            "ts": ts,
            "return": finite(base.get("return")) + alpha,
            "baselineReturn": finite(base.get("return")),
            "alphaReturn": alpha,
            "gross": finite(base.get("gross")) + weight,
        })
        previous_weight = weight

    event_rows = []
    for trade in trades:
        value = finite(event_values.get(trade["id"]))
        event_rows.append({**trade, "returnPct": value * 100.0, "byBar": event_by_bar[trade["id"]]})
    positives = [max(finite(row["returnPct"]), 0.0) for row in event_rows]
    positive_total = sum(positives)
    top_share = max(positives, default=0.0) / positive_total if positive_total > 0 else 0.0
    alpha_values = [finite(row["alphaReturn"]) for row in rows]
    baseline_values = [finite(row["baselineReturn"]) for row in rows]
    return {
        "rows": rows,
        "events": event_rows,
        "summary": {
            "count": len(event_rows),
            "years": sorted(set(int(row["entryYear"]) for row in event_rows)),
            "symbols": sorted(set(str(row["symbol"]) for row in event_rows)),
            "winRatePct": sum(finite(row["returnPct"]) > 0 for row in event_rows) / len(event_rows) * 100.0 if event_rows else 0.0,
            "topPositiveEventShare": top_share,
            "alphaBaselineCorrelation": correlation(alpha_values, baseline_values),
            "activeOverlapBars": overlap_bars,
            "activeFlatBars": flat_bars,
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


def evaluate_candidate(config: AlphaConfig, raw: dict, baseline: dict, periods: dict) -> dict:
    normal = simulate(config, raw, baseline, "normal")
    severe = simulate(config, raw, baseline, "severe")
    baseline_periods = {
        period: {
            "normal": metrics(baseline["normal"], start, end),
            "severe": metrics(baseline["severe"], start, end),
        }
        for period, (start, end) in periods.items()
    }
    result_periods = {
        period: {
            "normal": metrics(normal["rows"], start, end),
            "severe": metrics(severe["rows"], start, end),
            "alphaNormal": metrics(normal["rows"], start, end, "alphaReturn"),
            "alphaSevere": metrics(severe["rows"], start, end, "alphaReturn"),
        }
        for period, (start, end) in periods.items()
    }
    leave_one_out = {}
    for symbol in SYMBOLS:
        n = simulate(config, raw, baseline, "normal", {symbol})
        s = simulate(config, raw, baseline, "severe", {symbol})
        leave_one_out[symbol] = {
            "normalDelta": metrics(n["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["normal"]["compoundedReturnPct"],
            "severeDelta": metrics(s["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["severe"]["compoundedReturnPct"],
            "events": n["summary"]["count"],
        }

    full = result_periods["full"]
    validation = result_periods["validation2025"]
    diagnostic = result_periods["diagnostic2026H1"]
    development = result_periods["development2023_2024"]
    summary = normal["summary"]
    loo_severe = [finite(item["severeDelta"]) for item in leave_one_out.values()]
    top1 = metrics(remove_top_events(severe, 1), *periods["full"])
    top3 = metrics(remove_top_events(severe, 3), *periods["full"])
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
        and sum(value >= 0 for value in loo_severe) >= 2
        and min(loo_severe, default=0.0) >= -1.0
        and top1["compoundedReturnPct"] >= baseline_periods["full"]["severe"]["compoundedReturnPct"]
        and top3["compoundedReturnPct"] >= baseline_periods["full"]["severe"]["compoundedReturnPct"] - 1.0
    )
    return {
        "config": asdict(config),
        "screenPass": passed,
        "periods": result_periods,
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
    evaluations = [evaluate_candidate(config, raw, baseline, periods) for config in CANDIDATES]
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
        "strategyId": "V96_INDEPENDENT_ALPHA_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "parameterFamilyPredeclared": True,
            "promotionAllowed": False,
        },
        "candidateCount": len(CANDIDATES),
        "screenPassedCount": sum(bool(item["screenPass"]) for item in evaluations),
        "neighborFamilyPassedCount": sum(bool(item["neighborFamilyPass"]) for item in evaluations),
        "evaluations": evaluations,
        "limitations": [
            "2025 and 2026H1 are reused historical evidence, not pristine Forward evidence.",
            "Both families use completed 12-hour bars; a future 4-hour family remains separate work.",
            "Alpha is clipped before the frozen Core when the total Gross cap is reached.",
            "No candidate changes Production in this PR.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-independent-alpha-screen.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V96 Independent Alpha Screen",
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
    report.append("Historical screen only. Forward Shadow is required before any promotion.")
    (state_dir / "v96-independent-alpha-screen.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
