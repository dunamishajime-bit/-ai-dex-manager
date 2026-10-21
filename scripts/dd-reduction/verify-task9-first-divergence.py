#!/usr/bin/env python3
"""Find the first old-full8/new-Task9 divergence; never infer missing fills.

This is a research-only gate. Raw price-model source, 8-strategy candidate,
trade and complete MTM/STOP/allocator ledgers must be supplied for parity.
An accepted historical entry is NOT venue-certified execution evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

SEGMENTS = (
    "candidate_order", "allocation_state", "execution_ledger", "trade_ledger",
    "cash_ledger", "mark_to_market_timeline", "stop_fill_and_cooldown",
)
REQUIRED = (
    "event_seq", "priority", "entry_valid_until_ms", "worst_case_gross",
    "asset_class", "quantity",
)
DECISIONS = {"ACCEPTED_MODELED_ENTRY", "REJECTED_PORTFOLIO", "EXCLUDED_PREALLOCATION"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path):
    if not path.is_file():
        raise ValueError(f"missing file: {path}")
    out = []
    for n, line in enumerate(path.read_text("utf-8").splitlines(), 1):
        if line.strip():
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n} not an object")
            out.append(row)
    return out


def difference(a, b, location="$"):
    if isinstance(a, bool) or isinstance(b, bool):
        return None if a is b else (location, a, b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isfinite(a) and math.isfinite(b) and math.isclose(
                a, b, abs_tol=1e-6, rel_tol=1e-12):
            return None
        return location, a, b
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                return f"{location}.{key}", a.get(key, "<MISSING>"), b.get(key, "<MISSING>")
            found = difference(a[key], b[key], f"{location}.{key}")
            if found is not None:
                return found
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{location}.length", len(a), len(b)
        for i, (left, right) in enumerate(zip(a, b)):
            found = difference(left, right, f"{location}[{i}]")
            if found is not None:
                return found
        return None
    return None if a == b else (location, a, b)


def canonical_compare(old_dir, new_dir):
    """Compare independently emitted canonical JSONL traces in fixed order."""
    if old_dir is None or new_dir is None:
        return {"stage": "INDEPENDENT_TRACES_MISSING",
                "required": [f"{part}.jsonl" for part in SEGMENTS]}
    for part in SEGMENTS:
        left_path = old_dir / f"{part}.jsonl"
        right_path = new_dir / f"{part}.jsonl"
        if not left_path.is_file() or not right_path.is_file():
            return {"stage": "INDEPENDENT_TRACES_MISSING", "segment": part,
                    "oldExists": left_path.is_file(), "newExists": right_path.is_file()}
        old = read_jsonl(left_path)
        new = read_jsonl(right_path)
        if not old or not new:
            return {"stage": "EMPTY_TRACE", "segment": part}
        if len(old) != len(new):
            return {"stage": "TRACE_ROW_COUNT", "segment": part,
                    "oldCount": len(old), "newCount": len(new)}
        for i, (a, b) in enumerate(zip(old, new)):
            delta = difference(a, b)
            if delta is not None:
                field, expected, actual = delta
                return {"stage": "FIRST_TRANSACTION_DIVERGENCE", "segment": part,
                        "row": i, "candidateId": a.get("candidate_id"),
                        "timestampMs": a.get("ts_ms", a.get("timestamp_ms")),
                        "field": field, "old": expected, "new": actual}
    return None


def verify(decisions_path, trades_path, task9_path, cost, old_dir=None, new_dir=None):
    if cost not in (10, 30):
        raise ValueError("cost must be 10 or 30bps")
    decisions = read_jsonl(decisions_path)
    trades = read_jsonl(trades_path)
    if not task9_path.is_file():
        raise ValueError("new Task9 run report missing")
    task9 = json.loads(task9_path.read_text("utf-8"))
    if task9.get("productionChanges") != 0 or task9.get("liveClaim") is not False:
        raise ValueError("LIVE/Production claim in research replay")
    status = Counter()
    ids = set()
    accepted = set()
    ordered = sorted(decisions, key=lambda row: (
        int(row.get("decision_ts_ms") or row.get("entry_ts_ms") or 0),
        str(row.get("candidate_id") or ""),
    ))
    for row in ordered:
        cid = row.get("candidate_id")
        if not isinstance(cid, str) or not cid or cid in ids:
            raise ValueError("empty or duplicate legacy candidate ID")
        ids.add(cid)
        decision = row.get("decision")
        if decision not in DECISIONS:
            raise ValueError(f"invalid observed decision: {decision}")
        status[decision] += 1
        if decision == "ACCEPTED_MODELED_ENTRY":
            accepted.add(cid)
    trade_ids = [row.get("candidate_id") for row in trades]
    if len(trade_ids) != len(set(trade_ids)) or set(trade_ids) != accepted:
        raise ValueError("original candidate/fill/trade IDs disagree")
    cases = task9.get("cases")
    if not isinstance(cases, list):
        raise ValueError("Task9 case list missing")
    matches = [item for item in cases if item.get("caseName") == "BASELINE"
               and item.get("costBps") == cost]
    if len(matches) != 1:
        raise ValueError("missing or duplicate same-cost Task9 baseline")
    coverage = matches[0].get("sourceCoverage")
    if not isinstance(coverage, dict) or coverage.get("observedRows") != len(decisions):
        raise ValueError("different candidate counts or missing coverage")
    input_sha = sha(decisions_path)
    if not any(x.get("sha256") == input_sha for x in coverage.get("sourceHashes", [])):
        raise ValueError("new Task9 did not read the exact original candidate bytes")
    gap = None
    for row in ordered:
        if row["decision"] == "EXCLUDED_PREALLOCATION":
            continue
        missing = [key for key in REQUIRED if row.get(key) is None]
        if missing:
            gap = {"stage": "CANONICAL_SOURCE_FIELDS_MISSING",
                   "candidateId": row["candidate_id"],
                   "decisionTsMs": row.get("decision_ts_ms"),
                   "strategy": row.get("strategy_id"),
                   "decision": row["decision"], "missing": missing,
                   "rejectedOrderSizeMustNotBeInferred": row["decision"] == "REJECTED_PORTFOLIO"}
            break
    if gap is None and coverage.get("status") != "COMPLETE":
        gap = {"stage": "TASK9_SOURCE_COVERAGE", "reason": coverage.get("reasons"),
               "replayableRows": coverage.get("replayableRows")}
    if gap is None:
        gap = canonical_compare(old_dir, new_dir)
    return {"schemaVersion": 1,
            "status": "COMPLETE_TRACE_PARITY" if gap is None else "BLOCKED_FIRST_DIVERGENCE",
            "costBps": cost, "totalCandidates": len(decisions),
            "acceptedCandidates": len(accepted), "tradeRows": len(trades),
            "decisionCounts": dict(status), "sourceCandidateSha256": input_sha,
            "sourceTradesSha256": sha(trades_path), "newTask9Sha256": sha(task9_path),
            "firstDivergence": gap, "economicParityProven": gap is None,
            "venueFillParityProven": False,
            "productionChanges": 0, "liveChanges": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-decisions", required=True, type=Path)
    parser.add_argument("--legacy-trades", required=True, type=Path)
    parser.add_argument("--new-task9-run", required=True, type=Path)
    parser.add_argument("--cost-bps", type=int, choices=[10, 30], required=True)
    parser.add_argument("--old-trace-dir", type=Path)
    parser.add_argument("--new-trace-dir", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = verify(args.legacy_decisions, args.legacy_trades, args.new_task9_run,
                    args.cost_bps, args.old_trace_dir, args.new_trace_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({"status": result["status"], "firstDivergence": result["firstDivergence"],
                      "output": str(args.output)}, ensure_ascii=False))
    if not result["economicParityProven"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
