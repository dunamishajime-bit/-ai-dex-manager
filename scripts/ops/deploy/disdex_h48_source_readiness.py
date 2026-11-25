#!/usr/bin/env python3
"""Read-only H48 source compatibility audit. Never issues or enables orders."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

SOURCE = "4786f600ae7bf86ffca948f1412956a9113cb20d"
OVERLAY_BASE_SHA256 = "797b9356f8f788411a6c29f8c36939927b03d476c28e09ee16cfa37ae5e4f53a"
RUNNER = "lib/hype-zec-long-runner.ts"
ENTRYPOINT = "scripts/disdex-hype-zec-long-live-runner.ts"
TREND_WRAPPER = "scripts/disdex-hype-trend-live-runner.ts"


def assess_source(root: Path, expected_base: str = OVERLAY_BASE_SHA256) -> dict:
    """Inspect only the exact checked-out candidate; missing files fail closed."""
    reasons = []
    sources = {}
    for path in (RUNNER, ENTRYPOINT, TREND_WRAPPER):
        target = root / path
        if not target.is_file() or target.is_symlink():
            reasons.append("H48_SOURCE_MISSING:" + path)
            continue
        raw = target.read_bytes()
        if len(raw) > 2_000_000:
            reasons.append("H48_SOURCE_TOO_LARGE:" + path)
            continue
        sources[path] = raw
    runner = sources.get(RUNNER, b"")
    entry = sources.get(ENTRYPOINT, b"")
    wrapper = sources.get(TREND_WRAPPER, b"")
    runner_digest = hashlib.sha256(runner).hexdigest()
    if runner_digest != expected_base:
        reasons.append("H48_LEGACY_OVERLAY_BASE_SHA256_MISMATCH")
    if not all(marker in runner for marker in (
        b"HYPE_H48_TIME_ONLY_ENTRY_COMPLETED",
        b"HYPE_H48_TIME_ONLY_EXIT_NOT_DUE",
    )):
        reasons.append("H48_TIME_ONLY_ENTRY_EXIT_NOT_PRESENT")
    if b"createH48TimeOnlyPolicyAuthority(" not in entry:
        reasons.append("H48_TIME_ONLY_AUTHORITY_NOT_WIRED")
    if re.search(rb'DISDEX_HYPE_ZEC_SIGNAL_MODE\s*=\s*["\']TREND["\']', wrapper):
        reasons.append("H48_TREND_WRAPPER_REQUIRES_SEPARATE_LAUNCH_REVIEW")
    return {
        "status": "H48_SOURCE_REVIEW_BLOCKED" if reasons else "H48_STATIC_SOURCE_CHECK_PASS_NOT_AUTHORIZATION",
        "reasons": reasons,
        "sourceSha": SOURCE,
        "runnerSha256": runner_digest,
        "expectedLegacyOverlaySha256": expected_base,
        "ordersEnabled": False,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
        "certificateIssued": False,
        "approvalRedeemed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    revision = subprocess.run(
        ["git", "-C", str(args.source_dir), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True, timeout=15,
    ).stdout.strip()
    if revision != SOURCE:
        print(json.dumps({"status": "H48_SOURCE_REVIEW_BLOCKED", "reasons": ["H48_EXACT_SOURCE_SHA_MISMATCH"],
                          "ordersEnabled": False, "certificateIssued": False, "approvalRedeemed": False}))
        return 2
    dirty = subprocess.run(
        ["git", "-C", str(args.source_dir), "status", "--porcelain", "--untracked-files=no"],
        capture_output=True, text=True, check=True, timeout=15,
    ).stdout.strip()
    if dirty:
        print(json.dumps({"status": "H48_SOURCE_REVIEW_BLOCKED", "reasons": ["H48_SOURCE_DIR_DIRTY"],
                          "ordersEnabled": False, "certificateIssued": False, "approvalRedeemed": False}))
        return 2
    result = assess_source(args.source_dir)
    print(json.dumps(result, sort_keys=True))
    return 2 if result["reasons"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
