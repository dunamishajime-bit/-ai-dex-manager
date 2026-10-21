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
import research_lab_pengu_long_regime_gate_v44 as v44


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def preholdout_eligible(item: dict) -> bool:
    full = item["preHoldout"]
    folds = item["folds"]
    returns = [fold["compoundedReturnPct"] for fold in folds]
    severe = [fold["severeReturnPct"] for fold in folds]
    return bool(
        full["trades"] >= 5
        and full["compoundedReturnPct"] > 0
        and (full["profitFactor"] or 0) >= 1.15
        and full["maxDrawdownPct"] >= -20
        and full["severeReturnPct"] > 0
        and (full["severeProfitFactor"] or 0) >= 1.05
        and sum(value > 0 for value in returns) >= 2
        and statistics.median(returns) >= -1.0
        and statistics.median(severe) >= -1.5
        and min(returns) >= -7.0
    )


def holdout_class(metric: dict) -> str:
    if metric["trades"] == 0:
        return "INACTIVE_REGIME_PASS"
    if (
        metric["trades"] >= 2
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -15
    ):
        return "ACTIVE_PROFIT_PASS"
    return "FAIL"


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
    p_sma, p_momentum = v44.extended_series(pengu_rows)
    _, b_momentum = v44.extended_series(btc_rows)
    members = v44.fixed_members()

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 520 * v39.HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    holdout_start = first + int(span * 0.80)
    fold_edges = [first + int((holdout_start - first) * step / 4) for step in range(5)]

    candidates = v44.gates()
    gate_map = {gate.strategy_id: gate for gate in candidates}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    results: Dict[str, dict] = {}
    eligible_ids: List[str] = []
    for gate in candidates:
        trades = v44.build_trades(
            gate, members, pengu, btc, funding, funding_by_index,
            p_sma, p_momentum, b_momentum,
        )
        trades_by_id[gate.strategy_id] = trades
        item = {
            "gate": asdict(gate),
            "preHoldout": metrics(trades, first, holdout_start),
            "folds": [metrics(trades, fold_edges[index], fold_edges[index + 1]) for index in range(4)],
        }
        results[gate.strategy_id] = item
        if preholdout_eligible(item):
            eligible_ids.append(gate.strategy_id)

    stable = [
        strategy_id for strategy_id in eligible_ids
        if sum(1 for other in eligible_ids if other != strategy_id and v44.neighbor(gate_map[strategy_id], gate_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        statistics.median(fold["severeReturnPct"] for fold in results[strategy_id]["folds"]),
        min(
            results[strategy_id]["preHoldout"]["profitFactor"] or 0,
            results[strategy_id]["preHoldout"]["severeProfitFactor"] or 0,
        ),
        results[strategy_id]["preHoldout"]["compoundedReturnPct"],
        results[strategy_id]["preHoldout"]["maxDrawdownPct"],
        -gate_map[strategy_id].sma_length,
    ), reverse=True)

    selected = stable[0] if stable else None
    long_trades = trades_by_id[selected] if selected else []
    long_preholdout = metrics(long_trades, first, holdout_start)
    long_holdout = metrics(long_trades, holdout_start, last + v39.HOUR)
    long_class = holdout_class(long_holdout)
    long_safety_pass = selected is not None and long_class != "FAIL"

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_preholdout = metrics(short_trades, first, holdout_start)
    short_holdout = metrics(short_trades, holdout_start, last + v39.HOUR)
    short_pass = holdout_class(short_holdout) == "ACTIVE_PROFIT_PASS"

    combined = v39.combine_trades(long_trades, short_trades, 1.0, 1.0)
    combined_preholdout = metrics(combined, first, holdout_start)
    combined_holdout = metrics(combined, holdout_start, last + v39.HOUR)
    combined_full = metrics(combined, first, last + v39.HOUR)
    combined_pass = bool(
        long_safety_pass
        and short_pass
        and combined_holdout["compoundedReturnPct"] > 0
        and (combined_holdout["profitFactor"] or 0) >= 1.0
        and combined_holdout["severeReturnPct"] > 0
        and combined_holdout["maxDrawdownPct"] >= -15
    )
    status = "PENGU_DUAL_ENGINE_V45_COMPLETE" if combined_pass else "PENGU_DUAL_ENGINE_V45_NOT_COMPLETE"

    ranked_diagnostics = stable[:20]
    diagnostics = {}
    for strategy_id in ranked_diagnostics:
        holdout = metrics(trades_by_id[strategy_id], holdout_start, last + v39.HOUR)
        diagnostics[strategy_id] = {
            **results[strategy_id],
            "frozenHoldout": holdout,
            "holdoutClass": holdout_class(holdout),
        }

    payload = rounded({
        "version": 45,
        "strategyId": "PENGU_REGIME_AWARE_DUAL_ENGINE_V45",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "candidateCount": len(candidates),
        "eligibleCount": len(eligible_ids),
        "stableCount": len(stable),
        "selectedLongGateId": selected,
        "selectedLongGate": asdict(gate_map[selected]) if selected else None,
        "longPreHoldout": long_preholdout,
        "longFrozenHoldout": long_holdout,
        "longHoldoutClass": long_class,
        "longSafetyPassed": long_safety_pass,
        "shortRule": asdict(short_rule),
        "shortPreHoldout": short_preholdout,
        "shortFrozenHoldout": short_holdout,
        "shortHoldoutPassed": short_pass,
        "combinedPreHoldout": combined_preholdout,
        "combinedFrozenHoldout": combined_holdout,
        "combinedFull": combined_full,
        "combinedHoldoutPassed": combined_pass,
        "topStable": stable[:20],
        "diagnostics": diagnostics,
        "selectedLongTrades": [asdict(trade) for trade in long_trades],
        "shortTrades": [asdict(trade) for trade in short_trades],
        "productionChanged": False,
        "realTradingEnabled": False,
        "promotionMode": "PAPER_FORWARD",
        "limitations": [
            "A zero-trade Long holdout is classified as an inactive-regime safety pass, not proof of positive Long alpha.",
            "The selected Long gate must produce new forward Long trades before live eligibility.",
            "The latest window is reused confirmation, not pristine forward evidence.",
            "V19 microstructure vetoes remain forward-only.",
        ],
    })
    report = [
        "# PENGU Regime-Aware Dual Engine V45",
        "",
        f"- Status: **{status}**",
        f"- Eligible: {len(eligible_ids)} / {len(candidates)}",
        f"- Stable: {len(stable)}",
        f"- Selected Long gate: **{selected or 'NONE'}**",
        f"- Long pre-holdout: {long_preholdout['compoundedReturnPct']}% / PF {long_preholdout['profitFactor']} / DD {long_preholdout['maxDrawdownPct']}%",
        f"- Long holdout: {long_holdout['trades']} trades / {long_holdout['compoundedReturnPct']}% / {long_class}",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Promotion: PAPER_FORWARD",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-regime-aware-dual-engine-v45.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-regime-aware-dual-engine-v45.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
