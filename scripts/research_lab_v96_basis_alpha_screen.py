from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import research_lab_v96_independent_alpha_screen as base
import research_lab_v35_weight_band_strong_v95 as v95

ASTER_BASE = "https://fapi.asterdex.com"
SYMBOLS = ("ETH", "BNB", "SOL")
PAIRS = {symbol: f"{symbol}USDT" for symbol in SYMBOLS}
BAR = 12 * v95.core.HOUR
START_2025 = v95.core.v4.START_2025
START_2026 = v95.core.v4.START_2026


@dataclass(frozen=True)
class PremiumConfig:
    name: str
    family: str
    mode: str
    window: int
    hold_bars: int
    threshold: float
    gross: float = 0.10


CANDIDATES = (
    PremiumConfig("PREM_FADE_W60_Z1P5_H1", "FADE", "FADE", 60, 1, 1.5),
    PremiumConfig("PREM_FADE_W60_Z1P5_H2", "FADE", "FADE", 60, 2, 1.5),
    PremiumConfig("PREM_FADE_W60_Z1P5_H4", "FADE", "FADE", 60, 4, 1.5),
    PremiumConfig("PREM_FADE_W60_Z2_H1", "FADE", "FADE", 60, 1, 2.0),
    PremiumConfig("PREM_FADE_W60_Z2_H2", "FADE", "FADE", 60, 2, 2.0),
    PremiumConfig("PREM_FADE_W60_Z2_H4", "FADE", "FADE", 60, 4, 2.0),
    PremiumConfig("PREM_FADE_W120_Z1P5_H2", "FADE", "FADE", 120, 2, 1.5),
    PremiumConfig("PREM_FADE_W120_Z2_H2", "FADE", "FADE", 120, 2, 2.0),
    PremiumConfig("PREM_FUND_W60_Z1P5_H2", "FUND_CONFIRM", "FUND_CONFIRM", 60, 2, 1.5),
    PremiumConfig("PREM_FUND_W60_Z1P5_H4", "FUND_CONFIRM", "FUND_CONFIRM", 60, 4, 1.5),
    PremiumConfig("PREM_FUND_W60_Z2_H2", "FUND_CONFIRM", "FUND_CONFIRM", 60, 2, 2.0),
    PremiumConfig("PREM_FUND_W60_Z2_H4", "FUND_CONFIRM", "FUND_CONFIRM", 60, 4, 2.0),
    PremiumConfig("PREM_SPREAD_W60_Z2P5_H1", "SPREAD", "SPREAD", 60, 1, 2.5),
    PremiumConfig("PREM_SPREAD_W60_Z2P5_H2", "SPREAD", "SPREAD", 60, 2, 2.5),
    PremiumConfig("PREM_SPREAD_W60_Z2P5_H4", "SPREAD", "SPREAD", 60, 4, 2.5),
    PremiumConfig("PREM_SPREAD_W60_Z3P5_H1", "SPREAD", "SPREAD", 60, 1, 3.5),
    PremiumConfig("PREM_SPREAD_W60_Z3P5_H2", "SPREAD", "SPREAD", 60, 2, 3.5),
    PremiumConfig("PREM_SPREAD_W60_Z3P5_H4", "SPREAD", "SPREAD", 60, 4, 3.5),
)


def finite(value: object, fallback: float = 0.0) -> float:
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


def fetch_json(path: str, params: dict, timeout: int = 30):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{ASTER_BASE}{path}?{query}",
        headers={"User-Agent": "DisDex-V96-Basis-Research/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_price_klines(path: str, parameter: str, pair: str, start: int, end: int) -> Dict[int, float]:
    cursor = start
    result: Dict[int, float] = {}
    empty = 0
    while cursor < end:
        payload = fetch_json(path, {
            parameter: pair,
            "interval": "12h",
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"unexpected {path} payload for {pair}: {type(payload).__name__}")
        if not payload:
            empty += 1
            cursor += 90 * 24 * v95.core.HOUR
            if empty > 12:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, list) and len(item) >= 5:
                ts = int(item[0])
                if start <= ts < end:
                    result[ts] = finite(item[4])
        last_ts = int(payload[-1][0])
        next_cursor = last_ts + BAR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.05)
    return result


