#!/usr/bin/env python3
"""Run self-contained Task 8 Python checks and report unavailable legacy inputs."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_TESTS = (
    "test_task9_engine_audit_20261020.py",
    "test_task9_fixed_ledger_replay_20261020.py",
    "test_task9_initial_adverse_stop.py",
)


def main() -> int:
    sys.path.insert(0, str(SCRIPT_DIR))
    suite = unittest.defaultTestLoader.loadTestsFromName("test_task8_artifact_contract_20261021")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    excluded = [
        {
            "test_file": name,
            "classification": "UNAVAILABLE_LEGACY_DEPENDENCY",
            "reason": "imports the untracked legacy V12 LONG/fixed-replay dependency tree; not present in Git checkout",
        }
        for name in LEGACY_TESTS
    ]
    summary = {
        "classification": "COMPLETE_WITH_LIMITATIONS" if result.wasSuccessful() else "BLOCKED_WITH_EVIDENCE",
        "executed_self_contained_tests": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "excluded_legacy_tests": excluded,
        "excluded_are_not_counted_as_pass_or_skip": True,
    }
    print(f"PYTHON_RESEARCH_DISCOVERY {json.dumps(summary, sort_keys=True)}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
