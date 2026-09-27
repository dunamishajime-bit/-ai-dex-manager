"""Requested integrated research BT: BRK/MR 0.75x, FET 1x, two pre-entry FET gates.

Replays baseline, cap-only and cap-plus-FET-gates at 8/10bps on the same
acquired annual data. PENGU is untouched. Features are computed strictly
from completed H1 candles prior to each FET entry, with missing history
failing closed rather than selectively skipping. No LIVE changes.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any

from .crypto_price_model import _rows
from .fet_entry_audit import fet_entry_features, load_history
from .portfolio_price_model import run_portfolio_model

REQUESTED_CAPS = {"Q102_BRK": 0.75, "Q102_MR": 0.75, "FET": 1.0}
COSTS = (("PRICE_MODEL_8BPS", 8.0), ("PRICE_MODEL_10BPS", 10.0))


def gate_reasons(features: dict[str, float]) -> list[str]:
    """Gate only on pre-entry observations; no realized return or exit input."""
    result = []
    if features["fet_return_24h"] >= 0.15 and features["fet_atr_24h_pct"] >= 0.02:
        result.append("FET_PREENTRY_OVERHEAT_24H_15PCT_ATR_2PCT")
    if features["fet_minus_btc_24h"] < 0 and features["fet_return_24h"] < 0.01:
        result.append("FET_PREENTRY_RELATIVE_WEAK_BTC_AND_FET24H_LT_1PCT")
    return result


def gate_candidate_stream(
    original: list[dict[str, Any]], data_root: Path, output_root: Path,
) -> tuple[Path, list[dict[str, Any]]]:
    fet = load_history(data_root, "FETUSDT")
    btc = load_history(data_root, "BTCUSDT")
    rows, audit = [], []
    for i, candidate in enumerate(original, 1):
        row = deepcopy(candidate)
        if row.get("strategy_id") == "FET" and row.get("status") == "MODELED_CLOSED_TRADE":
            ts = int(row["entry_ts_ms"])
            # Strictly past, contiguous pre-entry H1. No privileged outcome data.
            try:
                features = fet_entry_features(fet, btc, ts)
            except ValueError as error:
                raise ValueError(f"FET_GATE_PREENTRY_DATA_NOT_VERIFIABLE:{ts}:{error}") from error
            reasons = gate_reasons(features)
            audit.append({
                "original_candidate_row": i, "symbol": "FETUSDT",
                "entry_ts_ms": ts, "entry_price_usd": row.get("entry_price"),
                "requested_gross_before_portfolio": row.get("requested_gross"),
                "preentry_features": features, "gate_reasons": reasons,
                "research_gate_decision": "BLOCK" if reasons else "ALLOW",
                "feature_time_contract": "ONLY_CONTIGUOUS_COMPLETED_H1_STRICTLY_BEFORE_ENTRY",
            })
            if reasons:
                row["original_candidate_status"] = row["status"]
                row["status"] = "FET_RESEARCH_GATE_BLOCKED"
                row["exclusion_reason"] = "+".join(reasons)
        rows.append(row)
    output_root.mkdir(parents=True, exist_ok=True)
    path = output_root / "crypto-price-model-candidates.jsonl"
    path.write_text("".join(json.dumps(x, sort_keys=True, allow_nan=False) + "\n"
                            for x in rows), encoding="utf-8")
    (output_root / "fet-gate-preentry-decisions.jsonl").write_text(
        "".join(json.dumps(x, sort_keys=True, allow_nan=False) + "\n"
                for x in audit), encoding="utf-8")
    return output_root, audit


def run_combo(
    data_root: Path, candidate_root: Path, output_root: Path,
    v52_ledger_root: Path | None, ecb_fx_root: Path,
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    candidate_path = candidate_root / "crypto-price-model-candidates.jsonl"
    original = _rows(candidate_path)
    gated_root, gate_audit = gate_candidate_stream(
        original, data_root, output_root / "gated-candidates")
    cases = (
        ("CURRENT_BASELINE_UNMODIFIED", candidate_root, None),
        ("BRK0P75_MR0P75_FET1_CAP_ONLY", candidate_root, REQUESTED_CAPS),
        ("BRK0P75_MR0P75_FET1_DUAL_GATE", gated_root, REQUESTED_CAPS),
    )
    runs = {}
    for label, source, caps in cases:
        runs[label] = run_portfolio_model(
            data_root, source, output_root / label,
            v52_ledger_root=v52_ledger_root, ecb_fx_root=ecb_fx_root,
            cost_scenarios=COSTS, research_risk_caps=caps)
        if len(runs[label]["scenarios"]) != len(COSTS):
            raise ValueError(f"EXPECTED_ALL_COST_SCENARIOS:{label}")
        if any(row["accounting_reconciliation"]["status"] != "PASS"
               for row in runs[label]["scenarios"]):
            raise ValueError(f"PORTFOLIO_RECONCILIATION_FAILED:{label}")
        # The V52 research ledger is strategy-scoped and its rows do not have
        # a strategy_id field. Count accepted modeled lifecycles by status;
        # every skipped V52 candidate is counted separately by the portfolio.
        if v52_ledger_root is not None:
            v52_lifecycles = _rows(Path(v52_ledger_root) / "v52-model-ledger.jsonl")
            expected_decisions = (
                len(original) + runs[label]["v52_skipped_candidates"]
                + sum(r.get("status") == "MODELED_CLOSED_TRADE" for r in v52_lifecycles)
            )
            if any(s["candidate_decision_rows"] != expected_decisions
                   for s in runs[label]["scenarios"]):
                raise ValueError(
                    f"CANDIDATE_DECISION_COUNT_MISMATCH:{label}:"
                    f"expected={expected_decisions}:"
                    f"actual={[s['candidate_decision_rows'] for s in runs[label]['scenarios']]}"
                )

    blocked = Counter(k for r in gate_audit for k in r["gate_reasons"])
    accepted_baseline = {}
    baseline_dir = output_root / "CURRENT_BASELINE_UNMODIFIED" / "PRICE_MODEL_10BPS"
    for d in _rows(baseline_dir / "candidate-decisions.jsonl"):
        if d["strategy_id"] == "FET":
            accepted_baseline[int(d["entry_ts_ms"])] = d
    trade_by_entry = {
        int(t["entry_ts_ms"]): t
        for t in _rows(baseline_dir / "portfolio-trades.jsonl")
        if t["strategy_id"] == "FET"
    }
    blocked_baseline = [
        {
            "entry_ts_ms": r["entry_ts_ms"],
            "reasons": r["gate_reasons"],
            "baseline_allocation": accepted_baseline.get(r["entry_ts_ms"], {}).get("decision"),
            "baseline_model_pnl_jpy_not_counterfactual":
                trade_by_entry.get(r["entry_ts_ms"], {}).get(
                    "modeled_realized_pnl_jpy_at_exit_fx"),
            "baseline_exit_reason": trade_by_entry.get(r["entry_ts_ms"], {}).get(
                "exit_reason_actual"),
        }
        for r in gate_audit if r["gate_reasons"]
    ]
    summary = {
        "status": "IN_SAMPLE_RESEARCH_MODEL_NOT_L2_VERIFIED",
        "period": "2025-08-10_to_2026-08-10",
        "cost_models": [c[1] for c in COSTS],
        "requested_gross_caps": REQUESTED_CAPS,
        "pengu_modified": False,
        "gate_contract": {
            "overheat": "FET_24H_RETURN >= 0.15 AND FET_ATR24H_PCT >= 0.02",
            "relative_weak": "FET_24H_RETURN - BTC_24H_RETURN < 0 AND FET_24H_RETURN < 0.01",
            "observations": "ONLY_STRICTLY_PREENTRY_COMPLETED_CONTIGUOUS_H1",
            "research_only": True,
        },
        "fet_gate_total_candidate_count_with_features": len(gate_audit),
        "fet_gate_blocked_by_reason": dict(blocked),
        "fet_gate_blocked_unique": len(blocked_baseline),
        "fet_blocked_baseline_examples": blocked_baseline,
        "source_candidate_stream_sha256": hashlib.sha256(candidate_path.read_bytes()).hexdigest(),
        "source_fet_h1_sha256": hashlib.sha256((
            data_root / "normalized/aster/klines/FETUSDT.jsonl").read_bytes()).hexdigest(),
        "source_btc_h1_sha256": hashlib.sha256((
            data_root / "normalized/aster/klines/BTCUSDT.jsonl").read_bytes()).hexdigest(),
        "cases": {
            label: {
                "status": report["status"],
                "v52_model_complete": report["v52_model_complete"],
                "v52_missing_market_data_selected_candidates_excluded":
                    report["v52_missing_market_data_selected_candidates_excluded"],
                "scenarios": [{
                    key: row[key] for key in (
                        "scenario_id", "final_equity_jpy", "maximum_mtm_drawdown",
                        "profit_factor", "win_rate", "closed_trades",
                        "strategy_pnl_jpy", "strategy_trades",
                        "candidate_decision_counts", "strategy_trade_outcome_aggregates",
                        "accounting_reconciliation", "monthly_equity_jpy")
                } for row in report["scenarios"]],
            } for label, report in runs.items()
        },
        "limitations": [
            "Retrospective same-sample research; pre-entry gates derived from observed hard stops",
            "Exact historical order-book fills and liquidation-buffer parity unverified",
            "V52 missing reference sessions remain excluded identically across cases",
            "Candidate exit prices and fixed holding policies are frozen from causal signal scan",
        ],
    }
    (output_root / "requested-combo-summary.json").write_text(
        json.dumps(summary, sort_keys=True, indent=2, allow_nan=False) + "\n",
        encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--v52-ledger-root", type=Path, required=True)
    parser.add_argument("--ecb-fx-root", type=Path, required=True)
    a = parser.parse_args()
    result = run_combo(a.data_root, a.candidate_root, a.output_root,
                       a.v52_ledger_root, a.ecb_fx_root)
    print("FET_DUAL_GATE_REQUESTED_BT:", json.dumps({
        "status": result["status"],
        "blocked": result["fet_gate_blocked_by_reason"],
        "cases": {k: [{x: s[x] for x in ("scenario_id","final_equity_jpy",
                    "maximum_mtm_drawdown","profit_factor","closed_trades")}
                  for s in v["scenarios"]] for k,v in result["cases"].items()},
    }, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
