from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR

BASE_LONG = v50.Candidate(
    side=1,
    family="BREAK",
    lookback=6,
    momentum1h=0.35,
    momentum3h=2.0,
    relative3h=0.5,
    volume_acceleration=1.1,
    volatility_expansion=1.0,
    extreme_factor=2.2,
    confirmation_move_pct=0.4,
    exit_profile="WIDE",
)


def combine_same_side(*trade_groups: List[v50.Trade]) -> List[v50.Trade]:
    tagged = []
    for priority, group in enumerate(trade_groups):
        for trade in group:
            tagged.append((trade.entry_ts, priority, trade))
    tagged.sort(key=lambda row: (row[0], row[1]))
    result: List[v50.Trade] = []
    next_free = 0
    for _, _, trade in tagged:
        if trade.entry_ts < next_free:
            continue
        result.append(trade)
        next_free = trade.exit_ts
    return result


def split_metrics(trades: List[v50.Trade], folds: List[tuple[int, int]]) -> dict:
    return {
        "train": v50.metrics(trades, folds[0][0], folds[2][1]),
        "trainSevere": v50.metrics(trades, folds[0][0], folds[2][1], True),
        "validation": v50.metrics(trades, folds[3][0], folds[3][1]),
        "validationSevere": v50.metrics(trades, folds[3][0], folds[3][1], True),
        "holdout": v50.metrics(trades, folds[4][0], folds[4][1]),
        "holdoutSevere": v50.metrics(trades, folds[4][0], folds[4][1], True),
        "full": v50.metrics(trades, folds[0][0], folds[-1][1]),
        "fullSevere": v50.metrics(trades, folds[0][0], folds[-1][1], True),
    }


def proxy_capture(trades: List[v50.Trade], folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]], side: int) -> dict:
    names = ("3h3", "6h5", "12h8")
    rows = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        item = {}
        for name in names:
            early_hours = 2 if name == "3h3" else 3 if name == "6h5" else 4
            item[name] = v50.capture_metrics(fold_trades, proxies[name][index], early_hours, side)
        rows.append(item)
    def sum_metric(indices, metric):
        return sum(rows[index][name][metric] for index in indices for name in names)
    return {
        "folds": rows,
        "trainCaptured": sum_metric(range(3), "capturedEvents"),
        "trainEarly": sum_metric(range(3), "earlyCapturedEvents"),
        "validationCaptured": sum_metric((3,), "capturedEvents"),
        "validationEarly": sum_metric((3,), "earlyCapturedEvents"),
        "validationEvents": sum_metric((3,), "events"),
    }


def selection_pass(metrics: dict, captures: dict, baseline_metrics: dict, baseline_capture: dict, side: int) -> bool:
    train = metrics["train"]
    train_severe = metrics["trainSevere"]
    validation = metrics["validation"]
    validation_severe = metrics["validationSevere"]
    return bool(
        train["trades"] >= (8 if side < 0 else 6)
        and train["compoundedReturnPct"] > 0
        and train_severe["compoundedReturnPct"] > 0
        and train["maxDrawdownPct"] >= -5
        and validation["trades"] >= 2
        and validation["compoundedReturnPct"] > 0
        and validation_severe["compoundedReturnPct"] > 0
        and (validation["profitFactor"] or 0) >= 1.0
        and validation["maxDrawdownPct"] >= -3
        and captures["validationEarly"] >= baseline_capture["validationEarly"]
        and captures["trainEarly"] >= baseline_capture["trainEarly"]
        and (
            captures["validationEarly"] > baseline_capture["validationEarly"]
            or captures["trainEarly"] > baseline_capture["trainEarly"]
            or validation_severe["compoundedReturnPct"] > baseline_metrics["validationSevere"]["compoundedReturnPct"]
        )
    )


