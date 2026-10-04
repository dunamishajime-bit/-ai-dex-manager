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
import research_lab_pengu_regime_aware_dual_engine_v45 as v45


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


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
        if v45.preholdout_eligible(item):
            eligible_ids.append(gate.strategy_id)

    stable = [
        strategy_id for strategy_id in eligible_ids
        if sum(1 for other in eligible_ids if other != strategy_id and v44.neighbor(gate_map[strategy_id], gate_map[other])) >= 2
    ]

    def robust_key(strategy_id: str):
        item = results[strategy_id]
        gate = gate_map[strategy_id]
        folds = item["folds"]
        full = item["preHoldout"]
        return (
            round(statistics.median(fold["severeReturnPct"] for fold in folds), 3),
            round(min(full["profitFactor"] or 0, full["severeProfitFactor"] or 0), 3),
            round(full["compoundedReturnPct"], 3),
            round(full["maxDrawdownPct"], 3),
            gate.relative_threshold,
            gate.relative_length,
            gate.momentum_threshold,
            gate.momentum_length,
            gate.slope_lookback,
            gate.sma_length,
        )

    stable.sort(key=robust_key, reverse=True)
    selected = stable[0] if stable else None
    long_trades = trades_by_id[selected] if selected else []
    long_preholdout = metrics(long_trades, first, holdout_start)
    long_holdout = metrics(long_trades, holdout_start, last + v39.HOUR)
    long_class = v45.holdout_class(long_holdout)
    long_pass = selected is not None and long_class != "FAIL"

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_preholdout = metrics(short_trades, first, holdout_start)
    short_holdout = metrics(short_trades, holdout_start, last + v39.HOUR)
    short_pass = v45.holdout_class(short_holdout) == "ACTIVE_PROFIT_PASS"

    combined = v39.combine_trades(long_trades, short_trades, 1.0, 1.0)
    combined_preholdout = metrics(combined, first, holdout_start)
    combined_holdout = metrics(combined, holdout_start, last + v39.HOUR)
    combined_full = metrics(combined, first, last + v39.HOUR)
    combined_pass = bool(
        long_pass
        and short_pass
        and combined_holdout["compoundedReturnPct"] > 0
        and (combined_holdout["profitFactor"] or 0) >= 1.0
        and combined_holdout["severeReturnPct"] > 0
        and combined_holdout["maxDrawdownPct"] >= -15
    )
    status = "PENGU_DUAL_ENGINE_V46_COMPLETE" if combined_pass else "PENGU_DUAL_ENGINE_V46_NOT_COMPLETE"

    payload = rounded({
        "version": 46,
        "strategyId": "PENGU_CONSERVATIVE_TIEBREAK_V46",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "selectionPolicy": [
            "Use development and four pre-holdout folds only.",
            "Rank by median fold Severe return, minimum normal/Severe PF, return and DD.",
            "For rounded robust ties, prefer stricter relative threshold, longer relative period, stronger momentum and longer trend confirmation.",
            "Frozen holdout is read only after the conservative candidate is selected.",
        ],
        "candidateCount": len(candidates),
        "eligibleCount": len(eligible_ids),
        "stableCount": len(stable),
        "selectedLongGateId": selected,
        "selectedLongGate": asdict(gate_map[selected]) if selected else None,
        "selectedRobustKey": list(robust_key(selected)) if selected else None,
        "longPreHoldout": long_preholdout,
        "longFrozenHoldout": long_holdout,
        "longHoldoutClass": long_class,
        "longHoldoutPassed": long_pass,
        "shortRule": asdict(short_rule),
        "shortPreHoldout": short_preholdout,
        "shortFrozenHoldout": short_holdout,
        "shortHoldoutPassed": short_pass,
        "combinedPreHoldout": combined_preholdout,
        "combinedFrozenHoldout": combined_holdout,
        "combinedFull": combined_full,
        "combinedHoldoutPassed": combined_pass,
        "topStable": stable[:30],
        "topStablePreHoldout": {strategy_id: results[strategy_id] for strategy_id in stable[:30]},
        "selectedLongTrades": [asdict(trade) for trade in long_trades],
        "shortTrades": [asdict(trade) for trade in short_trades],
        "productionChanged": False,
        "realTradingEnabled": False,
        "promotionMode": "PAPER_FORWARD",
        "limitations": [
            "The final holdout is reused confirmation, not pristine forward evidence.",
            "A zero-trade Long holdout is a safety pass only; new forward Long trades are required before live promotion.",
            "V19 microstructure vetoes remain forward-only.",
        ],
    })

    report = [
        "# PENGU Conservative Tiebreak V46",
        "",
        f"- Status: **{status}**",
        f"- Selected Long gate: **{selected or 'NONE'}**",
        f"- Long pre-holdout: {long_preholdout['compoundedReturnPct']}% / PF {long_preholdout['profitFactor']} / DD {long_preholdout['maxDrawdownPct']}%",
        f"- Long holdout: {long_holdout['trades']} trades / {long_holdout['compoundedReturnPct']}% / PF {long_holdout['profitFactor']} / {long_class}",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Promotion: PAPER_FORWARD",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-conservative-tiebreak-v46.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-conservative-tiebreak-v46.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
