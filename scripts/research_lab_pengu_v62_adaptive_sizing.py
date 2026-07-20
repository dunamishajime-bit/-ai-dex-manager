from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, replace
from pathlib import Path
from typing import Dict, List

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_v60_delayed_exit as v60
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
BASE_COST_PCT = 0.14
SEVERE_COST_PCT = 0.28

FLASH_EXIT = v60.ExitConfig(36, 3.5, 36, 3.5)
DISTRIBUTION_EXIT = v60.ExitConfig(24, 2.5, 24, 3.5)


def no_unconfirmed_probe(*args, **kwargs):
    return None


v60.make_probe_only = no_unconfirmed_probe


def sizing_space() -> list[tuple[float, float, float]]:
    return list(itertools.product(
        (0.0, 0.05, 0.10, 0.15),
        (0.10, 0.15, 0.20),
        (0.15, 0.20, 0.25, 0.30),
    ))


def rescale_trade(trade: v50.Trade, new_gross: float) -> v50.Trade:
    if trade.total_gross <= 0:
        raise ValueError("Cannot rescale a zero-gross trade")
    ratio = new_gross / trade.total_gross
    gross_pct = trade.gross_pct * ratio
    funding_pct = trade.funding_pct * ratio
    base_pct = gross_pct - funding_pct - new_gross * BASE_COST_PCT
    severe_pct = gross_pct - funding_pct - new_gross * SEVERE_COST_PCT
    return replace(
        trade,
        probe_gross=trade.probe_gross * ratio,
        add_gross=trade.add_gross * ratio,
        total_gross=new_gross,
        gross_pct=gross_pct,
        funding_pct=funding_pct,
        base_pct=base_pct,
        severe_pct=severe_pct,
    )


def scaled_engine(
    distribution: List[v50.Trade],
    flash: List[v50.Trade],
    distribution_gross: float,
    flash_gross: float,
    extreme_gross: float,
) -> List[v50.Trade]:
    distribution_scaled = [
        rescale_trade(trade, distribution_gross)
        for trade in distribution
        if distribution_gross > 0
    ]
    flash_scaled = [
        rescale_trade(
            trade,
            extreme_gross if trade.mode == "EXTREME_PROBE_ADD" else flash_gross,
        )
        for trade in flash
    ]
    return v60.combine_same_side(distribution_scaled, flash_scaled)


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


def selection_pass(item: dict) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    wave = item["wave"]
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
        and excluded["validation"]["maxDrawdownPct"] >= -3.0
        and wave["events"] > 0
        and wave["capturedEvents"] / wave["events"] >= 0.50
        and wave["profitableCapturedEvents"] / wave["events"] >= 0.50
    )


def cluster_key(item: dict) -> tuple:
    return (
        round(item["distributionGross"] / 0.05),
        round(item["flashGross"] / 0.05),
    )


def rank_key(item: dict) -> tuple:
    included = item["included"]
    excluded = item["excluded"]
    return (
        excluded["validationSevere"]["compoundedReturnPct"],
        included["validationSevere"]["compoundedReturnPct"],
        excluded["trainSevere"]["compoundedReturnPct"],
        included["trainSevere"]["compoundedReturnPct"],
        included["validation"]["maxDrawdownPct"],
        included["train"]["maxDrawdownPct"],
        -item["extremeGross"],
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
        and h["maxDrawdownPct"] >= -1.5
        and hs["maxDrawdownPct"] >= -1.6
        and (h["profitFactor"] or 0) >= 1.05
        and (he["profitFactor"] or 0) >= 1.05
    )


def run_aster_forward(selected: dict, cutoff: int, now_end: int) -> dict:
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    flash = v60.run_candidate(v60.FLASH, FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, DISTRIBUTION_EXIT, pengu, btc, funding, features)
    combined = scaled_engine(
        distribution,
        flash,
        float(selected["distributionGross"]),
        float(selected["flashGross"]),
        float(selected["extremeGross"]),
    )
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

    flash = v60.run_candidate(v60.FLASH, FLASH_EXIT, pengu, btc, funding, features)
    distribution = v60.run_candidate(v60.DISTRIBUTION, DISTRIBUTION_EXIT, pengu, btc, funding, features)

    passed = []
    diagnostics = []
    for distribution_gross, flash_gross, extreme_gross in sizing_space():
        combined = scaled_engine(
            distribution,
            flash,
            distribution_gross,
            flash_gross,
            extreme_gross,
        )
        item = evaluate(combined, folds, events)
        item["distributionGross"] = distribution_gross
        item["flashGross"] = flash_gross
        item["extremeGross"] = extreme_gross
        item["sizingId"] = f"D{distribution_gross:g}_F{flash_gross:g}_X{extreme_gross:g}".replace(".", "p")
        item["passedBeforeCluster"] = selection_pass(item)
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
        if item["selectionClusterSize"] >= 2:
            stable.append(item)
    stable.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    selected = stable[0] if stable else None
    accepted = bool(selected and holdout_pass(selected))
    aster_forward = run_aster_forward(selected, cutoff, now_end) if selected else None
    status = "ADAPTIVE_SIZING_HOLDOUT_PASS" if accepted else "NO_ROBUST_ADAPTIVE_SIZING"

    result = rounded({
        "version": 62,
        "strategyId": "PENGU_V62_ADAPTIVE_SIZING",
        "generatedAt": now.isoformat(),
        "status": status,
        "entryAndExitFrozen": True,
        "flashExit": asdict(FLASH_EXIT),
        "distributionExit": asdict(DISTRIBUTION_EXIT),
        "sizingCount": len(sizing_space()),
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
            "maximumPenguGross": 0.30,
        },
        "limitations": [
            "Only position sizing was optimized; V61 signals and exits were frozen.",
            "The final archive 20% was used only for acceptance or rejection.",
            "The operator has observed earlier archive results, so pristine human-blind evidence remains false.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v62-adaptive-sizing.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if selected:
        inc = selected["included"]
        exc = selected["excluded"]
    else:
        inc = exc = {key: {} for key in ("full", "fullSevere", "holdout", "holdoutSevere")}
    report = [
        "# PENGU V62 Adaptive Sizing",
        "",
        f"- Status: **{status}**",
        f"- Selected sizing: **{selected['sizingId'] if selected else 'NONE'}**",
        f"- Distribution / Flash / Extreme gross: **{selected['distributionGross'] if selected else None} / {selected['flashGross'] if selected else None} / {selected['extremeGross'] if selected else None}**",
        f"- Passed / stable: {len(passed)} / {len(stable)}",
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
    (state_dir / "pengu-v62-adaptive-sizing.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
