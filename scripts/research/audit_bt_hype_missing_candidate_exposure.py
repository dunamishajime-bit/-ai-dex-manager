#!/usr/bin/env python3
"""Inspect pure HYPE signals absent from STABLE4 model decision ledgers.

Read-only research reconciliation. Observed modeled exposure is NOT a reason code
or an actual venue position. Never infer why a candidate was suppressed.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

STUDY = "EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"

def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as fp:
        return list(csv.DictReader(fp))

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def positive_or_zero(s: str, label: str) -> float:
    result = float(s)
    if not math.isfinite(result) or result < 0:
        raise ValueError("INVALID_RESEARCH_METRIC:" + label)
    return result

def context_for_gaps(gaps: list[str], fills: list[dict], equity: list[dict]) -> list[dict]:
    if len(gaps) != len(set(gaps)):
        raise ValueError("DUPLICATE_GAP_TIME")
    equity_by_time = {row["utc"]: row for row in equity}
    if len(equity_by_time) != len(equity):
        raise ValueError("DUPLICATE_RESEARCH_SNAPSHOT_TIME")
    if len({r["trade_id"] for r in fills}) != len(fills):
        raise ValueError("DUPLICATE_RESEARCH_FILL_ID")
    result = []
    for time in sorted(gaps):
        row = equity_by_time.get(time)
        if row is None:
            raise ValueError("MISSING_RESEARCH_EQUITY_SNAPSHOT:" + time)
        open_count = int(row["open_count"])
        gross = positive_or_zero(row["total_gross_x"], "total_gross_x")
        crypto = positive_or_zero(row["crypto_gross_x"], "crypto_gross_x")
        stock = positive_or_zero(row["stock_gross_x"], "stock_gross_x")
        if open_count < 0 or abs((crypto + stock) - gross) > 0.02:
            raise ValueError("INCONSISTENT_RESEARCH_GROSS")
        active = [fill for fill in fills if fill["entry_utc"] <= time < fill["exit_utc"]]
        if len(active) != open_count:
            raise ValueError("MODELED_FILLED_POSITION_SNAPSHOT_MISMATCH:" + time)
        owners = sorted({r["strategy"] for r in active})
        result.append({
            "candidate_utc": time,
            "research_snapshot_open_count": open_count,
            "research_modeled_open_owner_groups": owners,
            "research_hype_model_open": "HYPE" in owners,
            "research_snapshot_crypto_gross_x": crypto,
            "research_snapshot_stock_gross_x": stock,
            "research_snapshot_total_gross_x": gross,
            "no_research_open_exposure": open_count == 0 and gross == 0,
            "reason_for_missing_hype_decision_proven": False,
        })
    return result

def build(base: Path, reconciliation: dict, study: dict) -> dict:
    if reconciliation.get("schema") != "disdex-bt-hype-pinned-signal-to-model-decision-reconciliation/v1":
        raise ValueError("UNKNOWN_HYPE_RECONCILIATION_SCHEMA")
    if study.get("schema") != "disdex-bt-stable4-research-source-audit/v1":
        raise ValueError("UNKNOWN_STUDY_SCHEMA")
    scenarios: dict[str,dict] = {}
    for bps in ("10", "30"):
        d = reconciliation["scenarios"][bps]
        gaps = d["pure_signals_without_hype_decision"]
        if len(gaps) != 8 or len(gaps) != d["pure_signals_without_hype_decision_count"]:
            raise ValueError("CANDIDATE_GAP_EVIDENCE_MISMATCH")
        prefix = f"{STUDY}_{bps}BPS_"
        fills_file = base / (prefix + "FILLS.csv")
        equity_file = base / (prefix + "EQUITY_30MIN.csv")
        decision_file = base / (prefix + "DECISIONS.csv")
        if sha(fills_file) != study["scenarios"][bps]["fills_file_sha256"] or sha(decision_file) != d["decision_csv_sha256"]:
            raise ValueError("SOURCE_SHA256_NOT_MATCHING_PREVIOUS_AUDIT")
        fills = read_csv(fills_file)
        if len(fills) != study["scenarios"][bps]["modeled_exits"]:
            raise ValueError("SOURCE_FILL_COUNT_MISMATCH")
        context = context_for_gaps(gaps, fills, read_csv(equity_file))
        scenarios[bps] = {
            "original_model_fills_sha256": sha(fills_file),
            "original_model_decisions_sha256": sha(decision_file),
            "original_model_equity_sha256": sha(equity_file),
            "unresolved_pure_candidates": len(context),
            "zero_exposure_candidates": sum(x["no_research_open_exposure"] for x in context),
            "model_hype_open_at_candidate_count": sum(x["research_hype_model_open"] for x in context),
            "candidates": context,
        }
    return {
        "schema": "disdex-bt-hype-model-only-missing-candidate-exposure/v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "STABLE4_MODELED_EXPOSURE_CONTEXT_NOT_PRODUCTION",
        "research_gross_not_live_gross": True,
        "unresolved_signal_scheduling_reason_verified": False,
        "model_portfolio_arbitration_reexecuted": False,
        "production_bt_parity_certified": False,
        "scenarios": scenarios,
    }

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    repo=Path(__file__).resolve().parents[2]
    evidence=repo/"docs/research-results"
    parser.add_argument("--study-root",type=Path,required=True)
    parser.add_argument("--reconciliation",type=Path,default=evidence/"BT_HYPE_PURE_SIGNAL_MODEL_DECISION_RECONCILE_20261119_UNCERTIFIED.json")
    parser.add_argument("--audit",type=Path,default=evidence/"BT_STABLE4_SOURCE_PARITY_AUDIT_20261119.json")
    parser.add_argument("--output",type=Path,default=evidence/"BT_HYPE_MISSING_SIGNAL_MODEL_EXPOSURE_20261119_UNCERTIFIED.json")
    args=parser.parse_args()
    result=build(args.study_root,json.loads(args.reconciliation.read_text(encoding="utf-8")),json.loads(args.audit.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    for bps,data in result["scenarios"].items():
        print(f"{bps}bps: missing={data['unresolved_pure_candidates']} zero_model_exposure={data['zero_exposure_candidates']} hype_model_open={data['model_hype_open_at_candidate_count']}")
    print("NO_CAUSAL_PORTFOLIO_EXPLANATION_VERIFIED")
if __name__=="__main__":
    main()