def selection_rank(metrics: dict, captures: dict) -> tuple:
    return (
        captures["validationEarly"],
        captures["validationCaptured"],
        metrics["validationSevere"]["compoundedReturnPct"],
        metrics["validation"]["compoundedReturnPct"],
        captures["trainEarly"],
        metrics["trainSevere"]["compoundedReturnPct"],
        metrics["train"]["compoundedReturnPct"],
        metrics["train"]["maxDrawdownPct"],
    )


def select_addon(
    candidates: List[v52.Candidate],
    base_trades: List[v50.Trade],
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    features: dict,
    folds: List[tuple[int, int]],
    proxies: Dict[str, List[List[dict]]],
    side: int,
) -> tuple[Optional[v52.Candidate], List[v50.Trade], dict]:
    baseline_metrics = split_metrics(base_trades, folds)
    baseline_capture = proxy_capture(base_trades, folds, proxies, side)
    passed = []
    diagnostics = []
    for candidate in candidates:
        candidate_trades, armed = v52.run_candidate(candidate, pengu, btc, funding, features)
        combined = combine_same_side(candidate_trades, base_trades)
        metrics = split_metrics(combined, folds)
        captures = proxy_capture(combined, folds, proxies, side)
        item = {
            "candidate": asdict(candidate),
            "candidateId": candidate.candidate_id,
            "armedWithoutOrder": armed,
            "candidateTrades": len(candidate_trades),
            "metrics": metrics,
            "captures": captures,
        }
        diagnostics.append(item)
        if selection_pass(metrics, captures, baseline_metrics, baseline_capture, side):
            passed.append((selection_rank(metrics, captures), candidate, combined, item))
    passed.sort(key=lambda row: row[0], reverse=True)
    diagnostics.sort(key=lambda item: selection_rank(item["metrics"], item["captures"]), reverse=True)
    if not passed:
        return None, base_trades, {
            "passedCount": 0,
            "baselineMetrics": baseline_metrics,
            "baselineCapture": baseline_capture,
            "topDiagnostics": diagnostics[:10],
        }
    _, selected, combined, selected_item = passed[0]
    return selected, combined, {
        "passedCount": len(passed),
        "baselineMetrics": baseline_metrics,
        "baselineCapture": baseline_capture,
        "selected": selected_item,
        "topDiagnostics": diagnostics[:10],
    }


