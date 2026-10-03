"""Read-only audit: exact research parity is not a LIVE ownership certificate.

No venue client, deployment mutation, state editing or approval artifact writer.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import stat
import zipfile


EXPECTED = {
    "portfolio-trades.jsonl": (1275, "3433c0b033bb048b1aca22b21d97ff253bbb160edb47d00eb7a8fac6a1ac9915"),
    "candidate-decisions.jsonl": (2588, "48b68012f7e9dea1fc83b98119b7318e48193abe57ca9c27efb6062ea3b76b53"),
}
RAW_SHA = "35d5259ee890c7d1ac19d8d433940f05a8d0c94f793b9d3005d770ea2e8dc10c"
GATED_SHA = "ecc8103dea9ce392ea72fe918ca362416b762f0072a1a43d7f0d496b6755b935"
ENGINE_SHA = "761d88a34ddda536bcf0a88547b1f438ff58b17086b1a89388dc805df6aeba06"
ANCHOR = {"final_equity_jpy": 1229065462.0472791,
          "profit_factor": 2.4887028036012624,
          "maximum_mtm_drawdown": -0.21296368751349548,
          "closed_trades": 1275}


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def extract_verified_zip(path, destination, expected_sha):
    """Fail before extracting anything if identity or any member is unsafe."""
    if expected_sha is not None and file_sha(path) != expected_sha:
        raise ValueError("SOURCE_ARCHIVE_SHA_MISMATCH")
    destination = Path(destination).resolve()
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            target = (destination / item.filename).resolve()
            if (destination not in target.parents or ":" in item.filename or "\\" in item.filename
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError(f"UNSAFE_ARCHIVE_MEMBER:{item.filename}")
        destination.mkdir(parents=True, exist_ok=True)
        archive.extractall(destination)


def rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def semantic_parity(expected, actual):
    """Compare every field and row in original order; no numeric tolerances."""
    n = max(len(expected), len(actual))
    for i in range(n):
        left = expected[i] if i < len(expected) else None
        right = actual[i] if i < len(actual) else None
        # Python treats False==0 and True==1; exact JSON must not.
        if json.dumps(left, sort_keys=True, allow_nan=False) != json.dumps(right, sort_keys=True, allow_nan=False):
            return {"pass": False, "first_divergence_index": i, "expected": left, "actual": right}
    return {"pass": True, "rows": len(expected), "first_divergence_index": None}


def iso(ts):
    return datetime.fromtimestamp(ts / 1000, timezone.utc).isoformat()


def find_ownership_conflicts(trades):
    """Closed-trade ownership occupies [entry, actual exit), not planned exit.

    Equal exit/entry timestamps are intentionally non-overlapping. Same-side
    netted venue quantity does not give two independently reconciled owners.
    """
    grouped = {}
    ids = set()
    for row in trades:
        cid = row["candidate_id"]
        if not cid or cid in ids:
            raise ValueError(f"DUPLICATE_OR_MISSING_CANDIDATE_ID:{cid}")
        ids.add(cid)
        start, end = row["entry_ts_ms"], row["exit_ts_ms"]
        if (not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                    and math.isfinite(v) and v > 0 for v in (start, end)) or end < start):
            raise ValueError(f"INVALID_TRADE_LIFECYCLE:{cid}")
        if row["side"] not in {"LONG", "SHORT"} or not row["strategy_id"] or not row["symbol"]:
            raise ValueError(f"INVALID_TRADE_OWNER:{cid}")
        if end == start:
            # Filled then preempted at the same model timestamp: fees remain
            # in accounting, but [entry, exit) is an empty ownership interval.
            continue
        grouped.setdefault(row["symbol"], []).append(row)
    conflicts = []
    fields = ("candidate_id", "strategy_id", "side", "entry_ts_ms", "exit_ts_ms",
              "entry_price", "accepted_gross", "rank", "family", "exit_reason_actual")
    for symbol, group in sorted(grouped.items()):
        group.sort(key=lambda r: (r["entry_ts_ms"], r["candidate_id"]))
        for i, left in enumerate(group):
            for right in group[i + 1:]:
                if right["entry_ts_ms"] >= left["exit_ts_ms"]:
                    break
                start = max(left["entry_ts_ms"], right["entry_ts_ms"])
                end = min(left["exit_ts_ms"], right["exit_ts_ms"])
                if start < end:
                    conflicts.append({
                        "symbol": symbol, "overlap_start_ts_ms": start,
                        "overlap_end_ts_ms": end, "overlap_start_utc": iso(start),
                        "overlap_end_utc": iso(end),
                        "opposite_sides": left["side"] != right["side"],
                        "cross_strategy": left["strategy_id"] != right["strategy_id"],
                        "earlier_owner": {k: left.get(k) for k in fields},
                        "later_owner": {k: right.get(k) for k in fields},
                    })
    return sorted(conflicts, key=lambda r: (r["overlap_start_ts_ms"], r["symbol"]))


def certification_status(parity_pass, source_pass, conflict_count):
    if not source_pass:
        return "BLOCKED_CANONICAL_SOURCE_IDENTITY"
    if not parity_pass:
        return "BLOCKED_CORE_EXACT_PARITY"
    if conflict_count:
        return "BLOCKED_FORMAL_CORE_SYMBOL_OWNERSHIP_PARITY_CONFLICT"
    return "CORE_OFFLINE_AUDIT_PASS_NOT_LIVE_CERTIFIED"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical", required=True, type=Path)
    parser.add_argument("--fresh", required=True, type=Path)
    parser.add_argument("--raw-candidates", required=True, type=Path)
    parser.add_argument("--gated-candidates", required=True, type=Path)
    parser.add_argument("--engine-source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = {"schema": "disdex/formal-core-ownership-audit/v1", "ledger_parity": {},
              "source_files": {}, "production_mutation": False,
              "orders_sent": 0, "cancels_sent": 0, "position_changes_sent": 0}
    source_pass = True
    for name, (count, digest) in EXPECTED.items():
        original, fresh = args.canonical / name, args.fresh / name
        canonical_rows, fresh_rows = rows(original), rows(fresh)
        checked = semantic_parity(canonical_rows, fresh_rows)
        checked.update({"canonical_sha256": file_sha(original), "fresh_bytes_sha256": file_sha(fresh),
                        "canonical_expected_rows": count, "fresh_rows": len(fresh_rows),
                        "byte_identity": original.read_bytes() == fresh.read_bytes()})
        source_pass &= file_sha(original) == digest and len(canonical_rows) == count
        report["ledger_parity"][name] = checked
    for label, path, digest in (("raw_candidates", args.raw_candidates, RAW_SHA),
                                 ("fet_dual_gate_candidates", args.gated_candidates, GATED_SHA)):
        actual = file_sha(path)
        source_pass &= actual == digest
        report["source_files"][label] = {"path": str(path), "bytes": path.stat().st_size,
                                        "sha256": actual, "expected_sha256": digest}
    source_pass &= file_sha(args.engine_source) == ENGINE_SHA
    report["source_files"]["engine"] = {"path": str(args.engine_source), "sha256": file_sha(args.engine_source),
                                        "expected_sha256": ENGINE_SHA}
    metrics = json.loads((args.fresh / "metrics.json").read_text(encoding="utf-8"))
    report["anchor"] = {k: {"actual": metrics[k], "expected": value, "pass": metrics[k] == value}
                        for k, value in ANCHOR.items()}
    conflicts = find_ownership_conflicts(rows(args.fresh / "portfolio-trades.jsonl"))
    report["ownership_conflicts"] = conflicts
    report["ownership_summary"] = {
        "overlapping_pairs": len(conflicts),
        "opposite_side_pairs": sum(r["opposite_sides"] for r in conflicts),
        "same_side_pairs": sum(not r["opposite_sides"] for r in conflicts),
        "by_symbol": dict(Counter(r["symbol"] for r in conflicts)),
        "later_owner_counts": dict(Counter(r["later_owner"]["strategy_id"] for r in conflicts)),
    }
    parity_pass = all(r["pass"] for r in report["ledger_parity"].values()) and all(r["pass"] for r in report["anchor"].values())
    report["source_identity_pass"] = bool(source_pass)
    report["core_exact_semantic_parity_pass"] = parity_pass
    report["status"] = certification_status(parity_pass, source_pass, len(conflicts))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": report["status"], "source_identity_pass": bool(source_pass),
                      "core_exact_semantic_parity_pass": parity_pass,
                      "ownership_summary": report["ownership_summary"], "output": str(args.output)}, indent=2))
    return 2 if report["status"].startswith("BLOCKED_") else 0


if __name__ == "__main__":
    raise SystemExit(main())
