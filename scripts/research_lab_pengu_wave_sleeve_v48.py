from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_pengu_wave_sleeve_v47 as v47


def fold_bounds(rows: List[dict], count: int = 4) -> List[tuple[int, int]]:
    start = int(rows[0]["ts"])
    end = int(rows[-1]["ts"]) + v47.HOUR
    span = end - start
    return [
        (start + span * index // count, start + span * (index + 1) // count)
        for index in range(count)
    ]


def events_by_fold(events: List[dict], folds: List[tuple[int, int]]) -> List[List[dict]]:
    return [[event for event in events if start <= event["startTs"] < end] for start, end in folds]


def aggregate_metrics(trades: List[v47.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v47.metrics(trades, start, end, severe)


def candidate_summary(
    candidate: v47.Candidate,
    trades: List[v47.Trade],
    folds: List[tuple[int, int]],
    proxy_events: Dict[str, List[List[dict]]],
) -> dict:
    fold_metrics = [aggregate_metrics(trades, start, end) for start, end in folds]
    fold_severe = [aggregate_metrics(trades, start, end, True) for start, end in folds]
    captures = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        capture12 = v47.capture_metrics(fold_trades, proxy_events["12h10"][index], 6)
        capture24 = v47.capture_metrics(fold_trades, proxy_events["24h15"][index], 12)
        capture72 = v47.capture_metrics(fold_trades, proxy_events["72h25"][index], 24)
        captures.append({"12h10": capture12, "24h15": capture24, "72h25": capture72})

    selection_start = folds[0][0]
    selection_end = folds[2][1]
    selection = aggregate_metrics(trades, selection_start, selection_end)
    selection_severe = aggregate_metrics(trades, selection_start, selection_end, True)
    holdout = aggregate_metrics(trades, folds[3][0], folds[3][1])
    holdout_severe = aggregate_metrics(trades, folds[3][0], folds[3][1], True)
    positive_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_metrics[:3])
    severe_positive_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_severe[:3])
    captured = sum(
        captures[index][name]["capturedEvents"]
        for index in range(3)
        for name in ("12h10", "24h15", "72h25")
    )
    early = sum(
        captures[index][name]["earlyCapturedEvents"]
        for index in range(3)
        for name in ("12h10", "24h15", "72h25")
    )
    available = sum(
        captures[index][name]["events"]
        for index in range(3)
        for name in ("12h10", "24h15", "72h25")
    )
    minimum_fold_dd = min(item["maxDrawdownPct"] for item in fold_metrics[:3])
    passed = bool(
        selection["trades"] >= 8
        and selection["compoundedReturnPct"] > 0
        and (selection["profitFactor"] or 0) >= 1.15
        and selection["maxDrawdownPct"] >= -20
        and selection_severe["compoundedReturnPct"] > 0
        and positive_folds >= 2
        and severe_positive_folds >= 2
        and minimum_fold_dd >= -15
        and captured >= 2
        and early >= 1
    )
    return {
        "candidate": asdict(candidate),
        "folds": fold_metrics,
        "foldsSevere": fold_severe,
        "captures": captures,
        "selection": selection,
        "selectionSevere": selection_severe,
        "holdout": holdout,
        "holdoutSevere": holdout_severe,
        "positiveSelectionFolds": positive_folds,
        "severePositiveSelectionFolds": severe_positive_folds,
        "selectionProxyEvents": available,
        "selectionCapturedEvents": captured,
        "selectionEarlyCapturedEvents": early,
        "passed": passed,
        "trades": [asdict(trade) for trade in trades],
    }


def rank_key(item: dict):
    selection = item["selection"]
    severe = item["selectionSevere"]
    fold_returns = [fold["compoundedReturnPct"] for fold in item["folds"][:3]]
    return (
        item["selectionEarlyCapturedEvents"],
        item["selectionCapturedEvents"],
        item["positiveSelectionFolds"],
        item["severePositiveSelectionFolds"],
        statistics.median(fold_returns),
        severe["compoundedReturnPct"],
        selection["compoundedReturnPct"],
        selection["maxDrawdownPct"],
    )


def rebuild_trades(item: dict | None) -> List[v47.Trade]:
    if not item:
        return []
    return [v47.Trade(**trade) for trade in item["trades"]]


def combine_sides(long_trades: List[v47.Trade], short_trades: List[v47.Trade]) -> List[v47.Trade]:
    grouped: Dict[int, List[v47.Trade]] = {}
    for trade in [*long_trades, *short_trades]:
        grouped.setdefault(trade.entry_ts, []).append(trade)
    result: List[v47.Trade] = []
    next_free_ts = 0
    for entry_ts in sorted(grouped):
        if entry_ts < next_free_ts:
            continue
        choices = grouped[entry_ts]
        selected = next((trade for trade in choices if trade.side < 0), choices[0])
        result.append(selected)
        next_free_ts = selected.exit_ts
    return result


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // v47.HOUR * v47.HOUR
    print("Fetching Aster PENGU/BTC history for V48")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = v47.prepare_features(pengu, btc)
    folds = fold_bounds(pengu)

    proxy_raw = {
        "12h10": v47.wave_events(pengu, 12, 10.0),
        "24h15": v47.wave_events(pengu, 24, 15.0),
        "72h25": v47.wave_events(pengu, 72, 25.0),
    }
    proxy_events = {name: events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = v47.wave_events(pengu, 24, 20.0)
    major72 = v47.wave_events(pengu, 72, 35.0)

    summaries: Dict[str, dict] = {}
    passed_by_side = {1: [], -1: []}
    candidates = v47.candidate_space()
    for position, candidate in enumerate(candidates, start=1):
        if position % 500 == 0:
            print(f"Evaluated {position}/{len(candidates)} candidates")
        trades = v47.run_candidate(candidate, pengu, btc, funding, features)
        item = candidate_summary(candidate, trades, folds, proxy_events)
        summaries[candidate.candidate_id] = item
        if item["passed"]:
            passed_by_side[candidate.side].append(candidate.candidate_id)

    for side in (1, -1):
        passed_by_side[side].sort(key=lambda key: rank_key(summaries[key]), reverse=True)

    selected_long = passed_by_side[1][0] if passed_by_side[1] else None
    selected_short = passed_by_side[-1][0] if passed_by_side[-1] else None
    long_item = summaries[selected_long] if selected_long else None
    short_item = summaries[selected_short] if selected_short else None
    combined = combine_sides(rebuild_trades(long_item), rebuild_trades(short_item))

    selection_start = folds[0][0]
    selection_end = folds[2][1]
    holdout_start, holdout_end = folds[3]
    combined_result = {
        "selection": v47.metrics(combined, selection_start, selection_end),
        "selectionSevere": v47.metrics(combined, selection_start, selection_end, True),
        "holdout": v47.metrics(combined, holdout_start, holdout_end),
        "holdoutSevere": v47.metrics(combined, holdout_start, holdout_end, True),
        "full": v47.metrics(combined, folds[0][0], folds[-1][1]),
        "fullSevere": v47.metrics(combined, folds[0][0], folds[-1][1], True),
        "major24": v47.capture_metrics(combined, major24, 12),
        "major72": v47.capture_metrics(combined, major72, 24),
        "trades": [asdict(trade) for trade in combined],
    }

    status = "DUAL_CANDIDATE_FOUND" if selected_long and selected_short else "PARTIAL_CANDIDATE" if selected_long or selected_short else "NO_ROBUST_CANDIDATE"
    result = v47.rounded({
        "version": 48,
        "strategyId": "PENGU_WAVE_SLEEVE_V48_WALK_FORWARD",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "basePr": 42,
        "baseCommit": "ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "candidateCount": len(candidates),
        "folds": [{"start": iso(start), "end": iso(end)} for start, end in folds],
        "proxyEventCountsByFold": {
            name: [len(items) for items in by_fold]
            for name, by_fold in proxy_events.items()
        },
        "majorEventCounts": {"24h20pct": len(major24), "72h35pct": len(major72)},
        "passedLongCount": len(passed_by_side[1]),
        "passedShortCount": len(passed_by_side[-1]),
        "selectedLong": selected_long,
        "selectedShort": selected_short,
        "selectedLongResult": long_item,
        "selectedShortResult": short_item,
        "combined": combined_result,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "The last chronological quarter is untouched during candidate selection.",
            "Proxy events provide more observations than the three major-wave events; major waves remain separately audited.",
            "A candidate is not production-ready unless the untouched holdout is positive and Severe is acceptable.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v48.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    combined_metrics = result["combined"]
    report = [
        "# PENGU Wave Sleeve V48 Walk-forward",
        "",
        f"- Status: **{status}**",
        f"- Selected Long: **{selected_long or 'NONE'}**",
        f"- Selected Short: **{selected_short or 'NONE'}**",
        f"- Passed Long / Short: {len(passed_by_side[1])} / {len(passed_by_side[-1])}",
        f"- Selection combined: {combined_metrics['selection']['compoundedReturnPct']}% / PF {combined_metrics['selection']['profitFactor']} / DD {combined_metrics['selection']['maxDrawdownPct']}% / N {combined_metrics['selection']['trades']}",
        f"- Holdout combined: {combined_metrics['holdout']['compoundedReturnPct']}% / PF {combined_metrics['holdout']['profitFactor']} / DD {combined_metrics['holdout']['maxDrawdownPct']}% / N {combined_metrics['holdout']['trades']}",
        f"- Holdout Severe: {combined_metrics['holdoutSevere']['compoundedReturnPct']}% / DD {combined_metrics['holdoutSevere']['maxDrawdownPct']}%",
        f"- Major 24h waves: {combined_metrics['major24']['capturedEvents']}/{combined_metrics['major24']['events']} captured; early {combined_metrics['major24']['earlyCapturedEvents']}/{combined_metrics['major24']['events']}",
        f"- Major 72h waves: {combined_metrics['major72']['capturedEvents']}/{combined_metrics['major72']['events']} captured; early {combined_metrics['major72']['earlyCapturedEvents']}/{combined_metrics['major72']['events']}",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v48.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
