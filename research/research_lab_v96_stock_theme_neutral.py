from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_v96_stock_theme_shadow as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_THEME_NEUTRAL_V1"
PAIR_GROSS = 0.10
LEG_GROSS = 0.05
NORMAL_TURNOVER_BPS = 20.0
SEVERE_TURNOVER_BPS = 50.0
MIN_THEME_MEMBERS = 4
MIN_EVALUATION_DAYS = 80


@dataclass(frozen=True)
class PairConfig:
    name: str
    slow: int
    fast: int


CONFIGS = (
    PairConfig("PAIR_L10", 10, 3),
    PairConfig("PAIR_L20_PRIMARY", 20, 5),
    PairConfig("PAIR_L40", 40, 10),
)


def pair_signal(config: PairConfig, day: str, themes: dict, daily: dict) -> Optional[dict]:
    candidates: List[dict] = []
    for theme, symbols in themes.items():
        members: List[dict] = []
        for symbol in symbols:
            symbol_days = daily.get(symbol, {})
            history_days = sorted(key for key in symbol_days if key <= day)
            if len(history_days) <= config.slow:
                continue
            closes = [base.finite(symbol_days[key]["close"]) for key in history_days]
            r_fast = base.pct_change(closes, config.fast)
            r_slow = base.pct_change(closes, config.slow)
            if r_fast is None or r_slow is None:
                continue
            members.append({"symbol": symbol, "score": r_slow + 0.5 * r_fast, "fast": r_fast, "slow": r_slow})
        if len(members) < MIN_THEME_MEMBERS:
            continue
        strongest = max(members, key=lambda row: row["score"])
        weakest = min(members, key=lambda row: row["score"])
        spread = strongest["score"] - weakest["score"]
        if strongest["score"] <= 0 or weakest["score"] >= 0 or spread <= 0:
            continue
        candidates.append({
            "theme": theme,
            "long": strongest["symbol"],
            "short": weakest["symbol"],
            "spread": spread,
            "memberCount": len(members),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda row: row["spread"], reverse=True)
    return candidates[0]


def week_end_days(days: Sequence[str]) -> List[str]:
    result: Dict[Tuple[int, int], str] = {}
    for day in days:
        date = dt.date.fromisoformat(day)
        iso = date.isocalendar()
        result[(iso.year, iso.week)] = day
    return sorted(result.values())


def latest_decision(decisions: Sequence[str], source_day: str) -> Optional[str]:
    eligible = [day for day in decisions if day <= source_day]
    return eligible[-1] if eligible else None


def next_open_return(daily: dict, symbol: str, day: str) -> float:
    symbol_days = sorted(daily.get(symbol, {}))
    if day not in daily.get(symbol, {}):
        return 0.0
    position = symbol_days.index(day)
    if position + 1 >= len(symbol_days):
        return 0.0
    current_open = base.finite(daily[symbol][day]["open"])
    next_open = base.finite(daily[symbol][symbol_days[position + 1]]["open"])
    return next_open / current_open - 1.0 if current_open > 0 and next_open > 0 else 0.0


def build_returns(config: PairConfig, themes: dict, daily: dict, funding: dict, severe: bool) -> Tuple[List[dict], List[dict]]:
    all_days = sorted(set().union(*(set(rows) for rows in daily.values())))
    decisions = week_end_days(all_days)
    signals = {day: pair_signal(config, day, themes, daily) for day in decisions}
    delay = 2 if severe else 1
    cost_bps = SEVERE_TURNOVER_BPS if severe else NORMAL_TURNOVER_BPS
    previous: Dict[str, float] = {}
    rows: List[dict] = []
    events: List[dict] = []
    active_key: Optional[Tuple[str, str, str]] = None
    active: Optional[dict] = None

    for index, day in enumerate(all_days):
        source_index = index - delay
        signal = None
        if source_index >= 0:
            source_day = all_days[source_index]
            decision_day = latest_decision(decisions, source_day)
            signal = signals.get(decision_day) if decision_day else None
        requested: Dict[str, float] = {}
        if signal:
            requested[str(signal["long"])] = LEG_GROSS
            requested[str(signal["short"])] = -LEG_GROSS
        requested_gross = sum(abs(weight) for weight in requested.values())
        available = max(0.0, base.PORTFOLIO_GROSS_CAP - 1.90)
        scale = min(1.0, available / requested_gross) if requested_gross > 0 else 0.0
        weights = {symbol: weight * scale for symbol, weight in requested.items()}
        pnl = 0.0
        funding_cost = 0.0
        for symbol, weight in weights.items():
            pnl += weight * next_open_return(daily, symbol, day)
            symbol_funding = weight * base.finite(funding.get(symbol, {}).get(day))
            funding_cost += symbol_funding
            pnl -= symbol_funding
        turnover = sum(abs(weights.get(symbol, 0.0) - previous.get(symbol, 0.0)) for symbol in set(weights) | set(previous))
        pnl -= turnover * cost_bps / 10_000.0
        if severe:
            pnl -= sum(abs(weight) for weight in weights.values()) * 10.0 / 10_000.0

        key = (str(signal["theme"]), str(signal["long"]), str(signal["short"])) if signal else None
        if active is not None and key != active_key:
            active["exitDay"] = day
            active = None
            active_key = None
        if key is not None and active is None:
            active_key = key
            active = {
                "theme": key[0],
                "long": key[1],
                "short": key[2],
                "entryDay": day,
                "exitDay": all_days[-1],
                "returnPct": 0.0,
                "bars": 0,
            }
            events.append(active)
        if active is not None:
            active["returnPct"] += pnl * 100.0
            active["bars"] += 1

        rows.append({
            "day": day,
            "return": pnl,
            "theme": signal.get("theme") if signal else None,
            "long": signal.get("long") if signal else None,
            "short": signal.get("short") if signal else None,
            "gross": sum(abs(weight) for weight in weights.values()),
            "net": sum(weights.values()),
            "turnover": turnover,
            "fundingCost": funding_cost,
        })
        previous = weights
    return rows, events


def event_summary(events: Sequence[dict]) -> dict:
    positive = [max(0.0, base.finite(event.get("returnPct"))) for event in events]
    total = sum(positive)
    symbols = set()
    for event in events:
        symbols.add(str(event.get("long")))
        symbols.add(str(event.get("short")))
    return {
        "count": len(events),
        "winRatePct": sum(base.finite(event.get("returnPct")) > 0 for event in events) / len(events) * 100.0 if events else 0.0,
        "topPositiveEventShare": max(positive, default=0.0) / total if total > 0 else 0.0,
        "symbols": sorted(symbols - {"None"}),
        "themes": sorted({str(event.get("theme")) for event in events}),
    }


def evaluate(config: PairConfig, themes: dict, daily: dict, funding: dict) -> dict:
    normal, normal_events = build_returns(config, themes, daily, funding, False)
    severe, severe_events = build_returns(config, themes, daily, funding, True)
    ranges = base.split_ranges(normal)
    periods = {}
    for name, (start, end) in ranges.items():
        periods[name] = {"normal": base.metrics(normal[start:end]), "severe": base.metrics(severe[start:end])}
    summary = event_summary(normal_events)
    enough = len(normal) >= MIN_EVALUATION_DAYS
    passed = bool(
        enough
        and periods["validation"]["normal"]["compoundedReturnPct"] > 0
        and periods["validation"]["severe"]["compoundedReturnPct"] > 0
        and periods["holdout"]["normal"]["compoundedReturnPct"] > 0
        and periods["holdout"]["severe"]["compoundedReturnPct"] > 0
        and periods["full"]["severe"]["compoundedReturnPct"] > 0
        and periods["full"]["severe"]["maxDrawdownPct"] >= -10.0
        and summary["count"] >= 12
        and summary["topPositiveEventShare"] <= 0.35
        and len(summary["symbols"]) >= 4
        and len(summary["themes"]) >= 2
    )
    return {
        "config": asdict(config),
        "screenPass": passed,
        "enoughHistory": enough,
        "periods": periods,
        "normalSummary": summary,
        "severeSummary": event_summary(severe_events),
    }


def self_test() -> None:
    assert week_end_days(["2026-07-20", "2026-07-21", "2026-07-24", "2026-07-27"]) == ["2026-07-24", "2026-07-27"]
    assert base.integration_self_test()["v96WeightsUntouched"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    self_test()
    if args.self_test:
        print("self-test: ok")
        return

    now_ms = int(dt.datetime.now(tz=UTC).timestamp() * 1000)
    start_ms = now_ms - base.HISTORY_DAYS * 86_400_000
    exchange = base.request_json("/fapi/v1/exchangeInfo")
    themes, universe_rows = base.discover_universe(exchange)
    symbols = sorted(set(themes["AI"]) | set(themes["SEMICONDUCTOR"]))
    daily: Dict[str, Dict[str, dict]] = {}
    funding: Dict[str, Dict[str, float]] = {}
    coverage = {}
    for symbol in symbols:
        klines = base.fetch_klines(symbol, start_ms, now_ms)
        daily[symbol] = base.aggregate_regular_days(klines)
        funding_rows = base.fetch_funding(symbol, start_ms, now_ms)
        funding[symbol] = base.funding_by_hold_date(funding_rows)
        coverage[symbol] = {"regularDays": len(daily[symbol]), "fundingRows": len(funding_rows)}

    evaluations = [evaluate(config, themes, daily, funding) for config in CONFIGS]
    by_name = {item["config"]["name"]: item for item in evaluations}
    primary = by_name["PAIR_L20_PRIMARY"]
    neighbor_passes = sum(item["screenPass"] for item in evaluations if item is not primary)
    robust = bool(primary["screenPass"] and neighbor_passes >= 1)
    status = "STOCK_THEME_NEUTRAL_ROBUST_HISTORICAL" if robust else "NO_ROBUST_STOCK_THEME_NEUTRAL_EDGE"

    result = {
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(tz=UTC).isoformat(),
        "status": status,
        "selectedForProduction": False,
        "universe": {"themes": themes, "symbols": universe_rows, "coverage": coverage},
        "design": {
            "decisionFrequency": "weekly after completed U.S. regular session",
            "portfolio": "long strongest and short weakest member inside one theme",
            "themeSelection": "largest positive cross-sectional score spread",
            "gross": PAIR_GROSS,
            "grossPerLeg": LEG_GROSS,
            "netTarget": 0.0,
            "normalTurnoverBps": NORMAL_TURNOVER_BPS,
            "severeTurnoverBps": SEVERE_TURNOVER_BPS,
        },
        "evaluations": evaluations,
        "integration": base.integration_self_test(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "orderSubmissionAllowed": False,
            "mode": "SHADOW",
            "v96WeightsMutable": False,
            "promotionAllowed": False,
            "fixedLookbackNeighborhood": [10, 20, 40],
        },
        "limitations": [
            "Current-listing survivorship bias remains.",
            "The Aster stock-perpetual history is uneven and often short.",
            "Historical spread, depth and liquidation state are not available for this test.",
            "The separate three-day collector is Forward evidence and is not used to tune this historical result.",
        ],
    }
    (output / "v96-stock-theme-neutral.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Theme Neutral Screen",
        "",
        f"- Status: **{status}**",
        "- Structure: 0.05 Gross long + 0.05 Gross short inside one theme",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "- V96 weights mutable: **NO**",
        "",
        "| Config | Pass | Full N | Full S | Val N/S | Holdout N/S | Severe DD | Events | Symbols | Themes | Top share |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in evaluations:
        p = item["periods"]
        s = item["normalSummary"]
        lines.append(
            f"| {item['config']['name']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{p['full']['normal']['compoundedReturnPct']:.4f} | {p['full']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['validation']['normal']['compoundedReturnPct']:.4f}/{p['validation']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['holdout']['normal']['compoundedReturnPct']:.4f}/{p['holdout']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['full']['severe']['maxDrawdownPct']:.4f} | {s['count']} | {len(s['symbols'])} | {len(s['themes'])} | {s['topPositiveEventShare']:.4f} |"
        )
    lines.extend(["", "Research-only market-neutral Shadow engine. No order path is present."])
    markdown = "\n".join(lines) + "\n"
    (output / "v96-stock-theme-neutral.md").write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)


if __name__ == "__main__":
    main()
