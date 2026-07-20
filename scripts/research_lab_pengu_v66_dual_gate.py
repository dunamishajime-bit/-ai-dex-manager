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
import research_lab_pengu_v65_conditional_distribution as v65
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
MAX_GROSS = 0.30
RNG_SEED = 66066

v60.make_probe_only = v62.no_unconfirmed_probe


def gate_space() -> list[tuple[float, float]]:
    return list(itertools.product(
        (-6.0, -5.0, -4.0, -3.0, -2.5),
        (0.80, 0.85, 0.90, 0.95, 1.00, 1.10, 1.20),
    ))


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def index_map(rows: List[dict]) -> Dict[int, int]:
    return {int(row["ts"]): index for index, row in enumerate(rows)}


def build_candidate(
    distribution: List[v50.Trade],
    flash: List[v50.Trade],
    rows: List[dict],
    features: dict,
    distribution_mom3_threshold: float,
    flash_volume_threshold: float,
) -> List[v50.Trade]:
    indices = index_map(rows)
    distribution_scaled: List[v50.Trade] = []
    for trade in distribution:
        index = indices.get(int(trade.signal_ts))
        if index is None:
            continue
        momentum3 = features["mom3"][index]
        if momentum3 is not None and float(momentum3) >= distribution_mom3_threshold:
            distribution_scaled.append(v62.rescale_trade(trade, MAX_GROSS))

    flash_scaled: List[v50.Trade] = []
    for trade in flash:
        index = indices.get(int(trade.signal_ts))
        if index is None:
            continue
        if trade.mode == "EXTREME_PROBE_ADD":
            flash_scaled.append(v62.rescale_trade(trade, MAX_GROSS))
            continue
        volume_acceleration = features["volumeAcceleration"][index]
        if volume_acceleration is not None and float(volume_acceleration) >= flash_volume_threshold:
            flash_scaled.append(v62.rescale_trade(trade, MAX_GROSS))

    return v60.combine_same_side(distribution_scaled, flash_scaled)


def selection_pass(item: dict, folds: list[tuple[int, int]]) -> bool:
    return v65.selection_pass(item, folds)


def rank_key(item: dict) -> tuple:
    return (
        item["excluded"]["validationSevere"]["compoundedReturnPct"],
        item["included"]["validationSevere"]["compoundedReturnPct"],
        item["excluded"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["train"]["maxDrawdownPct"],
        item["selectionRemoveBestTradeSevere"]["compoundedReturnPct"],
        -item["flashVolumeThreshold"],
    )


def cluster_key(item: dict) -> tuple:
    return (item["distributionMom3Threshold"],)


def holdout_pass(item: dict) -> bool:
    return v65.holdout_pass(item)


def corrected_stress_excluded(
    trades: List[v50.Trade],
    events: List[dict],
    start: int,
    end: int,
    cost_pct: float,
) -> dict:
    return v65.corrected_stress_excluded(trades, events, start, end, cost_pct)


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
        float(selected["distributionMom3Threshold"]),
        float(selected["flashVolumeThreshold"]),
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
        "removeBestTrade": v65.remove_best_trade_metrics(trades, start, end),
        "removeTop3Trades": v65.remove_best_trade_metrics(trades, start, end, count=3),
        "removeBestMonth": v65.remove_best_month_metrics(trades, start, end),
        "excludedRemoveBestMonth": v65.remove_best_month_metrics(excluded, start, end),
        "concentration": v65.concentration(trades, start, end),
        "excludedConcentration": v65.concentration(excluded, start, end),
        "tradeBootstrap": v63.bootstrap_trades([trade.base_pct for trade in trades], rng),
        "excludedTradeBootstrap": v63.bootstrap_trades([trade.base_pct for trade in excluded], rng),
        "monthBootstrap": v63.bootstrap_months(trades, "base_pct", rng),
        "excludedMonthBootstrap": v63.bootstrap_months(excluded, "base_pct", rng),
        "waveExclusion": exclusion,
        "trades": [asdict(trade) for trade in trades],
        "excludedTrades": [asdict(trade) for trade in excluded],
    }


def robustness_pass(result: dict, minimum_trades: int) -> bool:
    return v65.robustness_pass(result, minimum_trades)


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
    for distribution_threshold, flash_volume_threshold in gate_space():
        trades = build_candidate(
            distribution,
            flash,
            pengu,
            features,
            distribution_threshold,
            flash_volume_threshold,
        )
        item = v62.evaluate(trades, folds, selection_events)
        item.update({
            "distributionMom3Threshold": distribution_threshold,
            "flashVolumeThreshold": flash_volume_threshold,
            "gateId": f"D_M3_GE_{distribution_threshold:g}_F_VOL_GE_{flash_volume_threshold:g}".replace(".", "p").replace("-", "N"),
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
        "DUAL_GATE_FULL_PASS"
        if archive_holdout_pass and archive_robustness and aster_robustness
        else "DUAL_GATE_ARCHIVE_PASS"
        if archive_holdout_pass and archive_robustness
        else "NO_ROBUST_DUAL_GATE"
    )
    result = rounded({
        "version": 66,
        "strategyId": "PENGU_V66_DUAL_GATE",
        "generatedAt": now.isoformat(),
        "status": status,
        "entryAndExitFrozen": True,
        "maximumPenguGross": MAX_GROSS,
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
            "The gate families were motivated after earlier aggregate archive analysis; pristine human-blind evidence remains false.",
            "The final chronological 20% was not used by the dual-gate selection algorithm.",
            "Aster is cross-venue evidence and overlaps much of the Binance archive period.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v66-dual-gate.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    report = [
        "# PENGU V66 Dual Gate",
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
    (state_dir / "pengu-v66-dual-gate.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
