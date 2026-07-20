from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52
import research_lab_pengu_wave_sleeve_v56 as v56

HOUR = v47.HOUR

EXTRA_EXIT_PROFILES = (
    v49.ExitProfile("RUN48", 2.2, 4.0, 4.0, 48),
    v49.ExitProfile("RUN72", 2.8, 5.0, 5.0, 72),
)
known_profiles = {profile.name for profile in v49.EXIT_PROFILES}
v49.EXIT_PROFILES = tuple(v49.EXIT_PROFILES) + tuple(
    profile for profile in EXTRA_EXIT_PROFILES if profile.name not in known_profiles
)


def long_break_candidates() -> List[v50.Candidate]:
    return [
        v50.Candidate(
            side=1,
            family="BREAK",
            lookback=lookback,
            momentum1h=m1,
            momentum3h=m3,
            relative3h=relative,
            volume_acceleration=volume,
            volatility_expansion=volatility,
            extreme_factor=extreme,
            confirmation_move_pct=confirmation,
            exit_profile=exit_profile,
        )
        for lookback, m1, m3, relative, volume, volatility, extreme, confirmation, exit_profile
        in itertools.product(
            (6, 12),
            (0.35, 0.70, 1.10),
            (2.0, 3.0, 4.0),
            (0.5, 1.0, 1.5),
            (1.1, 1.5),
            (1.0, 1.2),
            (2.2, 3.0),
            (0.4, 0.6),
            ("WIDE", "RUN48", "RUN72"),
        )
    ]


def washout_candidates() -> List[v56.WashoutScout]:
    return [
        v56.WashoutScout(
            side=1,
            family="WASHOUT",
            lookback=6,
            trigger1=m1,
            trigger3=1.5,
            context=0.0,
            volume_threshold=0.3,
            volatility_threshold=0.4,
            distance_atr=9.0,
            confirmation_move_pct=0.2,
            confirmation_hours=1,
            exit_profile=exit_profile,
            current_mom3_max=m3max,
            drawdown24_min=drawdown,
            body_min=body,
        )
        for m1, m3max, drawdown, body, exit_profile in itertools.product(
            (0.8, 1.0, 1.2),
            (-2.5, -3.0, -4.0),
            (-6.0, -8.0, -10.0),
            (0.25, 0.30, 0.40),
            ("FAST", "WIDE", "RUN48"),
        )
    ]


def short_flash_candidates() -> List[v52.Candidate]:
    return [
        v52.Candidate(
            side=-1,
            family="FLASH",
            lookback=lookback,
            trigger1=trigger1,
            trigger3=trigger3,
            context=0.0,
            volume_threshold=volume,
            volatility_threshold=volatility,
            distance_atr=1.0,
            confirmation_move_pct=confirmation,
            confirmation_hours=confirm_hours,
            exit_profile=exit_profile,
        )
        for lookback, trigger1, trigger3, volume, volatility, confirmation, confirm_hours, exit_profile
        in itertools.product(
            (6, 12),
            (1.5, 2.0, 2.5),
            (2.5, 3.5, 5.0),
            (0.8, 1.2, 1.6),
            (0.7, 1.0, 1.2),
            (0.2, 0.4),
            (1, 2),
            ("WIDE", "RUN48", "RUN72"),
        )
    ]


def short_distribution_candidates() -> List[v52.Candidate]:
    return [
        v52.Candidate(
            side=-1,
            family="DISTRIBUTION",
            lookback=lookback,
            trigger1=trigger1,
            trigger3=trigger3,
            context=context,
            volume_threshold=0.5,
            volatility_threshold=0.6,
            distance_atr=distance,
            confirmation_move_pct=confirmation,
            confirmation_hours=confirm_hours,
            exit_profile=exit_profile,
        )
        for lookback, trigger1, trigger3, context, distance, confirmation, confirm_hours, exit_profile
        in itertools.product(
            (6, 12),
            (0.7, 1.0, 1.4),
            (0.5, 1.0, 1.5),
            (1.5, 2.0, 2.5),
            (0.5, 1.0),
            (0.2, 0.4),
            (1, 2),
            ("FAST", "WIDE", "RUN48"),
        )
    ]


