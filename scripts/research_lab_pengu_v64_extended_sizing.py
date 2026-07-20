from __future__ import annotations

# Isolated rerun revision 1. Strategy logic is unchanged.

import datetime as dt
import itertools
import json
import os
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
v60.make_probe_only = v62.no_unconfirmed_probe


def sizing_space() -> list[tuple[float, float, float]]:
    return list(itertools.product(
        (0.0, 0.05, 0.10, 0.15),
        (0.20, 0.25, 0.30),
        (0.25, 0.30),
    ))


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def concentration(trades: List[v50.Trade], start: int, end: int) -> dict:
    values = sorted(
        (trade.base_pct for trade in trades if start <= trade.entry_ts < end and trade.base_pct > 0),
        reverse=True,
    )
    total = sum(values)
    return {
        "positiveSumPct": total,
        "bestTradePct": values[0] if values else None,
        "bestTradeSharePct": values[0] / total * 100.0 if values and total > 0 else None,
        "top3SharePct": sum(values[:3]) / total * 100.0 if values and total > 0 else None,
    }


def remove_best_trade_metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    selected = [trade for trade in trades if start <= trade.entry_ts < end]
    if not selected:
        return metrics([], start, end, severe)
    field = "severe_pct" if severe else "base_pct"
    best = max(selected, key=lambda trade: getattr(trade, field))
    filtered = [trade for trade in trades if trade is not best]
    return metrics(filtered, start, end, severe)


def selection_pass(item: dict, folds: list[tuple[int, int]]) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    wave = item["wave"]
    selection_start = folds[0][0]
    selection_end = folds[3][1]
    trades = [v50.Trade(**row) for row in item["trades"]]
    concentration_result = concentration(trades, selection_start, selection_end)
    no_best = remove_best_trade_metrics(trades, selection_start, selection_end, True)
    item["selectionConcentration"] = concentration_result
    item["selectionRemoveBestTradeSevere"] = no_best
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
        and no_best["compoundedReturnPct"] > 0
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
        -item["flashGross"],
        -item["distributionGross"],
    )


def cluster_key(item: dict) -> tuple:
    return (item["flashGross"], item["extremeGross"])


def holdout_pass(item: dict) -> bool:
    h = item["included"]["holdout"]
    hs = item["included"]["holdoutSevere"]
    he = item["excluded"]["holdout"]
    hes = item["excluded"]["holdoutSevere"]
    return bool(
        h["trades"] >= 3
        and h["compoundedReturnPct"] > 0
        and hs["compoundedReturnPct"] > 0
        and he["compoundedReturnPct"] > 0
        and hes["compoundedReturnPct"] > 0
        and h["maxDrawdownPct"] >= -1.5
        and hs["maxDrawdownPct"] >= -1.6
        and (h["profitFactor"] or 0) >= 1.05
    )


def corrected_stress_excluded(trades: List[v50.Trade], events: list[dict], start: int, end: int, cost: float) -> dict:
    stressed = [v63.stress_trade(trade, cost) for trade in trades]
    excluded, _ = common.exclude_large_wave_profits(stressed, events)
    return metrics(excluded, start, end)


