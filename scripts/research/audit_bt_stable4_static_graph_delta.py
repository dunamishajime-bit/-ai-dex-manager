#!/usr/bin/env python3
"""Compare historical and LIVE static Git import graphs; never certify modeled fills."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re

SOURCE_PATH = Path(__file__).with_name("audit_bt_live_dependency_closure.py")
SPEC = importlib.util.spec_from_file_location("bt_live_git_closure_for_compare", SOURCE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load pinned Git graph builder")
GRAPH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GRAPH)

CATEGORIES: dict[str, tuple[str,...]] = {
    "signal_entry": ("signal", "candidate", "strategy", "sleeve", "model", "opportunity", "entry-features"),
    "exit_protection": ("exit", "stop", "protection", "retirement", "lifecycle", "funding"),
    "risk_gross_priority": ("risk", "gross", "reservation", "portfolio", "preempt", "kill-switch"),
    "order_execution": ("execution", "durable-order", "trade-executor", "order-cycle", "adapter"),
    "authority_readiness": ("certified", "gate", "auth", "account-fresh", "signed", "lock", "heartbeat"),
}

def categorize(path: str) -> list[str]:
    basename = path.rsplit("/", 1)[-1].lower()
    return [label for label, terms in CATEGORIES.items() if any(term in basename for term in terms)] or ["requires_manual_review"]


def evaluate_graphs(research_graph: dict, live_graph: dict) -> dict:
    older = {row["path"]: row["git_sha256"] for row in research_graph["files"]}
    newer = {row["path"]: row["git_sha256"] for row in live_graph["files"]}
    if len(older) != len(research_graph["files"]) or len(newer) != len(live_graph["files"]):
        raise ValueError("Duplicate source file in closure")
    if research_graph["unresolved_relative_imports"] or live_graph["unresolved_relative_imports"]:
        raise ValueError("Static imports unresolved; cannot compare source lineage")
    changed = []
    for path in sorted(older.keys() | newer.keys()):
        if older.get(path) == newer.get(path):
            continue
        changed.append({
            "path": path,
            "research": "PRESENT" if path in older else "ABSENT",
            "live": "PRESENT" if path in newer else "ABSENT",
            "operation": "MODIFIED" if path in older and path in newer else "LIVE_ADDED" if path in newer else "LIVE_REMOVED",
            "review_categories": categorize(path),
            "economic_effect_proven": False,
        })
    return {
        "research_static_files": len(older),
        "live_static_files": len(newer),
        "identical_static_files": len(set(older) & set(newer)) - sum(1 for path in older.keys() & newer.keys() if older[path] != newer[path]),
        "changed_files_in_static_graph_union": len(changed),
        "has_unreviewed_semantic_changes": len(changed) > 0,
        "source_graph_change_requires_trade_reexecution": len(changed) > 0,
        "changed": changed,
    }


def audit(study: dict, snapshot: dict, root: Path) -> dict:
    if study.get("schema") != "disdex-bt-stable4-vps-source-comparison/v1" or snapshot.get("schema") != "disdex-bt-vps-entrypoint-parity/v1":
        raise ValueError("Source evidence schema mismatch")
    if snapshot.get("all_entrypoints_verified") is not True:
        raise ValueError("LIVE snapshot is not verified")
    observed = {row["runner"]: row for row in snapshot["rows"]}
    models = {row["model"]: row for row in study["scenarios"]["10"]["models"]}
    records = {}
    for runner in ("V4", "HYPE"):
        if runner not in observed or runner not in models or observed[runner].get("verified") is not True:
            raise ValueError(f"{runner} missing trusted entrypoint")
        older_shas = models[runner]["source_shas"]
        if len(older_shas) != 1 or not re.fullmatch(r"[a-f0-9]{40}", older_shas[0]):
            raise ValueError(f"{runner} ambiguous research SHA")
        new_sha = observed[runner]["git_commit"]
        older_graph = GRAPH.closure(older_shas[0], observed[runner]["entrypoint"], root)
        newer_graph = GRAPH.closure(new_sha, observed[runner]["entrypoint"], root)
        summary = evaluate_graphs(older_graph, newer_graph)
        records[runner] = {
            "research_git_commit": older_shas[0],
            "observed_live_git_commit": new_sha,
            "entrypoint": observed[runner]["entrypoint"],
            "research_uses_same_entrypoint_assumed_not_independently_verified": True,
            **summary,
        }
    return {
        "schema": "disdex-bt-research-live-static-import-delta/v1",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "PINNED_LOCAL_GIT_STATIC_IMPORT_GRAPH",
        "file_categories_are_heuristic_not_economic_causality_proof": True,
        "runtime_feature_flags_verified": False,
        "historical_trades_reexecuted": False,
        "production_bt_parity_certified": False,
        "runners": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    base = root/"docs/research-results"
    parser.add_argument("--study", type=Path, default=base/"BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json")
    parser.add_argument("--live", type=Path, default=base/"BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    parser.add_argument("--output", type=Path, default=base/"BT_RESEARCH_LIVE_STATIC_GRAPH_DELTA_20261119_UNCERTIFIED.json")
    args = parser.parse_args()
    output = audit(json.loads(args.study.read_text(encoding="utf-8")),json.loads(args.live.read_text(encoding="utf-8")),root)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    for name, row in output["runners"].items():
        print(f"{name}: research_graph={row['research_static_files']} live_graph={row['live_static_files']} diff_union={row['changed_files_in_static_graph_union']} study_replay_reexecution_required={row['source_graph_change_requires_trade_reexecution']}")
    print("CERTIFICATION=BLOCKED_HISTORICAL_REPLAY_NOT_REEXECUTED")


if __name__=="__main__":
    main()