def fold_bounds(rows: List[dict], count: int = 5) -> List[Tuple[int, int]]:
    start = int(rows[0]["ts"])
    end = int(rows[-1]["ts"]) + HOUR
    span = end - start
    return [
        (start + span * index // count, start + span * (index + 1) // count)
        for index in range(count)
    ]


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def split_metrics(trades: List[v50.Trade], folds: List[Tuple[int, int]]) -> dict:
    return {
        "folds": [metrics(trades, start, end) for start, end in folds],
        "foldsSevere": [metrics(trades, start, end, True) for start, end in folds],
        "train": metrics(trades, folds[0][0], folds[2][1]),
        "trainSevere": metrics(trades, folds[0][0], folds[2][1], True),
        "validation": metrics(trades, folds[3][0], folds[3][1]),
        "validationSevere": metrics(trades, folds[3][0], folds[3][1], True),
        "holdout": metrics(trades, folds[4][0], folds[4][1]),
        "holdoutSevere": metrics(trades, folds[4][0], folds[4][1], True),
        "full": metrics(trades, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(trades, folds[0][0], folds[-1][1], True),
    }


def candidate_trades(
    family: str,
    candidate,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    features: dict,
) -> List[v50.Trade]:
    if family == "LONG_BREAK":
        trades, _ = v50.run_candidate(candidate, pengu, btc, funding, features)
        return trades
    if family == "WASHOUT":
        trades, _ = v56.run_candidate(candidate, pengu, btc, funding, features)
        return trades
    trades, _ = v52.run_candidate(candidate, pengu, btc, funding, features)
    return trades


def selection_wave_events(pengu: List[dict], folds: List[Tuple[int, int]]) -> List[dict]:
    cutoff = folds[3][1]
    events = [
        *v50.wave_events(pengu, 24, 20.0),
        *v50.wave_events(pengu, 72, 35.0),
    ]
    return [event for event in events if int(event["startTs"]) < cutoff]


def capture_selection(trades: List[v50.Trade], events: List[dict], side: int) -> dict:
    selected = [event for event in events if int(event["side"]) == side]
    audit24 = v50.capture_metrics(trades, [event for event in selected if int(event["endTs"]) - int(event["startTs"]) <= 48 * HOUR], 6, side)
    audit_all = v50.capture_metrics(trades, selected, 12, side)
    return {
        "events": audit_all["events"],
        "captured": audit_all["capturedEvents"],
        "early": audit24["earlyCapturedEvents"] + max(0, audit_all["earlyCapturedEvents"] - audit24["earlyCapturedEvents"]),
        "profitable": audit_all["profitableCapturedEvents"],
        "all": audit_all,
    }


def exclude_wave_profits(trades: List[v50.Trade], events: List[dict]) -> List[v50.Trade]:
    excluded, _ = common.exclude_large_wave_profits(trades, events)
    return excluded


def cluster_key(family: str, candidate) -> tuple:
    if family == "LONG_BREAK":
        return (family, candidate.lookback, candidate.exit_profile, candidate.extreme_factor)
    if family == "WASHOUT":
        return (family, candidate.current_mom3_max, candidate.drawdown24_min, candidate.exit_profile)
    return (family, candidate.lookback, candidate.exit_profile, candidate.confirmation_hours)


def passes_selection(
    included: dict,
    excluded: dict,
    capture: dict,
    side: int,
) -> bool:
    minimum_train = 12 if side < 0 else 8
    positive_excluded_folds = sum(
        row["compoundedReturnPct"] > 0 for row in excluded["folds"][:4]
    )
    positive_excluded_severe_folds = sum(
        row["compoundedReturnPct"] > 0 for row in excluded["foldsSevere"][:4]
    )
    return bool(
        included["train"]["trades"] >= minimum_train
        and included["train"]["compoundedReturnPct"] > 0
        and included["trainSevere"]["compoundedReturnPct"] > 0
        and (included["train"]["profitFactor"] or 0) >= 1.10
        and included["validation"]["trades"] >= 2
        and included["validation"]["compoundedReturnPct"] > 0
        and included["validationSevere"]["compoundedReturnPct"] >= 0
        and (included["validation"]["profitFactor"] or 0) >= 1.00
        and excluded["train"]["compoundedReturnPct"] > 0
        and excluded["trainSevere"]["compoundedReturnPct"] > 0
        and (excluded["train"]["profitFactor"] or 0) >= 1.05
        and excluded["validation"]["compoundedReturnPct"] >= 0
        and excluded["validationSevere"]["compoundedReturnPct"] >= -0.10
        and positive_excluded_folds >= 3
        and positive_excluded_severe_folds >= 3
        and capture["events"] > 0
        and capture["captured"] / capture["events"] >= 0.50
        and capture["profitable"] / capture["events"] >= 0.50
    )


def rank_key(item: dict) -> tuple:
    excluded = item["excluded"]
    included = item["included"]
    capture = item["capture"]
    return (
        excluded["validationSevere"]["compoundedReturnPct"],
        excluded["validation"]["compoundedReturnPct"],
        included["validationSevere"]["compoundedReturnPct"],
        capture["profitable"],
        capture["captured"],
        excluded["trainSevere"]["compoundedReturnPct"],
        included["trainSevere"]["compoundedReturnPct"],
        included["train"]["maxDrawdownPct"],
    )


def search_family(
    family: str,
    candidates: list,
    side: int,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    features: dict,
    folds: List[Tuple[int, int]],
    selection_events: List[dict],
) -> dict:
    passed: List[dict] = []
    diagnostics: List[dict] = []
    for position, candidate in enumerate(candidates, start=1):
        if position % 500 == 0:
            print(f"{family} {position}/{len(candidates)}")
        trades = candidate_trades(family, candidate, pengu, btc, funding, features)
        excluded_trades = exclude_wave_profits(trades, selection_events)
        included = split_metrics(trades, folds)
        excluded = split_metrics(excluded_trades, folds)
        capture = capture_selection(trades, selection_events, side)
        item = {
            "family": family,
            "candidate": asdict(candidate),
            "candidateId": candidate.candidate_id,
            "included": included,
            "excluded": excluded,
            "capture": capture,
            "trades": [asdict(trade) for trade in trades],
            "passedBeforeCluster": passes_selection(included, excluded, capture, side),
        }
        diagnostics.append(item)
        if item["passedBeforeCluster"]:
            passed.append(item)

    clusters: Dict[tuple, int] = {}
    for item in passed:
        candidate = next(candidate for candidate in candidates if candidate.candidate_id == item["candidateId"])
        key = cluster_key(family, candidate)
        clusters[key] = clusters.get(key, 0) + 1
    stable: List[dict] = []
    for item in passed:
        candidate = next(candidate for candidate in candidates if candidate.candidate_id == item["candidateId"])
        item["selectionClusterSize"] = clusters.get(cluster_key(family, candidate), 0)
        if item["selectionClusterSize"] >= 2:
            stable.append(item)
    stable.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    return {
        "family": family,
        "candidateCount": len(candidates),
        "passedBeforeCluster": len(passed),
        "stablePassed": len(stable),
        "selected": stable[0] if stable else None,
        "topDiagnostics": diagnostics[:20],
    }


def rebuild(item: Optional[dict]) -> List[v50.Trade]:
    if not item:
        return []
    return [v50.Trade(**trade) for trade in item["trades"]]


def combine_same_side(*groups: List[v50.Trade]) -> List[v50.Trade]:
    tagged = []
    for priority, group in enumerate(groups):
        tagged.extend((trade.entry_ts, priority, trade) for trade in group)
    tagged.sort(key=lambda row: (row[0], row[1]))
    result: List[v50.Trade] = []
    next_free = 0
    for _, _, trade in tagged:
        if trade.entry_ts < next_free:
            continue
        result.append(trade)
        next_free = trade.exit_ts
    return result


def portfolio_result(
    long_trades: List[v50.Trade],
    short_trades: List[v50.Trade],
    pengu: List[dict],
    folds: List[Tuple[int, int]],
) -> dict:
    combined = v50.combine_sides(long_trades, short_trades)
    events = [
        *v50.wave_events(pengu, 24, 20.0),
        *v50.wave_events(pengu, 72, 35.0),
    ]
    excluded, exclusion = common.exclude_large_wave_profits(combined, events)
    included_metrics = split_metrics(combined, folds)
    excluded_metrics = split_metrics(excluded, folds)
    audit24 = v50.capture_metrics(combined, v50.wave_events(pengu, 24, 20.0), 6)
    audit72 = v50.capture_metrics(combined, v50.wave_events(pengu, 72, 35.0), 12)
    return {
        "included": included_metrics,
        "excluded": excluded_metrics,
        "wave24": audit24,
        "wave72": audit72,
        "exclusion": exclusion,
        "trades": [asdict(trade) for trade in combined],
        "excludedTrades": [asdict(trade) for trade in excluded],
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    btc, btc_months = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    pengu, btc, funding, cutoff = archive_source.trim_to_complete_funding_window(
        pengu, btc, funding, funding_months
    )
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    folds = fold_bounds(pengu, 5)
    events = selection_wave_events(pengu, folds)

    searches = {
        "longBreak": search_family(
            "LONG_BREAK", long_break_candidates(), 1,
            pengu, btc, funding, features, folds, events,
        ),
        "washout": search_family(
            "WASHOUT", washout_candidates(), 1,
            pengu, btc, funding, features, folds, events,
        ),
        "shortFlash": search_family(
            "SHORT_FLASH", short_flash_candidates(), -1,
            pengu, btc, funding, features, folds, events,
        ),
        "shortDistribution": search_family(
            "SHORT_DISTRIBUTION", short_distribution_candidates(), -1,
            pengu, btc, funding, features, folds, events,
        ),
    }

    long_break = rebuild(searches["longBreak"]["selected"])
    washout = rebuild(searches["washout"]["selected"])
    short_flash = rebuild(searches["shortFlash"]["selected"])
    short_distribution = rebuild(searches["shortDistribution"]["selected"])
    final_long = combine_same_side(washout, long_break)
    final_short = combine_same_side(short_distribution, short_flash)
    portfolio = portfolio_result(final_long, final_short, pengu, folds)

    holdout = portfolio["included"]["holdout"]
    holdout_severe = portfolio["included"]["holdoutSevere"]
    holdout_excluded = portfolio["excluded"]["holdout"]
    holdout_excluded_severe = portfolio["excluded"]["holdoutSevere"]
    holdout_pass = bool(
        holdout["trades"] >= 5
        and holdout["compoundedReturnPct"] > 0
        and holdout_severe["compoundedReturnPct"] > 0
        and holdout_excluded["compoundedReturnPct"] > 0
        and holdout_excluded_severe["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.05
        and (holdout_excluded["profitFactor"] or 0) >= 1.05
    )
    selected_count = sum(searches[key]["selected"] is not None for key in searches)
    status = "ARCHIVE_HOLDOUT_PASS" if holdout_pass and selected_count > 0 else "NO_ROBUST_PORTFOLIO"
    result = rounded({
        "version": 58,
        "strategyId": "PENGU_V58_BINANCE_ARCHIVE_WALK_FORWARD",
        "generatedAt": now.isoformat(),
        "status": status,
        "archiveCoverage": {
            "start": dt.datetime.fromtimestamp(int(pengu[0]["ts"]) / 1000, tz=dt.timezone.utc).isoformat(),
            "end": dt.datetime.fromtimestamp((int(pengu[-1]["ts"]) + HOUR) / 1000, tz=dt.timezone.utc).isoformat(),
            "cutoff": dt.datetime.fromtimestamp(cutoff / 1000, tz=dt.timezone.utc).isoformat(),
            "penguMonths": pengu_months,
            "btcMonths": btc_months,
            "fundingMonths": funding_months,
        },
        "folds": [
            {
                "start": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
                "end": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
                "role": "TRAIN" if index < 3 else "VALIDATION" if index == 3 else "HOLDOUT",
            }
            for index, (start, end) in enumerate(folds)
        ],
        "selectionLargeWaveEvents": len(events),
        "searches": searches,
        "selectedCount": selected_count,
        "portfolio": portfolio,
        "holdoutPassed": holdout_pass,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "holdoutUsedForSelection": False,
        },
        "limitations": [
            "The final chronological 20% was not used by the candidate selection algorithm.",
            "The operator had already observed aggregate V57 results over the full archive before V58; this is algorithmically untouched but not pristine human-blind evidence.",
            "A production candidate still requires forward evidence after selection.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v58-archive-walkforward.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# PENGU V58 Binance Archive Walk-forward",
        "",
        f"- Status: **{status}**",
        f"- Selected families: {selected_count}/4",
        f"- Holdout pass: **{'YES' if holdout_pass else 'NO'}**",
        "",
    ]
    for key, search in searches.items():
        selected = search["selected"]
        report.extend([
            f"## {key}",
            f"- Candidates: {search['candidateCount']}",
            f"- Passed / stable: {search['passedBeforeCluster']} / {search['stablePassed']}",
            f"- Selected: **{selected['candidateId'] if selected else 'NONE'}**",
            "",
        ])
    report.extend([
        "## Portfolio",
        f"- Full included: {portfolio['included']['full']['compoundedReturnPct']}% / PF {portfolio['included']['full']['profitFactor']} / DD {portfolio['included']['full']['maxDrawdownPct']}%",
        f"- Full included Severe: {portfolio['included']['fullSevere']['compoundedReturnPct']}%",
        f"- Full large-wave profits excluded: {portfolio['excluded']['full']['compoundedReturnPct']}% / PF {portfolio['excluded']['full']['profitFactor']} / DD {portfolio['excluded']['full']['maxDrawdownPct']}%",
        f"- Full excluded Severe: {portfolio['excluded']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout included: {holdout['compoundedReturnPct']}% / PF {holdout['profitFactor']} / DD {holdout['maxDrawdownPct']}%",
        f"- Holdout included Severe: {holdout_severe['compoundedReturnPct']}%",
        f"- Holdout excluded: {holdout_excluded['compoundedReturnPct']}% / PF {holdout_excluded['profitFactor']} / DD {holdout_excluded['maxDrawdownPct']}%",
        f"- Holdout excluded Severe: {holdout_excluded_severe['compoundedReturnPct']}%",
        f"- 24h waves early: {portfolio['wave24']['earlyCapturedEvents']}/{portfolio['wave24']['events']}",
        f"- 72h waves early: {portfolio['wave72']['earlyCapturedEvents']}/{portfolio['wave72']['events']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ])
    (state_dir / "pengu-v58-archive-walkforward.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
