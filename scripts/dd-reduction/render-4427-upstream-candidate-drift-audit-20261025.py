#!/usr/bin/env python3
"""Read-only Native8 candidate provenance audit for RENDER #4427 (2026-10-25).

Never modifies the modeled ledgers, portfolio gates, production, or LIVE.
"""
from __future__ import annotations
import collections
import hashlib
import json
from pathlib import Path

ROOT = Path("C:/tmp/render-mtf-study-20261024")
ENGINE = Path("C:/tmp/r4427c3/RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024/engine")
RUNS = {
    10: ["cmp_5bb26c207eb3", "cmp_88139ccf92bb", "cmp_d112f9aef1ff"],
    30: ["cmp_2104321c587e", "cmp_3a77ec7e46bd", "cmp_433aa2452f5a"],
}
EXTRA_REASON = "V12:TASK9_ADVERSE_SIDE_COOLDOWN"

def read(path: Path) -> list[dict]:
    assert path.is_file(), f"PRIMARY_SOURCE_MISSING:{path}"
    return [json.loads(line) for line in path.read_text(encoding="utf8").splitlines() if line.strip()]

def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def key(row: dict) -> tuple:
    return tuple(row.get(k) for k in ("strategy_id", "symbol", "side", "route", "entry_ts_ms"))

def sha_json(obj) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf8")).hexdigest()

def audit() -> dict:
    result = {"status": "RESEARCH_ONLY_UPSTREAM_CANDIDATE_DRIFT_CONFIRMED_ROOT_CAUSE_UNPROVEN",
              "model_only": True, "costs": {}, "production_changes": 0, "live_changes": 0}
    for cost, ids in RUNS.items():
        manifests, decisions, source_hashes = [], [], []
        for run_id in ids:
            root = ENGINE / run_id / run_id / f"{cost}bps" / "cases" / "V2_M150_D05_CORE_NATIVE"
            manifest_path = root / "candidates" / "crypto-price-model-candidates.jsonl"
            decision_path = root / "runs" / f"PRICE_MODEL_{cost}BPS" / "candidate-decisions.jsonl"
            manifests.append(read(manifest_path))
            decisions.append(read(decision_path))
            source_hashes.append({"run_id": run_id, "candidate_file_sha256": sha_file(manifest_path),
                                  "decision_file_sha256": sha_file(decision_path)})
        assert [len(rows) for rows in manifests] == [2444, 2424, 2424]
        assert [len(rows) for rows in decisions] == [2543, 2523, 2523]
        assert manifests[1] == manifests[2], "WARM_MANIFEST_DRIFT"
        assert decisions[1] == decisions[2], "WARM_DECISION_DRIFT"
        first, warm = manifests[:2]
        first_count, warm_count = collections.Counter(map(key, first)), collections.Counter(map(key, warm))
        extras = first_count - warm_count
        assert sum(extras.values()) == 20 and not (warm_count - first_count)
        assert all(n == 1 for n in extras.values()), "DUPLICATE_KEY_AMBIGUITY"
        extra_rows = [row for row in first if key(row) in extras]
        assert len(extra_rows) == 20 and all(row["strategy_id"] == "V12" for row in extra_rows)
        retained = [row for row in first if key(row) not in extras]
        assert retained == warm, "OTHER_CANDIDATE_CONTENT_OR_ORDER_DRIFT"
        rejected = [[row for row in run if row.get("reason") == EXTRA_REASON] for run in decisions]
        assert [len(rows) for rows in rejected] == [20, 0, 0]
        assert collections.Counter(map(key, rejected[0])) == extras, "REJECTION_TO_SOURCE_KEY_MISMATCH"
        assert all(row.get("decision") == "REJECTED_PORTFOLIO" for row in rejected[0])
        result["costs"][str(cost)] = {
            "run_ids": ids,
            "source_counts": list(map(len, manifests)),
            "decision_counts": list(map(len, decisions)),
            "first_only_v12_source_rows": 20,
            "source_rows_are_exactly_20_first_run_cooldown_rejections": True,
            "remaining_2424_source_rows_exactly_equal_in_order_and_content": True,
            "warm_source_and_decision_files_byte_identical": source_hashes[1]["candidate_file_sha256"] == source_hashes[2]["candidate_file_sha256"] and source_hashes[1]["decision_file_sha256"] == source_hashes[2]["decision_file_sha256"],
            "extra_keys_sha256": sha_json(sorted([list(k) for k in extras])),
            "source_files": source_hashes,
            "first_only_source_keys": [list(k) for k in sorted(extras)],
        }
        assert result["costs"][str(cost)]["warm_source_and_decision_files_byte_identical"]
    assert result["costs"]["10"]["first_only_source_keys"] == result["costs"]["30"]["first_only_source_keys"]
    result["finding"] = ("The 20 extra V12 cooldown rejections are present in the FIRST replay's "
                         "pre-allocation crypto-price-model-candidates.jsonl and absent from both "
                         "later replays; after removing those 20, all other upstream source rows "
                         "are exactly identical. Therefore the mismatch already exists before "
                         "portfolio admission/decision recording, and cannot be fixed by simply "
                         "renumbering candidate IDs or normalizing the decision ledger.")
    result["limits"] = [
        "The exact state/cache or generator mutation that changes the pre-allocation candidate manifest has not been proven.",
        "These are archived modeled replays, not fresh clean-process cold/warm executions.",
        "No formal independent Owner/Route registration or full safety gate parity is proven.",
        "Aster 2025 RENDER H1 mark missing; actual Aster M5 fills and funding not authenticated.",
        "All historical periods were already explored and are not untouched OOS.",
        "No VPS/LIVE/Production/HP/real order changes.",
    ]
    return result

