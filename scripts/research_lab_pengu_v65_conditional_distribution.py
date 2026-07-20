from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import random
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_v60_delayed_exit as v60
import research_lab_pengu_v62_adaptive_sizing as v62
import research_lab_pengu_v63_robustness as v63
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
FLASH_GROSS = 0.30
EXTREME_GROSS = 0.30
BOOTSTRAP_SAMPLES = 10_000
RNG_SEED = 65065

v60.make_probe_only = v62.no_unconfirmed_probe


def gate_space() -> list[tuple[float, float, str, float]]:
    return list(itertools.product(
        (0.0, 0.05),
        (0.10, 0.15, 0.20, 0.25, 0.30),
        ("GE", "LE"),
        (-6.0, -5.0, -4.0, -3.0, -2.5),
    ))


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def scale_distribution(
    distribution: List[v50.Trade],
    rows: List[dict],
    features: dict,
    low_gross: float,
    high_gross: float,
    operation: str,
    threshold: float,
) -> List[v50.Trade]:
    index_by_ts = {int(row["ts"]): index for index, row in enumerate(rows)}
    scaled: List[v50.Trade] = []
    for trade in distribution:
        index = index_by_ts.get(int(trade.signal_ts))
        if index is None:
            continue
        momentum3 = features["mom3"][index]
        if momentum3 is None:
            continue
        passes = float(momentum3) >= threshold if operation == "GE" else float(momentum3) <= threshold
        target = high_gross if passes else low_gross
        if target <= 0:
            continue
        scaled.append(v62.rescale_trade(trade, target))
    return scaled


def fixed_flash(flash: List[v50.Trade]) -> List[v50.Trade]:
    return [
        v62.rescale_trade(
            trade,
            EXTREME_GROSS if trade.mode == "EXTREME_PROBE_ADD" else FLASH_GROSS,
        )
        for trade in flash
    ]


def build_candidate(
    distribution: List[v50.Trade],
    flash: List[v50.Trade],
    rows: List[dict],
    features: dict,
    low_gross: float,
    high_gross: float,
    operation: str,
    threshold: float,
) -> List[v50.Trade]:
    return v60.combine_same_side(
        scale_distribution(distribution, rows, features, low_gross, high_gross, operation, threshold),
        fixed_flash(flash),
    )


def concentration(trades: List[v50.Trade], start: int, end: int) -> dict:
    positives = sorted(
        (trade.base_pct for trade in trades if start <= trade.entry_ts < end and trade.base_pct > 0),
        reverse=True,
    )
    positive_sum = sum(positives)
    return {
        "positiveTradeSumPct": positive_sum,
        "bestTradePct": positives[0] if positives else None,
        "bestTradeSharePct": positives[0] / positive_sum * 100.0 if positives and positive_sum > 0 else None,
        "top3SharePct": sum(positives[:3]) / positive_sum * 100.0 if positives and positive_sum > 0 else None,
    }


def remove_best_trade_metrics(
    trades: List[v50.Trade],
    start: int,
    end: int,
    count: int = 1,
    severe: bool = False,
) -> dict:
    selected = [trade for trade in trades if start <= trade.entry_ts < end]
    field = "severe_pct" if severe else "base_pct"
    remove_ids = {
        id(trade)
        for trade in sorted(selected, key=lambda trade: getattr(trade, field), reverse=True)[:count]
    }
    return metrics([trade for trade in trades if id(trade) not in remove_ids], start, end, severe)


def remove_best_month_metrics(trades: List[v50.Trade], start: int, end: int) -> dict:
    groups: Dict[str, List[v50.Trade]] = {}
    for trade in trades:
        if start <= trade.entry_ts < end:
            month = dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
            groups.setdefault(month, []).append(trade)
    if not groups:
        return {"month": None, "metrics": metrics([], start, end)}
    best_month = max(
        groups,
        key=lambda month: v63.compounded_from_values([trade.base_pct for trade in groups[month]]),
    )
    filtered = [
        trade for trade in trades
        if dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m") != best_month
    ]
    return {"month": best_month, "metrics": metrics(filtered, start, end)}