def adoption_gate(trades: List[v50.Trade], folds: List[tuple[int, int]], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    metrics = split_metrics(trades, folds)
    audit24 = v50.capture_metrics(trades, major24, 6, side)
    audit72 = v50.capture_metrics(trades, major72, 12, side)
    total = audit24["events"] + audit72["events"]
    early = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early / total * 100.0 if total else None
    profitable_rate = profitable / total * 100.0 if total else None
    h = metrics["holdout"]
    hs = metrics["holdoutSevere"]
    passed = bool(
        h["trades"] >= 2
        and h["compoundedReturnPct"] > 0
        and hs["compoundedReturnPct"] > 0
        and (h["profitFactor"] or 0) >= 1.05
        and total > 0
        and early_rate is not None and early_rate >= 50.0
        and profitable_rate is not None and profitable_rate >= 50.0
    )
    return passed, {
        "metrics": metrics,
        "major24": audit24,
        "major72": audit72,
        "totalMajorEvents": total,
        "earlyMajorEvents": early,
        "profitableMajorEvents": profitable,
        "earlyMajorRatePct": early_rate,
        "profitableMajorRatePct": profitable_rate,
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V53 ensemble")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    proxy_raw = {
        "3h3": v50.wave_events(pengu, 3, 3.0),
        "6h5": v50.wave_events(pengu, 6, 5.0),
        "12h8": v50.wave_events(pengu, 12, 8.0),
    }
    proxies = {name: v50.events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)

    base_long_trades = v50.run_candidate(BASE_LONG, pengu, btc, funding, features)
    reversal_candidates = [candidate for candidate in v52.candidate_space(1) if candidate.family == "REVERSAL"]
    compression_candidates = [candidate for candidate in v52.candidate_space(1) if candidate.family == "COMPRESSION"]
    selected_reversal, long_after_reversal, reversal_selection = select_addon(
        reversal_candidates, base_long_trades, pengu, btc, funding, features, folds, proxies, 1
    )
    selected_compression, final_long, compression_selection = select_addon(
        compression_candidates, long_after_reversal, pengu, btc, funding, features, folds, proxies, 1
    )

    flash_candidates = [candidate for candidate in v52.candidate_space(-1) if candidate.family == "FLASH"]
    distribution_candidates = [candidate for candidate in v52.candidate_space(-1) if candidate.family == "DISTRIBUTION"]
    selected_flash, short_after_flash, flash_selection = select_addon(
        flash_candidates, [], pengu, btc, funding, features, folds, proxies, -1
    )
    selected_distribution, final_short, distribution_selection = select_addon(
        distribution_candidates, short_after_flash, pengu, btc, funding, features, folds, proxies, -1
    )

    long_pass, long_evidence = adoption_gate(final_long, folds, major24, major72, 1)
    short_pass, short_evidence = adoption_gate(final_short, folds, major24, major72, -1)
    enabled = v50.combine_sides(final_long if long_pass else [], final_short if short_pass else [])
    enabled_metrics = split_metrics(enabled, folds)
    status = (
        "BOTH_ENABLED" if long_pass and short_pass
        else "LONG_ONLY_ENABLED" if long_pass
        else "SHORT_ONLY_ENABLED" if short_pass
        else "NO_PRODUCTION_CANDIDATE"
    )
    result = rounded({
        "version": 53,
        "strategyId": "PENGU_WAVE_SLEEVE_V53_BASE_PLUS_SCOUT_ENSEMBLE",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "baseLong": asdict(BASE_LONG),
        "selectedReversal": asdict(selected_reversal) if selected_reversal else None,
        "selectedCompression": asdict(selected_compression) if selected_compression else None,
        "selectedFlash": asdict(selected_flash) if selected_flash else None,
        "selectedDistribution": asdict(selected_distribution) if selected_distribution else None,
        "reversalSelection": reversal_selection,
        "compressionSelection": compression_selection,
        "flashSelection": flash_selection,
        "distributionSelection": distribution_selection,
        "longGatePassed": long_pass,
        "shortGatePassed": short_pass,
        "longEvidence": long_evidence,
        "shortEvidence": short_evidence,
        "enabledMetrics": enabled_metrics,
        "enabledTrades": [asdict(trade) for trade in enabled],
        "longTrades": [asdict(trade) for trade in final_long],
        "shortTrades": [asdict(trade) for trade in final_short],
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v53.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V53 Ensemble", "", f"- Status: **{status}**",
        f"- Reversal Scout: **{selected_reversal.candidate_id if selected_reversal else 'NONE'}**",
        f"- Compression Scout: **{selected_compression.candidate_id if selected_compression else 'NONE'}**",
        f"- Flash Short: **{selected_flash.candidate_id if selected_flash else 'NONE'}**",
        f"- Distribution Short: **{selected_distribution.candidate_id if selected_distribution else 'NONE'}**",
        f"- Long gate: **{'PASS' if long_pass else 'FAIL'}**",
        f"- Short gate: **{'PASS' if short_pass else 'FAIL'}**",
        "", "## Long",
        f"- Holdout: {long_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {long_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {long_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {long_evidence['profitableMajorRatePct']}%",
        "", "## Short",
        f"- Holdout: {short_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {short_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {short_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {short_evidence['profitableMajorRatePct']}%",
        "", "## Enabled",
        f"- Full: {enabled_metrics['full']['compoundedReturnPct']}%",
        f"- Full Severe: {enabled_metrics['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {enabled_metrics['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {enabled_metrics['holdoutSevere']['compoundedReturnPct']}%",
        "", "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v53.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
