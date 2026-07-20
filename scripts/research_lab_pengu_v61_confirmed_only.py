from __future__ import annotations

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
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR


def no_unconfirmed_probe(*args, **kwargs):
    return None


v60.make_probe_only = no_unconfirmed_probe


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def split_metrics(trades: List[v50.Trade], folds: list[tuple[int, int]]) -> dict:
    return {
        "train": metrics(trades, folds[0][0], folds[2][1]),
        "trainSevere": metrics(trades, folds[0][0], folds[2][1], True),
        "validation": metrics(trades, folds[3][0], folds[3][1]),
        "validationSevere": metrics(trades, folds[3][0], folds[3][1], True),
        "holdout": metrics(trades, folds[4][0], folds[4][1]),
        "holdoutSevere": metrics(trades, folds[4][0], folds[4][1], True),
        "full": metrics(trades, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(trades, folds[0][0], folds[-1][1], True),
    }


def selection_events(pengu: list[dict], folds: list[tuple[int, int]]) -> list[dict]:
    cutoff = folds[3][1]
    return [
        event
        for event in [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
        if int(event["startTs"]) < cutoff
    ]


def evaluate(trades: List[v50.Trade], folds: list[tuple[int, int]], events: list[dict]) -> dict:
    excluded, exclusion = common.exclude_large_wave_profits(trades, events)
    return {
        "included": split_metrics(trades, folds),
        "excluded": split_metrics(excluded, folds),
        "wave": v50.capture_metrics(trades, events, 12, -1),
        "exclusion": exclusion,
        "trades": [asdict(trade) for trade in trades],
    }


def passes_selection(item: dict) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    wave = item["wave"]
    return bool(
        included["train"]["trades"] >= 10
        and included["train"]["compoundedReturnPct"] > 0
        and included["trainSevere"]["compoundedReturnPct"] > 0
        and included["validation"]["trades"] >= 2
        and included["validation"]["compoundedReturnPct"] > 0
        and included["validationSevere"]["compoundedReturnPct"] > 0
        and excluded["train"]["compoundedReturnPct"] > 0
        and excluded["trainSevere"]["compoundedReturnPct"] > 0
        and excluded["validation"]["compoundedReturnPct"] > 0
        and excluded["validationSevere"]["compoundedReturnPct"] > 0
        and wave["events"] > 0
        and wave["capturedEvents"] / wave["events"] >= 0.50
        and wave["profitableCapturedEvents"] / wave["events"] >= 0.50
    )


def cluster_key(item: dict) -> tuple:
    flash = item["flashExit"]
    distribution = item["distributionExit"]
    return (
        flash["hold_hours"],
        flash["trail_start_hours"],
        distribution["hold_hours"],
        distribution["trail_start_hours"],
    )


def rank_key(item: dict) -> tuple:
    included = item["included"]
    excluded = item["excluded"]
    flash = item["flashExit"]
    distribution = item["distributionExit"]
    combined_stop = float(flash["hard_stop_atr"]) + float(distribution["hard_stop_atr"])
    combined_hold = int(flash["hold_hours"]) + int(distribution["hold_hours"])
    return (
        excluded["validationSevere"]["compoundedReturnPct"],
        included["validationSevere"]["compoundedReturnPct"],
        excluded["validation"]["maxDrawdownPct"],
        included["validation"]["maxDrawdownPct"],
        -combined_stop,
        -combined_hold,
        excluded["trainSevere"]["compoundedReturnPct"],
        included["trainSevere"]["compoundedReturnPct"],
    )


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
        and (h["profitFactor"] or 0) >= 1.05
        and (he["profitFactor"] or 0) >= 1.05
    )


def build_rows(pengu: list[dict], btc: list[dict], funding: list[dict], features: dict):
    flash_rows: Dict[str, List[v50.Trade]] = {}
    distribution_rows: Dict[str, List[v50.Trade]] = {}
    configs = v60.exit_configs()
    for position, config in enumerate(configs, start=1):
        if position % 12 == 0:
            print(f"Confirmed-only exit configs {position}/{len(configs)}")
        flash_rows[config.config_id] = v60.run_candidate(v60.FLASH, config, pengu, btc, funding, features)
        distribution_rows[config.config_id] = v60.run_candidate(v60.DISTRIBUTION, config, pengu, btc, funding, features)
    return configs, flash_rows, distribution_rows


def run_selected_on_aster(selected: dict, cutoff: int, now_end: int) -> dict:
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    flash_config = v60.ExitConfig(**selected["flashExit"])
    distribution_config = v60.ExitConfig(**selected["distributionExit"])
    flash = v60.run_candidate(v60.FLASH, flash_config, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, distribution_config, pengu, btc, funding, features)
    combined = v60.combine_same_side(distribution, flash)
    start = max(cutoff, int(pengu[0]["ts"]))
    end = int(pengu[-1]["ts"]) + HOUR
    return {
        "startTs": start,
        "endTs": end,
        "startIso": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
        "endIso": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
        "normal": metrics(combined, start, end),
        "severe": metrics(combined, start, end, True),
        "trades": [asdict(trade) for trade in combined if start <= trade.entry_ts < end],
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
    pengu, btc, funding, cutoff = archive_source.trim_to_complete_funding_window(pengu, btc, funding, funding_months)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    events = selection_events(pengu, folds)

    configs, flash_rows, distribution_rows = build_rows(pengu, btc, funding, features)
    passed = []
    diagnostics = []
    for flash_config, distribution_config in itertools.product(configs, configs):
        combined = v60.combine_same_side(
            distribution_rows[distribution_config.config_id],
            flash_rows[flash_config.config_id],
        )
        item = evaluate(combined, folds, events)
        item["flashExit"] = asdict(flash_config)
        item["flashExitId"] = flash_config.config_id
        item["distributionExit"] = asdict(distribution_config)
        item["distributionExitId"] = distribution_config.config_id
        item["passedBeforeCluster"] = passes_selection(item)
        diagnostics.append(item)
        if item["passedBeforeCluster"]:
            passed.append(item)

    cluster_counts: Dict[tuple, int] = {}
    for item in passed:
        key = cluster_key(item)
        cluster_counts[key] = cluster_counts.get(key, 0) + 1
    stable = []
    for item in passed:
        item["selectionClusterSize"] = cluster_counts.get(cluster_key(item), 0)
        if item["selectionClusterSize"] >= 3:
            stable.append(item)
    stable.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    selected = stable[0] if stable else None
    accepted = bool(selected and holdout_pass(selected))
    aster_forward = run_selected_on_aster(selected, cutoff, now_end) if selected else None
    status = "CONFIRMED_ONLY_HOLDOUT_PASS" if accepted else "NO_ROBUST_CONFIRMED_ONLY"

    result = rounded({
        "version": 61,
        "strategyId": "PENGU_V61_CONFIRMED_ONLY_DELAYED_EXIT",
        "generatedAt": now.isoformat(),
        "status": status,
        "unconfirmedProbeEnabled": False,
        "exitConfigCount": len(configs),
        "combinationCount": len(configs) ** 2,
        "passedBeforeCluster": len(passed),
        "stablePassed": len(stable),
        "selected": selected,
        "holdoutPassed": accepted,
        "asterPostArchive": aster_forward,
        "topDiagnostics": diagnostics[:30],
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "holdoutUsedForSelection": False,
        },
        "limitations": [
            "The final archive 20% was used only for acceptance or rejection.",
            "The confirmed-only design was motivated after observing a V60 holdout probe loss, so human-blind evidence is no longer pristine.",
            "Aster post-archive evidence may contain few or zero trades because the window is short.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v61-confirmed-only.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if selected:
        inc = selected["included"]
        exc = selected["excluded"]
    else:
        inc = exc = {key: {} for key in ("full", "fullSevere", "holdout", "holdoutSevere")}
    report = [
        "# PENGU V61 Confirmed-only Delayed Exit",
        "",
        f"- Status: **{status}**",
        "- Unconfirmed Probe orders: **DISABLED**",
        f"- Passed / stable: {len(passed)} / {len(stable)}",
        f"- Flash exit: **{selected['flashExitId'] if selected else 'NONE'}**",
        f"- Distribution exit: **{selected['distributionExitId'] if selected else 'NONE'}**",
        f"- Holdout pass: **{'YES' if accepted else 'NO'}**",
        "",
        f"- Full included: {inc['full'].get('compoundedReturnPct')}% / PF {inc['full'].get('profitFactor')} / DD {inc['full'].get('maxDrawdownPct')}%",
        f"- Full Severe: {inc['fullSevere'].get('compoundedReturnPct')}%",
        f"- Full waves excluded: {exc['full'].get('compoundedReturnPct')}% / PF {exc['full'].get('profitFactor')} / DD {exc['full'].get('maxDrawdownPct')}%",
        f"- Full excluded Severe: {exc['fullSevere'].get('compoundedReturnPct')}%",
        f"- Holdout included: {inc['holdout'].get('compoundedReturnPct')}%",
        f"- Holdout Severe: {inc['holdoutSevere'].get('compoundedReturnPct')}%",
        f"- Holdout excluded: {exc['holdout'].get('compoundedReturnPct')}%",
        f"- Holdout excluded Severe: {exc['holdoutSevere'].get('compoundedReturnPct')}%",
        "",
        f"- Aster post-archive: {aster_forward['normal']['compoundedReturnPct'] if aster_forward else None}% / N {aster_forward['normal']['trades'] if aster_forward else None}",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v61-confirmed-only.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
