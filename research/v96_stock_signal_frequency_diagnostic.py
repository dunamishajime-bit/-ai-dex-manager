from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import v96_stock_theme_forward_7d_pnl as base

DIAGNOSTIC_ID = "V96_STOCK_SIGNAL_FREQUENCY_DIAGNOSTIC_V1"
BALANCED_DIRECTIONAL_BREADTH = 0.55
BALANCED_NEUTRAL_ROBUST_SEPARATION = 2.0
BALANCED_NEUTRAL_REVIEW_EVERY_TRADING_DAYS = 2


def member_scores(day: str, daily: dict, symbols: Sequence[str]) -> List[dict]:
    rows: List[dict] = []
    for symbol in symbols:
        history_days = sorted(key for key in daily.get(symbol, {}) if key <= day)
        if len(history_days) <= base.LOOKBACK_SLOW:
            continue
        closes = [base.finite(daily[symbol][key]["close"]) for key in history_days]
        r5 = base.pct_change(closes, base.LOOKBACK_FAST)
        r20 = base.pct_change(closes, base.LOOKBACK_SLOW)
        if r5 is None or r20 is None:
            continue
        rows.append({
            "symbol": symbol,
            "r5": r5,
            "r20": r20,
            "score": r20 + 0.5 * r5,
        })
    return rows


def balanced_directional_signal(day: str, daily: dict) -> Optional[dict]:
    candidates: List[dict] = []
    for theme, symbols in base.THEMES.items():
        members = member_scores(day, daily, symbols)
        if len(members) < 4:
            continue
        theme_score = statistics.median(row["score"] for row in members)
        positive_ratio = sum(row["score"] > 0 for row in members) / len(members)
        side = 0
        if theme_score > 0 and positive_ratio >= BALANCED_DIRECTIONAL_BREADTH:
            side = 1
        elif theme_score < 0 and positive_ratio <= 1.0 - BALANCED_DIRECTIONAL_BREADTH:
            side = -1
        if side == 0:
            continue
        selected = max(members, key=lambda row: row["score"]) if side > 0 else min(
            members, key=lambda row: row["score"]
        )
        candidates.append({
            "theme": theme,
            "side": side,
            "symbol": selected["symbol"],
            "themeScore": theme_score,
            "positiveRatio": positive_ratio,
            "memberScore": selected["score"],
        })
    if not candidates:
        return None
    candidates.sort(key=lambda row: (abs(row["themeScore"]), abs(row["memberScore"])), reverse=True)
    return candidates[0]


def balanced_neutral_signal(day: str, daily: dict) -> Optional[dict]:
    candidates: List[dict] = []
    for theme, symbols in base.THEMES.items():
        members = member_scores(day, daily, symbols)
        if len(members) < 4:
            continue
        values = [row["score"] for row in members]
        centre = statistics.median(values)
        mad = statistics.median(abs(value - centre) for value in values)
        robust_scale = 1.4826 * mad
        strongest = max(members, key=lambda row: row["score"])
        weakest = min(members, key=lambda row: row["score"])
        spread = strongest["score"] - weakest["score"]
        separation = spread / robust_scale if robust_scale > 1e-12 else 0.0
        if spread <= 0 or separation < BALANCED_NEUTRAL_ROBUST_SEPARATION:
            continue
        candidates.append({
            "theme": theme,
            "long": strongest["symbol"],
            "short": weakest["symbol"],
            "spread": spread,
            "robustSeparation": separation,
        })
    if not candidates:
        return None
    candidates.sort(key=lambda row: (row["robustSeparation"], row["spread"]), reverse=True)
    return candidates[0]


def signal_key(signal: Optional[dict], neutral: bool = False) -> Optional[Tuple[object, ...]]:
    if not signal:
        return None
    if neutral:
        return (signal.get("theme"), signal.get("long"), signal.get("short"))
    return (signal.get("theme"), signal.get("side"), signal.get("symbol"))


def summarize_series(days: Sequence[str], signals: Dict[str, Optional[dict]], neutral: bool = False) -> dict:
    eligible = [day for day in days if signals.get(day)]
    changes: List[str] = []
    previous: Optional[Tuple[object, ...]] = None
    for day in days:
        key = signal_key(signals.get(day), neutral=neutral)
        if key is not None and key != previous:
            changes.append(day)
        previous = key

    gaps: List[int] = []
    positions = {day: index for index, day in enumerate(days)}
    for earlier, later in zip(changes, changes[1:]):
        gaps.append(positions[later] - positions[earlier])

    return {
        "observedTradingDays": len(days),
        "eligibleSignalDays": len(eligible),
        "eligibleSignalDayPct": len(eligible) / len(days) * 100.0 if days else 0.0,
        "distinctEntryOrRotationEvents": len(changes),
        "averageTradingDaysBetweenEvents": statistics.mean(gaps) if gaps else None,
        "medianTradingDaysBetweenEvents": statistics.median(gaps) if gaps else None,
        "maximumTradingDaysBetweenEvents": max(gaps) if gaps else None,
        "firstEventDay": changes[0] if changes else None,
        "lastEventDay": changes[-1] if changes else None,
        "eventDays": changes,
    }


def every_nth_days(days: Sequence[str], n: int) -> List[str]:
    return [day for index, day in enumerate(days) if index % n == 0]