def corrected_stress_excluded(
    trades: List[v50.Trade],
    events: List[dict],
    start: int,
    end: int,
    cost_pct: float,
) -> dict:
    stressed = [v63.stress_trade(trade, cost_pct) for trade in trades]
    excluded, _ = common.exclude_large_wave_profits(stressed, events)
    return metrics(excluded, start, end)


def selection_pass(item: dict, folds: list[tuple[int, int]]) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    wave = item["wave"]
    selection_start = folds[0][0]
    selection_end = folds[3][1]
    trades = [v50.Trade(**row) for row in item["trades"]]
    concentration_result = concentration(trades, selection_start, selection_end)
    no_best_severe = remove_best_trade_metrics(trades, selection_start, selection_end, severe=True)
    item["selectionConcentration"] = concentration_result
    item["selectionRemoveBestTradeSevere"] = no_best_severe
    return bool(
        included["train"]["trades"] >= 10
        and included["train"]["compoundedReturnPct"] > 0
        and included["trainSevere"]["compoundedReturnPct"] > 0
        and included["train"]["maxDrawdownPct"] >= -5.0
        and included["validation"]["trades"] >= 2
        and included["validation"]["compoundedReturnPct"] > 0
        and included["validationSevere"]["compoundedReturnPct"] > 0
        and included["validation"]["maxDrawdownPct"] >= -3.0
        and excluded["train"]["compoundedReturnPct"] > 0
        and excluded["trainSevere"]["compoundedReturnPct"] > 0
        and excluded["train"]["maxDrawdownPct"] >= -5.0
        and excluded["validation"]["compoundedReturnPct"] > 0
        and excluded["validationSevere"]["compoundedReturnPct"] > 0
        and no_best_severe["compoundedReturnPct"] > 0
        and concentration_result["bestTradeSharePct"] is not None
        and concentration_result["bestTradeSharePct"] <= 40.0
        and wave["events"] > 0
        and wave["capturedEvents"] / wave["events"] >= 0.50
        and wave["profitableCapturedEvents"] / wave["events"] >= 0.50
    )


