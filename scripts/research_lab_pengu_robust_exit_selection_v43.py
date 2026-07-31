from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_pengu_dual_engine_v39 as v39
import research_lab_pengu_long_completion_v40 as v40
import research_lab_pengu_failure_exit_dual_engine_v42 as v42


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def eligible(item: dict) -> bool:
    full = item["preHoldout"]
    folds = item["folds"]
    returns = [fold["compoundedReturnPct"] for fold in folds]
    severe = [fold["severeReturnPct"] for fold in folds]
    return bool(
        full["trades"] >= 10
        and full["compoundedReturnPct"] > 0
        and (full["profitFactor"] or 0) >= 1.10
        and full["maxDrawdownPct"] >= -25
        and full["severeReturnPct"] > 0
        and (full["severeProfitFactor"] or 0) >= 1.0
        and statistics.median(returns) > 0
        and statistics.median(severe) > -0.5
        and sum(value > 0 for value in returns) >= 2
        and min(returns) >= -8.0
    )


def holdout_pass(metric: dict) -> bool:
    return bool(
        metric["trades"] >= 3
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -20
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // v39.HOUR * v39.HOUR
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    pengu_rows = v39.fetch_klines("PENGUUSDT", end)
    btc_rows = v39.fetch_klines("BTCUSDT", end)
    funding = v39.fetch_funding("PENGUUSDT", end)
    pengu = v40.build_cache(pengu_rows)
    btc = v40.build_cache(btc_rows)
    funding_by_index = v40.latest_funding_by_index(funding, pengu_rows)
    members = v42.fixed_long_members()

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 360 * v39.HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    holdout_start = first + int(span * 0.80)
    fold_edges = [first + int((holdout_start - first) * step / 4) for step in range(5)]

    overlays = v42.overlays()
    overlay_map = {overlay.strategy_id: overlay for overlay in overlays}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    results: Dict[str, dict] = {}
    eligible_ids: List[str] = []
    for overlay in overlays:
        trades = v42.build_overlay_trades(overlay, members, pengu, btc, funding, funding_by_index)
        trades_by_id[overlay.strategy_id] = trades
        item = {
            "overlay": asdict(overlay),
            "preHoldout": metrics(trades, first, holdout_start),
            "folds": [metrics(trades, fold_edges[index], fold_edges[index + 1]) for index in range(4)],
        }
        results[overlay.strategy_id] = item
        if eligible(item):
            eligible_ids.append(overlay.strategy_id)

    stable = [
        strategy_id for strategy_id in eligible_ids
        if sum(1 for other in eligible_ids if other != strategy_id and v42.neighbor(overlay_map[strategy_id], overlay_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        min(
            results[strategy_id]["preHoldout"]["profitFactor"] or 0,
            results[strategy_id]["preHoldout"]["severeProfitFactor"] or 0,
        ),
        statistics.median(fold["compoundedReturnPct"] for fold in results[strategy_id]["folds"]),
        statistics.median(fold["severeReturnPct"] for fold in results[strategy_id]["folds"]),
        results[strategy_id]["preHoldout"]["maxDrawdownPct"],
        -overlay_map[strategy_id].max_hold_hours,
        -overlay_map[strategy_id].stop_atr,
    ), reverse=True)
    selected = stable[0] if stable else None
    long_trades = trades_by_id[selected] if selected else []
    long_preholdout = metrics(long_trades, first, holdout_start)
    long_holdout = metrics(long_trades, holdout_start, last + v39.HOUR)
    long_passed = bool(selected and holdout_pass(long_holdout))

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_preholdout = metrics(short_trades, first, holdout_start)
    short_holdout = metrics(short_trades, holdout_start, last + v39.HOUR)
    short_passed = holdout_pass(short_holdout)

    combined = v39.combine_trades(long_trades if long_passed else [], short_trades, 1.0, 1.0)
    combined_preholdout = metrics(combined, first, holdout_start)
    combined_holdout = metrics(combined, holdout_start, last + v39.HOUR)
    combined_full = metrics(combined, first, last + v39.HOUR)
    combined_passed = bool(long_passed and short_passed and holdout_pass(combined_holdout))
    status = "PENGU_DUAL_ENGINE_V43_COMPLETE" if combined_passed else "PENGU_EXIT_V43_NOT_COMPLETE"

    diagnostic_ranked = sorted(results, key=lambda strategy_id: (
        results[strategy_id]["preHoldout"]["profitFactor"] or 0,
        results[strategy_id]["preHoldout"]["compoundedReturnPct"],
    ), reverse=True)[:30]
    diagnostics = {}
    for strategy_id in diagnostic_ranked:
        diagnostics[strategy_id] = {
            **results[strategy_id],
            "frozenHoldout": metrics(trades_by_id[strategy_id], holdout_start, last + v39.HOUR),
            "eligible": strategy_id in eligible_ids,
            "stable": strategy_id in stable,
        }

    payload = rounded({
        "version": 43,
        "strategyId": "PENGU_ROBUST_EXIT_SELECTION_V43",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "candidateCount": len(overlays),
        "eligibleCount": len(eligible_ids),
        "stableCount": len(stable),
        "selectedExitOverlayId": selected,
        "selectedExitOverlay": asdict(overlay_map[selected]) if selected else None,
        "longPreHoldout": long_preholdout,
        "longFrozenHoldout": long_holdout,
        "longHoldoutPassed": long_passed,
        "shortRule": asdict(short_rule),
        "shortPreHoldout": short_preholdout,
        "shortFrozenHoldout": short_holdout,
        "shortHoldoutPassed": short_passed,
        "combinedPreHoldout": combined_preholdout,
        "combinedFrozenHoldout": combined_holdout,
        "combinedFull": combined_full,
        "combinedHoldoutPassed": combined_passed,
        "topStable": stable[:20],
        "diagnosticTop30": diagnostics,
        "selectedLongTrades": [asdict(trade) for trade in long_trades],
        "shortTrades": [asdict(trade) for trade in short_trades],
        "productionChanged": False,
        "realTradingEnabled": False,
    })
    report = [
        "# PENGU Robust Exit Selection V43",
        "",
        f"- Status: **{status}**",
        f"- Eligible: {len(eligible_ids)} / {len(overlays)}",
        f"- Stable: {len(stable)}",
        f"- Selected exit: **{selected or 'NONE'}**",
        f"- Long pre-holdout: {long_preholdout['compoundedReturnPct']}% / PF {long_preholdout['profitFactor']} / DD {long_preholdout['maxDrawdownPct']}%",
        f"- Long holdout: {long_holdout['compoundedReturnPct']}% / PF {long_holdout['profitFactor']} / Severe {long_holdout['severeReturnPct']}%",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-robust-exit-selection-v43.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-robust-exit-selection-v43.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