def build_diagnostic(history_days: int) -> dict:
    end = dt.datetime.now(tz=base.UTC)
    start = end - dt.timedelta(days=history_days)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    daily: Dict[str, Dict[str, dict]] = {}
    coverage: Dict[str, int] = {}
    for symbol in base.SYMBOLS:
        klines = base.fetch_klines(symbol, start_ms, end_ms)
        daily[symbol] = base.aggregate_regular_days(klines)
        coverage[symbol] = len(daily[symbol])

    all_days = base.all_days(daily)
    usable_days = [
        day for day in all_days
        if sum(day in daily.get(symbol, {}) for symbol in base.SYMBOLS) >= 12
    ]

    strict_directional = {
        day: base.directional_signal(day, daily, base.DirectionalConfig()) for day in usable_days
    }
    balanced_directional = {day: balanced_directional_signal(day, daily) for day in usable_days}

    strict_week_days = base.week_end_days(usable_days)
    strict_neutral_sparse = {
        day: base.neutral_signal(day, daily, base.NeutralConfig()) for day in strict_week_days
    }
    strict_neutral = {day: strict_neutral_sparse.get(day) for day in strict_week_days}

    balanced_review_days = every_nth_days(usable_days, BALANCED_NEUTRAL_REVIEW_EVERY_TRADING_DAYS)
    balanced_neutral = {day: balanced_neutral_signal(day, daily) for day in balanced_review_days}

    return {
        "diagnosticId": DIAGNOSTIC_ID,
        "generatedAtUtc": end.isoformat(),
        "historyRequestedDays": history_days,
        "coverage": coverage,
        "usableTradingDays": len(usable_days),
        "currentStrict": {
            "directionalRule": "median r5 and r20 same sign plus 66.7% members positive in both windows",
            "directional": summarize_series(usable_days, strict_directional),
            "neutralRule": "weekly strongest score > 0 and weakest score < 0",
            "neutral": summarize_series(strict_week_days, strict_neutral, neutral=True),
        },
        "balancedCandidateV2": {
            "directionalRule": "median composite score sign plus 55% composite-score breadth",
            "directional": summarize_series(usable_days, balanced_directional),
            "neutralRule": "relative strongest/weakest pair, robust separation >= 2.0, reviewed every 2 trading days",
            "neutral": summarize_series(balanced_review_days, balanced_neutral, neutral=True),
        },
        "interpretation": {
            "profitabilityEvaluated": False,
            "selectionByProfitProhibited": True,
            "purpose": "Measure signal scarcity before any PnL comparison or rule promotion.",
        },
        "safety": {
            "mode": "SHADOW_DIAGNOSTIC_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
        },
    }


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "stock-signal-frequency-diagnostic.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    strict_d = result["currentStrict"]["directional"]
    balanced_d = result["balancedCandidateV2"]["directional"]
    strict_n = result["currentStrict"]["neutral"]
    balanced_n = result["balancedCandidateV2"]["neutral"]
    lines = [
        "# Stock signal frequency diagnostic",
        "",
        f"Usable trading days: **{result['usableTradingDays']}**",
        "",
        "## Current strict",
        f"- Directional eligible days: {strict_d['eligibleSignalDays']}; entry/rotation events: {strict_d['distinctEntryOrRotationEvents']}",
        f"- Neutral eligible review days: {strict_n['eligibleSignalDays']}; entry/rotation events: {strict_n['distinctEntryOrRotationEvents']}",
        "",
        "## Balanced candidate V2",
        f"- Directional eligible days: {balanced_d['eligibleSignalDays']}; entry/rotation events: {balanced_d['distinctEntryOrRotationEvents']}",
        f"- Neutral eligible review days: {balanced_n['eligibleSignalDays']}; entry/rotation events: {balanced_n['distinctEntryOrRotationEvents']}",
        "",
        "This diagnostic compares signal frequency only. It does not select rules by historical profit.",
    ]
    (output_dir / "stock-signal-frequency-diagnostic.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert every_nth_days(["a", "b", "c", "d", "e"], 2) == ["a", "c", "e"]
    assert signal_key({"theme": "AI", "side": 1, "symbol": "X"}) == ("AI", 1, "X")
    assert signal_key({"theme": "AI", "long": "X", "short": "Y"}, neutral=True) == ("AI", "X", "Y")
    sample = summarize_series(
        ["a", "b", "c", "d"],
        {"a": None, "b": {"theme": "AI", "side": 1, "symbol": "X"}, "c": {"theme": "AI", "side": 1, "symbol": "X"}, "d": {"theme": "AI", "side": 1, "symbol": "Y"}},
    )
    assert sample["eligibleSignalDays"] == 3
    assert sample["distinctEntryOrRotationEvents"] == 2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history-days", type=int, default=270)
    parser.add_argument("--output-dir", default=".research-state/v96-stock-signal-frequency")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("Stock signal frequency diagnostic self-test: PASS")
        return 0
    result = build_diagnostic(args.history_days)
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "usableTradingDays": result["usableTradingDays"],
        "strictDirectionalEvents": result["currentStrict"]["directional"]["distinctEntryOrRotationEvents"],
        "balancedDirectionalEvents": result["balancedCandidateV2"]["directional"]["distinctEntryOrRotationEvents"],
        "strictNeutralEvents": result["currentStrict"]["neutral"]["distinctEntryOrRotationEvents"],
        "balancedNeutralEvents": result["balancedCandidateV2"]["neutral"]["distinctEntryOrRotationEvents"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
