#!/usr/bin/env python3
"""Read-only Git source gate for formal STABLE4 DD30 SHA-bound cutovers.

Runs from protected master before Owner-goal claim, Root staging, or exchange
operations. Unprotected candidate lineages cannot be used.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from typing import Callable

SOURCE_CONTRACT = {
    "lib/disdex-shared-risk-writer-pin.ts": (
        "checkSharedRiskWriterPin",
        "SHARED_RISK_WRITER_NOT_PINNED",
        ".disdex-release-sha",
    ),
    "scripts/disdex-shared-crypto-risk-writer.ts": (
        "assertSharedRiskWriterPinned()",
        "assertWriterPinned: assertStillPinned",
    ),
    "lib/disdex-shared-crypto-risk-writer.ts": (
        "await input.assertWriterPinned?.();",
    ),
    "scripts/ops/deploy/disdex_stable4_dd30_monitor_cutover.py": (
        "def retire_non_pinned_shared_risk_writers(",
        "assert_single_shared_risk_writer(read_regular(PINS, 131_072), target=target)",
    ),
    "tests/test_stable4_dd30_shared_writer_singleton.py": (
        "test_duplicate_active_is_fail_closed_even_if_disabled",
    ),
    "tests/shared-risk-writer-pin.test.ts": (
        "only exact pinned immutable release may refresh risk",
    ),
}


class CandidateGuardError(RuntimeError):
    pass


def git_show_candidate(sha: str, rel: str) -> str:
    result = subprocess.run(
        ["git", "show", sha + ":" + rel],
        text=True, encoding="utf-8", errors="strict",
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25,
    )
    if result.returncode:
        raise CandidateGuardError("SINGLE_WRITER_SOURCE_MISSING:" + rel)
    return result.stdout


def verify_singlewriter_candidate(
    sha: str,
    read_source: Callable[[str, str], str] = git_show_candidate,
) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise CandidateGuardError("CANDIDATE_SHA_INVALID")
    for rel, required in SOURCE_CONTRACT.items():
        source = read_source(sha, rel)
        for fragment in required:
            if fragment not in source:
                raise CandidateGuardError("SINGLE_WRITER_GUARD_MISSING:" + rel)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-sha", required=True)
    args = parser.parse_args()
    verify_singlewriter_candidate(args.target_sha)
    print("STABLE4_SINGLE_WRITER_CANDIDATE_BOUND=TRUE")
    print("LIVE_ORDER_PERMIT=FALSE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
