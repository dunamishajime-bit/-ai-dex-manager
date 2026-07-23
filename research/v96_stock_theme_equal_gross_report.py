from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import v96_stock_theme_forward_7d_pnl as pnl
import v96_stock_theme_forward_7d_quality_v2 as quality
from v96_stock_theme_equal_gross_config import (
    ALLOCATION_ID,
    CRYPTO_GROSS_CAP,
    PORTFOLIO_GROSS_CAP,
    STOCK_GROSS_CAP,
    STOCK_NEUTRAL_LONG_GROSS,
    STOCK_NEUTRAL_SHORT_GROSS,
    allocation_manifest,
    self_test as allocation_self_test,
)


def configure_base_module() -> None:
    pnl.STOCK_GROSS_CAP = STOCK_GROSS_CAP
    pnl.ASSUMED_V96_GROSS = CRYPTO_GROSS_CAP
    pnl.PORTFOLIO_GROSS_CAP = PORTFOLIO_GROSS_CAP


def evaluate_neutral_equal_gross(daily: dict, funding: dict, severe: bool) -> dict:
    days = pnl.all_days(daily)
    decisions = pnl.week_end_days(days)
    signals = {day: pnl.neutral_signal(day, daily, pnl.NeutralConfig()) for day in decisions}
    delay = 2 if severe else 1
    cost_bps = pnl.SEVERE_TURNOVER_BPS if severe else pnl.NORMAL_TURNOVER_BPS
    previous: Dict[str, float] = {}
    rows: List[dict] = []
    start_day = pnl.START_UTC.astimezone(pnl.NY).date().isoformat()
    end_day = pnl.END_UTC.astimezone(pnl.NY).date().isoformat()

    for index, day in enumerate(days):
        if not (start_day <= day <= end_day):
            continue
        source_index = index - delay
        source_day = days[source_index] if source_index >= 0 else None
        decision_day = pnl.latest_decision(decisions, source_day) if source_day else None
        signal = signals.get(decision_day) if decision_day else None
        requested: Dict[str, float] = {}
        if signal:
            requested[str(signal["long"])] = STOCK_NEUTRAL_LONG_GROSS
            requested[str(signal["short"])] = -STOCK_NEUTRAL_SHORT_GROSS

        gross = sum(abs(value) for value in requested.values())
        available = max(0.0, PORTFOLIO_GROSS_CAP - CRYPTO_GROSS_CAP)
        scale = min(1.0, STOCK_GROSS_CAP / gross, available / gross) if gross > 0 else 0.0
        weights = {symbol: value * scale for symbol, value in requested.items()}

        next_days: List[str] = []
        completed = bool(weights)
        raw_returns: Dict[str, float] = {}
        interval_return = 0.0
        funding_cost = 0.0
        marked_to_market = 0.0

        for symbol, weight in weights.items():
            raw, next_day = pnl.next_open_return(daily, symbol, day)
            if raw is None or next_day is None or next_day > end_day:
                completed = False
                partial = pnl.open_to_close_return(daily, symbol, day)
                if partial is not None:
                    marked_to_market += weight * partial
            else:
                raw_returns[symbol] = raw
                next_days.append(next_day)
                interval_return += weight * raw

            symbol_funding = weight * pnl.finite(funding.get(symbol, {}).get(day))
            funding_cost += symbol_funding
            interval_return -= symbol_funding
            marked_to_market -= symbol_funding

        turnover = sum(
            abs(weights.get(symbol, 0.0) - previous.get(symbol, 0.0))
            for symbol in set(weights) | set(previous)
        )
        interval_return -= turnover * cost_bps / 10_000.0
        if severe:
            interval_return -= sum(abs(value) for value in weights.values()) * 10.0 / 10_000.0

        rows.append({
            "day": day,
            "sourceDay": source_day,
            "decisionDay": decision_day,
            "theme": signal.get("theme") if signal else None,
            "long": signal.get("long") if signal else None,
            "short": signal.get("short") if signal else None,
            "gross": sum(abs(value) for value in weights.values()),
            "net": sum(weights.values()),
            "active": bool(weights),
            "completed": completed,
            "nextDays": sorted(set(next_days)),
            "rawReturns": raw_returns,
            "fundingCost": funding_cost,
            "turnover": turnover,
            "return": interval_return if completed else 0.0,
            "markedToMarketReturn": marked_to_market if not completed else 0.0,
        })
        previous = weights

    return {
        "scenario": "SEVERE" if severe else "NORMAL",
        "metrics": pnl.metrics(rows),
        "rows": rows,
    }