def rank_key(item: dict) -> tuple:
    return (
        item["excluded"]["validationSevere"]["compoundedReturnPct"],
        item["included"]["validationSevere"]["compoundedReturnPct"],
        item["excluded"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["train"]["maxDrawdownPct"],
        item["selectionRemoveBestTradeSevere"]["compoundedReturnPct"],
        -item["highGross"],
    )


def cluster_key(item: dict) -> tuple:
    return (item["lowGross"], item["highGross"], item["operation"])


def holdout_pass(item: dict) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    return bool(
        included["holdout"]["trades"] >= 3
        and included["holdout"]["compoundedReturnPct"] > 0
        and included["holdoutSevere"]["compoundedReturnPct"] > 0
        and excluded["holdout"]["compoundedReturnPct"] > 0
        and excluded["holdoutSevere"]["compoundedReturnPct"] > 0
        and included["holdout"]["maxDrawdownPct"] >= -1.5
        and included["holdoutSevere"]["maxDrawdownPct"] >= -1.6
        and (included["holdout"]["profitFactor"] or 0) >= 1.05
    )


def venue_result(
    name: str,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    selected: dict,
) -> dict:
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    flash = v60.run_candidate(v60.FLASH, v62.FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, v62.DISTRIBUTION_EXIT, pengu, btc, funding, features)
    trades = build_candidate(
        distribution,
        flash,
        pengu,
        features,
        float(selected["lowGross"]),
        float(selected["highGross"]),
        str(selected["operation"]),
        float(selected["threshold"]),
    )
    start = int(pengu[0]["ts"])
    end = int(pengu[-1]["ts"]) + HOUR
    events = [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
    excluded, exclusion = common.exclude_large_wave_profits(trades, events)
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
        "cost0p56": metrics([v63.stress_trade(trade, 0.56) for trade in trades], start, end),
        "excludedCost0p56": corrected_stress_excluded(trades, events, start, end, 0.56),
        "excludedCost0p70": corrected_stress_excluded(trades, events, start, end, 0.70),
        "removeBestTrade": remove_best_trade_metrics(trades, start, end),
        "removeTop3Trades": remove_best_trade_metrics(trades, start, end, count=3),
        "removeBestMonth": remove_best_month_metrics(trades, start, end),
        "excludedRemoveBestMonth": remove_best_month_metrics(excluded, start, end),
        "concentration": concentration(trades, start, end),
        "excludedConcentration": concentration(excluded, start, end),
        "tradeBootstrap": v63.bootstrap_trades([trade.base_pct for trade in trades], rng),
        "excludedTradeBootstrap": v63.bootstrap_trades([trade.base_pct for trade in excluded], rng),
        "monthBootstrap": v63.bootstrap_months(trades, "base_pct", rng),
        "excludedMonthBootstrap": v63.bootstrap_months(excluded, "base_pct", rng),
        "waveExclusion": exclusion,
        "trades": [asdict(trade) for trade in trades],
        "excludedTrades": [asdict(trade) for trade in excluded],
    }


def robustness_pass(result: dict, require_trades: int) -> bool:
    return bool(
        result["included"]["trades"] >= require_trades
        and result["includedSevere"]["compoundedReturnPct"] > 0
        and result["excludedSevere"]["compoundedReturnPct"] > 0
        and result["cost0p56"]["compoundedReturnPct"] > 0
        and result["excludedCost0p56"]["compoundedReturnPct"] > 0
        and result["excludedCost0p70"]["compoundedReturnPct"] > 0
        and result["removeBestTrade"]["compoundedReturnPct"] > 0
        and result["removeTop3Trades"]["compoundedReturnPct"] > 0
        and result["removeBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and result["excludedRemoveBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and result["tradeBootstrap"]["returnP05"] > 0
        and result["excludedTradeBootstrap"]["returnP05"] > 0
    )


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    now_end = int(now.timestamp() * 1000) // HOUR * HOUR

    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    btc, _ = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    pengu, btc, funding, _ = archive_source.trim_to_complete_funding_window(pengu, btc, funding, funding_months)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    selection_events = v62.selection_events(pengu, folds)
    flash = v60.run_candidate(v60.FLASH, v62.FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, v62.DISTRIBUTION_EXIT, pengu, btc, funding, features)

    passed = []
    diagnostics = []
    for low_gross, high_gross, operation, threshold in gate_space():
        trades = build_candidate(
            distribution,
            flash,
            pengu,
            features,
            low_gross,
            high_gross,
            operation,
            threshold,
        )
        item = v62.evaluate(trades, folds, selection_events)
        item.update({
            "lowGross": low_gross,
            "highGross": high_gross,
            "operation": operation,
            "threshold": threshold,
            "gateId": f"D{low_gross:g}_{high_gross:g}_M3_{operation}_{threshold:g}".replace(".", "p").replace("-", "N"),
        })
        item["passedBeforeCluster"] = selection_pass(item, folds)
        diagnostics.append(item)
        if item["passedBeforeCluster"]:
            passed.append(item)

    cluster_counts: Dict[tuple, int] = {}
    for item in passed:
        cluster_counts[cluster_key(item)] = cluster_counts.get(cluster_key(item), 0) + 1
    stable = []
    for item in passed:
        item["selectionClusterSize"] = cluster_counts.get(cluster_key(item), 0)
        if item["selectionClusterSize"] >= 2:
            stable.append(item)
    stable.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    selected = stable[0] if stable else None
    archive_holdout_pass = bool(selected and holdout_pass(selected))

    if selected:
        archive_result = venue_result("BINANCE_ARCHIVE", pengu, btc, funding, selected)
        aster_result = venue_result(
            "ASTER",
            v47.fetch_klines("PENGUUSDT", now_end),
            v47.fetch_klines("BTCUSDT", now_end),
            v47.fetch_funding("PENGUUSDT", now_end),
            selected,
        )
        archive_robustness = robustness_pass(archive_result, 30)
        aster_robustness = robustness_pass(aster_result, 15)
    else:
        archive_result = None
        aster_result = None
        archive_robustness = False
        aster_robustness = False

    status = (
        "CONDITIONAL_DISTRIBUTION_FULL_PASS"
        if archive_holdout_pass and archive_robustness and aster_robustness
        else "CONDITIONAL_DISTRIBUTION_ARCHIVE_PASS"
        if archive_holdout_pass and archive_robustness
        else "NO_ROBUST_CONDITIONAL_DISTRIBUTION"
    )
    result = rounded({
        "version": 65,
        "strategyId": "PENGU_V65_CONDITIONAL_DISTRIBUTION",
        "generatedAt": now.isoformat(),
        "status": status,
        "entryAndExitFrozen": True,
        "flashGross": FLASH_GROSS,
        "extremeGross": EXTREME_GROSS,
        "maximumPenguGross": 0.30,
        "gateCount": len(gate_space()),
        "passedBeforeCluster": len(passed),
        "stablePassed": len(stable),
        "selected": selected,
        "archiveHoldoutPassed": archive_holdout_pass,
        "archiveRobustnessPassed": archive_robustness,
        "asterRobustnessPassed": aster_robustness,
        "archive": archive_result,
        "aster": aster_result,
        "topDiagnostics": diagnostics[:30],
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "holdoutUsedForSelection": False,
        },
        "limitations": [
            "The gate family was motivated after observing earlier aggregate archive results; pristine human-blind evidence remains false.",
            "The final chronological 20% was not used by the gate selection algorithm.",
            "Aster is cross-venue evidence and overlaps much of the Binance archive period.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v65-conditional-distribution.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    report = [
        "# PENGU V65 Conditional Distribution",
        "",
        f"- Status: **{status}**",
        f"- Selected gate: **{selected['gateId'] if selected else 'NONE'}**",
        f"- Passed / stable: {len(passed)} / {len(stable)}",
        f"- Archive Holdout: **{'PASS' if archive_holdout_pass else 'FAIL'}**",
        f"- Archive robustness: **{'PASS' if archive_robustness else 'FAIL'}**",
        f"- Aster robustness: **{'PASS' if aster_robustness else 'FAIL'}**",
        "",
        f"- Archive included: {archive_result['included']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive Severe: {archive_result['includedSevere']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive waves excluded: {archive_result['excluded']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive excluded Severe: {archive_result['excludedSevere']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive excluded cost 0.56%: {archive_result['excludedCost0p56']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive remove best trade: {archive_result['removeBestTrade']['compoundedReturnPct'] if archive_result else None}%",
        f"- Archive bootstrap P05: {archive_result['tradeBootstrap']['returnP05'] if archive_result else None}%",
        f"- Archive excluded bootstrap P05: {archive_result['excludedTradeBootstrap']['returnP05'] if archive_result else None}%",
        "",
        f"- Aster included: {aster_result['included']['compoundedReturnPct'] if aster_result else None}%",
        f"- Aster waves excluded: {aster_result['excluded']['compoundedReturnPct'] if aster_result else None}%",
        f"- Aster excluded cost 0.56%: {aster_result['excludedCost0p56']['compoundedReturnPct'] if aster_result else None}%",
        f"- Aster remove best trade: {aster_result['removeBestTrade']['compoundedReturnPct'] if aster_result else None}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v65-conditional-distribution.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
