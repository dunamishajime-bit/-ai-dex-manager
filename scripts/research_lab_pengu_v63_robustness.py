from __future__ import annotations

import datetime as dt
import json
import os
import random
import statistics
from dataclasses import asdict, replace
from pathlib import Path
from typing import Dict, List

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_v60_delayed_exit as v60
import research_lab_pengu_v62_adaptive_sizing as v62
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
RNG_SEED = 62063
BOOTSTRAP_SAMPLES = 10_000
FIXED_DISTRIBUTION_GROSS = 0.15
FIXED_FLASH_GROSS = 0.20
FIXED_EXTREME_GROSS = 0.30

v60.make_probe_only = v62.no_unconfirmed_probe


def fixed_trades(pengu: list[dict], btc: list[dict], funding: list[dict]) -> List[v50.Trade]:
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    flash = v60.run_candidate(v60.FLASH, v62.FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, v62.DISTRIBUTION_EXIT, pengu, btc, funding, features)
    return v62.scaled_engine(
        distribution,
        flash,
        FIXED_DISTRIBUTION_GROSS,
        FIXED_FLASH_GROSS,
        FIXED_EXTREME_GROSS,
    )


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def stress_trade(trade: v50.Trade, round_trip_cost_pct: float) -> v50.Trade:
    stressed = trade.gross_pct - trade.funding_pct - trade.total_gross * round_trip_cost_pct
    return replace(trade, base_pct=stressed, severe_pct=stressed)


def stressed_metrics(trades: List[v50.Trade], start: int, end: int, cost: float) -> dict:
    return metrics([stress_trade(trade, cost) for trade in trades], start, end)