def build_premiums(times: Sequence[int]) -> Tuple[Dict[str, Dict[int, float]], dict]:
    start = int(times[0])
    end = int(times[-1]) + BAR
    premiums: Dict[str, Dict[int, float]] = {}
    coverage = {}
    for symbol, pair in PAIRS.items():
        mark = fetch_price_klines("/fapi/v1/markPriceKlines", "symbol", pair, start, end)
        index = fetch_price_klines("/fapi/v1/indexPriceKlines", "pair", pair, start, end)
        common = sorted(set(mark) & set(index) & set(times))
        premiums[symbol] = {
            ts: mark[ts] / index[ts] - 1.0
            for ts in common
            if index[ts] > 0 and mark[ts] > 0
        }
        coverage[symbol] = {
            "markRows": len(mark),
            "indexRows": len(index),
            "commonRows": len(premiums[symbol]),
            "coveragePct": len(premiums[symbol]) / len(times) * 100.0 if times else 0.0,
            "firstTs": min(premiums[symbol], default=None),
            "lastTs": max(premiums[symbol], default=None),
        }
    return premiums, coverage


def zscore(values: Sequence[float]) -> Optional[float]:
    if len(values) < 20:
        return None
    deviation = statistics.pstdev(values)
    if deviation <= 1e-12:
        return None
    return (values[-1] - statistics.fmean(values)) / deviation


def premium_z(
    premiums: Dict[str, Dict[int, float]],
    symbol: str,
    times: Sequence[int],
    position: int,
    window: int,
) -> Optional[float]:
    if position - window + 1 < 0:
        return None
    sample = []
    for index in range(position - window + 1, position + 1):
        value = premiums.get(symbol, {}).get(int(times[index]))
        if value is None:
            return None
        sample.append(value)
    return zscore(sample)


def signal(
    config: PremiumConfig,
    raw: dict,
    premiums: Dict[str, Dict[int, float]],
    times: Sequence[int],
    position: int,
    excluded: Set[str],
) -> Optional[Dict[str, float]]:
    ts = int(times[position])
    values: List[Tuple[str, float]] = []
    for symbol in SYMBOLS:
        if symbol in excluded:
            continue
        value = premium_z(premiums, symbol, times, position, config.window)
        if value is not None:
            values.append((symbol, value))
    if not values:
        return None
    if config.mode in {"FADE", "FUND_CONFIRM"}:
        symbol, value = max(values, key=lambda item: abs(item[1]))
        if abs(value) < config.threshold:
            return None
        if config.mode == "FUND_CONFIRM":
            funding = base.funding_rate(raw, symbol, ts)
            if value > 0 and funding <= 0:
                return None
            if value < 0 and funding >= 0:
                return None
        return {symbol: -config.gross if value > 0 else config.gross}
    if config.mode == "SPREAD":
        if len(values) < 2:
            return None
        low = min(values, key=lambda item: item[1])
        high = max(values, key=lambda item: item[1])
        if high[1] - low[1] < config.threshold:
            return None
        each = config.gross / 2.0
        return {low[0]: each, high[0]: -each}
    raise ValueError(f"unknown premium mode: {config.mode}")