if __name__ == "__main__":
    report = audit()
    output = ROOT / "RENDER_4427_UPSTREAM_CANDIDATE_DRIFT_AUDIT_20261025.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")
    lines = [
        "# RENDER #4427 — upstream candidate drift audit (2026-10-25)",
        "",
        "STATUS: RESEARCH ONLY; root cause and formal Owner/Route safety parity remain unproven.",
        "",
        "## New, independently checkable finding",
        "The first replay differs BEFORE the portfolio admission/decision logger. The "
        "pre-allocation candidate manifest contains 20 additional V12 rows; "
        "their strategy/symbol/side/route/timestamp keys match exactly the 20 "
        "first-run-only `V12:TASK9_ADVERSE_SIDE_COOLDOWN` rejections.",
        "",
        "| Cost | First source rows | Later source rows | First decision rows | Later decision rows | Other source rows equal |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for cost in (10, 30):
        row = report["costs"][str(cost)]
        lines.append(f"| {cost}bps | {row['source_counts'][0]} | {row['source_counts'][1]} / {row['source_counts'][2]} | {row['decision_counts'][0]} | {row['decision_counts'][1]} / {row['decision_counts'][2]} | YES, exact order/content |")
    lines += [
        "",
        "The two later candidate manifests are byte-identical; so are their decision files. "
        "Removing precisely the 20 extra first-run source rows leaves an exact match "
        "with both later manifests. The extra key set is the same at 10bps and 30bps.",
        "",
        "## Causal scope and next diagnostic",
        "This narrows the problem to pre-allocation candidate generation / research "
        "source transformation, not just decision IDs or decision logging. "
        "It does NOT yet prove whether the cause is mutable Python module state, "
        "cached input, repeated study-adapter installation, or an earlier source "
        "artifact. To prove that, instrument candidate counts and source SHA "
        "immediately before and after each stage in a fresh isolated process.",
        "",
        "## Fail-closed limits",
        *[f"- {item}" for item in report["limits"]],
        "",
        "Evidence: archived Native8 candidate and decision JSONL paths and SHA256 "
        "in the accompanying JSON. Audit script is deterministic and read-only "
        "except for its report output under C:/tmp/render-mtf-study-20261024.",
    ]
    (ROOT / "RENDER_4427_UPSTREAM_CANDIDATE_DRIFT_AUDIT_20261025.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print(json.dumps({"status": report["status"], "report_sha256": sha_file(output),
                      "costs": {k: {"extra": v["first_only_v12_source_rows"],
                                   "warm_source_exact": v["warm_source_and_decision_files_byte_identical"],
                                   "other_rows_exact": v["remaining_2424_source_rows_exactly_equal_in_order_and_content"]}
                                for k, v in report["costs"].items()}}, ensure_ascii=False))