def venue_result(
    name: str,
    pengu: list[dict],
    btc: list[dict],
    funding: list[dict],
    distribution_gross: float,
    flash_gross: float,
    extreme_gross: float,
) -> dict:
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    flash = v60.run_candidate(v60.FLASH, v62.FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, v62.DISTRIBUTION_EXIT, pengu, btc, funding, features)
    trades = v62.scaled_engine(distribution, flash, distribution_gross, flash_gross, extreme_gross)
    start = int(pengu[0]["ts"])
    end = int(pengu[-1]["ts"]) + HOUR
    events = [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
    excluded, exclusion = common.exclude_large_wave_profits(trades, events)
    return {
        "venue": name,
        "startIso": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
        "endIso": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
        "included": metrics(trades, start, end),
        "includedSevere": metrics(trades, start, end, True),
        "excluded": metrics(excluded, start, end),
        "excludedSevere": metrics(excluded, start, end, True),
        "excludedCost0p56": corrected_stress_excluded(trades, events, start, end, 0.56),
        "removeBestTrade": remove_best_trade_metrics(trades, start, end),
        "concentration": concentration(trades, start, end),
        "waveExclusion": exclusion,
        "trades": [asdict(trade) for trade in trades],
    }


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
    events = v62.selection_events(pengu, folds)
    flash = v60.run_candidate(v60.FLASH, v62.FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, v62.DISTRIBUTION_EXIT, pengu, btc, funding, features)

    passed = []
    diagnostics = []
    for distribution_gross, flash_gross, extreme_gross in sizing_space():
        trades = v62.scaled_engine(distribution, flash, distribution_gross, flash_gross, extreme_gross)
        item = v62.evaluate(trades, folds, events)
        item.update({
            "distributionGross": distribution_gross,
            "flashGross": flash_gross,
            "extremeGross": extreme_gross,
            "sizingId": f"D{distribution_gross:g}_F{flash_gross:g}_X{extreme_gross:g}".replace(".", "p"),
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
        aster = venue_result(
            "ASTER",
            v47.fetch_klines("PENGUUSDT", now_end),
            v47.fetch_klines("BTCUSDT", now_end),
            v47.fetch_funding("PENGUUSDT", now_end),
            selected["distributionGross"],
            selected["flashGross"],
            selected["extremeGross"],
        )
        aster_pass = bool(
            aster["included"]["trades"] >= 5
            and aster["includedSevere"]["compoundedReturnPct"] > 0
            and aster["excludedSevere"]["compoundedReturnPct"] > 0
            and aster["excludedCost0p56"]["compoundedReturnPct"] > 0
            and aster["removeBestTrade"]["compoundedReturnPct"] > 0
        )
    else:
        aster = None
        aster_pass = False

    status = (
        "EXTENDED_SIZING_FULL_PASS" if archive_holdout_pass and aster_pass
        else "EXTENDED_SIZING_ARCHIVE_PASS" if archive_holdout_pass
        else "NO_ROBUST_EXTENDED_SIZING"
    )
    result = rounded({
        "version": 64,
        "strategyId": "PENGU_V64_EXTENDED_SIZING",
        "generatedAt": now.isoformat(),
        "status": status,
        "entryAndExitFrozen": True,
        "maximumPenguGross": 0.30,
        "sizingCount": len(sizing_space()),
        "passedBeforeCluster": len(passed),
        "stablePassed": len(stable),
        "selected": selected,
        "archiveHoldoutPassed": archive_holdout_pass,
        "asterPassed": aster_pass,
        "aster": aster,
        "topDiagnostics": diagnostics[:24],
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "holdoutUsedForSelection": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v64-extended-sizing.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if selected:
        inc = selected["included"]
        exc = selected["excluded"]
    else:
        inc = exc = {key: {} for key in ("full", "fullSevere", "holdout", "holdoutSevere")}
    report = [
        "# PENGU V64 Extended Sizing",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected['sizingId'] if selected else 'NONE'}**",
        f"- Passed / stable: {len(passed)} / {len(stable)}",
        f"- Archive Holdout: **{'PASS' if archive_holdout_pass else 'FAIL'}**",
        f"- Aster: **{'PASS' if aster_pass else 'FAIL'}**",
        "",
        f"- Full included: {inc['full'].get('compoundedReturnPct')}% / PF {inc['full'].get('profitFactor')} / DD {inc['full'].get('maxDrawdownPct')}%",
        f"- Full Severe: {inc['fullSevere'].get('compoundedReturnPct')}%",
        f"- Full waves excluded: {exc['full'].get('compoundedReturnPct')}% / PF {exc['full'].get('profitFactor')} / DD {exc['full'].get('maxDrawdownPct')}%",
        f"- Full excluded Severe: {exc['fullSevere'].get('compoundedReturnPct')}%",
        f"- Holdout: {inc['holdout'].get('compoundedReturnPct')}% / Severe {inc['holdoutSevere'].get('compoundedReturnPct')}%",
        f"- Holdout excluded: {exc['holdout'].get('compoundedReturnPct')}% / Severe {exc['holdoutSevere'].get('compoundedReturnPct')}%",
        "",
        f"- Aster included: {aster['included']['compoundedReturnPct'] if aster else None}%",
        f"- Aster waves excluded: {aster['excluded']['compoundedReturnPct'] if aster else None}%",
        f"- Aster excluded cost 0.56%: {aster['excludedCost0p56']['compoundedReturnPct'] if aster else None}%",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v64-extended-sizing.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
