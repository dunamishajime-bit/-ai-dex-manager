#!/usr/bin/env python3
"""Independent audit of Task9's single economic core and historical full8 run.

Checks native proposal, accepted trade, modeled STOP cooldown, full H1 MTM,
realized PnL and source-provenance across 10/30bps from the SAME model pass.
Does not certify the standalone TypeScript allocator or venue execution.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path


ID = "V12_SHORT_PCT2P5_12H_MFE1P0_R12"
HOUR = 3_600_000
STRATEGIES = {"V12", "PENGU", "Q102", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"}


def check(cond, reason):
    if not cond:
        raise RuntimeError("TASK9_NATIVE_PARITY_FAILURE:" + reason)


def close(actual, expect, label, *, rtol=2e-10, atol=1e-6):
    check(isinstance(actual, (float, int)) and isinstance(expect, (float, int))
          and math.isfinite(actual) and math.isfinite(expect)
          and math.isclose(actual, expect, rel_tol=rtol, abs_tol=atol),
          f"{label} {actual} != {expect}")


def file_sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    check(path.is_file(), f"source missing {path}")
    return [json.loads(row) for row in path.read_text("utf8").splitlines() if row]


def folder(root, case, cost):
    if case == "BASELINE":
        group, run = "BASELINE", "BASELINE"
    else:
        group, run = "V12_SHORT", f"RERUN_{ID}_{cost}"
    return (root / "engine" / group / run / f"{cost}bps"
            / "cases" / "V2_M150_D05_CORE_NATIVE" / "runs"
            / f"PRICE_MODEL_{cost}BPS")


def audit_one(root, case, cost):
    d = folder(root, case, cost)
    metrics_path = d / "metrics.json"
    check(metrics_path.is_file(), f"source metrics absent {d}")
    metrics = json.loads(metrics_path.read_text("utf8"))
    candidates = read(d / "candidate-decisions.jsonl")
    trades = read(d / "portfolio-trades.jsonl")
    events = read(d / "portfolio-events.jsonl")
    mtm = read(d / "task9-mtm.jsonl")
    check(len(candidates) == 3185, "all-8 candidate count is not 3185")
    check(len(mtm) >= 8760, f"missing H1 marks: {len(mtm)}")
    check(all(mtm[i + 1]["timestamp_ms"] - mtm[i]["timestamp_ms"] == HOUR
              for i in range(len(mtm) - 1)), "hourly MTM timestamps discontinuous")
    check(metrics.get("missing_active_position_mtm_hours") == 0,
          "active mark price gaps disallow MTM parity")
    ids = [row["candidate_id"] for row in candidates]
    check(len(set(ids)) == len(ids), "duplicate candidate decision")
    check(set(row["strategy_id"] for row in candidates) == STRATEGIES, "not all 8 strategies")
    accepted = {row["candidate_id"]: row for row in candidates
                if row["decision"] == "ACCEPTED_MODELED_ENTRY"}
    excluded = [row for row in candidates if row["decision"] == "EXCLUDED_PREALLOCATION"]
    rejected = [row for row in candidates if row["decision"] == "REJECTED_PORTFOLIO"]
    check(len(excluded) == 16, "preallocation exclusions changed")
    check(len(accepted) + len(excluded) + len(rejected) == len(candidates),
          "unknown/incomplete candidate decision type")
    check(len(trades) == len(accepted) == metrics["closed_trades"],
          "trade counts not exact")
    tbyid = {t["candidate_id"]: t for t in trades}
    check(len(tbyid) == len(trades) and set(tbyid) == set(accepted),
          "fill/trade candidate IDs diverge")
    seqs = sorted(row["event_seq"] for row in candidates)
    check(seqs == list(range(1, len(candidates) + 1)),
          "native candidate decision event sequence has gaps or duplicates")
    for row in candidates:
        if row["decision"] == "EXCLUDED_PREALLOCATION":
            continue
        check(row["validity"] == "VALID"
              and row["candidate_status"] in {"ACCEPTED", "REJECTED"}
              and row["entry_valid_until_ms"] > row["decision_ts_ms"]
              and row["priority"] is not None and row["asset_class"] in {"CRYPTO", "NON_CRYPTO"}
              and isinstance(row["quantity"], (int, float)) and row["quantity"] > 0
              and row["source_frozen_model"] is True and row["source_venue_signed"] is False,
              f"actionable canonical evidence failed {row['candidate_id']}")
    for candidate_id, decision in accepted.items():
        trade = tbyid[candidate_id]
        check(decision["quantity_actual_fill"] is True, "modeled fill status missing")
        close(decision["quantity"], trade["original_quantity"], f"entry qty {candidate_id}")
        close(decision["accepted_gross"], trade["accepted_gross"],
              f"entry gross {candidate_id}", atol=1e-12)
        close(decision["entry_price"], trade["entry_price"], f"entry price {candidate_id}")
    ordered = sorted((x for x in candidates if x["decision"] != "EXCLUDED_PREALLOCATION"), key=lambda x: x["event_seq"])
    check(all(ordered[i]["decision_ts_ms"] <= ordered[i + 1]["decision_ts_ms"]
              for i in range(len(ordered) - 1)), "future-ordering violation")
    pnl = [float(x["total_pnl_jpy"]) for x in trades]
    gains = sum(x for x in pnl if x > 0)
    losses = -sum(x for x in pnl if x < 0)
    check(losses > 0, "profit factor denominator missing")
    close(gains / losses, metrics["profit_factor"], "profit factor", atol=1e-12)
    wallet_end = mtm[-1]["equity_jpy"]
    close(wallet_end, metrics["final_equity_jpy"], "final equity")
    max_dd = min(x["drawdown_pct"] for x in mtm) / 100.0
    close(max_dd, metrics["maximum_mtm_drawdown"], "full H1 MTM maxDD", atol=1e-11)
    check(metrics.get("accounting_reconciliation", {}).get("status") == "PASS",
          "native trade/wallet accounting failed")
    entry_events = [e for e in events if e.get("event_type") == "MODELED_ENTRY"]
    exit_events = [e for e in events if e.get("event_type") == "MODELED_EXIT"]
    check(len(entry_events) == len(exit_events) == len(trades),
          "modeled entry/exit ledger missing rows")
    check({e["candidate_id"] for e in entry_events} == set(tbyid)
          and {e["candidate_id"] for e in exit_events} == set(tbyid),
          "entry/exit event linkage incomplete")
    cd = [e for e in events if e.get("event_type") == "TASK9_MODELED_STOP_COOLDOWN"]
    stop_trades = [t for t in trades if str(t["exit_reason_actual"]).startswith(
        "RESEARCH_INITIAL_ADVERSE_STOP_" + ID)]
    excluded_cd = [d for d in candidates if d.get("reason") == "V12:TASK9_ADVERSE_SIDE_COOLDOWN"]
    if case == "BASELINE":
        check(not cd and not stop_trades and not excluded_cd,
              "unmodified baseline emitted Task9 overlay events")
    else:
        check(len(cd) == len(stop_trades) > 0, "STOP fill/cooldown count differs")
        cdb = {e["candidate_id"]: e for e in cd}
        check(len(cdb) == len(cd)
              and set(cdb) == {t["candidate_id"] for t in stop_trades},
              "STOP protection cooldown duplicate/missing")
        for t in stop_trades:
            c = cdb[t["candidate_id"]]
            check(c["strategy_id"] == t["strategy_id"] == "V12"
                  and c["side"] == t["side"] == "SHORT"
                  and c["symbol"] == t["symbol"]
                  and c["ts_ms"] == t["exit_ts_ms"]
                  and c["until_ts_ms"] == c["ts_ms"] + 12 * HOUR
                  and c["source_venue_signed"] is False,
                  f"unproven or mis-timed STOP cooldown {t['candidate_id']}")
        for rejected_row in excluded_cd:
            active_stop = any(c["symbol"] == rejected_row["symbol"]
                              and c["side"] == rejected_row["side"]
                              and c["ts_ms"] < rejected_row["decision_ts_ms"] < c["until_ts_ms"]
                              for c in cd)
            check(active_stop, f"cooldown triggered without admitted prior STOP {rejected_row['candidate_id']}")
    return {
        "candidateCount": len(candidates),
        "actionableCount": len(candidates) - len(excluded),
        "acceptedCount": len(accepted),
        "rejectedCount": len(rejected),
        "excludedPreallocation": len(excluded),
        "tradeCount": len(trades),
        "modeledStopExits": len(stop_trades),
        "stopConfirmedCooldownEvents": len(cd),
        "stopCooldownRejected": len(excluded_cd),
        "h1MtmPoints": len(mtm),
        "finalEquityJpy": wallet_end,
        "profitFactor": gains / losses,
        "maxDrawdownPct": 100 * max_dd,
        "allEightStrategies": True,
        "accounting": "PASS",
        "sha256": {
            f: file_sha(d/f) for f in [
                "candidate-decisions.jsonl", "portfolio-trades.jsonl",
                "portfolio-events.jsonl", "task9-mtm.jsonl", "metrics.json"
            ]
        },
        "venueFillVerified": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    matrix = {}
    for cost in (10, 30):
        baseline = audit_one(args.model_root, "BASELINE", cost)
        change = audit_one(args.model_root, ID, cost)
        check(change["maxDrawdownPct"] > baseline["maxDrawdownPct"],
              f"{cost}bps candidate DD not improved")
        matrix[str(cost)] = {"baseline": baseline, "stopWithConfirmedCooldown": change}
    manifest = {
        "status": "PASS_NATIVE_SINGLE_CORE_FULL8_ECONOMIC_AND_STOP_CAUSAL_PARITY",
        "scope": "Full8 frozen H1 modeled execution, with archived 5m initial-adverse STOP",
        "inSampleResearchOnly": True,
        "standaloneTsReducerEconomicParityProven": False,
        "productionVenueFillParityProven": False,
        "observationalProof": "Native allocator -> candidates/fills/events/MTM -> independent ledger recomputation",
        "scenarios": matrix,
        "liveChanges": 0, "productionChanges": 0,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf8")
    print(json.dumps({"status": manifest["status"], "results": {
        cost: {name: {k: entry[k] for k in (
            "finalEquityJpy", "profitFactor", "maxDrawdownPct", "tradeCount",
            "modeledStopExits", "stopCooldownRejected", "h1MtmPoints")}
               for name, entry in scenarios.items()}
        for cost, scenarios in matrix.items()}, "liveChanges": 0},
        ensure_ascii=False))


if __name__ == "__main__":
    main()