def compounded_from_values(values: List[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= 1.0 + value / 100.0
    return (equity - 1.0) * 100.0


def max_drawdown_from_values(values: List[float]) -> float:
    equity = 1.0
    peak = 1.0
    drawdown = 0.0
    for value in values:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        drawdown = min(drawdown, (equity / peak - 1.0) * 100.0)
    return drawdown


def percentile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def bootstrap_trades(values: List[float], rng: random.Random) -> dict:
    returns: List[float] = []
    drawdowns: List[float] = []
    positive = 0
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = [rng.choice(values) for _ in values]
        result = compounded_from_values(sample)
        returns.append(result)
        drawdowns.append(max_drawdown_from_values(sample))
        positive += result > 0
    return {
        "samples": BOOTSTRAP_SAMPLES,
        "positiveProbabilityPct": positive / BOOTSTRAP_SAMPLES * 100.0,
        "returnP01": percentile(returns, 0.01),
        "returnP05": percentile(returns, 0.05),
        "returnMedian": percentile(returns, 0.50),
        "returnP95": percentile(returns, 0.95),
        "drawdownP05": percentile(drawdowns, 0.05),
        "drawdownMedian": percentile(drawdowns, 0.50),
        "worstDrawdown": min(drawdowns),
    }


def monthly_groups(trades: List[v50.Trade], field: str = "base_pct") -> Dict[str, List[float]]:
    result: Dict[str, List[float]] = {}
    for trade in trades:
        month = dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        result.setdefault(month, []).append(float(getattr(trade, field)))
    return result


def monthly_report(trades: List[v50.Trade], field: str = "base_pct") -> dict:
    groups = monthly_groups(trades, field)
    rows = []
    for month in sorted(groups):
        values = groups[month]
        rows.append({
            "month": month,
            "trades": len(values),
            "compoundedReturnPct": compounded_from_values(values),
            "sumReturnPct": sum(values),
            "wins": sum(value > 0 for value in values),
        })
    returns = [row["compoundedReturnPct"] for row in rows]
    return {
        "months": rows,
        "monthCount": len(rows),
        "positiveMonths": sum(value > 0 for value in returns),
        "negativeMonths": sum(value < 0 for value in returns),
        "medianMonthPct": statistics.median(returns) if returns else None,
        "bestMonthPct": max(returns) if returns else None,
        "worstMonthPct": min(returns) if returns else None,
    }


def bootstrap_months(trades: List[v50.Trade], field: str, rng: random.Random) -> dict:
    groups = monthly_groups(trades, field)
    month_returns = [compounded_from_values(values) for values in groups.values()]
    returns: List[float] = []
    positive = 0
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = [rng.choice(month_returns) for _ in month_returns]
        result = compounded_from_values(sample)
        returns.append(result)
        positive += result > 0
    return {
        "samples": BOOTSTRAP_SAMPLES,
        "positiveProbabilityPct": positive / BOOTSTRAP_SAMPLES * 100.0,
        "returnP01": percentile(returns, 0.01),
        "returnP05": percentile(returns, 0.05),
        "returnMedian": percentile(returns, 0.50),
        "returnP95": percentile(returns, 0.95),
    }


def remove_best_trade(trades: List[v50.Trade], count: int = 1) -> List[v50.Trade]:
    best_ids = {
        id(trade)
        for trade in sorted(trades, key=lambda trade: trade.base_pct, reverse=True)[:count]
    }
    return [trade for trade in trades if id(trade) not in best_ids]


def remove_best_month(trades: List[v50.Trade]) -> tuple[List[v50.Trade], str | None]:
    groups: Dict[str, List[v50.Trade]] = {}
    for trade in trades:
        month = dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        groups.setdefault(month, []).append(trade)
    if not groups:
        return trades, None
    best_month = max(groups, key=lambda month: compounded_from_values([trade.base_pct for trade in groups[month]]))
    return [
        trade for trade in trades
        if dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m") != best_month
    ], best_month


def concentration(trades: List[v50.Trade]) -> dict:
    positives = sorted((trade.base_pct for trade in trades if trade.base_pct > 0), reverse=True)
    total_positive = sum(positives)
    return {
        "positiveTradeSumPct": total_positive,
        "bestTradePct": positives[0] if positives else None,
        "bestTradeSharePct": positives[0] / total_positive * 100.0 if positives and total_positive > 0 else None,
        "top3SharePct": sum(positives[:3]) / total_positive * 100.0 if positives and total_positive > 0 else None,
    }


def venue_result(name: str, pengu: list[dict], btc: list[dict], funding: list[dict]) -> dict:
    aligned_pengu, aligned_btc = common.intersect_rows(pengu, btc)
    trades = fixed_trades(aligned_pengu, aligned_btc, funding)
    start = int(aligned_pengu[0]["ts"])
    end = int(aligned_pengu[-1]["ts"]) + HOUR
    events = [*v50.wave_events(aligned_pengu, 24, 20.0), *v50.wave_events(aligned_pengu, 72, 35.0)]
    excluded, exclusion = common.exclude_large_wave_profits(trades, events)
    no_best1 = remove_best_trade(trades, 1)
    no_best3 = remove_best_trade(trades, 3)
    no_best_month, best_month = remove_best_month(trades)
    excluded_no_best1 = remove_best_trade(excluded, 1)
    excluded_no_best_month, excluded_best_month = remove_best_month(excluded)
    rng = random.Random(RNG_SEED + (1 if name == "ASTER" else 0))
    return {
        "venue": name,
        "startTs": start,
        "endTs": end,
        "startIso": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
        "endIso": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
        "included": metrics(trades, start, end),
        "includedSevere": metrics(trades, start, end, True),
        "excluded": metrics(excluded, start, end),
        "excludedSevere": metrics(excluded, start, end, True),
        "stressCosts": {
            "cost0p42": stressed_metrics(trades, start, end, 0.42),
            "cost0p56": stressed_metrics(trades, start, end, 0.56),
            "cost0p70": stressed_metrics(trades, start, end, 0.70),
            "excludedCost0p42": stressed_metrics(excluded, start, end, 0.42),
            "excludedCost0p56": stressed_metrics(excluded, start, end, 0.56),
        },
        "removeBestTrade": metrics(no_best1, start, end),
        "removeTop3Trades": metrics(no_best3, start, end),
        "removeBestMonth": {"month": best_month, "metrics": metrics(no_best_month, start, end)},
        "excludedRemoveBestTrade": metrics(excluded_no_best1, start, end),
        "excludedRemoveBestMonth": {"month": excluded_best_month, "metrics": metrics(excluded_no_best_month, start, end)},
        "concentration": concentration(trades),
        "excludedConcentration": concentration(excluded),
        "monthly": monthly_report(trades),
        "monthlySevere": monthly_report(trades, "severe_pct"),
        "excludedMonthly": monthly_report(excluded),
        "tradeBootstrap": bootstrap_trades([trade.base_pct for trade in trades], rng),
        "excludedTradeBootstrap": bootstrap_trades([trade.base_pct for trade in excluded], rng),
        "monthBootstrap": bootstrap_months(trades, "base_pct", rng),
        "excludedMonthBootstrap": bootstrap_months(excluded, "base_pct", rng),
        "waveEvents": {"count": len(events), "exclusion": exclusion},
        "trades": [asdict(trade) for trade in trades],
        "excludedTrades": [asdict(trade) for trade in excluded],
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    now_end = int(now.timestamp() * 1000) // HOUR * HOUR

    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    archive_pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    archive_btc, _ = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    archive_funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    archive_pengu, archive_btc, archive_funding, _ = archive_source.trim_to_complete_funding_window(
        archive_pengu, archive_btc, archive_funding, funding_months
    )
    archive = venue_result("BINANCE_ARCHIVE", archive_pengu, archive_btc, archive_funding)

    aster = venue_result(
        "ASTER",
        v47.fetch_klines("PENGUUSDT", now_end),
        v47.fetch_klines("BTCUSDT", now_end),
        v47.fetch_funding("PENGUUSDT", now_end),
    )

    archive_pass = bool(
        archive["includedSevere"]["compoundedReturnPct"] > 0
        and archive["excludedSevere"]["compoundedReturnPct"] > 0
        and archive["stressCosts"]["cost0p56"]["compoundedReturnPct"] > 0
        and archive["stressCosts"]["excludedCost0p56"]["compoundedReturnPct"] > 0
        and archive["removeBestTrade"]["compoundedReturnPct"] > 0
        and archive["removeBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and archive["excludedRemoveBestTrade"]["compoundedReturnPct"] > 0
        and archive["excludedRemoveBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and archive["tradeBootstrap"]["returnP05"] > 0
        and archive["excludedTradeBootstrap"]["returnP05"] > 0
    )
    aster_pass = bool(
        aster["included"]["trades"] >= 5
        and aster["includedSevere"]["compoundedReturnPct"] > 0
        and aster["excludedSevere"]["compoundedReturnPct"] > 0
    )
    status = (
        "FULL_ROBUSTNESS_PASS" if archive_pass and aster_pass
        else "ARCHIVE_ROBUST_ASTER_PENDING" if archive_pass
        else "ROBUSTNESS_FAIL"
    )
    result = rounded({
        "version": 63,
        "strategyId": "PENGU_V63_FIXED_ROBUSTNESS",
        "generatedAt": now.isoformat(),
        "status": status,
        "parametersFrozen": True,
        "fixedSizing": {
            "distributionGross": FIXED_DISTRIBUTION_GROSS,
            "flashGross": FIXED_FLASH_GROSS,
            "extremeGross": FIXED_EXTREME_GROSS,
        },
        "fixedExits": {
            "flash": asdict(v62.FLASH_EXIT),
            "distribution": asdict(v62.DISTRIBUTION_EXIT),
        },
        "archivePassed": archive_pass,
        "asterPassed": aster_pass,
        "archive": archive,
        "aster": aster,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "parametersOptimized": False,
        },
        "limitations": [
            "Aster overlaps the Binance period and is cross-venue rather than chronologically pristine.",
            "The post-July 2026 Aster segment currently has no V62 trades.",
            "Bootstrap results assume the observed trade or monthly blocks are representative.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v63-robustness.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU V63 Fixed Robustness",
        "",
        f"- Status: **{status}**",
        f"- Archive robustness: **{'PASS' if archive_pass else 'FAIL'}**",
        f"- Aster cross-venue: **{'PASS' if aster_pass else 'FAIL/PENDING'}**",
        "",
        "## Binance Archive",
        f"- Included: {archive['included']['compoundedReturnPct']}% / Severe {archive['includedSevere']['compoundedReturnPct']}%",
        f"- Waves excluded: {archive['excluded']['compoundedReturnPct']}% / Severe {archive['excludedSevere']['compoundedReturnPct']}%",
        f"- Cost 0.56%: {archive['stressCosts']['cost0p56']['compoundedReturnPct']}%",
        f"- Excluded cost 0.56%: {archive['stressCosts']['excludedCost0p56']['compoundedReturnPct']}%",
        f"- Remove best trade: {archive['removeBestTrade']['compoundedReturnPct']}%",
        f"- Remove top 3: {archive['removeTop3Trades']['compoundedReturnPct']}%",
        f"- Remove best month ({archive['removeBestMonth']['month']}): {archive['removeBestMonth']['metrics']['compoundedReturnPct']}%",
        f"- Excluded remove best month ({archive['excludedRemoveBestMonth']['month']}): {archive['excludedRemoveBestMonth']['metrics']['compoundedReturnPct']}%",
        f"- Trade bootstrap P05: {archive['tradeBootstrap']['returnP05']}%",
        f"- Excluded trade bootstrap P05: {archive['excludedTradeBootstrap']['returnP05']}%",
        f"- Month bootstrap P05: {archive['monthBootstrap']['returnP05']}%",
        f"- Excluded month bootstrap P05: {archive['excludedMonthBootstrap']['returnP05']}%",
        "",
        "## Aster",
        f"- Included: {aster['included']['compoundedReturnPct']}% / Severe {aster['includedSevere']['compoundedReturnPct']}% / N {aster['included']['trades']}",
        f"- Waves excluded: {aster['excluded']['compoundedReturnPct']}% / Severe {aster['excludedSevere']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v63-robustness.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
