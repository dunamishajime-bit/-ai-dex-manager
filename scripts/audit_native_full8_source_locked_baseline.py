"""Prove that the archived native eight-owner BT is exactly reusable as baseline.

This auditor NEVER re-evaluates entry/exit/owner gates, and never sends orders.
It cannot certify a counterfactual dynamic-gross portfolio: the native engine
must expose its post-gate allocation boundary for that experiment.
"""
from __future__ import annotations
import argparse
from collections import Counter
from hashlib import sha256
import json
import math
from pathlib import Path

FAMILIES = {"V12", "PENGU", "Q102", "FET", "HYPE_LONG", "IDLE", "RESIDUAL", "V52"}
MUTABLE_FIELDS = ["approved_gross_at_entry_only"]
PROTECTED_FIELDS = [
    "entry_ts_ms", "signal_ts_ms", "symbol", "side", "strategy_id", "route",
    "family", "exit_ts_ms", "exit_reason_actual", "partial_exit_sequence",
    "native_ownership", "cooldown", "resident_stop",
]


def read_rows(path: Path):
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def digest(path: Path) -> str:
    h = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def event_cashflow(event: dict) -> float:
    kind = event["event_type"]
    if kind == "MONTHLY_CONTRIBUTION":
        return float(event["settlement_cashflow"])
    if kind == "MODELED_ENTRY":
        return -float(event["fee_settlement"])
    if kind == "FUNDING":
        return float(event["cashflow_settlement"])
    if kind in ("MODELED_EXIT", "MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT"):
        return float(event["net_cashflow_settlement"])
    if kind == "TASK9_MODELED_STOP_COOLDOWN":
        return 0.
    raise ValueError("UNKNOWN_NATIVE_EVENT_TYPE:" + kind)


def audit_native(run: Path) -> dict:
    metrics_path = run / "metrics.json"
    event_path = run / "portfolio-events.jsonl"
    trade_path = run / "portfolio-trades.jsonl"
    decision_path = run / "candidate-decisions.jsonl"
    metrics = json.loads(metrics_path.read_text(encoding="utf8"))
    events = read_rows(event_path)
    trades = read_rows(trade_path)
    decisions = read_rows(decision_path)
    accepted = [r for r in decisions if r.get("decision") == "ACCEPTED_MODELED_ENTRY"]
    trade_counts = Counter(r["strategy_id"] for r in trades)
    if set(trade_counts) != FAMILIES:
        raise ValueError("NATIVE_STRATEGY_FAMILY_SET_CHANGED")
    if len(accepted) != len(trades):
        raise ValueError("NATIVE_ACCEPTED_TRADE_COUNT_MISMATCH")
    if set(str(r["candidate_id"]) for r in accepted) != set(str(r["candidate_id"]) for r in trades):
        raise ValueError("NATIVE_ACCEPTED_CANDIDATE_IDS_DIFFER")
    by_id = {str(row["candidate_id"]): row for row in accepted}
    for trade in trades:
        entry = by_id[str(trade["candidate_id"])]
        for field in ("strategy_id", "symbol", "side", "entry_ts_ms"):
            if entry.get(field) != trade.get(field):
                raise ValueError("NATIVE_GATE_LEDGER_IDENTITY_MISMATCH:" + str(trade["candidate_id"]) + ":" + field)
    running = 0.
    reconciled = 0
    max_absolute_error = 0.
    event_counts = Counter()
    last_ts = 0
    for e in events:
        ts = int(e["ts_ms"])
        if ts < last_ts:
            raise ValueError("NATIVE_EVENT_CLOCK_NOT_MONOTONIC")
        last_ts = ts
        event_counts[e["event_type"]] += 1
        running += event_cashflow(e)
        reported = e.get("wallet_after_event")
        if reported is not None:
            error = abs(running - float(reported))
            max_absolute_error = max(max_absolute_error, error)
            if error > 1e-7 * max(1., abs(float(reported))):
                raise ValueError("NATIVE_EVENT_WALLET_CASHFLOW_MISMATCH")
            reconciled += 1
    final_fx = float(events[-1]["reference_fx_jpy_per_usd"])
    modeled_final = running * final_fx
    expected_final = float(metrics["final_equity_jpy"])
    delta = modeled_final - expected_final
    if not math.isclose(modeled_final, expected_final, rel_tol=1e-10, abs_tol=1e-5):
        raise ValueError("NATIVE_EQUITY_FAILED_RECONCILIATION")
    if dict(trade_counts) != metrics["strategy_trades"]:
        raise ValueError("NATIVE_TRADE_COUNTS_NOT_SAME_AS_SUMMARY")
    if event_counts["MODELED_ENTRY"] != len(trades) or event_counts["MODELED_EXIT"] != len(trades):
        raise ValueError("NATIVE_ENTRY_EXIT_EVENT_COUNT_MISMATCH")
    return {
        "status": "PASS_NATIVE_EIGHT_STRATEGY_BASELINE_CASHFLOW_RECONCILIATION",
        "allNativeAdmissionDecisionsFrozen": True,
        "nativeEntryExitTimestampsFrozen": True,
        "grossOverlayApplied": False,
        "readyForGrossOnlyHook": True,
        "exactNativeLatestSourceShaVerified": False,
        "liveVenueFillVerified": False,
        "historicalModeledPriceOnly": True,
        "strategyCount": len(FAMILIES),
        "strategyTradeCounts": dict(trade_counts),
        "acceptedEntries": len(accepted),
        "exits": event_counts["MODELED_EXIT"],
        "partialExitEvents": event_counts["MODELED_PARTIAL_EXIT"] + event_counts["HYPE_PRIORITY_PARTIAL_EXIT"],
        "fundingEvents": event_counts["FUNDING"],
        "eventCounts": dict(event_counts),
        "walletReconciledEvents": reconciled,
        "maximumWalletReconciliationErrorUsd": max_absolute_error,
        "nativeFinalEquityJpy": expected_final,
        "replayedFinalEquityJpy": modeled_final,
        "finalEquityDeltaJpy": delta,
        "nativePF": float(metrics["profit_factor"]),
        "nativeDD": float(metrics["maximum_mtm_drawdown"]),
        "nativeWinRate": float(metrics["win_rate"]),
        "nativeContributionJpy": float(metrics["contributed_jpy"]),
        "sourceSHA256": {
            "portfolioEvents": digest(event_path),
            "nativeDecisions": digest(decision_path),
            "nativeTrades": digest(trade_path),
            "nativeMetrics": digest(metrics_path),
        },
        "grossOnlyHookContract": {
            "mutable": MUTABLE_FIELDS,
            "immutable": PROTECTED_FIELDS,
            "constraints": ["no-new-candidate-without-original-postgate-native-evaluation",
                            "native-strategy-and-symbol-slot-ownership-preserved",
                            "strategy-position-class-total-gross-cap-preserved",
                            "venue-min-lot-stop-and-funding-repriced-to-new-quantity",
                            "reject-if-native-entryexit-or-cashflow-baseline-parity-fails"],
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--native-run", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    args = ap.parse_args()
    evidence = audit_native(args.native_run)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
