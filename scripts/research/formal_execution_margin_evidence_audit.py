"""Build a machine-readable execution/margin evidence matrix.

The audit distinguishes Production-order-path contract tests from historical replay
inputs. Passing contract tests never fabricates historical account, filter, or
partial/unknown-execution chronology.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

RELEVANT_SOURCE = (
    "lib/direct-trade-executor.ts",
    "lib/disdex-account-order-lock.ts",
    "lib/disdex-pending-exposure-registry.ts",
    "lib/disdex-integrated-gross-governor.ts",
    "lib/disdex-strict-portfolio-planner.ts",
    "lib/v12-live-execution-engine.ts",
    "lib/disdex-quality102-causal-v1-runner.ts",
    "lib/pengu-dual-ls-v2-portfolio-runner.ts",
    "lib/fet-brk48-live-runner.ts",
    "scripts/disdex_v52_aster_only_live_engine.py",
    "scripts/disdex_v96_v52_margin_guard_runtime.py",
)

HISTORICAL_EVIDENCE_REQUIREMENTS = (
    "point-in-time account availableBalance/equity/margin snapshots at every exposure decision",
    "point-in-time symbol filters and leverage/margin-mode read-back at every exposure decision",
    "causal pending-order and account-lock chronology",
    "partial/unknown execution reconciliation chronology with actual venue timestamps",
    "resident protection fill chronology and actual exit timestamps",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(repo: Path, *args: str) -> str:
    return subprocess.run(
        list(args), cwd=repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    ).stdout.strip()


def write_json(path: Path, payload: Any) -> str:
    raw = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def scan_fixed_release_for_historical_execution_inputs(release_root: Path) -> dict[str, list[str]]:
    patterns = {
        "account_snapshots": ("account-snapshot", "account_snapshot", "available-balance", "available_balance"),
        "historical_symbol_filters": ("exchangeinfo-history", "exchange_info_history", "symbol-filter-history", "filter-history"),
        "historical_execution_events": ("execution-event", "execution_event", "order-event", "partial-fill", "unknown-execution"),
        "historical_margin_readback": ("margin-readback", "margin_readback", "leverage-readback", "margin-mode-history"),
    }
    found: dict[str, list[str]] = {key: [] for key in patterns}
    for path in release_root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(release_root).as_posix().lower()
        # Source code/test names are not historical event tapes.
        if "all-reconstruction-code-plus-90-file-audited-source/runtime_source_snapshot/" in relative:
            continue
        for key, needles in patterns.items():
            if any(needle in relative for needle in needles):
                found[key].append(path.relative_to(release_root).as_posix())
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--production-sha", required=True)
    parser.add_argument("--rule-contract-tests-passed", action="store_true")
    args = parser.parse_args(argv)

    repo = args.repo_root.resolve()
    release = args.release_root.resolve()
    head = run(repo, "git", "rev-parse", "HEAD")
    if head != args.target_sha:
        raise RuntimeError(f"TARGET_SHA_MISMATCH:{head}:{args.target_sha}")
    run(repo, "git", "cat-file", "-e", f"{args.production_sha}^{{commit}}")

    source = {}
    for rel in RELEVANT_SOURCE:
        path = repo / rel
        if not path.is_file():
            raise RuntimeError(f"RELEVANT_SOURCE_MISSING:{rel}")
        source[rel] = {"sha256": sha256(path)}

    changed_from_live = [
        line for line in run(
            repo,
            "git", "diff", "--name-only",
            f"{args.production_sha}..{args.target_sha}",
            "--", *RELEVANT_SOURCE,
        ).splitlines() if line
    ]

    historical = scan_fixed_release_for_historical_execution_inputs(release)
    historical_complete = all(bool(rows) for rows in historical.values())

    # The authenticated V52 archive explicitly refuses LIVE execution parity.
    v52_summary_path = release / "v52-SHA-verified-original-ledger" / "v52-model-summary.json"
    v52_summary = json.loads(v52_summary_path.read_text(encoding="utf-8"))
    if v52_summary.get("audited_live_execution_parity") is not False:
        raise RuntimeError("V52_ARCHIVE_EXECUTION_PARITY_FLAG_UNEXPECTED")

    rule_matrix = {
        "account_lock_bounded_retry": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "cross_runner_pending_exposure_reservation": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "v12_preorder_worst_case_gross_reservation": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "exact_5x_cross_mutation_and_readback_before_exposure": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "unknown_partial_exit_fail_closed": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "actual_fill_timestamp_required_for_cooldown": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "resident_protection_recovery_contract": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "q102_preemption_replans_after_realized_exit": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
    }

    historical_matrix = {
        key: {
            "status": "FOUND_IN_FIXED_RELEASE" if rows else "MISSING_FROM_FIXED_RELEASE",
            "paths": rows,
        }
        for key, rows in historical.items()
    }

    overall = (
        "PASS"
        if args.rule_contract_tests_passed and historical_complete and v52_summary.get("audited_live_execution_parity") is True
        else "BLOCKED_HISTORICAL_EXECUTION_MARGIN_INPUTS_MISSING"
    )
    payload = {
        "schema_version": 1,
        "status": overall,
        "certification_issued": False,
        "production_mutation_allowed": False,
        "target_sha": args.target_sha,
        "current_production_sha": args.production_sha,
        "rule_contract_tests": rule_matrix,
        "rule_contract_test_status": "PASS" if args.rule_contract_tests_passed else "NOT_RUN",
        "relevant_source_sha256": source,
        "relevant_source_changed_from_current_production": changed_from_live,
        "historical_input_evidence": historical_matrix,
        "historical_requirements": list(HISTORICAL_EVIDENCE_REQUIREMENTS),
        "v52_archived_live_execution_parity": v52_summary.get("audited_live_execution_parity"),
        "v52_archived_limitations": v52_summary.get("limitations", []),
        "ruling": (
            "Order-path safety contracts may be proven by tests, but they do not establish historical "
            "execution/margin parity. The fixed release lacks the point-in-time account/filter/execution "
            "event tapes required to replay available margin, 5x Cross read-back, partial/unknown outcomes, "
            "and resident-protection chronology exactly. Missing historical evidence remains fail-closed."
        ),
    }
    manifest_sha = write_json(args.output.resolve(), payload)
    print(json.dumps({
        "status": overall,
        "rule_contract_test_status": payload["rule_contract_test_status"],
        "missing_historical_categories": [
            key for key, value in historical_matrix.items() if value["status"] != "FOUND_IN_FIXED_RELEASE"
        ],
        "manifest_sha256": manifest_sha,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