def generate_trades(
    config: PremiumConfig,
    raw: dict,
    baseline: dict,
    premiums: Dict[str, Dict[int, float]],
    delay_bars: int,
    excluded: Set[str],
) -> List[dict]:
    times = baseline["times"]
    trades: List[dict] = []
    next_free = 0
    sequence = 0
    warmup = max(130, config.window)
    for position in range(warmup, len(times) - config.hold_bars - delay_bars - 1):
        if position < next_free:
            continue
        weights = signal(config, raw, premiums, times, position, excluded)
        if not weights:
            continue
        entry_index = position + 1 + delay_bars
        exit_index = entry_index + config.hold_bars
        if exit_index >= len(times):
            continue
        sequence += 1
        trades.append({
            "id": f"{config.name}-{sequence}",
            "signalTs": times[position],
            "entryTs": times[entry_index],
            "exitTs": times[exit_index],
            "entryYear": dt.datetime.fromtimestamp(times[entry_index] / 1000, tz=dt.timezone.utc).year,
            "weights": weights,
            "symbols": sorted(weights),
        })
        next_free = exit_index
    return trades


def simulate(
    config: PremiumConfig,
    raw: dict,
    baseline: dict,
    premiums: Dict[str, Dict[int, float]],
    scenario: str,
    excluded: Set[str] | None = None,
) -> dict:
    excluded = excluded or set()
    severe = scenario == "severe"
    baseline_rows = baseline["severe" if severe else "normal"]
    delay = 1 if severe else 0
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0
    trades = generate_trades(config, raw, baseline, premiums, delay, excluded)
    active_by_ts: Dict[int, dict] = {}
    for trade in trades:
        for ts in baseline["times"]:
            if int(trade["entryTs"]) <= ts < int(trade["exitTs"]):
                active_by_ts[ts] = trade
    previous: Dict[str, float] = {}
    rows: List[dict] = []
    event_values: Dict[str, float] = {trade["id"]: 0.0 for trade in trades}
    event_by_bar: Dict[str, Dict[int, float]] = {trade["id"]: {} for trade in trades}
    for index, base_row in enumerate(baseline_rows):
        ts = int(base_row["ts"])
        trade = active_by_ts.get(ts)
        requested = dict(trade["weights"]) if trade else {}
        requested_gross = sum(abs(weight) for weight in requested.values())
        available = max(0.0, 2.0 - finite(base_row.get("gross")))
        scale = min(1.0, available / requested_gross) if requested_gross > 0 else 0.0
        weights = {symbol: weight * scale for symbol, weight in requested.items()}
        alpha = 0.0
        for symbol in set(previous) | set(weights):
            weight = finite(weights.get(symbol))
            old = finite(previous.get(symbol))
            alpha += weight * base.price_return(raw, symbol, ts)
            alpha -= weight * base.funding_rate(raw, symbol, ts)
            alpha -= abs(weight - old) * cost_bps / 10_000.0
            alpha -= abs(weight) * adverse_bps / 10_000.0
        if trade:
            event_values[trade["id"]] += alpha
            event_by_bar[trade["id"]][index] = alpha
        rows.append({
            "ts": ts,
            "return": finite(base_row.get("return")) + alpha,
            "baselineReturn": finite(base_row.get("return")),
            "alphaReturn": alpha,
            "gross": finite(base_row.get("gross")) + sum(abs(weight) for weight in weights.values()),
        })
        previous = weights
    event_rows = []
    symbol_set: Set[str] = set()
    for trade in trades:
        symbol_set.update(str(symbol) for symbol in trade["symbols"])
        event_rows.append({
            **trade,
            "returnPct": finite(event_values.get(trade["id"])) * 100.0,
            "byBar": event_by_bar[trade["id"]],
        })
    positives = [max(finite(row["returnPct"]), 0.0) for row in event_rows]
    positive_total = sum(positives)
    top_share = max(positives, default=0.0) / positive_total if positive_total > 0 else 0.0
    return {
        "rows": rows,
        "events": event_rows,
        "summary": {
            "count": len(event_rows),
            "years": sorted(set(int(row["entryYear"]) for row in event_rows)),
            "symbols": sorted(symbol_set),
            "winRatePct": sum(finite(row["returnPct"]) > 0 for row in event_rows) / len(event_rows) * 100.0 if event_rows else 0.0,
            "topPositiveEventShare": top_share,
            "alphaBaselineCorrelation": base.correlation(
                [finite(row["alphaReturn"]) for row in rows],
                [finite(row["baselineReturn"]) for row in rows],
            ),
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


def evaluate(config: PremiumConfig, raw: dict, baseline: dict, premiums: dict, periods: dict) -> dict:
    normal = simulate(config, raw, baseline, premiums, "normal")
    severe = simulate(config, raw, baseline, premiums, "severe")
    baseline_periods = {
        name: {
            "normal": base.metrics(baseline["normal"], start, end),
            "severe": base.metrics(baseline["severe"], start, end),
        }
        for name, (start, end) in periods.items()
    }
    result_periods = {
        name: {
            "normal": base.metrics(normal["rows"], start, end),
            "severe": base.metrics(severe["rows"], start, end),
            "alphaNormal": base.metrics(normal["rows"], start, end, "alphaReturn"),
            "alphaSevere": base.metrics(severe["rows"], start, end, "alphaReturn"),
        }
        for name, (start, end) in periods.items()
    }
    leave_one_out = {}
    for symbol in SYMBOLS:
        n = simulate(config, raw, baseline, premiums, "normal", {symbol})
        s = simulate(config, raw, baseline, premiums, "severe", {symbol})
        leave_one_out[symbol] = {
            "normalDelta": base.metrics(n["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["normal"]["compoundedReturnPct"],
            "severeDelta": base.metrics(s["rows"], *periods["full"])["compoundedReturnPct"]
            - baseline_periods["full"]["severe"]["compoundedReturnPct"],
            "events": n["summary"]["count"],
        }
    full = result_periods["full"]
    development = result_periods["development2023_2024"]
    validation = result_periods["validation2025"]
    diagnostic = result_periods["diagnostic2026H1"]
    summary = normal["summary"]
    loo_severe = [finite(item["severeDelta"]) for item in leave_one_out.values()]
    top1 = base.metrics(remove_top_events(severe, 1), *periods["full"])
    top3 = base.metrics(remove_top_events(severe, 3), *periods["full"])
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
    baseline = base.build_baseline(raw)
    times = baseline["times"]
    premiums, coverage = build_premiums(times)
    periods = {
        "development2023_2024": (times[0], START_2025),
        "validation2025": (START_2025, START_2026),
        "diagnostic2026H1": (START_2026, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }
    evaluations = [evaluate(config, raw, baseline, premiums, periods) for config in CANDIDATES]
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
        "strategyId": "V96_MARK_INDEX_PREMIUM_ALPHA_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "parameterFamilyPredeclared": True,
            "promotionAllowed": False,
        },
        "coverage": coverage,
        "candidateCount": len(CANDIDATES),
        "screenPassedCount": sum(bool(item["screenPass"]) for item in evaluations),
        "neighborFamilyPassedCount": sum(bool(item["neighborFamilyPass"]) for item in evaluations),
        "evaluations": evaluations,
        "limitations": [
            "Mark-index premium is an exchange-specific proxy and not a guaranteed executable cash-and-carry basis.",
            "2025 and 2026H1 remain reused historical evidence.",
            "No candidate changes Production or submits orders.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-basis-alpha-screen.json"
    md_path = state_dir / "v96-basis-alpha-screen.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Mark-Index Premium Alpha Screen",
        "",
        f"- Candidates: {result['candidateCount']}",
        f"- Screen passes: {result['screenPassedCount']}",
        f"- Neighbor-family passes: {result['neighborFamilyPassedCount']}",
        "- Production changed: **NO**",
        "",
        "## Coverage",
    ]
    for symbol, item in result["coverage"].items():
        report.append(f"- {symbol}: {item['commonRows']} rows, {item['coveragePct']}%")
    report.extend([
        "",
        "| Candidate | Pass | Neighbor | Full N | Full S | 2025 N | 2025 S | 2026 N | 2026 S | Events | Corr |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for item in result["evaluations"]:
        report.append(
            f"| {item['config']['name']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['neighborFamilyPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['summary']['count']} | {item['summary']['alphaBaselineCorrelation']} |"
        )
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