def write_allocation(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = allocation_manifest()
    (output_dir / "equal-gross-allocation.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# Equal-gross research allocation",
        "",
        f"Allocation: **{ALLOCATION_ID}**",
        "",
        f"- Crypto Gross cap: {CRYPTO_GROSS_CAP:.2f}",
        f"- Stock Gross cap: {STOCK_GROSS_CAP:.2f}",
        f"- Total Gross cap: {PORTFOLIO_GROSS_CAP:.2f}",
        f"- Stock neutral legs: Long {STOCK_NEUTRAL_LONG_GROSS:.2f} / Short {STOCK_NEUTRAL_SHORT_GROSS:.2f}",
        "- Crypto engine: 24 hours",
        "- Stock engine: U.S. market session only",
        "- Sleeve lending: disabled during the initial comparison",
        "",
        "This is a Shadow research allocation. Production, LIVE, VPS and order submission are unchanged.",
    ]
    (output_dir / "equal-gross-allocation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_quality_report(input_dir: Path, output_dir: Path) -> dict:
    result = quality.analyze(input_dir)
    result["allocation"] = allocation_manifest()
    result["safety"].update({
        "cryptoGrossCap": CRYPTO_GROSS_CAP,
        "stockThemeGrossCap": STOCK_GROSS_CAP,
        "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
        "allocationId": ALLOCATION_ID,
        "currentProductionV96WeightsMutable": False,
    })
    quality.write_report(result, output_dir)
    return result


def build_pnl_report(output_dir: Path) -> dict:
    configure_base_module()
    history_start = pnl.START_UTC - dt.timedelta(days=90)
    history_end = pnl.END_UTC + dt.timedelta(days=1)
    start_ms = int(history_start.timestamp() * 1000)
    end_ms = int(history_end.timestamp() * 1000)

    daily: Dict[str, Dict[str, dict]] = {}
    funding: Dict[str, Dict[str, float]] = {}
    coverage: Dict[str, dict] = {}
    for symbol in pnl.SYMBOLS:
        klines = pnl.fetch_klines(symbol, start_ms, end_ms)
        funding_rows = pnl.fetch_funding(symbol, start_ms, end_ms)
        daily[symbol] = pnl.aggregate_regular_days(klines)
        funding[symbol] = pnl.funding_by_date(funding_rows)
        coverage[symbol] = {
            "regularDays": len(daily[symbol]),
            "fundingRows": len(funding_rows),
        }

    directional_normal = pnl.evaluate_directional(daily, funding, False)
    directional_severe = pnl.evaluate_directional(daily, funding, True)
    neutral_normal = evaluate_neutral_equal_gross(daily, funding, False)
    neutral_severe = evaluate_neutral_equal_gross(daily, funding, True)

    completed = min(
        directional_normal["metrics"]["completedIntervals"],
        directional_severe["metrics"]["completedIntervals"],
    )
    status = "PRELIMINARY_FORWARD_PNL_ONLY_NOT_ROBUST" if completed >= 2 else "INSUFFICIENT_FORWARD_INTERVALS"
    result = {
        "strategyId": "V96_STOCK_THEME_FORWARD_7D_EQUAL_GROSS_PNL_V1",
        "allocationId": ALLOCATION_ID,
        "status": status,
        "selectedForProduction": False,
        "window": {
            "startUtc": pnl.START_UTC.isoformat(),
            "endUtc": pnl.END_UTC.isoformat(),
        },
        "allocation": allocation_manifest(),
        "frozenRules": {
            "directional": "BREADTH_67_PRIMARY, next trading-day execution, Stock Gross 1.00",
            "neutral": "PAIR_L20_PRIMARY, weekly strongest Long 0.50 and weakest Short 0.50",
            "normalTurnoverBps": pnl.NORMAL_TURNOVER_BPS,
            "severeTurnoverBps": pnl.SEVERE_TURNOVER_BPS,
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
            "retuningAllowed": False,
        },
        "directional": {
            "normal": directional_normal,
            "severe": directional_severe,
        },
        "neutral": {
            "normal": neutral_normal,
            "severe": neutral_severe,
        },
        "coverage": coverage,
        "safety": {
            "mode": "SHADOW",
            "orderSubmissionAllowed": False,
            "currentProductionV96WeightsMutable": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
        },
        "limitations": [
            "The window contains only about five U.S. regular sessions.",
            "The 1.00/1.00 allocation is a normalized comparison baseline, not a Production approval.",
            "Completed next-open holding intervals are fewer than the number of sessions.",
            "Current-listing survivorship bias remains.",
            "No result from this report can approve profitability, robustness, or Production.",
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-theme-forward-7d-equal-gross-pnl.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    d_normal = directional_normal["metrics"]
    d_severe = directional_severe["metrics"]
    n_normal = neutral_normal["metrics"]
    n_severe = neutral_severe["metrics"]
    lines = [
        "# V96 stock-theme equal-gross preliminary Shadow PnL",
        "",
        f"Status: **{status}**",
        "",
        f"- Crypto Gross cap: {CRYPTO_GROSS_CAP:.2f}",
        f"- Stock Gross cap: {STOCK_GROSS_CAP:.2f}",
        f"- Portfolio Gross cap: {PORTFOLIO_GROSS_CAP:.2f}",
        "",
        "## Directional Stock Gross 1.00",
        f"- Normal: {d_normal['compoundedReturnPct']:.6f}% over {d_normal['completedIntervals']} completed intervals",
        f"- Severe: {d_severe['compoundedReturnPct']:.6f}% over {d_severe['completedIntervals']} completed intervals",
        "",
        "## Same-theme neutral Long 0.50 / Short 0.50",
        f"- Normal: {n_normal['compoundedReturnPct']:.6f}% over {n_normal['completedIntervals']} completed intervals",
        f"- Severe: {n_severe['compoundedReturnPct']:.6f}% over {n_severe['completedIntervals']} completed intervals",
        "",
        "This is a preliminary equal-gross Shadow comparison, not a robustness or Production approval.",
    ]
    (output_dir / "v96-stock-theme-forward-7d-equal-gross-pnl.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )
    return result


def self_test() -> None:
    allocation_self_test()
    configure_base_module()
    assert abs(pnl.weight_capacity(1.0) - 1.0) < 1e-12
    assert CRYPTO_GROSS_CAP + STOCK_GROSS_CAP == PORTFOLIO_GROSS_CAP
    assert STOCK_NEUTRAL_LONG_GROSS + STOCK_NEUTRAL_SHORT_GROSS == STOCK_GROSS_CAP


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".research-state/v96-stock-theme-forward-data")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-theme-equal-gross-report")
    parser.add_argument("--allocation-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    self_test()
    if args.self_test:
        print("V96 stock-theme equal-gross report self-test: PASS")
        return 0

    output_dir = Path(args.output_dir).resolve()
    write_allocation(output_dir)
    if args.allocation_only:
        print(json.dumps(allocation_manifest(), ensure_ascii=False))
        return 0

    quality_result = build_quality_report(Path(args.input_dir).resolve(), output_dir)
    pnl_result = build_pnl_report(output_dir)
    print(json.dumps({
        "allocationId": ALLOCATION_ID,
        "qualityStatus": quality_result["status"],
        "pnlStatus": pnl_result["status"],
        "cryptoGrossCap": CRYPTO_GROSS_CAP,
        "stockGrossCap": STOCK_GROSS_CAP,
        "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
    }, ensure_ascii=False))
    return 0 if quality_result.get("dataQualityPass") else 1


if __name__ == "__main__":
    raise SystemExit(main())
